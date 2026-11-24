import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetVarietyHolds,
  feederStartWaitsForVariety,
  publishVarietyHolds,
  VARIETY_HOLD_FRESH_MS,
  varietyFirstPlan,
  varietyHoldsThisCycle,
  varietyOwedGamesThisCycle,
  type VarietyTable,
} from './HorseVarietyFirst.js';

/*
 * LAW - AN OWED MAIN STARTS BEFORE AN EXTRA TABLE, AT A FULL CAP TOO (2026-11-24).
 *
 * Short Deck, Pineapple, FLO8 and PLO8 cash dealt nothing from 2026-11-23
 * 08:43Z: the hourly cap (25) was full of ten games' second to fourth tables,
 * every full game carried a Horse waiting list (#11773), and the cluster tick
 * (every 5 s) turned each slot that freed into another waiting-list feeder.
 * The variety rule (#11346) held extra tables only in a cycle whose cap ALREADY
 * admitted an owed start, so at a full cap it held nothing.
 *
 * Now: a seating cycle with an owed start holds every extra table whatever the
 * cap says, and publishes the owed games on its heartbeat
 * (`detail.variety_owed_games`), which the database's feeder opener
 * (fn_cash_hourly_feeder_admissible, 20261124072701) reads, so the tick does
 * not open an extra table while an owed start would no longer fit. The waiting
 * list itself is untouched.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');
const MIGRATIONS = join(here, '../../../supabase/migrations');

type T = VarietyTable & { seated: number };
const table = (
  id: string,
  game: string,
  role: 'main' | 'feeder',
  index: number | null,
  seated: number,
  lifecycle = 'live'
): T => ({ id, cluster_id: game, role, main_index: index, lifecycle, seated });

const DEEP = ['nlh12', 'plo4q', 'flhq', 'plo5m'];
const OWED = ['pineapple', 'short-deck'];

/** A full cap: four deep games, a full Main 1 and Main 2 each, one opening feeder each. */
const fullFloor = (): T[] => [
  ...DEEP.flatMap((g) => [
    table(`${g}-m1`, g, 'main', 1, 9),
    table(`${g}-m2`, g, 'main', 2, 9),
    table(`${g}-f`, g, 'feeder', null, 0, 'opening'),
  ]),
  ...OWED.map((g) => table(`${g}-m1`, g, 'main', 1, 0)),
];
const planFor = (floor: T[]) =>
  varietyFirstPlan({
    tables: floor,
    seatedAt: (id) => floor.find((t) => t.id === id)?.seated ?? 0,
    startGames: new Set([...DEEP, ...OWED]),
    neverHeldGames: new Set(),
    mayStart: (t) => t.role === 'main' && t.main_index === 1,
  });
const occupied = (floor: T[]) => floor.filter((t) => t.seated > 0).length;

describe('an owed Main 1 starts before an extra table, at a full cap too', () => {
  beforeEach(() => __resetVarietyHolds());

  it('a seating cycle at a full cap holds every extra table and names the owed games', () => {
    const floor = fullFloor();
    const plan = planFor(floor);
    expect([...plan.owedStarts.values()].sort()).toEqual(OWED);
    /* The cap is full: the hourly read admits no empty table this cycle
       (before 2026-11-24 the hold asked exactly that, and held nothing). */
    const fullCapCycle = { withheld: false, admitted: (_tableId: string) => false };
    const held = varietyHoldsThisCycle(plan, fullCapCycle);
    expect([...held].sort()).toEqual(DEEP.map((g) => `${g}-f`).sort());
    expect(varietyOwedGamesThisCycle(plan, { withheld: false })).toEqual(OWED);
    publishVarietyHolds(held, new Set(['h1']), Date.now());
    expect(
      feederStartWaitsForVariety({
        reason: 'balance',
        swap_move_id: null,
        to_table_id: 'nlh12-f',
        player_id: 'h1',
      })
    ).toBe(true);
  });

  it('a withheld cycle holds nothing and names nothing', () => {
    const plan = planFor(fullFloor());
    expect(varietyHoldsThisCycle(plan, { withheld: true }).size).toBe(0);
    expect(varietyOwedGamesThisCycle(plan, { withheld: true })).toEqual([]);
  });

  it('every freed slot goes to an owed Main 1 until none is owed, then depth resumes', () => {
    /* The race, cycle by cycle: a seat at a deep game frees a slot; the tick
       (5 s, so first) opens a feeder only if every owed start still fits (the
       database rule, read from the published list); the fleet's walk then
       starts an owed Main 1 if the cap admits one. */
    const CAP = 8;
    let floor = fullFloor().filter((t) => t.lifecycle !== 'opening');
    expect(occupied(floor)).toBe(CAP);
    const startedOwed: string[] = [];
    for (let round = 0; round < OWED.length + 1; round++) {
      // one Main 2 of a deep game empties (a table broke): a slot frees.
      const leaving = floor.find((t) => t.role === 'main' && t.main_index === 2 && t.seated > 0)!;
      floor = floor.map((t) => (t.id === leaving.id ? { ...t, seated: 0 } : t));
      const plan = planFor(floor);
      const owed = varietyOwedGamesThisCycle(plan, { withheld: false });
      // the tick: census + opening + owed < cap
      const opening = floor.filter((t) => t.lifecycle === 'opening').length;
      if (occupied(floor) + opening + owed.length < CAP) {
        floor = [...floor, table(`feeder-${round}`, DEEP[0], 'feeder', null, 0, 'opening')];
      }
      // the walk: an owed start first, if the cap admits an empty table
      const reserved = floor.filter((t) => t.lifecycle === 'opening').length;
      const start = [...plan.owedStarts.keys()].sort()[0];
      if (start && occupied(floor) + reserved < CAP) {
        floor = floor.map((t) => (t.id === start ? { ...t, seated: 1 } : t));
        startedOwed.push(start);
      }
    }
    expect(startedOwed).toEqual(OWED.map((g) => `${g}-m1`));
    expect(occupied(floor)).toBeLessThanOrEqual(CAP);
    /* With nothing owed, the freed slot of the last round went to a
       waiting-list feeder again (#11773 depth, unchanged). */
    expect(floor.some((t) => t.id === `feeder-${OWED.length}`)).toBe(true);
    expect(floor.some((t) => t.id === 'feeder-0' || t.id === 'feeder-1')).toBe(false);
  });

  it('the fleet carries the owed games on its heartbeat from the same decision as the hold', () => {
    const fleet = read('./HorseFleetManager.ts');
    const decide = fleet.indexOf('const varietyHeld = varietyHoldsThisCycle(variety, {');
    const owed = fleet.indexOf('beat.varietyOwedGames = varietyOwedGamesThisCycle(variety, {');
    const publish = fleet.indexOf('publishVarietyHolds(varietyHeld, horseIdSet, Date.now());');
    const claim = fleet.indexOf(': await this.claimOfferedSeats(');
    expect(decide).toBeGreaterThan(-1);
    expect(owed).toBeGreaterThan(decide);
    expect(publish).toBeGreaterThan(owed);
    expect(claim).toBeGreaterThan(publish);
    expect(fleet.slice(owed, publish)).toContain('withheld: !!cycleWithheld,');
    /* Cleared before the hourly read, so a cycle that fails it names nothing. */
    const cleared = fleet.indexOf('beat.varietyOwedGames = [];');
    const hourly = fleet.indexOf('const hourlyAdmissions = await readHourlyCashAdmissions();');
    expect(cleared).toBeGreaterThan(-1);
    expect(hourly).toBeGreaterThan(cleared);
    expect(decide).toBeGreaterThan(hourly);
    expect(fleet).toContain('variety_owed_games: beat.varietyOwedGames,');
  });

  it('the database reads the same key, as fresh as the in-process hold', () => {
    /* Newest first, stopping at the first definition: the one production runs. */
    const newest = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .reverse()
      .find((f) =>
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.fn_cash_hourly_feeder_admissible\s*\(/i.test(
          readFileSync(join(MIGRATIONS, f), 'utf8')
        )
      );
    expect(newest, 'fn_cash_hourly_feeder_admissible has a defining migration').toBeTruthy();
    const sql = readFileSync(join(MIGRATIONS, newest!), 'utf8');
    expect(sql).toContain("h.detail -> 'variety_owed_games'");
    expect(sql).toContain(
      `h.beat_at > clock_timestamp() - interval '${VARIETY_HOLD_FRESH_MS / 1000} seconds'`
    );
    expect(sql).toContain('+ (SELECT o.n FROM owed o)');
  });
});
