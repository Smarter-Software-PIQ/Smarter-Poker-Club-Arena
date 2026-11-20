/**
 * ROLLING HANDOFF, WIRED INTO GAMESERVER (2026-11-19, docs/ENGINE-ROLLING-HANDOFF.md).
 *
 * RollingHandoffCoordinator.test.ts proves the protocol over a fake engine.
 * This file proves the REAL GameServer port and guards:
 *
 *   - with ENGINE_ROLLING_HANDOFF unset (or anything but "on") no coordinator
 *     exists, the routes do not exist, and the recovery path re-admits a table
 *     exactly as before;
 *   - two GameServer instances sharing one lease database move a cash table
 *     and a tournament through the real port: park with the maintenance park
 *     the restart census already trusts, transfer only at a parked durable
 *     boundary, retire the old dealer without releasing the moved lease, and
 *     adopt with exactly the handed generation, held until the fingerprint
 *     matches;
 *   - a table that is not durable, mid-hand, Lightning, unleased or inside the
 *     platform break never moves.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage } from 'node:http';
// Static imports, like the repo's other GameServer tests: the module graph is
// loaded at collection, never inside a hook a loaded machine can time out.
import { GameServer } from './GameServer.js';
import { createRouter } from './router.js';
import { RollingHandoffCoordinator } from './handoff/RollingHandoffCoordinator.js';
import type {
  HandedLease,
  HandOffRequest,
  HandOffResult,
  LeaseHandoffStore,
} from './handoff/leaseHandoffStore.js';

vi.mock('./services/errorReporter.js', () => ({ reportError: vi.fn() }));

afterEach(() => {
  delete process.env.ENGINE_ROLLING_HANDOFF;
  vi.restoreAllMocks();
});

const TABLE = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const EVENT = 'eeeeeeee-0000-4000-8000-0000000000e1';
const EVENT_TABLE = 'aaaaaaaa-0000-4000-8000-0000000000a2';
const GEN_A = 'bbbbbbbb-0000-4000-8000-0000000000b1';
const GEN_EVENT = 'bbbbbbbb-0000-4000-8000-0000000000b2';

type Lease = { instance: string; generation: string };

/** The handoff functions over one in-memory lease table (rules of the migration). */
function leaseDatabase() {
  const leases = new Map<string, Lease>();
  const rows: Array<HandedLease & { toInstance: string; state: string; fromGeneration: string }> =
    [];
  let n = 0;
  const store: LeaseHandoffStore = {
    async handOff(r: HandOffRequest): Promise<HandOffResult> {
      const key = `${r.scope}:${r.leaseKey}`;
      const lease = leases.get(key);
      if (!lease) return { status: 'refused', reason: 'lease_missing' };
      if (lease.instance !== r.fromInstance || lease.generation !== r.fromGeneration)
        return { status: 'refused', reason: 'lease_not_held' };
      leases.set(key, { instance: r.toInstance, generation: r.toGeneration });
      if (r.parentId) {
        const parent = rows.find((x) => x.handoffId === r.parentId);
        if (parent) parent.state = 'returned';
      }
      n += 1;
      const handoffId = `cccccccc-0000-4000-8000-${String(n).padStart(12, '0')}`;
      rows.push({
        handoffId,
        scope: r.scope,
        leaseKey: r.leaseKey,
        fromInstance: r.fromInstance,
        fromGeneration: r.fromGeneration,
        toGeneration: r.toGeneration,
        toInstance: r.toInstance,
        fingerprint: r.fingerprint,
        kind: r.kind,
        state: 'handed',
      });
      return { status: 'transferred', handoffId };
    },
    async handedTo(instance) {
      return rows.filter((x) => {
        const lease = leases.get(`${x.scope}:${x.leaseKey}`);
        return (
          x.toInstance === instance &&
          x.state === 'handed' &&
          lease?.instance === instance &&
          lease.generation === x.toGeneration
        );
      });
    },
    async settle(id, instance, outcome) {
      const row = rows.find((x) => x.handoffId === id && x.toInstance === instance);
      if (!row) return false;
      row.state = outcome;
      return true;
    },
    async openHandoffs(instance) {
      return rows.filter((x) => {
        const lease = leases.get(`${x.scope}:${x.leaseKey}`);
        return (
          x.state === 'handed' &&
          (x.toInstance === instance || x.fromInstance === instance) &&
          lease?.instance === x.toInstance &&
          lease.generation === x.toGeneration
        );
      }).length;
    },
  };
  return { leases, rows, store };
}

/** The public surface of ServerTableEngine that the port reads, as a fake. */
function fakeEngine(opts: {
  instance: string;
  generation: string;
  seats: Array<{ seat: number; userId: string; stack: number }>;
  leases: Map<string, Lease>;
  leaseKey: string;
}) {
  const e = {
    running: true,
    handInProgress: true,
    maintenancePaused: false,
    maintenanceLock: false,
    durable: true,
    lightning: false,
    fenced: [] as string[],
    seats: opts.seats.map((s) => ({ ...s })),
    isRunning: () => e.running,
    isBetweenHands: () => !e.handInProgress,
    isParkedBetweenHands: () => e.maintenancePaused && !e.handInProgress,
    hasUnresolvedF06Preparation: () => false,
    hasUnretiredStoppedTimeBankCustody: () => false,
    hasAccountingInFlight: () => false,
    isMaintenanceStateDurable: () => e.durable,
    maintenanceDurabilityReason: () => (e.durable ? null : 'bank_park_write_incomplete'),
    getEngineLeaseAuthority: () => ({
      scope: 'cash' as const,
      verified: true as const,
      generation: opts.generation,
      proofDeadlineMonotonicMs: Number.MAX_SAFE_INTEGER,
    }),
    hasCurrentEngineLeaseAuthority: () => {
      const lease = opts.leases.get(opts.leaseKey);
      return lease?.instance === opts.instance && lease.generation === opts.generation;
    },
    describeHandoffBoundary: () => ({
      seats: e.seats.map((s) => ({ ...s })),
      lightning: e.lightning,
    }),
    pauseForMaintenance: vi.fn(() => {
      e.maintenancePaused = true;
    }),
    resumeFromMaintenance: vi.fn(() => {
      e.maintenancePaused = false;
    }),
    fenceForEngineLeaseLoss: vi.fn((reason: string) => {
      e.fenced.push(reason);
    }),
    setMaintenanceLock: vi.fn((locked: boolean) => {
      e.maintenanceLock = locked;
      return { success: true };
    }),
  };
  return e;
}

/** A GameServer built the way the repo's other GameServer tests build one. */
function server(instance: string, db: ReturnType<typeof leaseDatabase>) {
  const s = Object.create(GameServer.prototype) as any;
  s.running = true;
  s.lifecycleGeneration = 1;
  s.tableEngines = new Map();
  s.tournamentEngines = new Map();
  s.tournamentOwnedTables = new Set();
  s.maintenanceBreak = { isActive: () => false };
  s.lightningRooms = { activeHosts: () => 0 };
  s.directTableAdmissionOperations = new Map();
  s.directTableAdmissionLeaseGenerations = new Map();
  s.tournamentManagerAdmissionLeaseGenerations = new Map();
  // Set by the GameServer constructor (successor role and relay, 2026-11-19).
  s.handoffYieldedTables = new Set();
  s.recoverDirectTableEngine = vi.fn(async (tableId: string) => {
    s.tableEngines.delete(tableId);
  });
  s.stopTournamentManagerIfOwned = vi.fn(
    async (tournamentId: string, _m: unknown, _c: string, release: boolean) => {
      expect(release).toBe(false); // a moved lease is never released by the old instance
      for (const id of s.tournamentEngines.get(tournamentId)?.getTableIds() ?? [])
        s.tableEngines.delete(id);
      s.tournamentEngines.delete(tournamentId);
      return true;
    }
  );
  // Admission: claim with the seeded generation (claim_table_lease_v2 renewal),
  // construct the engine, and honour the arrival hold exactly as
  // performCashTableEngineAdmission does.
  s.ensureCashTableEngine = vi.fn(async (tableId: string) => {
    const generation = s.directTableAdmissionLeaseGenerations.get(tableId);
    const lease = db.leases.get(`table:${tableId}`);
    if (!generation || lease?.instance !== instance || lease.generation !== generation)
      return false;
    const engine = fakeEngine({
      instance,
      generation,
      seats: s.adoptedSeats ?? [],
      leases: db.leases,
      leaseKey: `table:${tableId}`,
    });
    engine.handInProgress = false;
    s.tableEngines.set(tableId, engine);
    if (s.rollingHandoff?.holdsArrival({ scope: 'table', key: tableId }))
      engine.setMaintenanceLock(true);
    return true;
  });
  s.ensureTournamentManagerAdmission = vi.fn(async (tournamentId: string) => {
    const generation = s.tournamentManagerAdmissionLeaseGenerations.get(tournamentId);
    const lease = db.leases.get(`tournament:${tournamentId}`);
    if (!generation || lease?.instance !== instance || lease.generation !== generation) return;
    s.tournamentEngines.set(tournamentId, fakeManager(generation, [], db, instance, tournamentId));
  });
  const port = { ...s.createRollingHandoffPort(), instanceId: instance };
  s.rollingHandoff = new RollingHandoffCoordinator(port, db.store, {
    pollMs: 1,
    sleep: async () => {
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  });
  return s;
}

function fakeManager(
  generation: string,
  tableIds: string[],
  db: ReturnType<typeof leaseDatabase>,
  instance: string,
  tournamentId: string
) {
  return {
    running: true,
    isRunning: () => true,
    getTableIds: () => tableIds,
    getTournamentLeaseGeneration: () => generation,
    hasCurrentTournamentLeaseAuthority: () => {
      const lease = db.leases.get(`tournament:${tournamentId}`);
      return lease?.instance === instance && lease.generation === generation;
    },
    isF06RecoveryOwner: () => false,
    describeHandoffClock: () => ({ level: 4, levelStartedAtMs: 1_763_500_000_000, onBreak: false }),
    fenceForTournamentLeaseLoss: vi.fn(),
  };
}

const seats = [
  { seat: 2, userId: 'kingfish', stack: 1_250 },
  { seat: 5, userId: 'danimal', stack: 830 },
];

describe('rolling handoff wired into GameServer', () => {
  it('with the flag off GameServer builds no coordinator, and only exactly "on" builds one', () => {
    delete process.env.ENGINE_ROLLING_HANDOFF;
    expect(new GameServer().getRollingHandoff()).toBeNull();
    process.env.ENGINE_ROLLING_HANDOFF = 'true';
    expect(new GameServer().getRollingHandoff()).toBeNull();
    process.env.ENGINE_ROLLING_HANDOFF = 'on';
    expect(new GameServer().getRollingHandoff()).toBeInstanceOf(RollingHandoffCoordinator);
  });

  it('with the flag off the handoff routes do not exist (the same 404 as before)', async () => {
    const gameServer = { getRollingHandoff: () => null };
    const router = createRouter({ gameServer } as never);
    for (const url of ['/internal/rolling-handoff/status', '/internal/rolling-handoff/yield']) {
      const captured: { status?: number } = {};
      const res = {
        writeHead: (code: number) => {
          captured.status = code;
          return res;
        },
        setHeader: () => res,
        end: () => undefined,
      };
      await router(
        {
          method: 'GET',
          url,
          headers: {},
          socket: { remoteAddress: '127.0.0.1' },
        } as unknown as IncomingMessage,
        res as never
      );
      expect(captured.status).toBe(404);
    }
  });

  it('with the flag off a recovered cash table is re-admitted exactly as before', async () => {
    const s = Object.create(GameServer.prototype) as any;
    const engine = {
      getEngineLeaseAuthority: () => null,
      stop: vi.fn(async () => undefined),
      hasReleasedProcessOwnership: () => true,
      getStartupPolicyRefusal: () => null,
      getStartupRetainedHandRefusal: () => null,
    };
    s.running = true;
    s.tableEngines = new Map([[TABLE, engine]]);
    s.tournamentOwnedTables = new Set();
    s.releaseWeeklyPayout = vi.fn();
    s.directTableRestartBackoffStore = { isRepeating: () => false, recordFailure: vi.fn() };
    s.ensureCashTableEngineAdmission = vi.fn(async () => 'ready');
    s.finishDirectTableAdmission = vi.fn();
    await s.performDirectTableEngineRecovery(TABLE, engine, 'test', false);
    expect(s.ensureCashTableEngineAdmission).toHaveBeenCalledWith(TABLE);

    // The same path with the coordinator saying the table moved: no re-admission.
    s.tableEngines.set(TABLE, engine);
    s.ensureCashTableEngineAdmission.mockClear();
    s.rollingHandoff = { suppressesReadmission: () => true };
    await s.performDirectTableEngineRecovery(TABLE, engine, 'engine_handoff_yielded', false);
    expect(s.ensureCashTableEngineAdmission).not.toHaveBeenCalled();
    expect(s.tableEngines.has(TABLE)).toBe(false);
  });

  it('moves a cash table and a tournament between two GameServers through the real port', async () => {
    const db = leaseDatabase();
    const a = server('engine-old', db);
    const b = server('engine-new', db);
    db.leases.set(`table:${TABLE}`, { instance: 'engine-old', generation: GEN_A });
    db.leases.set(`tournament:${EVENT}`, { instance: 'engine-old', generation: GEN_EVENT });
    const cash = fakeEngine({
      instance: 'engine-old',
      generation: GEN_A,
      seats,
      leases: db.leases,
      leaseKey: `table:${TABLE}`,
    });
    const eventTable = fakeEngine({
      instance: 'engine-old',
      generation: GEN_EVENT,
      seats,
      leases: db.leases,
      leaseKey: `tournament:${EVENT}`,
    });
    a.tableEngines.set(TABLE, cash);
    a.tableEngines.set(EVENT_TABLE, eventTable);
    a.tournamentOwnedTables.add(EVENT_TABLE);
    a.tournamentEngines.set(EVENT, fakeManager(GEN_EVENT, [EVENT_TABLE], db, 'engine-old', EVENT));
    b.adoptedSeats = seats;

    const yielding = a.rollingHandoff.yieldTo('engine-new');
    await new Promise<void>((resolve) => setImmediate(resolve));
    // Both units were parked with the maintenance park; neither moved mid-hand.
    expect(cash.pauseForMaintenance).toHaveBeenCalled();
    expect(eventTable.pauseForMaintenance).toHaveBeenCalled();
    expect(db.rows).toHaveLength(0);
    // The hands in the air finish; the cash table's bank write is not yet durable.
    cash.handInProgress = false;
    cash.durable = false;
    eventTable.handInProgress = false;
    for (let i = 0; i < 20 && db.rows.length < 1; i++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    expect(db.rows.map((r) => r.scope)).toEqual(['tournament']);
    cash.durable = true;
    const status = await yielding;
    expect(status.yields.map((y: { state: string }) => y.state)).toEqual(['yielded', 'yielded']);

    // The old instance retired its dealers without releasing the moved leases.
    expect(cash.fenceForEngineLeaseLoss).toHaveBeenCalledWith('engine_handoff_yielded', false);
    expect(a.recoverDirectTableEngine).toHaveBeenCalledWith(TABLE, cash, 'engine_handoff_yielded');
    expect(a.stopTournamentManagerIfOwned).toHaveBeenCalled();
    expect(db.leases.get(`table:${TABLE}`)!.instance).toBe('engine-new');
    expect(db.leases.get(`tournament:${EVENT}`)!.instance).toBe('engine-new');
    // While yielding, the old instance refuses to start a dealer for anything.
    expect(a.rollingHandoff.refusesAdmission({ scope: 'table', key: TABLE })).toBe(true);

    await b.rollingHandoff.adoptPass();
    const adopted = b.tableEngines.get(TABLE);
    const handed = db.rows.find((r) => r.scope === 'table')!;
    // Claimed with exactly the handed generation, held at arrival, then released.
    expect(adopted.getEngineLeaseAuthority().generation).toBe(handed.toGeneration);
    expect(adopted.setMaintenanceLock.mock.calls).toEqual([[true], [false]]);
    expect(adopted.describeHandoffBoundary().seats).toEqual(seats);
    expect(b.tournamentEngines.get(EVENT).getTournamentLeaseGeneration()).toBe(
      db.rows.find((r) => r.scope === 'tournament')!.toGeneration
    );
    expect(db.rows.every((r) => r.state === 'adopted')).toBe(true);

    await a.rollingHandoff.adoptPass();
    expect(a.rollingHandoff.status().mode).toBe('retired');
  });

  it('never moves a table inside the platform break, on Lightning, or without a verified lease', () => {
    const db = leaseDatabase();
    const a = server('engine-old', db);
    db.leases.set(`table:${TABLE}`, { instance: 'engine-old', generation: GEN_A });
    const cash = fakeEngine({
      instance: 'engine-old',
      generation: GEN_A,
      seats,
      leases: db.leases,
      leaseKey: `table:${TABLE}`,
    });
    a.tableEngines.set(TABLE, cash);
    const port = a.createRollingHandoffPort();
    const unit = { scope: 'table' as const, key: TABLE };
    expect(port.eligibility(unit)).toBeNull();
    a.maintenanceBreak = { isActive: () => true };
    expect(port.eligibility(unit)).toBe('maintenance_break_active');
    a.maintenanceBreak = { isActive: () => false };
    cash.lightning = true;
    expect(port.eligibility(unit)).toBe('lightning_cluster_stays');
    cash.lightning = false;
    db.leases.set(`table:${TABLE}`, { instance: 'someone-else', generation: GEN_A });
    expect(port.eligibility(unit)).toBe('no_verified_cash_lease');
    expect(port.eligibility({ scope: 'table', key: 'aaaaaaaa-0000-4000-8000-0000000000ff' })).toBe(
      'not_running'
    );
  });

  it('names exactly why a table is not yet at its boundary', () => {
    const db = leaseDatabase();
    const a = server('engine-old', db);
    db.leases.set(`table:${TABLE}`, { instance: 'engine-old', generation: GEN_A });
    const cash = fakeEngine({
      instance: 'engine-old',
      generation: GEN_A,
      seats,
      leases: db.leases,
      leaseKey: `table:${TABLE}`,
    });
    a.tableEngines.set(TABLE, cash);
    const port = a.createRollingHandoffPort();
    const unit = { scope: 'table' as const, key: TABLE };
    expect(port.boundaryState(unit)).toEqual({ atBoundary: false, reason: 'cards_in_air' });
    cash.handInProgress = false;
    expect(port.boundaryState(unit)).toEqual({ atBoundary: false, reason: 'not_parked' });
    port.parkAtNextBoundary(unit);
    cash.durable = false;
    expect(port.boundaryState(unit)).toEqual({
      atBoundary: false,
      reason: 'bank_park_write_incomplete',
    });
    cash.durable = true;
    expect(port.boundaryState(unit)).toEqual({ atBoundary: true });
    expect(port.fingerprint(unit)).toEqual({ seats, clock: null });
    port.releasePark(unit);
    expect(cash.resumeFromMaintenance).toHaveBeenCalled();
    expect(port.holdsArrivalOf(unit)).toBe(true);
    expect(port.holdsArrivalOf({ scope: 'tournament', key: EVENT })).toBe(false);
  });
});
