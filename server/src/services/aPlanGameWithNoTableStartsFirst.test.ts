import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetVarietyHolds,
  clearVarietyHolds,
  compareVarietyFirst,
  feederStartWaitsForVariety,
  moveWaitsForVariety,
  publishVarietyHolds,
  VARIETY_HOLD_FRESH_MS,
  VARIETY_START_REST_MS,
  varietyFirstPlan,
  varietyHoldsThisCycle,
  varietyOwedGamesThisCycle,
  VarietyStartMemory,
  type VarietyTable,
} from './HorseVarietyFirst.js';
import { HORSE_STARTED_CASH_GAMES, LIGHTNING_HORSE_SEEDED } from './HorseUnionCashPlan.js';
import { seatMoveIsDue } from './supabase/seatMoves.js';
import { classifyBuyInRefusal } from './HorseBuyInRefusal.js';

/* 2026-11-18: PLO5 1/2 Madness, PLO5 .50/1 Classic and six other Main tables
   had no Horses from the 08:45Z night walk-down until the evening. The hourly
   cap was full of second, third and fourth tables of five games; every free
   start went to the newest feeder of a game that was already running. */

const here = dirname(fileURLToPath(import.meta.url));
const source = (rel: string) => readFileSync(join(here, rel), 'utf8');

const NLH_HALF = '95beda17-1629-4866-b888-cc1c920d4a91';
const PLO4_HALF = 'bda665c1-ddd9-4576-91d1-63e579678172';
const PLO6_HALF = '0914a283-0000-4000-8000-000000000001';
const FLH_QUARTER = '3f294ec3-8a4e-41f4-a11e-35e50618da3e';
const MADNESS_PLO5 = '050f0735-1eac-45b3-90f8-3e50ab72dc04';
const PLO5_HALF = 'e2952da8-0000-4000-8000-000000000002';
const L_PLO5_ONE_TWO = 'f67a1436-e842-4b49-8644-3e184bd77ba6';
const L_PLO4_ONE_TWO = 'c79d8ec2-2281-411d-b4e1-42b5610849e2';
const L_NLH_QUARTER = [...LIGHTNING_HORSE_SEEDED].find(
  (id) => id !== L_PLO5_ONE_TWO && id !== L_PLO4_ONE_TWO
)!;
const L_NLH_HALF = '57ca90e4-815e-4081-a5d2-1f10522d95c7';

type T = VarietyTable & { seated: number };
const main = (id: string, game: string, index: number, seated: number): T => ({
  id,
  cluster_id: game,
  role: 'main',
  main_index: index,
  lifecycle: 'live',
  seated,
});
const feeder = (id: string, game: string, seated: number, lifecycle = 'live'): T => ({
  id,
  cluster_id: game,
  role: 'feeder',
  main_index: null,
  lifecycle,
  seated,
});

/** The floor at 16:50Z on 2026-11-18: 18 occupied tables, 17 counted, cap 16. */
const todaysFloor = (): T[] => [
  main('nlh-m1', NLH_HALF, 1, 6),
  main('nlh-m2', NLH_HALF, 2, 6),
  main('nlh-m3', NLH_HALF, 3, 6),
  feeder('nlh-f', NLH_HALF, 4),
  feeder('nlh-f-opening', NLH_HALF, 0, 'opening'),
  main('plo4-m1', PLO4_HALF, 1, 6),
  main('plo4-m2', PLO4_HALF, 2, 6),
  feeder('plo4-f', PLO4_HALF, 3),
  main('plo6-m1', PLO6_HALF, 1, 6),
  main('plo6-m2', PLO6_HALF, 2, 6),
  feeder('plo6-f', PLO6_HALF, 3),
  main('flh-m1', FLH_QUARTER, 1, 6),
  main('flh-m2', FLH_QUARTER, 2, 6),
  feeder('flh-f', FLH_QUARTER, 2),
  feeder('flh-f-opening', FLH_QUARTER, 0, 'opening'),
  main('l-plo5-m1', L_PLO5_ONE_TWO, 1, 6),
  feeder('l-plo5-f1', L_PLO5_ONE_TWO, 6),
  feeder('l-plo5-f2-human-started', L_PLO5_ONE_TWO, 3),
  main('l-plo4-m1', L_PLO4_ONE_TWO, 1, 6),
  main('l-nlh-m1', L_NLH_QUARTER, 1, 6),
  main('madness-m1', MADNESS_PLO5, 1, 0),
  main('plo5-m1', PLO5_HALF, 1, 0),
  main('l-nlh-half-m1', L_NLH_HALF, 1, 0),
];
/** The human-started Lightning feeder with its person is outside the count. */
const counted = (floor: T[]) =>
  floor.filter((t) => t.seated > 0 && t.id !== 'l-plo5-f2-human-started').length;

const START_GAMES = new Set([
  NLH_HALF,
  PLO4_HALF,
  PLO6_HALF,
  FLH_QUARTER,
  MADNESS_PLO5,
  PLO5_HALF,
  ...LIGHTNING_HORSE_SEEDED,
]);

const planFor = (floor: T[], resting: ReadonlySet<string> = new Set()) =>
  varietyFirstPlan({
    tables: floor,
    seatedAt: (id) => floor.find((t) => t.id === id)?.seated ?? 0,
    startGames: START_GAMES,
    neverHeldGames: LIGHTNING_HORSE_SEEDED,
    mayStart: (t) => t.role === 'main' && Number(t.main_index) === 1,
    restingGames: resting,
  });

/** The walk's cluster rank as it stood before this rule: an opening feeder first. */
const clusterRank = (t: T) =>
  t.lifecycle === 'opening' ? -1 : t.role === 'feeder' ? 1000 : Number(t.main_index ?? 999);

/**
 * One fleet cycle against the database's rule (fn_cash_hourly_table_admissions):
 * an EMPTY table is admitted only while counted tables < cap, and one start is
 * made per cycle. Returns the table that takes it, or null.
 */
const nextStart = (floor: T[], cap: number, varietyFirst: boolean): T | null => {
  if (counted(floor) >= cap) return null;
  const plan = planFor(floor);
  const walk = [...floor].sort(
    (a, b) =>
      (varietyFirst ? compareVarietyFirst(a, b, plan) : 0) ||
      clusterRank(a) - clusterRank(b) ||
      a.id.localeCompare(b.id)
  );
  for (const t of walk) {
    if (t.seated > 0) continue;
    if (varietyFirst && plan.heldStarts.has(t.id)) continue;
    return t;
  }
  return null;
};

describe("a plan game with no table starts before another game's extra table", () => {
  beforeEach(() => __resetVarietyHolds());

  it('reproduces 2026-11-18: 17 counted tables against a cap of 16, Madness empty', () => {
    const floor = todaysFloor();
    expect(counted(floor)).toBe(17);
    expect(floor.filter((t) => t.seated > 0)).toHaveLength(18);
    expect(floor.find((t) => t.id === 'madness-m1')!.seated).toBe(0);
    /* Nothing empty starts at a full cap, with or without this rule. */
    expect(nextStart(floor, 16, false)).toBeNull();
    expect(nextStart(floor, 16, true)).toBeNull();
    expect(nextStart(floor, 17, true)).toBeNull();
  });

  it('gave the next free start to the newest feeder of a running game before this rule', () => {
    expect(nextStart(todaysFloor(), 18, false)!.id).toBe('flh-f-opening');
  });

  it('gives the next free start to a game that has no table', () => {
    const floor = todaysFloor();
    const plan = planFor(floor);
    expect(new Set(plan.owedStarts.values())).toEqual(
      new Set([MADNESS_PLO5, PLO5_HALF, L_NLH_HALF])
    );
    expect(plan.owedStarts.get('madness-m1')).toBe(MADNESS_PLO5);
    expect([...plan.heldStarts].sort()).toEqual(['flh-f-opening', 'nlh-f-opening']);
    const first = nextStart(floor, 18, true)!;
    expect(plan.owedStarts.has(first.id)).toBe(true);
  });

  it('variety first, then depth: every empty game is started before any extra table', () => {
    const floor = todaysFloor();
    const order: string[] = [];
    for (let cap = 18; cap <= 22; cap++) {
      const start = nextStart(floor, cap, true);
      if (!start) break;
      order.push(start.id);
      start.seated = 1;
      expect(counted(floor)).toBeLessThanOrEqual(cap);
    }
    expect(order.slice(0, 3).sort()).toEqual(['l-nlh-half-m1', 'madness-m1', 'plo5-m1']);
    /* Only now does a running game open another table. */
    expect(order.slice(3)).toEqual(['flh-f-opening', 'nlh-f-opening']);
    expect(planFor(floor).heldStarts.size).toBe(0);
  });

  it('holds nothing when no game is owed a start', () => {
    const floor = todaysFloor().filter(
      (t) => !['madness-m1', 'plo5-m1', 'l-nlh-half-m1'].includes(t.id)
    );
    const plan = planFor(floor);
    expect(plan.owedStarts.size).toBe(0);
    expect(plan.heldStarts.size).toBe(0);
  });

  it("never holds a table anybody is sitting at, nor a seeded Lightning game's next ring", () => {
    const floor = [
      ...todaysFloor(),
      feeder('l-plo4-f-opening', L_PLO4_ONE_TWO, 0, 'opening'),
      feeder('plo4-f2-one-person', PLO4_HALF, 1, 'opening'),
    ];
    const plan = planFor(floor);
    expect(plan.heldStarts.has('l-plo4-f-opening')).toBe(false);
    expect(plan.heldStarts.has('plo4-f2-one-person')).toBe(false);
    expect(plan.heldStarts.has('nlh-m1')).toBe(false);
  });

  it('owes nothing to a game a person must start, a closed table or a table Horses may not start', () => {
    const personStarted = 'aaaaaaaa-0000-4000-8000-00000000000a';
    const floor: T[] = [
      main('running', NLH_HALF, 1, 6),
      main('person-game-m1', personStarted, 1, 0),
      { ...main('madness-closed', MADNESS_PLO5, 1, 0), lifecycle: 'closed' },
      feeder('plo5-feeder-only', PLO5_HALF, 0),
    ];
    const plan = planFor(floor);
    expect(plan.owedStarts.size).toBe(0);
    expect(plan.heldStarts.size).toBe(0);
  });

  it('starts an empty seeded Lightning game at its starter table', () => {
    const floor: T[] = [
      main('l-m1', L_NLH_HALF, 1, 0),
      feeder('l-f', L_NLH_HALF, 0),
      main('running', NLH_HALF, 1, 6),
    ];
    const plan = varietyFirstPlan({
      tables: floor,
      seatedAt: (id) => floor.find((t) => t.id === id)?.seated ?? 0,
      startGames: START_GAMES,
      neverHeldGames: LIGHTNING_HORSE_SEEDED,
      mayStart: () => true,
      preferredStarts: new Set(['l-f']),
    });
    expect([...plan.owedStarts.keys()]).toEqual(['l-f']);
  });

  it('rests a game the walk could not start, so depth is not held for ever', () => {
    const memory = new VarietyStartMemory();
    const t0 = Date.parse('2026-11-18T17:00:00Z');
    for (const g of [MADNESS_PLO5, PLO5_HALF, L_NLH_HALF])
      memory.noteCouldNotStart(g, t0, 'own_reason');
    const resting = planFor(todaysFloor(), memory.resting(t0 + 1_000));
    expect(resting.owedStarts.size).toBe(0);
    expect(resting.heldStarts.size).toBe(0);
    memory.noteStarted(PLO5_HALF);
    expect(memory.resting(t0 + 1_000).has(PLO5_HALF)).toBe(false);
    const again = planFor(todaysFloor(), memory.resting(t0 + VARIETY_START_REST_MS));
    expect(new Set(again.owedStarts.values())).toEqual(
      new Set([MADNESS_PLO5, PLO5_HALF, L_NLH_HALF])
    );
    expect(again.heldStarts.size).toBe(2);
  });

  it("holds a Horse's feeder-start move, never a person's, and never on a stale publication", () => {
    const t0 = Date.parse('2026-11-18T17:00:00Z');
    expect(moveWaitsForVariety('nlh-f-opening', 'horse-1', t0)).toBe(false);
    publishVarietyHolds(planFor(todaysFloor()).heldStarts, new Set(['horse-1']), t0);
    expect(moveWaitsForVariety('nlh-f-opening', 'horse-1', t0 + 5_000)).toBe(true);
    expect(moveWaitsForVariety('nlh-f-opening', 'person-1', t0 + 5_000)).toBe(false);
    expect(moveWaitsForVariety('nlh-m2', 'horse-1', t0 + 5_000)).toBe(false);
    expect(moveWaitsForVariety('nlh-f-opening', 'horse-1', t0 + VARIETY_HOLD_FRESH_MS)).toBe(false);
    expect(moveWaitsForVariety('nlh-f-opening', 'horse-1', t0 - 1)).toBe(false);
  });

  it('every plan game and every seeded Lightning game is a game Horses start', () => {
    expect(HORSE_STARTED_CASH_GAMES.has(MADNESS_PLO5)).toBe(true);
    for (const g of LIGHTNING_HORSE_SEEDED) expect(HORSE_STARTED_CASH_GAMES.has(g)).toBe(true);
  });
});

describe('nothing is held in a cycle that cannot make the owed start', () => {
  /* Review of 02de6de4e2f, finding 1: a paused or behind fleet republished its
     holds every cycle, so a full game's feeder-start move (which adds no Horse)
     waited for as long as the pause lasted, behind a start nobody was making. */
  beforeEach(() => __resetVarietyHolds());
  const bump = {
    reason: 'balance',
    swap_move_id: null,
    to_table_id: 'nlh-f-opening',
    player_id: 'h1',
  };
  const cycle = (withheld: boolean, floor: T[] = todaysFloor()) => {
    const plan = planFor(floor);
    const held = varietyHoldsThisCycle(plan, { withheld });
    publishVarietyHolds(held, new Set(['h1']), Date.now());
    return held;
  };

  it('a withheld cycle (paused, disabled, brain behind, outside the schedule) holds nothing', () => {
    expect(cycle(true).size).toBe(0);
    expect(feederStartWaitsForVariety(bump)).toBe(false);
    expect(varietyOwedGamesThisCycle(planFor(todaysFloor()), { withheld: true })).toEqual([]);
  });

  it('a cycle with no owed start holds nothing', () => {
    const everyGameHasATable = todaysFloor().map((t) =>
      t.role === 'main' && t.main_index === 1 && t.seated === 0 ? { ...t, seated: 3 } : t
    );
    expect(cycle(false, everyGameHasATable).size).toBe(0);
    expect(feederStartWaitsForVariety(bump)).toBe(false);
    expect(varietyOwedGamesThisCycle(planFor(everyGameHasATable), { withheld: false })).toEqual([]);
  });

  it('a seating cycle with an owed start holds the extra tables', () => {
    expect([...cycle(false)].sort()).toEqual(['flh-f-opening', 'nlh-f-opening']);
    expect(feederStartWaitsForVariety(bump)).toBe(true);
    /* ...and the next cycle, withheld, lets the same move go at once. */
    cycle(true);
    expect(feederStartWaitsForVariety(bump)).toBe(false);
  });

  it('a hold is dropped the moment a cycle begins its hourly read', () => {
    cycle(false);
    clearVarietyHolds();
    expect(feederStartWaitsForVariety(bump)).toBe(false);
  });

  it('the fleet clears before the hourly read and publishes only what the cycle can pay', () => {
    const fleet = source('./HorseFleetManager.ts');
    const clear = fleet.indexOf('clearVarietyHolds();');
    const read = fleet.indexOf('const hourlyAdmissions = await readHourlyCashAdmissions();');
    const decide = fleet.indexOf('const varietyHeld = varietyHoldsThisCycle(variety, {');
    const publish = fleet.indexOf('publishVarietyHolds(varietyHeld, horseIdSet, Date.now());');
    const claim = fleet.indexOf(': await this.claimOfferedSeats(');
    expect(clear).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(clear);
    expect(decide).toBeGreaterThan(read);
    expect(publish).toBeGreaterThan(decide);
    expect(claim).toBeGreaterThan(publish);
    expect(fleet.slice(decide, publish)).toContain('withheld: !!cycleWithheld,');
    /* A full cap is not a reason to hold nothing (2026-11-24): the hold no
       longer asks whether the cap admits an owed table this cycle. */
    expect(fleet.slice(decide, publish)).not.toContain('hourlyAdmissions');
    /* No publication anywhere else, and none of the raw plan. */
    expect(fleet.split('publishVarietyHolds(').length - 1).toBe(1);
    expect(fleet).not.toContain('variety.heldStarts');
  });

  it('the hourly door refusing a start is the floor, and rests no game', () => {
    for (const m of [
      'cash_hourly_table_cap_reached:16',
      'cash_hourly_table_start_paced',
      'cash_hourly_horse_arrival_paced',
      'cash_hourly_table_capacity_busy',
    ]) {
      expect(classifyBuyInRefusal(m)).toBe('hourly_cap');
    }
    const fleet = source('./HorseFleetManager.ts');
    expect(fleet).toMatch(
      /reason === 'hourly_cap' \|\|\s*reason === 'lightning_paced' \|\|\s*reason === 'frozen'\s*\) \{\s*varietyFloorStop = true;/
    );
  });
});

describe('a full schedule day still respects the hourly cap', () => {
  /* The owner's caps by Chicago hour, read from the migration that enforces them. */
  const caps = (() => {
    const sql = source(
      '../../../supabase/migrations/20261116153902_enforce_owner_hourly_cash_table_caps_with_human_expansion.sql'
    );
    const arrays = [...sql.matchAll(/ARRAY\[([\d,]+)\]\s+(lo|hi)/g)];
    const hi = arrays
      .find((m) => m[2] === 'hi')![1]
      .split(',')
      .map(Number);
    expect(hi).toHaveLength(24);
    return hi;
  })();

  it('never starts a table at or over the cap, and never deepens a game while one has no table', () => {
    const games = [...HORSE_STARTED_CASH_GAMES];
    type Row = T & { openedAt: number };
    const floor: Row[] = [];
    let clock = 0;
    const occupied = () => floor.filter((t) => t.seated > 0);
    let starts = 0;
    for (let day = 0; day < 2; day++) {
      for (let hour = 0; hour < 24; hour++) {
        const cap = caps[hour];
        /* The hourly close: newest tables first, down to the cap. */
        for (const t of occupied()
          .sort((a, b) => b.openedAt - a.openedAt)
          .slice(0, Math.max(0, occupied().length - cap))) {
          t.seated = 0;
        }
        /* Twenty cycles an hour; each offers every game a first table and
           every running game an opening feeder. */
        for (let cycle = 0; cycle < 20; cycle++) {
          const offered: Row[] = [];
          for (const g of games) {
            const running = floor.some((t) => t.cluster_id === g && t.seated > 0);
            const id = running ? `${g}-extra-${clock}` : `${g}-m1`;
            if (floor.some((t) => t.id === id)) continue;
            offered.push({
              ...(running ? feeder(id, g, 0, 'opening') : main(id, g, 1, 0)),
              openedAt: clock,
            });
          }
          const view = [...floor.filter((t) => t.seated > 0 || t.id.endsWith('-m1')), ...offered];
          const plan = varietyFirstPlan({
            tables: view,
            seatedAt: (id) => view.find((t) => t.id === id)?.seated ?? 0,
            startGames: HORSE_STARTED_CASH_GAMES,
            neverHeldGames: new Set<string>(),
            mayStart: (t) => t.role === 'main',
          });
          clock++;
          if (occupied().length >= cap) continue;
          const pick = [...view]
            .filter((t) => t.seated === 0 && !plan.heldStarts.has(t.id))
            .sort((a, b) => compareVarietyFirst(a, b, plan) || a.id.localeCompare(b.id))[0];
          if (!pick) continue;
          const emptyGames = games.filter(
            (g) => !floor.some((t) => t.cluster_id === g && t.seated > 0)
          );
          if (emptyGames.length > 0) expect(emptyGames).toContain(pick.cluster_id);
          pick.seated = 2;
          pick.openedAt = clock;
          if (!floor.includes(pick as Row)) floor.push(pick as Row);
          starts++;
          expect(occupied().length).toBeLessThanOrEqual(cap);
        }
        expect(occupied().length).toBeLessThanOrEqual(cap);
        /* Variety: no game holds two tables while the cap leaves a plan game with none
           that could have had the slot this hour. */
        const perGame = new Map<string, number>();
        for (const t of occupied()) {
          perGame.set(String(t.cluster_id), (perGame.get(String(t.cluster_id)) ?? 0) + 1);
        }
        if (perGame.size < games.length) {
          expect(Math.max(0, ...perGame.values())).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(starts).toBeGreaterThan(40);
  });
});

describe('the three doors a start is taken through all ask the one rule', () => {
  const fleet = source('./HorseFleetManager.ts');
  const engine = source('../engine/ServerTableEngineBase.ts');

  it('the walk ranks an owed start after a short-handed person and before everything else', () => {
    const sort = fleet.slice(fleet.indexOf('const orderedTables = ['));
    const person = sort.indexOf('Number(humanShort(b)) - Number(humanShort(a)) ||');
    const variety = sort.indexOf('compareVarietyFirst(a, b, variety) ||');
    const lightning = sort.indexOf('compareLightningStarters(a, b, lightningStarters) ||');
    const cluster = sort.indexOf('clusterRank(a) - clusterRank(b) ||');
    expect(person).toBeGreaterThan(-1);
    expect(variety).toBeGreaterThan(person);
    expect(lightning).toBeGreaterThan(variety);
    expect(cluster).toBeGreaterThan(lightning);
  });

  it('the walk does not start a held table, and only a start is withheld', () => {
    expect(fleet).toContain('if (hourly.startsGame && varietyHeld.has(table.id)) {');
    expect(fleet).toContain("if (diag) diag.withheld = 'variety_first';");
    /* Never a Lightning game's next ring, seeded or started by a person. */
    expect(fleet).toContain(
      'neverHeldGames: new Set([...LIGHTNING_HORSE_SEEDED, ...(cashPlanLightningGames ?? [])]),'
    );
  });

  it('a seat call does not start a held table', () => {
    expect(fleet).toContain('this.varietyHeldStarts = varietyHeld;');
    const claim = fleet.slice(fleet.indexOf('private async claimOfferedSeats('));
    const held = claim.indexOf('this.varietyHeldStarts.has(String(table.id)) &&');
    expect(held).toBeGreaterThan(-1);
    expect(held).toBeLessThan(claim.indexOf('const expiresAt'));
    expect(held).toBeLessThan(claim.indexOf('await this.seatHorse('));
  });

  it("the table engine does not execute a Horse's feeder-start move onto a held table", () => {
    expect(fleet).toContain('publishVarietyHolds(varietyHeld, horseIdSet, Date.now());');
    const at = engine.indexOf('protected async executePendingSeatMoves(');
    const waits = engine.indexOf('opts = { ...opts, waits: feederStartWaitsForVariety };', at);
    expect(waits).toBeGreaterThan(at);
    expect(waits).toBeLessThan(engine.indexOf('outcome = await executePendingSeatMoves(', at));
    expect(source('./supabase/seatMoves.ts')).toContain('if (opts.waits?.(move)) return false;');
    /* Only the tick's one-way feeder start. A must-move into a Main, a break
       move and a swap are never held, and neither is a person. */
    publishVarietyHolds(new Set(['feeder']), new Set(['horse-1']), Date.now());
    const move = (reason: string, swap: string | null = null, player = 'horse-1') => ({
      reason,
      swap_move_id: swap,
      to_table_id: 'feeder',
      player_id: player,
    });
    expect(feederStartWaitsForVariety(move('balance'))).toBe(true);
    expect(feederStartWaitsForVariety(move('balance', null, 'person-1'))).toBe(false);
    expect(feederStartWaitsForVariety(move('balance', 'partner'))).toBe(false);
    expect(feederStartWaitsForVariety(move('must_move'))).toBe(false);
    expect(feederStartWaitsForVariety(move('break'))).toBe(false);
    expect(feederStartWaitsForVariety(move('seat_change'))).toBe(false);
    expect(seatMoveIsDue(move('balance') as never, { announcedOnly: false })).toBe(true);
    expect(
      seatMoveIsDue(move('balance') as never, {
        announcedOnly: false,
        waits: feederStartWaitsForVariety,
      })
    ).toBe(false);
    expect(
      seatMoveIsDue(move('must_move') as never, {
        announcedOnly: true,
        mustMoveOnly: true,
        waits: feederStartWaitsForVariety,
      })
    ).toBe(true);
  });

  it('the hourly cap is still asked for every table and still admits one start a cycle', () => {
    expect(fleet).toContain('const hourlyAdmissions = await readHourlyCashAdmissions();');
    expect(fleet).toContain('if (!hourly || (hourly.startsGame && hourlyAutonomousStarted)) {');
    expect(fleet).toContain('cleared.splice(hourly.maxHorses)');
  });
});
