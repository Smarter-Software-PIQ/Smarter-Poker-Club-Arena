/**
 * ROLLING HANDOFF: two engine instances, one database, every table moves at
 * its own hand boundary (owner order 2026-11-19: stop requiring an engine
 * cutover for any upgrade, improvement or fix).
 *
 * The world below is two engine instances over ONE fake database whose lease
 * and handoff rules mirror the migration
 * 20261119211200_an_engine_hands_a_table_on_at_its_own_hand_boundary.sql and
 * claim_table_lease_v2 (renewal of the same instance + generation, takeover of
 * a stale row only). Every hand commits only while its dealer holds the exact
 * lease, as fn_ca_commit_hand_settlement_exact_before_obligations requires.
 *
 * What is proven:
 *   - every table and tournament moves at a hand boundary, none is forced;
 *   - no hand is ever split: each hand starts and commits on one instance,
 *     under the lease it started with, and the move happens with no card in
 *     the air;
 *   - seats and stacks are identical across the move, and a tournament's level
 *     clock is preserved;
 *   - a failed adoption, or a fingerprint mismatch, goes back to the old
 *     instance, which deals it again;
 *   - the old instance retires only when it owns nothing;
 *   - a lost answer is replayed and never moves a lease twice;
 *   - with the flag off nothing is constructed.
 */
import { describe, expect, it } from 'vitest';
import {
  RollingHandoffCoordinator,
  fingerprintsMatch,
  unitId,
  type BoundaryFingerprint,
  type HandoffEnginePort,
  type HandoffUnit,
} from './RollingHandoffCoordinator.js';
import { createLeaseHandoffStore } from './leaseHandoffStore.js';
import type {
  HandedLease,
  HandOffRequest,
  HandOffResult,
  LeaseHandoffStore,
} from './leaseHandoffStore.js';
import { rollingHandoffEnabled, ROLLING_HANDOFF_FLAG } from './rollingHandoffFlag.js';

type Seat = { seat: number; userId: string; stack: number };
type Clock = { level: number; levelStartedAtMs: number; onBreak: boolean };
type Lease = { instance: string; generation: string; heartbeatAt: number };
type Row = {
  id: string;
  scope: 'table' | 'tournament';
  leaseKey: string;
  kind: 'handoff' | 'return';
  parentId: string | null;
  fromInstance: string;
  fromGeneration: string;
  toInstance: string;
  toGeneration: string;
  fingerprint: BoundaryFingerprint | null;
  state: 'handed' | 'adopted' | 'returned' | 'abandoned';
};
type HandLog = {
  tableId: string;
  hand: number;
  startedOn: string;
  leaseAtStart: boolean;
  finishedOn: string | null;
  committed: boolean | null;
};

const STALE_MS = 30_000;
let uuidSeq = 0;
const uuid = (): string => {
  uuidSeq += 1;
  return `00000000-0000-4000-8000-${String(uuidSeq).padStart(12, '0')}`;
};

// ── The one database both instances share ──────────────────────────────────

class FakeDb {
  now = 1_700_000_000_000;
  readonly leases = new Map<string, Lease>();
  readonly rows: Row[] = [];
  readonly seats = new Map<string, Seat[]>();
  readonly clocks = new Map<string, Clock>();
  readonly tournamentTables = new Map<string, string[]>();
  readonly nextHand = new Map<string, number>();
  readonly casWithCardsInAir: string[] = [];
  /** Who answers whether a unit has a hand in the air (the world). */
  cardsInAir: (scope: 'table' | 'tournament', key: string) => boolean = () => false;

  k(scope: string, key: string): string {
    return `${scope}:${key}`;
  }

  claim(scope: 'table' | 'tournament', key: string, instance: string, generation: string): boolean {
    const id = this.k(scope, key);
    const row = this.leases.get(id);
    if (!row) {
      this.leases.set(id, { instance, generation, heartbeatAt: this.now });
      return true;
    }
    if (row.instance === instance && row.generation === generation) {
      row.heartbeatAt = this.now;
      return true;
    }
    if (this.now - row.heartbeatAt > STALE_MS && row.generation !== generation) {
      this.leases.set(id, { instance, generation, heartbeatAt: this.now });
      return true;
    }
    return false;
  }

  holds(scope: 'table' | 'tournament', key: string, instance: string, generation: string): boolean {
    const row = this.leases.get(this.k(scope, key));
    return (
      !!row &&
      row.instance === instance &&
      row.generation === generation &&
      this.now - row.heartbeatAt <= STALE_MS
    );
  }

  heartbeat(
    scope: 'table' | 'tournament',
    key: string,
    instance: string,
    generation: string
  ): void {
    if (this.holds(scope, key, instance, generation))
      this.leases.get(this.k(scope, key))!.heartbeatAt = this.now;
  }

  release(scope: 'table' | 'tournament', key: string, generation: string): void {
    const id = this.k(scope, key);
    if (this.leases.get(id)?.generation === generation) this.leases.delete(id);
  }

  /** fn_engine_hand_off_lease_v1, rule for rule. */
  handOff(r: HandOffRequest): HandOffResult {
    if (r.fromInstance === r.toInstance || r.fromGeneration === r.toGeneration)
      return { status: 'refused', reason: 'invalid_request' };
    if ((r.kind === 'return') !== (r.parentId !== null))
      return { status: 'refused', reason: 'invalid_request' };
    const replay = this.rows.find(
      (x) => x.scope === r.scope && x.leaseKey === r.leaseKey && x.toGeneration === r.toGeneration
    );
    if (replay) {
      return replay.fromInstance === r.fromInstance &&
        replay.fromGeneration === r.fromGeneration &&
        replay.toInstance === r.toInstance &&
        replay.kind === r.kind
        ? { status: 'transferred', handoffId: replay.id }
        : { status: 'refused', reason: 'generation_already_used' };
    }
    let parent: Row | undefined;
    if (r.kind === 'return') {
      parent = this.rows.find((x) => x.id === r.parentId);
      if (
        !parent ||
        parent.state !== 'handed' ||
        parent.kind !== 'handoff' ||
        parent.toInstance !== r.fromInstance ||
        parent.toGeneration !== r.fromGeneration ||
        parent.fromInstance !== r.toInstance
      )
        return { status: 'refused', reason: 'return_parent_mismatch' };
    }
    const id = this.k(r.scope, r.leaseKey);
    const lease = this.leases.get(id);
    if (!lease) {
      if (r.kind !== 'return') return { status: 'refused', reason: 'lease_missing' };
      this.leases.set(id, {
        instance: r.toInstance,
        generation: r.toGeneration,
        heartbeatAt: this.now,
      });
    } else {
      if (lease.instance !== r.fromInstance || lease.generation !== r.fromGeneration)
        return { status: 'refused', reason: 'lease_not_held' };
      if (this.now - lease.heartbeatAt > STALE_MS)
        return { status: 'refused', reason: 'lease_stale' };
      if (this.cardsInAir(r.scope, r.leaseKey)) this.casWithCardsInAir.push(id);
      this.leases.set(id, {
        instance: r.toInstance,
        generation: r.toGeneration,
        heartbeatAt: this.now,
      });
    }
    if (parent) parent.state = 'returned';
    const row: Row = {
      id: uuid(),
      scope: r.scope,
      leaseKey: r.leaseKey,
      kind: r.kind,
      parentId: r.parentId,
      fromInstance: r.fromInstance,
      fromGeneration: r.fromGeneration,
      toInstance: r.toInstance,
      toGeneration: r.toGeneration,
      fingerprint: r.fingerprint,
      state: 'handed',
    };
    this.rows.push(row);
    return { status: 'transferred', handoffId: row.id };
  }

  /** fn_engine_handed_leases_v1. */
  handedTo(instance: string): HandedLease[] {
    return this.rows
      .filter((x) => x.toInstance === instance && x.state === 'handed')
      .filter((x) => {
        const lease = this.leases.get(this.k(x.scope, x.leaseKey));
        return !!lease && lease.instance === x.toInstance && lease.generation === x.toGeneration;
      })
      .map((x) => ({
        handoffId: x.id,
        scope: x.scope,
        leaseKey: x.leaseKey,
        fromInstance: x.fromInstance,
        toGeneration: x.toGeneration,
        fingerprint: x.fingerprint,
        kind: x.kind,
      }));
  }

  settle(id: string, instance: string, outcome: 'adopted' | 'abandoned'): boolean {
    const row = this.rows.find((x) => x.id === id && x.toInstance === instance);
    if (!row) return false;
    if (row.state === 'handed') {
      row.state = outcome;
      return true;
    }
    return row.state === outcome;
  }

  /** fn_engine_open_lease_handoffs_v1. */
  openHandoffs(instance: string): number {
    return this.rows.filter((x) => {
      if (x.state !== 'handed') return false;
      if (x.fromInstance !== instance && x.toInstance !== instance) return false;
      const lease = this.leases.get(this.k(x.scope, x.leaseKey));
      return !!lease && lease.instance === x.toInstance && lease.generation === x.toGeneration;
    }).length;
  }

  store(): LeaseHandoffStore {
    return {
      handOff: async (r) => this.handOff(r),
      handedTo: async (i) => this.handedTo(i),
      settle: async (id, i, o) => this.settle(id, i, o),
      openHandoffs: async (i) => this.openHandoffs(i),
    };
  }
}

// ── A dealer: one table on one instance ─────────────────────────────────────

class FakeTable {
  running = true;
  handInProgress = false;
  currentHand = 0;
  parked = false;
  held = false;
  stuck = false;
  constructor(
    readonly id: string,
    readonly instance: FakeInstance,
    public seats: Seat[],
    readonly lease: { scope: 'table' | 'tournament'; key: string; generation: string }
  ) {}

  holdsLease(): boolean {
    return this.instance.world.db.holds(
      this.lease.scope,
      this.lease.key,
      this.instance.name,
      this.lease.generation
    );
  }

  step(): void {
    if (!this.running) return;
    const world = this.instance.world;
    if (this.handInProgress) {
      if (this.stuck) return;
      const log = world.hands.find(
        (h) => h.tableId === this.id && h.hand === this.currentHand && h.finishedOn === null
      )!;
      log.finishedOn = this.instance.name;
      // A hand commits only under the exact lease it was dealt under.
      log.committed = this.holdsLease();
      if (log.committed && this.seats.length >= 2) {
        const moved = 10;
        this.seats = this.seats.map((s, i) =>
          i === 0
            ? { ...s, stack: s.stack - moved }
            : i === 1
              ? { ...s, stack: s.stack + moved }
              : s
        );
        world.db.seats.set(
          this.id,
          this.seats.map((s) => ({ ...s }))
        );
      }
      this.handInProgress = false;
      return;
    }
    if (this.parked || this.held) return;
    const hand = (world.db.nextHand.get(this.id) ?? 0) + 1;
    world.db.nextHand.set(this.id, hand);
    this.currentHand = hand;
    this.handInProgress = true;
    world.hands.push({
      tableId: this.id,
      hand,
      startedOn: this.instance.name,
      leaseAtStart: this.holdsLease(),
      finishedOn: null,
      committed: null,
    });
  }
}

class FakeTournament {
  running = true;
  constructor(
    readonly id: string,
    readonly generation: string,
    public clock: Clock,
    readonly tables: FakeTable[]
  ) {}
}

// ── An engine instance and its port ──────────────────────────────────────────

class FakeInstance {
  readonly tables = new Map<string, FakeTable>();
  readonly tournaments = new Map<string, FakeTournament>();
  readonly failAdopt = new Set<string>();
  readonly corruptOnAdopt = new Set<string>();
  readonly reports: string[] = [];
  readonly coordinator: RollingHandoffCoordinator;

  constructor(
    readonly name: string,
    readonly world: World,
    options: { boundaryDeadlineMs?: number; store?: LeaseHandoffStore } = {}
  ) {
    this.coordinator = new RollingHandoffCoordinator(
      this.port(),
      options.store ?? world.db.store(),
      {
        boundaryDeadlineMs: options.boundaryDeadlineMs ?? 60_000,
        pollMs: 1_000,
        now: () => world.db.now,
        sleep: async () => {
          world.tick();
          await new Promise<void>((resolve) => setImmediate(resolve));
        },
        newGeneration: uuid,
      }
    );
  }

  cash(id: string, seats: Seat[]): FakeTable {
    const generation = uuid();
    expect(this.world.db.claim('table', id, this.name, generation)).toBe(true);
    this.world.db.seats.set(
      id,
      seats.map((s) => ({ ...s }))
    );
    const t = new FakeTable(
      id,
      this,
      seats.map((s) => ({ ...s })),
      {
        scope: 'table',
        key: id,
        generation,
      }
    );
    this.tables.set(id, t);
    return t;
  }

  tournament(id: string, clock: Clock, tables: Record<string, Seat[]>): FakeTournament {
    const generation = uuid();
    expect(this.world.db.claim('tournament', id, this.name, generation)).toBe(true);
    this.world.db.clocks.set(id, { ...clock });
    this.world.db.tournamentTables.set(id, Object.keys(tables));
    const engines = Object.entries(tables).map(([tableId, seats]) => {
      this.world.db.seats.set(
        tableId,
        seats.map((s) => ({ ...s }))
      );
      const t = new FakeTable(
        tableId,
        this,
        seats.map((s) => ({ ...s })),
        {
          scope: 'tournament',
          key: id,
          generation,
        }
      );
      this.tables.set(tableId, t);
      return t;
    });
    const tournament = new FakeTournament(id, generation, { ...clock }, engines);
    this.tournaments.set(id, tournament);
    return tournament;
  }

  tick(): void {
    for (const t of this.tables.values()) {
      this.world.db.heartbeat(t.lease.scope, t.lease.key, this.name, t.lease.generation);
      t.step();
    }
  }

  private cashTable(unit: HandoffUnit): FakeTable | undefined {
    const t = this.tables.get(unit.key);
    return unit.scope === 'table' && t && t.lease.scope === 'table' ? t : undefined;
  }

  port(): HandoffEnginePort {
    return {
      instanceId: this.name,
      version: `v-${this.name}`,
      ownedUnits: () => [
        ...[...this.tables.values()]
          .filter((t) => t.running && t.lease.scope === 'table')
          .map((t) => ({ scope: 'table' as const, key: t.id })),
        ...[...this.tournaments.values()]
          .filter((t) => t.running)
          .map((t) => ({ scope: 'tournament' as const, key: t.id })),
      ],
      eligibility: () => null,
      leaseGeneration: (unit) =>
        unit.scope === 'table'
          ? (this.cashTable(unit)?.lease.generation ?? null)
          : (this.tournaments.get(unit.key)?.generation ?? null),
      parkAtNextBoundary: (unit) => {
        if (unit.scope === 'table') {
          const t = this.cashTable(unit);
          if (t) t.parked = true;
        } else for (const t of this.tournaments.get(unit.key)?.tables ?? []) t.parked = true;
      },
      releasePark: (unit) => {
        if (unit.scope === 'table') {
          const t = this.cashTable(unit);
          if (t) t.parked = false;
        } else for (const t of this.tournaments.get(unit.key)?.tables ?? []) t.parked = false;
      },
      boundaryState: (unit) => {
        const tables =
          unit.scope === 'table'
            ? [this.cashTable(unit)].filter((t): t is FakeTable => !!t)
            : (this.tournaments.get(unit.key)?.tables ?? []);
        if (tables.length === 0) return { atBoundary: false, reason: 'not_running' };
        const busy = tables.find((t) => t.handInProgress || !t.parked);
        return busy ? { atBoundary: false, reason: 'cards_in_air' } : { atBoundary: true };
      },
      fingerprint: (unit) => {
        if (unit.scope === 'table') {
          const t = this.cashTable(unit);
          return t ? { seats: t.seats.map((s) => ({ ...s })), clock: null } : null;
        }
        const tour = this.tournaments.get(unit.key);
        return tour ? { seats: [], clock: { ...tour.clock } } : null;
      },
      retireYielded: async (unit) => {
        if (unit.scope === 'table') {
          const t = this.cashTable(unit);
          if (t) {
            t.running = false;
            this.tables.delete(t.id);
          }
        } else {
          const tour = this.tournaments.get(unit.key);
          if (tour) {
            tour.running = false;
            for (const t of tour.tables) {
              t.running = false;
              this.tables.delete(t.id);
            }
            this.tournaments.delete(tour.id);
          }
        }
        this.coordinator.noteUnitLeft();
      },
      adopt: async (unit, generation) => {
        if (this.failAdopt.has(unit.key)) {
          // GameServer's own failed-start recovery releases the exact generation.
          this.world.db.release(unit.scope, unit.key, generation);
          return false;
        }
        if (!this.world.db.claim(unit.scope, unit.key, this.name, generation)) return false;
        if (unit.scope === 'table') {
          const seats = (this.world.db.seats.get(unit.key) ?? []).map((s) => ({ ...s }));
          if (this.corruptOnAdopt.has(unit.key) && seats[0]) seats[0].stack += 1;
          const t = new FakeTable(unit.key, this, seats, {
            scope: 'table',
            key: unit.key,
            generation,
          });
          t.held = this.coordinator.holdsArrival(unit);
          this.tables.set(unit.key, t);
          return true;
        }
        const tables = (this.world.db.tournamentTables.get(unit.key) ?? []).map((tableId) => {
          const t = new FakeTable(
            tableId,
            this,
            (this.world.db.seats.get(tableId) ?? []).map((s) => ({ ...s })),
            { scope: 'tournament', key: unit.key, generation }
          );
          this.tables.set(tableId, t);
          return t;
        });
        this.tournaments.set(
          unit.key,
          new FakeTournament(
            unit.key,
            generation,
            { ...this.world.db.clocks.get(unit.key)! },
            tables
          )
        );
        return true;
      },
      releaseArrivalHold: (unit) => {
        const t = this.cashTable(unit);
        if (t) t.held = false;
      },
      holdsArrivalOf: (unit) => unit.scope === 'table',
      activeNonUnitWork: () => null,
      report: (_error, context) => {
        this.reports.push(context);
      },
    };
  }
}

class World {
  readonly db = new FakeDb();
  readonly hands: HandLog[] = [];
  readonly instances: FakeInstance[] = [];
  constructor() {
    this.db.cardsInAir = (scope, key) =>
      this.instances.some((i) =>
        [...i.tables.values()].some(
          (t) => t.running && t.lease.scope === scope && t.lease.key === key && t.handInProgress
        )
      );
  }
  instance(name: string, options?: ConstructorParameters<typeof FakeInstance>[2]): FakeInstance {
    const i = new FakeInstance(name, this, options);
    this.instances.push(i);
    return i;
  }
  tick(): void {
    this.db.now += 1_000;
    for (const i of this.instances) i.tick();
  }
  ticks(n: number): void {
    for (let k = 0; k < n; k++) this.tick();
  }
}

const seats = (...stacks: number[]): Seat[] =>
  stacks.map((stack, i) => ({ seat: i + 1, userId: `user-${i + 1}`, stack }));

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const T3 = '33333333-3333-4333-8333-333333333333';
const MTT = '44444444-4444-4444-8444-444444444444';
const MTT_A = '55555555-5555-4555-8555-555555555555';
const MTT_B = '66666666-6666-4666-8666-666666666666';
const CLOCK: Clock = { level: 7, levelStartedAtMs: 1_699_999_880_000, onBreak: false };

/** No hand anywhere was split, dealt without its lease, or moved with cards in the air. */
function expectNoSplitHand(world: World): void {
  for (const h of world.hands) {
    expect(h.leaseAtStart, `hand ${h.tableId}#${h.hand} dealt without its lease`).toBe(true);
    if (h.finishedOn !== null) {
      expect(h.finishedOn, `hand ${h.tableId}#${h.hand} split across instances`).toBe(h.startedOn);
      expect(h.committed, `hand ${h.tableId}#${h.hand} could not commit`).toBe(true);
    }
  }
  expect(world.db.casWithCardsInAir).toEqual([]);
  const byTable = new Map<string, number[]>();
  for (const h of world.hands) byTable.set(h.tableId, [...(byTable.get(h.tableId) ?? []), h.hand]);
  for (const [tableId, hands] of byTable) {
    expect(new Set(hands).size, `table ${tableId} dealt a hand number twice`).toBe(hands.length);
  }
}

function standardWorld(options?: { boundaryDeadlineMs?: number }) {
  const world = new World();
  const a = world.instance('engine-old', options);
  const b = world.instance('engine-new', options);
  a.cash(T1, seats(1000, 1000, 500));
  a.cash(T2, seats(200, 300));
  a.cash(T3, seats(750, 250, 400, 600));
  a.tournament(MTT, CLOCK, { [MTT_A]: seats(5000, 4000, 3000), [MTT_B]: seats(6000, 2000) });
  return { world, a, b };
}

/** The release asks the old instance to yield, the new one adopts, the old one re-checks. */
async function moveEverything(world: World, a: FakeInstance, b: FakeInstance) {
  world.tick(); // every table has a hand in the air when the release asks
  const status = await a.coordinator.yieldTo('engine-new');
  await b.coordinator.adoptPass();
  await a.coordinator.adoptPass();
  return { status };
}

describe('rolling handoff: two instances, one database', () => {
  it('moves every table and tournament at its own hand boundary and splits no hand', async () => {
    const { world, a, b } = standardWorld();
    const { status } = await moveEverything(world, a, b);

    expect(status.yields.map((y) => [unitId(y.unit), y.state]).sort()).toEqual(
      [
        [`table:${T1}`, 'yielded'],
        [`table:${T2}`, 'yielded'],
        [`table:${T3}`, 'yielded'],
        [`tournament:${MTT}`, 'yielded'],
      ].sort()
    );
    // Every hand that was in the air when the release asked finished on the
    // old instance; no new hand was dealt there after its park.
    const inAirAtAsk = world.hands.filter((h) => h.startedOn === 'engine-old');
    expect(inAirAtAsk).toHaveLength(5);
    expect(inAirAtAsk.every((h) => h.finishedOn === 'engine-old' && h.committed)).toBe(true);

    // The new instance owns every lease with the exact handed generation.
    for (const key of [T1, T2, T3])
      expect(world.db.leases.get(`table:${key}`)?.instance).toBe('engine-new');
    expect(world.db.leases.get(`tournament:${MTT}`)?.instance).toBe('engine-new');
    expect(world.db.rows.every((r) => r.state === 'adopted')).toBe(true);

    // ...and deals on.
    world.ticks(6);
    const newHands = world.hands.filter((h) => h.startedOn === 'engine-new');
    expect(new Set(newHands.map((h) => h.tableId))).toEqual(new Set([T1, T2, T3, MTT_A, MTT_B]));
    expectNoSplitHand(world);
    // Hand numbers continue from the database, never restart.
    for (const tableId of [T1, T2, T3, MTT_A, MTT_B]) {
      const numbers = world.hands.filter((h) => h.tableId === tableId).map((h) => h.hand);
      expect(numbers).toEqual([...numbers].sort((x, y) => x - y));
      expect(numbers[0]).toBe(1);
    }
  });

  it('keeps every seat and stack identical across the move', async () => {
    const { world, a, b } = standardWorld();
    await moveEverything(world, a, b);
    for (const tableId of [T1, T2, T3]) {
      const row = world.db.rows.find((r) => r.leaseKey === tableId)!;
      const adopted = b.tables.get(tableId)!;
      expect(adopted.seats).toEqual(row.fingerprint!.seats);
      expect(adopted.seats).toEqual(world.db.seats.get(tableId));
    }
    // The boundary stacks are the committed result of the last old-instance hand.
    expect(b.tables.get(T1)!.seats.map((s) => s.stack)).toEqual([990, 1010, 500]);
    expect(b.tables.get(T2)!.seats.map((s) => s.stack)).toEqual([190, 310]);
    // Seat numbers never change (avatar positions are law).
    expect(b.tables.get(T3)!.seats.map((s) => [s.seat, s.userId])).toEqual([
      [1, 'user-1'],
      [2, 'user-2'],
      [3, 'user-3'],
      [4, 'user-4'],
    ]);
  });

  it('moves a tournament with its level clock exactly preserved', async () => {
    const { world, a, b } = standardWorld();
    await moveEverything(world, a, b);
    const moved = b.tournaments.get(MTT)!;
    expect(moved.clock).toEqual(CLOCK);
    const row = world.db.rows.find((r) => r.leaseKey === MTT)!;
    expect(row.fingerprint!.clock).toEqual(CLOCK);
    // Both of its tables moved together, with their seats.
    expect(moved.tables.map((t) => t.id).sort()).toEqual([MTT_A, MTT_B].sort());
    expect(b.tables.get(MTT_B)!.seats.map((s) => s.stack)).toEqual([5990, 2010]);
    expect(a.tournaments.size).toBe(0);
  });

  it('retires the old instance only once it owns nothing and every move was adopted', async () => {
    const { world, a, b } = standardWorld();
    expect(a.coordinator.status().mode).toBe('serving');
    world.tick();
    const yielded = await a.coordinator.yieldTo('engine-new');
    // Everything left, but nothing has been adopted yet: a failure could still come back.
    expect(yielded.owned).toBe(0);
    expect(yielded.mode).toBe('yielding');
    expect(yielded.blockedRetirement).toBe('handoffs_open:4');
    await b.coordinator.adoptPass();
    await a.coordinator.adoptPass();
    const s = a.coordinator.status();
    expect(s.owned).toBe(0);
    expect(s.mode).toBe('retired');
    expect(s.retiredAtMs).not.toBeNull();
    expect(a.tables.size).toBe(0);
    expect(b.coordinator.status().mode).toBe('serving');
  });

  it('rolls a failed adoption back to the old instance, which deals it again', async () => {
    const { world, a, b } = standardWorld();
    b.failAdopt.add(T2);
    await moveEverything(world, a, b);

    // The adopter's failed start released the row; the return gave it back,
    // and the old instance adopted it on its next pass.
    const lease = world.db.leases.get(`table:${T2}`)!;
    expect(lease.instance).toBe('engine-old');
    const ret = world.db.rows.find((r) => r.leaseKey === T2 && r.kind === 'return')!;
    expect(ret.toInstance).toBe('engine-old');
    expect(world.db.rows.find((r) => r.leaseKey === T2 && r.kind === 'handoff')!.state).toBe(
      'returned'
    );
    expect(b.coordinator.refusesAdmission({ scope: 'table', key: T2 })).toBe(true);
    expect(b.reports).not.toContain('RollingHandoff.return_unconfirmed');
    expect(ret.state).toBe('adopted');
    expect(a.tables.get(T2)!.seats).toEqual(world.db.seats.get(T2));
    world.ticks(4);
    expect(
      world.hands.some((h) => h.tableId === T2 && h.startedOn === 'engine-old' && h.hand > 1)
    ).toBe(true);
    expect(world.hands.some((h) => h.tableId === T2 && h.startedOn === 'engine-new')).toBe(false);
    expectNoSplitHand(world);

    // The old instance owns T2 again, so it is not retired.
    const s = a.coordinator.status();
    expect(s.mode).toBe('yielding');
    expect(s.blockedRetirement).toBe('owns_units:1');
  });

  it('hands a table back, unsplit and undealt, when its boundary fingerprint does not match', async () => {
    const { world, a, b } = standardWorld();
    b.corruptOnAdopt.add(T3);
    await moveEverything(world, a, b);
    expect(b.reports).toContain('RollingHandoff.fingerprint_mismatch');
    expect(b.tables.has(T3)).toBe(false);
    expect(world.db.leases.get(`table:${T3}`)!.instance).toBe('engine-old');
    world.ticks(4);
    // The held arrival never dealt a hand on the new instance.
    expect(world.hands.some((h) => h.tableId === T3 && h.startedOn === 'engine-new')).toBe(false);
    expect(
      world.hands.some((h) => h.tableId === T3 && h.startedOn === 'engine-old' && h.hand > 1)
    ).toBe(true);
    expectNoSplitHand(world);
  });

  it('never forces a table: one that cannot reach a boundary is kept and deals on here', async () => {
    const { world, a, b } = standardWorld({ boundaryDeadlineMs: 8_000 });
    world.tick();
    a.tables.get(T1)!.stuck = true; // its hand will not finish inside the deadline
    const status = await a.coordinator.yieldTo('engine-new');
    await b.coordinator.adoptPass();
    const t1 = status.yields.find((y) => y.unit.key === T1)!;
    expect(t1.state).toBe('kept');
    expect(t1.reason).toMatch(/^boundary_deadline:cards_in_air/);
    expect(a.tables.get(T1)!.parked).toBe(false); // the park was released
    expect(world.db.leases.get(`table:${T1}`)!.instance).toBe('engine-old');
    expect(status.mode).toBe('yielding');
    expect(status.blockedRetirement).toBe('owns_units:1');

    // Later the hand finishes; asking again moves it and the old instance retires.
    a.tables.get(T1)!.stuck = false;
    const again = await a.coordinator.yieldTo('engine-new');
    await b.coordinator.adoptPass();
    await a.coordinator.adoptPass();
    expect(again.yields.find((y) => y.unit.key === T1)!.state).toBe('yielded');
    expect(a.coordinator.status().mode).toBe('retired');
    expect(b.tables.has(T1)).toBe(true);
    expectNoSplitHand(world);
  });

  it('keeps a table here when the database refuses the move', async () => {
    const { world, a, b } = standardWorld();
    world.tick();
    // Somebody else's generation is on the row: the CAS must refuse, not overwrite.
    world.db.leases.set(`table:${T2}`, {
      instance: 'engine-stranger',
      generation: uuid(),
      heartbeatAt: world.db.now,
    });
    const status = await a.coordinator.yieldTo('engine-new');
    await b.coordinator.adoptPass();
    const t2 = status.yields.find((y) => y.unit.key === T2)!;
    expect(t2.state).toBe('kept');
    expect(a.coordinator.status().blockedRetirement).toBe('owns_units:1');
    expect(t2.reason).toBe('handoff_refused:lease_not_held');
    expect(a.tables.get(T2)!.parked).toBe(false);
    expect(world.db.leases.get(`table:${T2}`)!.instance).toBe('engine-stranger');
    expect(b.tables.has(T2)).toBe(false);
  });

  it('replays a lost answer and never moves a lease twice', async () => {
    const world = new World();
    const real = world.db.store();
    let lost = 0;
    const lossy: LeaseHandoffStore = {
      ...real,
      handOff: async (r) => {
        const answer = await real.handOff(r);
        if (lost === 0) {
          lost += 1;
          return { status: 'unknown', detail: 'socket hang up' }; // committed, answer lost
        }
        return answer;
      },
    };
    const a = world.instance('engine-old', { store: lossy });
    const b = world.instance('engine-new');
    a.cash(T1, seats(100, 100));
    world.tick();
    const status = await a.coordinator.yieldTo('engine-new');
    expect(status.yields[0]!.state).toBe('yielded');
    expect(world.db.rows.filter((r) => r.leaseKey === T1)).toHaveLength(1);
    await b.coordinator.adoptPass();
    expect(b.tables.has(T1)).toBe(true);
    expectNoSplitHand(world);
  });

  it('refuses admissions only while yielding, and suppresses re-admission of moved units', async () => {
    const { world, a, b } = standardWorld();
    const unit = { scope: 'table' as const, key: T1 };
    expect(a.coordinator.refusesAdmission(unit)).toBe(false);
    expect(a.coordinator.suppressesReadmission(unit)).toBe(false);
    expect(a.coordinator.holdsArrival(unit)).toBe(false);
    expect(a.coordinator.isTransferring(unit)).toBe(false);
    await moveEverything(world, a, b);
    expect(a.coordinator.refusesAdmission(unit)).toBe(true);
    expect(a.coordinator.suppressesReadmission(unit)).toBe(true);
    expect(b.coordinator.refusesAdmission(unit)).toBe(false);
  });

  it('an aborted yield deals on with nothing moved', async () => {
    const world = new World();
    const a = world.instance('engine-old');
    world.instance('engine-new');
    a.cash(T1, seats(100, 100));
    world.tick();
    a.tables.get(T1)!.stuck = true;
    const run = a.coordinator.yieldTo('engine-new');
    await new Promise<void>((resolve) => setImmediate(resolve));
    a.coordinator.abortYield();
    const status = await run;
    expect(status.yields[0]!.reason).toBe('yield_aborted');
    expect(status.mode).toBe('serving');
    expect(a.tables.get(T1)!.parked).toBe(false);
    expect(world.db.rows).toHaveLength(0);
  });

  it('refuses to hand its tables to itself or to nobody', async () => {
    const world = new World();
    const a = world.instance('engine-old');
    await expect(a.coordinator.yieldTo('engine-old')).rejects.toThrow(/itself/);
    await expect(a.coordinator.yieldTo('')).rejects.toThrow(/successor/);
  });
});

describe('the boundary fingerprint', () => {
  const base: BoundaryFingerprint = { seats: seats(10, 20), clock: null };
  it('matches regardless of seat order', () => {
    expect(fingerprintsMatch(base, { seats: [...base.seats].reverse(), clock: null }).ok).toBe(
      true
    );
  });
  it('catches a changed stack, a changed player, a lost seat and a moved level', () => {
    expect(fingerprintsMatch(base, { seats: seats(10, 21), clock: null }).ok).toBe(false);
    expect(
      fingerprintsMatch(base, {
        seats: [base.seats[0]!, { ...base.seats[1]!, userId: 'someone-else' }],
        clock: null,
      }).ok
    ).toBe(false);
    expect(fingerprintsMatch(base, { seats: seats(10), clock: null }).ok).toBe(false);
    const clocked: BoundaryFingerprint = { seats: [], clock: CLOCK };
    expect(fingerprintsMatch(clocked, { seats: [], clock: { ...CLOCK, level: 8 } }).ok).toBe(false);
    expect(
      fingerprintsMatch(clocked, {
        seats: [],
        clock: { ...CLOCK, levelStartedAtMs: CLOCK.levelStartedAtMs + 5_000 },
      }).ok
    ).toBe(false);
    expect(
      fingerprintsMatch(clocked, {
        seats: [],
        clock: { ...CLOCK, levelStartedAtMs: CLOCK.levelStartedAtMs + 400 },
      }).ok
    ).toBe(true);
  });
});

describe('the flag', () => {
  it('is OFF unless the environment says exactly "on"', () => {
    expect(ROLLING_HANDOFF_FLAG).toBe('ENGINE_ROLLING_HANDOFF');
    expect(rollingHandoffEnabled({})).toBe(false);
    for (const value of ['1', 'true', 'ON', 'yes', ' on', '']) {
      expect(rollingHandoffEnabled({ ENGINE_ROLLING_HANDOFF: value })).toBe(false);
    }
    expect(rollingHandoffEnabled({ ENGINE_ROLLING_HANDOFF: 'on' })).toBe(true);
  });
});

describe('the PostgREST store fails closed', () => {
  const rpcAnswering = (answer: { data: unknown; error: { message?: string } | null } | Error) => ({
    calls: [] as Array<[string, Record<string, unknown>]>,
    rpc(fn: string, args: Record<string, unknown>) {
      this.calls.push([fn, args]);
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  });
  const request: HandOffRequest = {
    scope: 'table',
    leaseKey: T1,
    fromInstance: 'engine-old',
    fromGeneration: uuid(),
    toInstance: 'engine-new',
    toVersion: 'successor',
    toGeneration: uuid(),
    fingerprint: { seats: seats(10), clock: null },
    kind: 'handoff',
    parentId: null,
  };

  it('sends the exact request and reads a transfer', async () => {
    const id = uuid();
    const client = rpcAnswering({ data: { ok: true, handoff_id: id }, error: null });
    const store = createLeaseHandoffStore(client);
    expect(await store.handOff(request)).toEqual({ status: 'transferred', handoffId: id });
    expect(client.calls[0]![0]).toBe('fn_engine_hand_off_lease_v1');
    expect(client.calls[0]![1]).toMatchObject({
      p_scope: 'table',
      p_lease_key: T1,
      p_from_instance: 'engine-old',
      p_to_instance: 'engine-new',
      p_kind: 'handoff',
      p_parent_id: null,
    });
  });

  it('a transport error, a thrown call or a malformed answer is unknown, never a refusal', async () => {
    for (const answer of [
      { data: null, error: { message: 'timeout' } },
      new Error('socket hang up'),
      { data: { granted: true }, error: null },
      { data: { ok: true }, error: null },
    ]) {
      const result = await createLeaseHandoffStore(rpcAnswering(answer)).handOff(request);
      expect(result.status).toBe('unknown');
    }
    const refused = await createLeaseHandoffStore(
      rpcAnswering({ data: { ok: false, reason: 'lease_not_held' }, error: null })
    ).handOff(request);
    expect(refused).toEqual({ status: 'refused', reason: 'lease_not_held' });
  });

  it('skips an unreadable handed row instead of guessing, and throws when the list is unreadable', async () => {
    const good = {
      handoff_id: uuid(),
      scope: 'table',
      lease_key: T1,
      from_instance: 'engine-old',
      to_generation: uuid(),
      fingerprint: { seats: [{ seat: 1, userId: 'u', stack: 5 }], clock: null },
      kind: 'handoff',
    };
    const rows = await createLeaseHandoffStore(
      rpcAnswering({
        data: [good, { ...good, scope: 'cluster' }, { ...good, to_generation: 'x' }],
        error: null,
      })
    ).handedTo('engine-new');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fingerprint).toEqual({
      seats: [{ seat: 1, userId: 'u', stack: 5 }],
      clock: null,
    });
    await expect(
      createLeaseHandoffStore(rpcAnswering({ data: null, error: { message: 'down' } })).handedTo(
        'x'
      )
    ).rejects.toThrow(/fn_engine_handed_leases_v1/);
    await expect(
      createLeaseHandoffStore(
        rpcAnswering({ data: null, error: { message: 'down' } })
      ).openHandoffs('x')
    ).rejects.toThrow(/fn_engine_open_lease_handoffs_v1/);
    expect(
      await createLeaseHandoffStore(rpcAnswering({ data: 3, error: null })).openHandoffs('x')
    ).toBe(3);
  });

  it('an unreadable open-handoff count never retires an instance', async () => {
    const world = new World();
    const real = world.db.store();
    const blind: LeaseHandoffStore = {
      ...real,
      openHandoffs: async () => {
        throw new Error('database unreachable');
      },
    };
    const a = world.instance('engine-old', { store: blind });
    const b = world.instance('engine-new');
    a.cash(T1, seats(100, 100));
    world.tick();
    await a.coordinator.yieldTo('engine-new');
    await b.coordinator.adoptPass();
    await a.coordinator.adoptPass();
    expect(a.coordinator.status().mode).toBe('yielding');
    expect(a.reports).toContain('RollingHandoff.open_handoffs_unreadable');
  });
});
