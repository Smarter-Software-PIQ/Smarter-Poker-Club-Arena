/**
 * LAW - A HORSE-ONLY EXTRA TABLE YIELDS TO AN OWED MAIN (2026-11-24).
 *
 * Measured live at 17:22Z with #11909 serving: eleven of seventeen counted
 * tables were extra tables (NLH 1/2 Classic, PLO6 .50/1, PLO5 .10/.25 three
 * each, PLO4 .10/.25 two) opened before that fix, all Horses only, and no
 * Horse left any of them in an hour. #11909 stopped NEW extra tables from
 * taking a freed slot; nothing freed one, so the 25 owed games started only
 * when the cap rose.
 *
 * Now, while a start is owed and the owed starts do not fit under the cap,
 * ONE Horse-only extra table at a time (the top of its game's ladder) stops
 * being kept: the fleet seats nobody there (surplusTableIds) and answers no
 * seat call there, and HorseSessionRotator stands its Horses up one per cycle
 * through engine.leaveTable, the ordinary door (cashed out at the end of the
 * hand; stay clocks and owed hands first). Never a table with a person, never
 * Main 1, never a game with a person on its list, never Lightning.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { supabase } from './supabase.js';
import {
  __resetVarietyDrain,
  owedStartsFit,
  publishVarietyDrain,
  VARIETY_HOLD_FRESH_MS,
  varietyDrainingTable,
  varietyDrainTable,
  type DrainTable,
} from './HorseVarietyFirst.js';
import { HorseSessionRotator, type RotatorEngine } from './HorseSessionRotator.js';
import { setMaintenanceFrozen } from '../maintenance/freezeState.js';
import { JAQK_CLUB_ID } from './StableHand.js';

vi.mock('./HorseWorkSchedule.js', () => ({ offDutyReason: () => null, onDuty: () => true }));

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, rel), 'utf8');

type T = DrainTable & { seated: number; person?: boolean };
const t = (
  id: string,
  game: string,
  role: 'main' | 'feeder',
  index: number | null,
  seated: number,
  createdMin: number,
  extra: Partial<T> = {}
): T => ({
  id,
  cluster_id: game,
  role,
  main_index: index,
  lifecycle: 'live',
  seated,
  created_at: new Date(Date.UTC(2026, 10, 24, 13, createdMin)).toISOString(),
  ...extra,
});

/** Game A: three Horse-only tables (Main 1, Main 2, feeder). Owed: Short Deck. */
const gameA = (): T[] => [
  t('a-m1', 'A', 'main', 1, 9, 0),
  t('a-m2', 'A', 'main', 2, 9, 15),
  t('a-f', 'A', 'feeder', null, 4, 40),
];
const pick = (
  floor: T[],
  over: Partial<Parameters<typeof varietyDrainTable<T>>[0]> = {}
): string | null =>
  varietyDrainTable<T>({
    tables: floor,
    seatedAt: (id) => floor.find((x) => x.id === id)?.seated ?? 0,
    personSeatedAt: (id) => !!floor.find((x) => x.id === id)?.person,
    personWaitingGames: new Set(),
    neverHeldGames: new Set(['L']),
    owedGames: ['short-deck'],
    owedStartsFit: false,
    current: null,
    ...over,
  });

describe('which extra table yields', () => {
  it('full cap, an owed game, three Horse-only tables of game A: the feeder, and only it', () => {
    expect(pick(gameA())).toBe('a-f');
  });

  it('with no feeder, the highest Main: never Main 1, never a Main the ladder fills', () => {
    const floor = [
      t('a-m1', 'A', 'main', 1, 9, 0),
      t('a-m2', 'A', 'main', 2, 9, 15),
      t('a-m3', 'A', 'main', 3, 5, 30),
    ];
    expect(pick(floor)).toBe('a-m3');
    expect(pick(floor.slice(0, 2))).toBe('a-m2');
    expect(pick([t('a-m1', 'A', 'main', 1, 9, 0)])).toBeNull();
    /* Main 1 plus an empty feeder: nothing to release, Main 1 never is. */
    expect(pick([t('a-m1', 'A', 'main', 1, 9, 0), t('a-f', 'A', 'feeder', null, 0, 5)])).toBeNull();
  });

  it('a table with a person is never chosen, and the game below it is not drained instead', () => {
    const floor = gameA().map((x) => (x.id === 'a-f' ? { ...x, person: true } : x));
    expect(pick(floor)).toBeNull();
    const withB = [...floor, t('b-m1', 'B', 'main', 1, 6, 0), t('b-f', 'B', 'feeder', null, 3, 50)];
    expect(pick(withB)).toBe('b-f');
  });

  it('a game with a person on its list, a Lightning game, or a game mid-break is left alone', () => {
    expect(pick(gameA(), { personWaitingGames: new Set(['A']) })).toBeNull();
    const lightning = gameA().map((x) => ({ ...x, cluster_id: 'L' }));
    expect(pick(lightning)).toBeNull();
    const breaking = gameA().map((x) => (x.id === 'a-m2' ? { ...x, lifecycle: 'breaking' } : x));
    expect(pick(breaking)).toBeNull();
    /* An opening feeder is not a candidate; the live one still is. */
    const opening = [...gameA(), t('a-f2', 'A', 'feeder', null, 0, 55, { lifecycle: 'opening' })];
    expect(pick(opening)).toBe('a-f');
  });

  it('no owed game, or owed starts that fit, drains nothing', () => {
    expect(pick(gameA(), { owedGames: [] })).toBeNull();
    expect(pick(gameA(), { owedStartsFit: true })).toBeNull();
  });

  it('one table at a time: the fewest Horses, then the newest, and the current one keeps draining', () => {
    const floor = [
      ...gameA(),
      t('b-m1', 'B', 'main', 1, 6, 0),
      t('b-m2', 'B', 'main', 2, 6, 20),
      t('b-f', 'B', 'feeder', null, 2, 10),
      t('c-m1', 'C', 'main', 1, 6, 0),
      t('c-f', 'C', 'feeder', null, 2, 45),
    ];
    expect(pick(floor)).toBe('c-f');
    expect(pick(floor, { current: 'a-f' })).toBe('a-f');
    /* A current table that stopped being a candidate (a person sat) is dropped. */
    const sat = floor.map((x) => (x.id === 'a-f' ? { ...x, person: true } : x));
    expect(pick(sat, { current: 'a-f' })).toBe('c-f');
  });

  it("the owed starts fit by the database's own sum; unknown fits; an admitted owed start fits", () => {
    const base = {
      cap: 17,
      counted: 17,
      openingFeeders: 0,
      owedStarts: 25,
      anOwedStartAdmitted: false,
    };
    expect(owedStartsFit(base)).toBe(false);
    expect(owedStartsFit({ ...base, counted: 10, owedStarts: 7 })).toBe(true);
    expect(owedStartsFit({ ...base, counted: 10, owedStarts: 7, openingFeeders: 1 })).toBe(false);
    expect(owedStartsFit({ ...base, cap: null })).toBe(true);
    expect(owedStartsFit({ ...base, anOwedStartAdmitted: true })).toBe(true);
  });

  it('the publication is as fresh as the hold, and a stopped fleet drains nothing', () => {
    __resetVarietyDrain();
    publishVarietyDrain('a-f', 1_000);
    expect(varietyDrainingTable(1_000 + VARIETY_HOLD_FRESH_MS - 1)).toBe('a-f');
    expect(varietyDrainingTable(1_000 + VARIETY_HOLD_FRESH_MS)).toBeNull();
    publishVarietyDrain(null, 2_000);
    expect(varietyDrainingTable(2_000)).toBeNull();
  });
});

describe('the fleet keeps no Horse at the released table', () => {
  const fleet = read('./HorseFleetManager.ts');
  it('decides after the hold, clears before the hourly read, and joins surplusTableIds before any seating', () => {
    const clear = fleet.indexOf('publishVarietyDrain(null, Date.now());');
    const hourly = fleet.indexOf('const hourlyAdmissions = await readHourlyCashAdmissions();');
    const decide = fleet.indexOf('varietyDrain = varietyDrainTable({');
    const surplus = fleet.indexOf('surplusTableIds.add(varietyDrain);');
    const publish = fleet.indexOf('publishVarietyDrain(varietyDrain, Date.now());');
    const claim = fleet.indexOf(': await this.claimOfferedSeats(');
    expect(clear).toBeGreaterThan(-1);
    expect(hourly).toBeGreaterThan(clear);
    expect(decide).toBeGreaterThan(hourly);
    expect(surplus).toBeGreaterThan(decide);
    expect(publish).toBeGreaterThan(surplus);
    expect(claim).toBeGreaterThan(publish);
    expect(fleet).toContain('variety_drain_table: beat.varietyDrainTable,');
  });
  it('releases a table only on a fully read waiting list (an unread list is never "no person waiting")', () => {
    const reset = fleet.indexOf('this.humansWaitingReadComplete = false;');
    const set = fleet.indexOf('this.humansWaitingReadComplete = true;');
    const catchAt = fleet.indexOf("reportError(err, 'HorseFleet.humansWaitingByTable');");
    expect(reset).toBeGreaterThan(-1);
    // set only after every early return and the catch of the read
    expect(set).toBeGreaterThan(catchAt);
    const gate = fleet.indexOf('this.humansWaitingReadComplete\n');
    const decide = fleet.indexOf('varietyDrain = varietyDrainTable({');
    expect(gate).toBeGreaterThan(-1);
    expect(decide).toBeGreaterThan(gate);
  });
  it('a surplus table is neither walked into nor answered by a seat call (the existing doors)', () => {
    expect(fleet).toContain('if (surplusTableIds.has(table.id)) {');
    expect(fleet).toContain('if (surplusTableIds.has(String(offer.table_id))) continue;');
  });
});

/* ── THE ROTATOR, DRIVEN THROUGH A FAKE POSTGREST ─────────────────────────── */
type Rows = Record<string, any>[];
function fakeDb(tables: Record<string, Rows>) {
  const build = (name: string) => {
    let rows = [...(tables[name] ?? [])];
    let from = 0;
    let to = Infinity;
    let lim = Infinity;
    const b: any = {};
    b.select = () => b;
    b.eq = (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), b);
    b.in = (c: string, v: unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), b);
    b.is = (c: string, v: unknown) => ((rows = rows.filter((r) => (r[c] ?? null) === v)), b);
    b.gt = (c: string, v: any) => ((rows = rows.filter((r) => String(r[c]) > String(v))), b);
    b.lte = () => b;
    b.not = () => b;
    b.order = () => b;
    b.limit = (n: number) => ((lim = n), b);
    b.range = (a: number, z: number) => ((from = a), (to = z), b);
    b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
      Promise.resolve({
        data: rows.slice(from, Math.min(rows.length, to + 1)).slice(0, lim),
        error: null,
      }).then(ok, bad);
    return b;
  };
  vi.spyOn(supabase, 'from').mockImplementation(((name: string) => build(name)) as never);
  vi.spyOn(supabase, 'rpc').mockImplementation((() =>
    Promise.resolve({ data: null, error: { message: 'no rpc in fixture' } })) as never);
}

const NOW = Date.parse('2026-11-24T17:30:00Z');
const GAME = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const M1 = '10000000-0000-4000-8000-0000000000a1';
const M2 = '10000000-0000-4000-8000-0000000000a2';
const F = '10000000-0000-4000-8000-0000000000af';
const PERSON = 'p0000000-0000-4000-8000-000000000001';
const HORSES = Array.from(
  { length: 18 },
  (_, i) => `h0000000-0000-4000-8000-${String(i).padStart(12, '0')}`
);
const tableRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  big_blind: 0.02,
  small_blind: 0.01,
  game_variant: 'nlh',
  tournament_id: null,
  is_spins: false,
  status: 'running',
  settings: {},
  cluster_id: GAME,
  role: 'main',
  main_index: 1,
  lifecycle: 'live',
  created_at: new Date(NOW - 3600_000).toISOString(),
  max_players: 6,
  min_buy_in: 1,
  max_buy_in: 4,
  is_deleted: false,
  ...extra,
});
function floor(personAtFeeder = false) {
  const tables = [
    tableRow(M1),
    tableRow(M2, { main_index: 2 }),
    tableRow(F, { role: 'feeder', main_index: null }),
  ];
  const seats: Rows = [];
  tables.forEach((tb, ti) => {
    for (let s = 0; s < 6; s++) {
      const person = personAtFeeder && tb.id === F && s === 0;
      seats.push({
        id: `s-${ti}-${s}`,
        table_id: tb.id,
        user_id: person ? PERSON : HORSES[ti * 6 + s],
        seat_number: s + 1,
        stack: 2,
        joined_at: new Date(NOW - (60 + s) * 60_000).toISOString(),
        club_id: JAQK_CLUB_ID,
        leave_pending: false,
        is_sitting_out: false,
        left_at: null,
        tables: tb,
      });
    }
  });
  return {
    table_seats: seats,
    profiles: [...HORSES.map((id) => ({ id, is_horse: true })), { id: PERSON, is_horse: false }],
    club_members: [],
    chip_ledger: [],
    table_waitlist: [],
    cash_game_waitlist: [],
    cash_games: [{ id: GAME, must_move: true, cluster_mode: 'must_move', enabled: true }],
    cash_seat_moves: [],
    hand_history: [],
    tournament_players: [],
    tables,
  };
}

describe("the released table's Horses go home through the ordinary door", () => {
  beforeEach(() => {
    setMaintenanceFrozen(false);
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    for (const m of ['log', 'warn', 'error'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
    vi.spyOn(Math, 'random').mockReturnValue(0.999999); // no discretionary departures or breaks
    __resetVarietyDrain();
  });
  afterEach(() => {
    __resetVarietyDrain();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const run = async (db: ReturnType<typeof floor>, owed: Record<string, number> = {}) => {
    fakeDb(db);
    const leaves: Array<{ tableId: string; userId: string }> = [];
    const engine = (tableId: string): RotatorEngine => ({
      leaveTable: (userId: string) => {
        leaves.push({ tableId, userId });
        return { success: true };
      },
      hitRunHandsOwed: (userId: string) => owed[userId] ?? 0,
      sitOut: () => ({ success: true }),
    });
    const rot = new HorseSessionRotator(engine) as any;
    rot.isRunning = true;
    rot.lifecycleGeneration = 1;
    await rot.rotate(1);
    return leaves;
  };

  it('nothing published: nobody leaves the extra table', async () => {
    expect((await run(floor())).filter((l) => l.tableId === F)).toEqual([]);
  });

  it('the released table: exactly one Horse a cycle leaves it, Main 1 and Main 2 keep theirs', async () => {
    const baseline = await run(floor());
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    for (const m of ['log', 'warn', 'error'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
    publishVarietyDrain(F, Date.now());
    const leaves = await run(floor());
    const atF = leaves.filter((l) => l.tableId === F);
    expect(atF).toHaveLength(1);
    expect(HORSES.slice(12, 18)).toContain(atF[0].userId);
    expect(leaves.filter((l) => l.tableId !== F)).toEqual(baseline.filter((l) => l.tableId !== F));
  });

  it('a Horse still owing hands in profit plays them first; the next one goes', async () => {
    publishVarietyDrain(F, Date.now());
    const owed = Object.fromEntries(HORSES.slice(12, 17).map((h) => [h, 3]));
    const atF = (await run(floor(), owed)).filter((l) => l.tableId === F);
    expect(atF).toEqual([{ tableId: F, userId: HORSES[17] }]);
  });

  it('a person at the table stops the release at once', async () => {
    publishVarietyDrain(F, Date.now());
    expect((await run(floor(true))).filter((l) => l.tableId === F)).toEqual([]);
  });

  it('a table the cluster tick is breaking is not walked out of (the break moves its Horses)', async () => {
    publishVarietyDrain(F, Date.now());
    const db = floor();
    const breaking = { ...db.tables[2], lifecycle: 'breaking' };
    db.tables[2] = breaking;
    db.table_seats = db.table_seats.map((x) => (x.table_id === F ? { ...x, tables: breaking } : x));
    expect((await run(db)).filter((l) => l.tableId === F)).toEqual([]);
  });

  it('a stale publication releases nothing', async () => {
    publishVarietyDrain(F, Date.now() - VARIETY_HOLD_FRESH_MS);
    expect((await run(floor())).filter((l) => l.tableId === F)).toEqual([]);
  });
});
