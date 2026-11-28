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
 * seat call there, and HorseSessionRotator stands up every Horse not holding
 * cards in the same cycle (one leave sweep) through engine.leaveTable, the ordinary door (cashed out at the end of the
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
  drainCycleOutcome,
  varietyOwedSince,
  mayAddDrainTable,
  VARIETY_DRAIN_PACE_SLACK_MS,
  owedStartsFit,
  publishVarietyDrain,
  VARIETY_HOLD_FRESH_MS,
  varietyDrainingTable,
  varietyDrainingTables,
  varietyDrainTables,
  drainShortfall,
  feederStartWaitsForVariety,
  VARIETY_DRAIN_FRESH_MS,
  VARIETY_DRAIN_NEW_TABLE_MS,
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

  it('a released table stays released: empty, or in a cycle the owed starts fit, until no start is owed', () => {
    const floor = gameA();
    /* named last cycle; this cycle an owed start was admitted (fits): still named, no walk back in */
    expect(pick(floor, { current: 'a-f', owedStartsFit: true })).toBe('a-f');
    /* its Horses have gone home and it has not closed yet: still named, nobody is seated there */
    const emptied = floor.map((x) => (x.id === 'a-f' ? { ...x, seated: 0 } : x));
    expect(pick(emptied, { current: 'a-f' })).toBe('a-f');
    expect(pick(emptied, { current: 'a-f', owedStartsFit: true })).toBe('a-f');
    /* an empty table is never NEWLY released, and a fit never starts a release */
    expect(pick(emptied)).toBeNull();
    expect(pick(floor, { owedStartsFit: true })).toBeNull();
    /* no start owed, a person sat down or joined the list, or the table closed: released no longer */
    expect(pick(emptied, { current: 'a-f', owedGames: [] })).toBeNull();
    expect(pick(floor, { current: 'a-f', personWaitingGames: new Set(['A']) })).toBeNull();
    const sat = floor.map((x) => (x.id === 'a-f' ? { ...x, person: true } : x));
    expect(pick(sat, { current: 'a-f' })).toBeNull();
    const closed = floor.map((x) => (x.id === 'a-f' ? { ...x, lifecycle: 'closed' } : x));
    expect(pick(closed, { current: 'a-f', owedStartsFit: true })).toBeNull();
  });

  it('the drain scales with the backlog: one new table per cycle while released tables are fewer than the shortfall', () => {
    const floor = [
      ...gameA(),
      t('b-m1', 'B', 'main', 1, 6, 0),
      t('b-f', 'B', 'feeder', null, 2, 10),
      t('c-m1', 'C', 'main', 1, 6, 0),
      t('c-f', 'C', 'feeder', null, 3, 45),
    ];
    const many = (shortfall: number, current: string[] = []) =>
      varietyDrainTables<T>({
        tables: floor,
        seatedAt: (id) => floor.find((x) => x.id === id)?.seated ?? 0,
        personSeatedAt: (id) => !!floor.find((x) => x.id === id)?.person,
        personWaitingGames: new Set(),
        neverHeldGames: new Set(['L']),
        owedGames: ['short-deck', 'pineapple', 'flo8'],
        shortfall,
        current,
      });
    /* cycle 1: nothing released yet, three short: the fewest Horses first */
    expect(many(3)).toEqual(['b-f']);
    /* cycle 2: b-f kept, one more added (never two in one cycle) */
    expect(many(3, ['b-f'])).toEqual(['b-f', 'c-f']);
    expect(many(3, ['b-f', 'c-f'])).toEqual(['b-f', 'c-f', 'a-f']);
    /* released tables already cover the shortfall: nothing new */
    expect(many(2, ['b-f', 'c-f'])).toEqual(['b-f', 'c-f']);
    /* a free slot (shortfall 0): released tables stay released, none is added */
    expect(many(0, ['b-f'])).toEqual(['b-f']);
    expect(many(0)).toEqual([]);
    /* no start owed: everything is released no longer */
    expect(
      varietyDrainTables<T>({
        tables: floor,
        seatedAt: (id) => floor.find((x) => x.id === id)?.seated ?? 0,
        personSeatedAt: () => false,
        personWaitingGames: new Set(),
        neverHeldGames: new Set(),
        owedGames: [],
        shortfall: 5,
        current: ['b-f', 'c-f'],
      })
    ).toEqual([]);
  });

  it('2026-11-26: among new candidates the table whose Horses owe fewest hands goes first (it empties in one sweep)', () => {
    const floor = [
      ...gameA(),
      t('b-m1', 'B', 'main', 1, 6, 0),
      t('b-f', 'B', 'feeder', null, 2, 10),
      t('c-m1', 'C', 'main', 1, 6, 0),
      t('c-f', 'C', 'feeder', null, 3, 45),
    ];
    const many = (owingAt?: (id: string) => number) =>
      varietyDrainTables<T>({
        tables: floor,
        seatedAt: (id) => floor.find((x) => x.id === id)?.seated ?? 0,
        personSeatedAt: () => false,
        personWaitingGames: new Set(),
        neverHeldGames: new Set(),
        owedGames: ['short-deck'],
        shortfall: 1,
        current: [],
        ...(owingAt ? { owingAt } : {}),
      });
    /* no read: the fewest Horses (b-f, two seated) */
    expect(many()).toEqual(['b-f']);
    /* b-f has a Horse owing hands, c-f none: c-f goes first */
    expect(many((id) => (id === 'b-f' ? 1 : 0))).toEqual(['c-f']);
    /* a nonsense count is no preference */
    expect(many(() => Number.NaN)).toEqual(['b-f']);
    /* kept tables never change because of the count */
    expect(
      varietyDrainTables<T>({
        tables: floor,
        seatedAt: (id) => floor.find((x) => x.id === id)?.seated ?? 0,
        personSeatedAt: () => false,
        personWaitingGames: new Set(),
        neverHeldGames: new Set(),
        owedGames: ['short-deck'],
        shortfall: 1,
        current: ['b-f'],
        owingAt: () => 9,
      })
    ).toEqual(['b-f']);
  });

  it('2026-11-26: the owed-hands read runs only when a new table may be added, and the beat carries the cap it read', async () => {
    const fleet = read('./HorseFleetManager.ts');
    expect(fleet).toContain(
      'mayAddNew && shortfall > 0\n            ? await readHandsOwedByTable('
    );
    expect(fleet).toContain('owingAt: owing ? (tableId) => owing.get(tableId) ?? 0 : undefined,');
    expect(fleet).toContain('beat.cashRoom = room;');
    expect(fleet).toContain('cash_room: beat.cashRoom,');
    const { readHandsOwedByTable } = await import('./supabase/cashHourlyTables.js');
    const owes = { hr_engine_ack: true, hr_completed: false, baseline: 100, closed_at: null };
    fakeDb({
      cash_player_session: [
        { ...owes, table_id: 'x', player_id: 'h1', hr_hands_required: 10, hr_hands_played: 2 },
        { ...owes, table_id: 'x', player_id: 'h2', hr_hands_required: 10, hr_hands_played: 10 },
        {
          ...owes,
          table_id: 'y',
          player_id: 'h3',
          hr_hands_required: 10,
          hr_hands_played: 1,
          hr_completed: true,
        },
        {
          ...owes,
          table_id: 'y',
          player_id: 'h4',
          hr_hands_required: 10,
          hr_hands_played: 1,
          closed_at: '2026-11-26T00:00:00Z',
        },
        { ...owes, table_id: 'z', player_id: 'h5', hr_hands_required: 10, hr_hands_played: 0 },
      ],
      table_seats: [
        { table_id: 'x', user_id: 'h1', stack: 150, left_at: null },
        { table_id: 'x', user_id: 'h2', stack: 150, left_at: null },
        { table_id: 'y', user_id: 'h3', stack: 150, left_at: null },
        { table_id: 'y', user_id: 'h4', stack: 150, left_at: null },
        { table_id: 'z', user_id: 'h5', stack: 150, left_at: null },
      ],
    });
    const owed = await readHandsOwedByTable(['x', 'y']);
    expect(owed && Object.fromEntries(owed)).toEqual({ x: 1 });
    expect(await readHandsOwedByTable([])).toEqual(new Map());
    vi.restoreAllMocks();
  });

  it('review follow-up 2026-11-27: the tie-break counts only seats the engine treats as owing', async () => {
    const { readHandsOwedByTable, sessionHandsOwed } =
      await import('./supabase/cashHourlyTables.js');
    const row = {
      hr_engine_ack: true,
      hr_completed: false,
      baseline: 100,
      hr_hands_required: 10,
      hr_hands_played: 3,
      closed_at: null,
    };
    /* the engine's rule (fn_cash_session_hands_owed): acknowledged, in profit */
    expect(sessionHandsOwed(row, 150)).toBe(7);
    expect(sessionHandsOwed(row, 100)).toBe(0);
    expect(sessionHandsOwed(row, 80)).toBe(0);
    expect(sessionHandsOwed({ ...row, hr_engine_ack: false }, 150)).toBe(0);
    expect(sessionHandsOwed({ ...row, hr_completed: true }, 150)).toBe(0);
    /* the Charles big-win count binds with chips at the table, in profit or not */
    const big = { ...row, hr_completed: true, hr_big_win_required: 10, hr_big_win_played: 4 };
    expect(sessionHandsOwed(big, 80)).toBe(6);
    expect(sessionHandsOwed(big, 0)).toBe(0);
    expect(sessionHandsOwed({ ...big, hr_engine_ack: false }, 80)).toBe(0);
    fakeDb({
      cash_player_session: [
        { ...row, table_id: 'below', player_id: 'h1' },
        { ...row, table_id: 'noack', player_id: 'h2', hr_engine_ack: false },
        { ...row, table_id: 'owing', player_id: 'h3' },
        { ...big, table_id: 'bigwin', player_id: 'h4' },
        { ...row, table_id: 'gone', player_id: 'h5' },
      ],
      table_seats: [
        { table_id: 'below', user_id: 'h1', stack: 60, left_at: null },
        { table_id: 'noack', user_id: 'h2', stack: 150, left_at: null },
        { table_id: 'owing', user_id: 'h3', stack: 150, left_at: null },
        { table_id: 'bigwin', user_id: 'h4', stack: 60, left_at: null },
        { table_id: 'gone', user_id: 'h5', stack: 150, left_at: '2026-11-27T00:00:00Z' },
      ],
    });
    const owed = await readHandsOwedByTable(['below', 'noack', 'owing', 'bigwin', 'gone']);
    /* a table whose only owing Horse is below its baseline counts 0 */
    expect(owed?.get('below') ?? 0).toBe(0);
    expect(owed && Object.fromEntries(owed)).toEqual({ owing: 1, bigwin: 1 });
    /* a failed read is still no preference */
    vi.restoreAllMocks();
    vi.spyOn(supabase, 'from').mockImplementation((() => {
      throw new Error('down');
    }) as never);
    expect(await readHandsOwedByTable(['owing'])).toBeNull();
    vi.restoreAllMocks();
  });

  it('review follow-up 2026-11-27: the heartbeat carries when each owed game was first seen owed', () => {
    const T0 = '2026-11-27T10:00:00.000Z';
    const T1 = '2026-11-27T10:00:30.000Z';
    const T2 = '2026-11-27T10:01:00.000Z';
    /* a newly owed game is stamped now */
    const c1 = varietyOwedSince({
      withheld: false,
      owedGames: ['A', 'B'],
      previous: {},
      nowIso: T0,
    });
    expect(c1).toEqual({ A: T0, B: T0 });
    /* the memory survives across cycles; a new game gets its own time */
    const c2 = varietyOwedSince({
      withheld: false,
      owedGames: ['A', 'B', 'C'],
      previous: c1,
      nowIso: T1,
    });
    expect(c2).toEqual({ A: T0, B: T0, C: T1 });
    /* a withheld cycle publishes no owed games and forgets nothing */
    const c3 = varietyOwedSince({ withheld: true, owedGames: [], previous: c2, nowIso: T2 });
    expect(c3).toEqual(c2);
    expect(c3).not.toBe(c2);
    /* a game a seating cycle no longer publishes is forgotten; owed again later, it starts again */
    const c4 = varietyOwedSince({
      withheld: false,
      owedGames: ['A', 'C'],
      previous: c3,
      nowIso: T2,
    });
    expect(c4).toEqual({ A: T0, C: T1 });
    expect(
      varietyOwedSince({ withheld: false, owedGames: ['B'], previous: c4, nowIso: T2 })
    ).toEqual({
      B: T2,
    });
    expect(varietyOwedSince({ withheld: false, owedGames: [], previous: c4, nowIso: T2 })).toEqual(
      {}
    );
    /* the fleet keeps one memory, assigned only from the pure function, and the beat writes it */
    const fleet = read('./HorseFleetManager.ts');
    expect(fleet.match(/this\.varietyOwedSinceByGame = /g)?.length).toBe(1);
    expect(fleet).toContain('this.varietyOwedSinceByGame = varietyOwedSince({');
    expect(fleet).toContain('variety_owed_since: beat.varietyOwedSince,');
  });

  it('the shortfall is every owed start at a cap with no free slot, and zero whenever the starts fit', () => {
    const full = {
      cap: 16,
      counted: 16,
      openingFeeders: 0,
      owedStarts: 19,
      anOwedStartAdmitted: false,
    };
    expect(drainShortfall(full)).toBe(19);
    expect(drainShortfall({ ...full, counted: 15 })).toBe(0);
    expect(drainShortfall({ ...full, counted: 15, openingFeeders: 1 })).toBe(19);
    expect(drainShortfall({ ...full, cap: null })).toBe(0);
    expect(drainShortfall({ ...full, anOwedStartAdmitted: true })).toBe(0);
    expect(drainShortfall({ ...full, owedStarts: 0 })).toBe(0);
  });

  it('every released table is published, and each is still dropped when it goes stale', () => {
    __resetVarietyDrain();
    publishVarietyDrain(['a-f', 'b-f'], 1_000);
    expect(varietyDrainingTables(1_000)).toEqual(['a-f', 'b-f']);
    expect(varietyDrainingTable(1_000)).toBe('a-f');
    expect(varietyDrainingTables(1_000 + VARIETY_DRAIN_FRESH_MS)).toEqual([]);
    publishVarietyDrain([], 2_000);
    expect(varietyDrainingTables(2_000)).toEqual([]);
  });

  it('review 2026-11-26: an emptied released table covers no owed start; the ramp waits for the rotator', () => {
    const floor = [
      ...gameA().map((x) => (x.id === 'a-f' ? { ...x, seated: 0 } : x)),
      t('b-m1', 'B', 'main', 1, 6, 0),
      t('b-f', 'B', 'feeder', null, 2, 10),
    ];
    const many = (over: Partial<Parameters<typeof varietyDrainTables<T>>[0]> = {}) =>
      varietyDrainTables<T>({
        tables: floor,
        seatedAt: (id) => floor.find((x) => x.id === id)?.seated ?? 0,
        personSeatedAt: () => false,
        personWaitingGames: new Set(),
        neverHeldGames: new Set(),
        owedGames: ['short-deck'],
        shortfall: 1,
        current: ['a-f'],
        ...over,
      });
    /* a-f has emptied but not closed: it stays released, and b-f is added for the one short start */
    expect(many()).toEqual(['a-f', 'b-f']);
    /* not yet a rotator cycle since the last new release: a-f only */
    expect(many({ mayAddNew: false })).toEqual(['a-f']);
    expect(VARIETY_DRAIN_NEW_TABLE_MS).toBe(90_000);
    const rotator = read('./HorseSessionRotator.ts');
    expect(rotator).toMatch(/const CYCLE_MS = 90_000;/);
    const fleet = read('./HorseFleetManager.ts');
    expect(fleet).toContain(
      'const mayAddNew = mayAddDrainTable(Date.now(), this.varietyDrainNewAtMs);'
    );
  });

  it('review 2026-11-27: the pace is three fleet cycles even when the third runs a moment early, never two', () => {
    const stamped = 1_000_000;
    /* the third 30 s cycle after the stamp, a few ms early: a strict >= 90 s
       refused this and the new table waited a fourth cycle (120 s) */
    expect(mayAddDrainTable(stamped + 89_950, stamped)).toBe(true);
    expect(mayAddDrainTable(stamped + 90_000, stamped)).toBe(true);
    /* the second cycle, however late it ran, is never enough */
    expect(mayAddDrainTable(stamped + 60_000, stamped)).toBe(false);
    expect(mayAddDrainTable(stamped + 79_999, stamped)).toBe(false);
    expect(VARIETY_DRAIN_PACE_SLACK_MS).toBeLessThan(30_000);
    expect(VARIETY_DRAIN_NEW_TABLE_MS - VARIETY_DRAIN_PACE_SLACK_MS).toBeGreaterThan(60_000);
  });

  it('review 2026-11-26: no Horse is moved onto a released table; a person or a break move never waits', () => {
    __resetVarietyDrain();
    const now = Date.now();
    publishVarietyDrain(['tbl-f'], now, new Set(['horse-1']));
    const move = (reason: string, player: string, to = 'tbl-f') =>
      feederStartWaitsForVariety({
        reason,
        swap_move_id: null,
        to_table_id: to,
        player_id: player,
      });
    expect(move('balance', 'horse-1')).toBe(true);
    expect(move('seat_change', 'horse-1')).toBe(true);
    expect(move('must_move', 'horse-1')).toBe(true);
    expect(move('break', 'horse-1')).toBe(false);
    expect(move('balance', 'person-1')).toBe(false);
    expect(move('balance', 'horse-1', 'tbl-other')).toBe(false);
    __resetVarietyDrain();
    expect(move('balance', 'horse-1')).toBe(false);
  });

  it('review 2026-11-26: an undecided cycle keeps released tables out of seating, and the publication is never cleared before the reads', () => {
    const fleet = read('./HorseFleetManager.ts');
    const hold = fleet.indexOf('for (const tableId of holdOnly) surplusTableIds.add(tableId);');
    const claim = fleet.indexOf(': await this.claimOfferedSeats(');
    expect(hold).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(hold);
    expect(fleet).not.toContain('publishVarietyDrain(null, Date.now());');
    expect(fleet).toContain('publishVarietyDrain(released, Date.now(), horseIdSet);');
    expect(fleet).toContain('const holdOnly = drainCycle.held;');
    expect(fleet).toContain('const released = drainCycle.released;');
  });

  it('a cycle that could not decide does not forget the table being released', () => {
    const fleet = read('./HorseFleetManager.ts');
    /* The anchor is the decision call as the fleet writes it now. The old
       anchor ('varietyDrain = varietyDrainTables({') left the fleet in #12229,
       indexOf returned -1 and the ordering pin passed for any position
       (review 2026-11-27): the anchor itself must be found. */
    const decided = fleet.indexOf('const decision = varietyDrainDecision({');
    const keep = fleet.indexOf('this.varietyDrainTableIds = drainCycle.memory;');
    expect(decided).toBeGreaterThan(-1);
    expect(keep).toBeGreaterThan(decided);
    expect(fleet.match(/this\.varietyDrainTableIds = /g)?.length).toBe(1);
    const cycle = (over: Partial<Parameters<typeof drainCycleOutcome>[0]> = {}) =>
      drainCycleOutcome({
        withheld: false,
        readsComplete: false,
        owedThisCycle: 19,
        owedInPlan: 19,
        decision: [],
        remembered: ['tbl-a', 'tbl-b'],
        personSeatedAt: () => false,
        ...over,
      });
    expect(cycle()).toEqual({
      decided: false,
      held: ['tbl-a', 'tbl-b'],
      released: ['tbl-a', 'tbl-b'],
      memory: ['tbl-a', 'tbl-b'],
    });
    /* a table a person sat down at is never held, but is not forgotten either:
       the next decided cycle drops it by its own rule */
    expect(cycle({ personSeatedAt: (id) => id === 'tbl-b' })).toMatchObject({
      held: ['tbl-a'],
      released: ['tbl-a'],
      memory: ['tbl-a', 'tbl-b'],
    });
  });

  it('review 2026-11-27: a withheld cycle with good reads still holds, publishes and remembers the released tables', () => {
    const base = {
      readsComplete: true,
      decision: [] as string[],
      remembered: ['tbl-a', 'tbl-b'],
      personSeatedAt: () => false,
    };
    /* Seating withheld (the decision lane behind): the cycle publishes no owed
       games, the reads are fine. Before the fix this counted as decided, so
       memory and publication were both emptied. */
    expect(
      drainCycleOutcome({ ...base, withheld: true, owedThisCycle: 0, owedInPlan: 19 })
    ).toEqual({
      decided: false,
      held: ['tbl-a', 'tbl-b'],
      released: ['tbl-a', 'tbl-b'],
      memory: ['tbl-a', 'tbl-b'],
    });
    /* withheld and the plan itself owes nothing: nothing to hold, drain over */
    expect(drainCycleOutcome({ ...base, withheld: true, owedThisCycle: 0, owedInPlan: 0 })).toEqual(
      { decided: false, held: [], released: [], memory: [] }
    );
    /* a seating cycle with good reads decides: exactly the decision */
    expect(
      drainCycleOutcome({
        ...base,
        withheld: false,
        owedThisCycle: 19,
        owedInPlan: 19,
        decision: ['tbl-a', 'tbl-c'],
      })
    ).toEqual({
      decided: true,
      held: [],
      released: ['tbl-a', 'tbl-c'],
      memory: ['tbl-a', 'tbl-c'],
    });
    /* a seating cycle that finds nothing owed clears the memory */
    expect(
      drainCycleOutcome({ ...base, withheld: false, owedThisCycle: 0, owedInPlan: 0 })
    ).toEqual({ decided: true, held: [], released: [], memory: [] });
    const fleet = read('./HorseFleetManager.ts');
    expect(fleet).toContain('const drainCycle = drainCycleOutcome({');
    expect(fleet).toContain('withheld: !!cycleWithheld,');
    expect(fleet).toContain('owedInPlan: variety.owedStarts.size,');
    expect(fleet).not.toContain('const drainDecided =');
  });

  it('a table is released only at a cap with no free slot; unknown fits; an admitted owed start fits', () => {
    const base = {
      cap: 17,
      counted: 17,
      openingFeeders: 0,
      owedStarts: 25,
      anOwedStartAdmitted: false,
    };
    expect(owedStartsFit(base)).toBe(false);
    expect(owedStartsFit({ ...base, counted: 10, owedStarts: 7 })).toBe(true);
    /* A free slot under the cap fits the next owed start, however many are owed
       (production 2026-11-26 04:15 CST: cap 10, 6 counted, 30 owed). */
    expect(owedStartsFit({ ...base, counted: 10, owedStarts: 7, openingFeeders: 1 })).toBe(true);
    expect(owedStartsFit({ ...base, cap: 10, counted: 6, owedStarts: 30 })).toBe(true);
    /* No free slot: counted tables plus empty opening feeders reach the cap. */
    expect(owedStartsFit({ ...base, counted: 16, openingFeeders: 1, owedStarts: 1 })).toBe(false);
    expect(owedStartsFit({ ...base, owedStarts: 0 })).toBe(true);
    expect(owedStartsFit({ ...base, cap: null })).toBe(true);
    expect(owedStartsFit({ ...base, anOwedStartAdmitted: true })).toBe(true);
  });

  it('the publication is as fresh as the hold, and a stopped fleet drains nothing', () => {
    __resetVarietyDrain();
    publishVarietyDrain('a-f', 1_000);
    expect(varietyDrainingTable(1_000 + VARIETY_DRAIN_FRESH_MS - 1)).toBe('a-f');
    expect(varietyDrainingTable(1_000 + VARIETY_DRAIN_FRESH_MS)).toBeNull();
    publishVarietyDrain(null, 2_000);
    expect(varietyDrainingTable(2_000)).toBeNull();
  });
});

describe('the fleet keeps no Horse at the released table', () => {
  const fleet = read('./HorseFleetManager.ts');
  it('decides after the hold, clears before the hourly read, and joins surplusTableIds before any seating', () => {
    const clear = fleet.indexOf('clearVarietyHolds();');
    const hourly = fleet.indexOf('const hourlyAdmissions = await readHourlyCashAdmissions();');
    /* the decision call (2026-11-27: varietyDrainDecision, which also says why) */
    const decide = fleet.indexOf('const decision = varietyDrainDecision({');
    const surplus = fleet.indexOf(
      'for (const tableId of varietyDrain) surplusTableIds.add(tableId);'
    );
    const publish = fleet.indexOf('publishVarietyDrain(released, Date.now(), horseIdSet);');
    const claim = fleet.indexOf(': await this.claimOfferedSeats(');
    expect(clear).toBeGreaterThan(-1);
    expect(hourly).toBeGreaterThan(clear);
    expect(decide).toBeGreaterThan(hourly);
    expect(surplus).toBeGreaterThan(decide);
    expect(publish).toBeGreaterThan(surplus);
    expect(claim).toBeGreaterThan(publish);
    expect(fleet).toContain('variety_drain_table: beat.varietyDrainTable,');
    expect(fleet).toContain('variety_drain_tables: beat.varietyDrainTables,');
  });
  it('releases a table only on a fully read waiting list (an unread list is never "no person waiting")', () => {
    const reset = fleet.indexOf('this.humansWaitingReadComplete = false;');
    const set = fleet.indexOf('this.humansWaitingReadComplete = true;');
    const catchAt = fleet.indexOf("reportError(err, 'HorseFleet.humansWaitingByTable');");
    expect(reset).toBeGreaterThan(-1);
    // set only after every early return and the catch of the read
    expect(set).toBeGreaterThan(catchAt);
    const gate = fleet.indexOf('this.humansWaitingReadComplete\n');
    /* the decision call (2026-11-27: varietyDrainDecision, which also says why) */
    const decide = fleet.indexOf('const decision = varietyDrainDecision({');
    expect(gate).toBeGreaterThan(-1);
    expect(decide).toBeGreaterThan(gate);
  });
  it('the engine answers liveInHand the way leaveTable reads a live seat, and the drain asks it', () => {
    const base = read('../engine/ServerTableEngineBase.ts');
    const at = base.indexOf('public liveInHand(userId: string): boolean {');
    expect(at).toBeGreaterThan(-1);
    const body = base.slice(at, base.indexOf('\n  }\n', at));
    expect(body).toContain('this.handController?.getState()');
    expect(body).toContain('!self.is_folded');
    const rotator = read('./HorseSessionRotator.ts');
    const drain = rotator.slice(
      rotator.indexOf('for (const drainTableId of varietyDrainingTables(')
    );
    expect(drain.slice(0, drain.indexOf('engine.leaveTable(uid)'))).toContain(
      'engine.liveInHand?.(uid) !== true'
    );
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

  const run = async (
    db: ReturnType<typeof floor>,
    owed: Record<string, number> = {},
    live: ReadonlySet<string> = new Set()
  ) => {
    fakeDb(db);
    const leaves: Array<{ tableId: string; userId: string; confirm?: true }> = [];
    const engine = (tableId: string): RotatorEngine => ({
      leaveTable: (userId: string, opts?: { confirmHandCount?: boolean }) => {
        leaves.push(
          opts?.confirmHandCount ? { tableId, userId, confirm: true } : { tableId, userId }
        );
        return { success: true };
      },
      hitRunHandsOwed: (userId: string) => owed[userId] ?? 0,
      liveInHand: (userId: string) => live.has(userId),
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

  it('the released table: every Horse that can go leaves in the same cycle (one sweep), Main 1 and Main 2 keep theirs', async () => {
    const baseline = await run(floor());
    vi.restoreAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0.999999);
    for (const m of ['log', 'warn', 'error'] as const)
      vi.spyOn(console, m).mockImplementation(() => {});
    publishVarietyDrain(F, Date.now());
    const leaves = await run(floor());
    const atF = leaves.filter((l) => l.tableId === F);
    expect(atF.map((l) => l.userId).sort()).toEqual([...HORSES.slice(12, 18)].sort());
    expect(leaves.filter((l) => l.tableId !== F)).toEqual(baseline.filter((l) => l.tableId !== F));
  });

  it('a Horse still owing hands in profit plays them first; the next one goes', async () => {
    publishVarietyDrain(F, Date.now());
    const owed = Object.fromEntries(HORSES.slice(12, 17).map((h) => [h, 3]));
    const atF = (await run(floor(), owed)).filter((l) => l.tableId === F);
    expect(atF).toEqual([{ tableId: F, userId: HORSES[17] }]);
  });

  it('a Horse still holding cards in the hand being played is never folded out: one that has folded goes', async () => {
    publishVarietyDrain(F, Date.now());
    const live = new Set(HORSES.slice(12, 17));
    const atF = (await run(floor(), {}, live)).filter((l) => l.tableId === F);
    expect(atF).toEqual([{ tableId: F, userId: HORSES[17] }]);
  });

  it('the Horses not in the hand go together now; the ones in the hand stay for the next cycle', async () => {
    publishVarietyDrain(F, Date.now());
    const live = new Set(HORSES.slice(12, 14));
    const atF = (await run(floor(), {}, live)).filter((l) => l.tableId === F);
    expect(atF.map((l) => l.userId).sort()).toEqual([...HORSES.slice(14, 18)].sort());
  });

  it('every Horse at the released table is in the hand: nobody leaves this cycle', async () => {
    publishVarietyDrain(F, Date.now());
    const live = new Set(HORSES.slice(12, 18));
    expect((await run(floor(), {}, live)).filter((l) => l.tableId === F)).toEqual([]);
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

  it('two released tables: the Horses of both go home in the same cycle, Main 1 keeps its own', async () => {
    publishVarietyDrain([F, M2], Date.now());
    const leaves = await run(floor());
    expect(
      leaves
        .filter((l) => l.tableId === F)
        .map((l) => l.userId)
        .sort()
    ).toEqual([...HORSES.slice(12, 18)].sort());
    expect(
      leaves
        .filter((l) => l.tableId === M2)
        .map((l) => l.userId)
        .sort()
    ).toEqual([...HORSES.slice(6, 12)].sort());
    expect(leaves.filter((l) => l.tableId === M1)).toEqual([]);
  });

  it('the last Horse at a released table leaves alone with its count confirmed; never one in the hand, never while others stay', async () => {
    publishVarietyDrain(F, Date.now());
    const lone = () => {
      const db = floor();
      db.table_seats = db.table_seats
        .filter((x) => x.table_id !== F || x.user_id === HORSES[17])
        .map((x) =>
          x.table_id === F ? { ...x, joined_at: new Date(NOW - 3 * 60_000).toISOString() } : x
        );
      return db;
    };
    /* alone and owing eight hands in profit: it goes now, confirming its count */
    const owed = { [HORSES[17]]: 8 };
    expect((await run(lone(), owed)).filter((l) => l.tableId === F)).toEqual([
      { tableId: F, userId: HORSES[17], confirm: true },
    ]);
    /* alone but still holding cards: it stays */
    expect((await run(lone(), owed, new Set([HORSES[17]]))).filter((l) => l.tableId === F)).toEqual(
      []
    );
    /* two Horses owing: they play their hands heads-up; nobody is confirmed out */
    const two = floor();
    two.table_seats = two.table_seats.filter(
      (x) => x.table_id !== F || x.user_id === HORSES[16] || x.user_id === HORSES[17]
    );
    expect(
      (await run(two, { [HORSES[16]]: 3, [HORSES[17]]: 3 })).filter((l) => l.tableId === F)
    ).toEqual([]);
    /* the sweep takes every free Horse; the one left owing is alone and goes too */
    const sweep = (await run(floor(), { [HORSES[17]]: 4 })).filter((l) => l.tableId === F);
    expect(sweep.filter((l) => l.confirm)).toEqual([
      { tableId: F, userId: HORSES[17], confirm: true },
    ]);
    expect(sweep).toHaveLength(6);
  });

  it('a stale publication releases nothing', async () => {
    publishVarietyDrain(F, Date.now() - VARIETY_HOLD_FRESH_MS);
    expect((await run(floor())).filter((l) => l.tableId === F)).toEqual([]);
  });
});
