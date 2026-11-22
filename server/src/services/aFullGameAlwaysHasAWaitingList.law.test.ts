/**
 * LAW: A FULL GAME ALWAYS HAS A WAITING LIST (Dan 2026-11-22)
 *
 * Dan, verbatim: "Horses need to join waiting lists. All games should not be
 * 'full with no waiting lists' in fact there should always be one-seats open
 * if there is no waiting lists correct that logic and functionality for No
 * Limit Holdem games. MAKE SURE THIS FUNCTIONALITY IS FULLY UPDATED AND
 * CORRECTED."
 *
 * What he saw: a six-max PLO5 table reading "TABLE FULL - 5 WAITING" (right),
 * and nine-handed No Limit Hold'em tables sitting full with nobody waiting.
 *
 * WHY HOLD'EM AND NOT PLO. Nothing in the engine or the database names a
 * variant. The difference is the table size: the Classic Hold'em games are
 * nine-handed, and a full-ring game opens its second table through its own
 * branch of fn_cash_cluster_tick (four names on the list move the last two
 * players to a feeder). Until migration 20261121174545 that branch, unlike the
 * six-max branch (guarded since 20261118165301), opened the feeder while the
 * hourly table cap refused every seat at it: the four waiting horses were
 * called to chairs they could not take, their sixty-second holds lapsed, a
 * lapsed call leaves the list, and the Main stood full with nobody waiting
 * until the line regrew - four Hold'em games, every eight minutes. And in
 * every size, the fleet bought a game's last chair first and left the line to
 * a later cycle that any withheld gate could cancel.
 *
 * So this law pins both halves:
 *   1. the fleet never buys a game's last open chair unless the list is
 *      accounted for in the same decision, for every variant and table size;
 *   2. nothing in that path can single out a variant again.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  gameOwesALine,
  lastChairGameKey,
  lastChairVerdict,
  openChairsByGame,
} from './HorseLastChair.js';
import { planHorseQueues, type QueuedHorseRow } from './HorseGameQueue.js';
import { fullGameWaitTarget } from './HorseBehavior.js';
import { isFullClassicQueueTable } from './HorseQueueAdmission.js';
import { sliceBetween } from '../testHelpers/sourceWindow.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8');
const FLEET = read('./HorseFleetManager.ts');
const LAST_CHAIR = read('./HorseLastChair.ts');
const ADMISSION = read('./HorseQueueAdmission.ts');
const MIGRATIONS = join(HERE, '../../../supabase/migrations');

/** Every cash variant the floor deals. */
const VARIANTS = [
  'nlh',
  'plo4',
  'plo5',
  'plo6',
  'plo8',
  'flh',
  'flo8',
  'short_deck',
  'pineapple',
] as const;
/** Every table size a cash game can be created at. */
const SIZES = [2, 3, 4, 5, 6, 7, 8, 9] as const;
const NOW = 1_800_000_000_000;

/**
 * One fleet cycle on one game, wired exactly as HorseFleetManager wires it:
 * the seat stage plans to fill, the last-chair verdict trims, a game that
 * filled asks for its line, and the queue planner answers in the same cycle.
 */
function cycle(state: {
  variant: string;
  max: number;
  seated: string[];
  list: QueuedHorseRow[];
  free: string[];
  wantSeats: number;
}) {
  const gameId = 'game-1';
  const table = { id: 'table-1', cluster_id: gameId, lifecycle: 'live', max_players: state.max };
  const open = openChairsByGame({ tables: [table], occupiedByTable: () => state.seated.length });
  const key = lastChairGameKey(table);
  const picked = state.free.slice(0, Math.min(state.wantSeats, state.max - state.seated.length));
  const verdict = lastChairVerdict({
    seatsPlanned: picked.length,
    seatedHere: state.seated.length,
    openInGame: open.get(key) ?? 0,
    gameHasList: state.list.length > 0,
    canCarryLine: true,
    spareWaiters: state.free.length - picked.length,
  });
  const sat = picked.slice(0, verdict.seats);
  const seated = [...state.seated, ...sat];
  const free = state.free.filter((id) => !sat.includes(id));
  const openAfter = (open.get(key) ?? 0) - sat.length;
  const asks =
    (sat.length > 0 && gameOwesALine({ canCarryLine: true, openInGame: openAfter })) ||
    (sat.length === 0 && isFullClassicQueueTable(table, state.seated.length, new Set()))
      ? [
          {
            gameId,
            waitTarget: fullGameWaitTarget(table.id, state.max, NOW),
            pool: free,
            variant: state.variant,
            bigBlind: 2,
          },
        ]
      : [];
  const plan = planHorseQueues({
    asks,
    tables: [{ gameId, maxPlayers: state.max, seated: seated.length }],
    rows: state.list,
    excludedGameIds: new Set(),
    humanWaitingGameIds: new Set(),
    seatedByGame: new Map([[gameId, new Set(seated)]]),
    nowMs: NOW,
    gameInfo: new Map([[gameId, { variant: state.variant, bigBlind: 2 }]]),
    seatedAnywhere: new Set(seated),
  });
  const list = [
    ...state.list.filter((r) => !plan.cancel.includes(r.id)),
    ...plan.add.map((a, i) => ({
      id: `row-${state.list.length + i}`,
      game_id: a.game_id,
      user_id: a.user_id,
      created_at: new Date(NOW - 1000).toISOString(),
    })),
  ];
  return { seated, list, free: free.filter((id) => !list.some((r) => r.user_id === id)), verdict };
}

const horses = (n: number) => Array.from({ length: n }, (_, i) => `horse-${i}`);

describe('LAW: a cash game is never full with nobody on its waiting list', () => {
  for (const variant of VARIANTS) {
    for (const max of SIZES) {
      it(`${variant} ${max}-handed: the fleet fills it only with a name on the list, in the same cycle`, () => {
        let s = {
          variant,
          max,
          seated: [] as string[],
          list: [] as QueuedHorseRow[],
          free: horses(max + 6),
          wantSeats: max,
        };
        for (let i = 0; i < 12; i++) {
          const out = cycle(s);
          s = { ...s, seated: out.seated, list: out.list, free: out.free };
          const full = s.seated.length >= max;
          // The invariant, after every single cycle.
          expect(full && s.list.length === 0).toBe(false);
        }
        // With horses to spare the game ends FULL WITH A LINE, the PLO look.
        expect(s.seated.length).toBe(max);
        expect(s.list.length).toBeGreaterThanOrEqual(1);
      });

      if (max >= 3) {
        it(`${variant} ${max}-handed: with nobody free to wait, one chair stays open`, () => {
          let s = {
            variant,
            max,
            seated: [] as string[],
            list: [] as QueuedHorseRow[],
            // Exactly enough horses to fill it and not one more.
            free: horses(max),
            wantSeats: max,
          };
          for (let i = 0; i < 6; i++) {
            const out = cycle(s);
            s = { ...s, seated: out.seated, list: out.list, free: out.free };
            expect(s.seated.length >= max && s.list.length === 0).toBe(false);
          }
          expect(s.seated.length).toBe(max - 1);
          expect(s.list).toEqual([]);
        });
      }
    }
  }

  it('a person who took the last chair is answered with a name on the list next cycle', () => {
    for (const variant of VARIANTS) {
      for (const max of SIZES) {
        const out = cycle({
          variant,
          max,
          seated: ['person', ...horses(max - 1).map((h) => `seated-${h}`)],
          list: [],
          free: horses(3),
          wantSeats: 0,
        });
        expect(out.list.length).toBe(1);
      }
    }
  });
});

describe('LAW: the last-chair verdict, case by case', () => {
  it('never returns "full with no list" for any plan, size or pool (heads-up dealing aside)', () => {
    for (let open = 0; open <= 9; open++) {
      for (let planned = 0; planned <= open; planned++) {
        for (const gameHasList of [true, false]) {
          for (const canCarryLine of [true, false]) {
            for (const spareWaiters of [0, 1, 4]) {
              for (const seatedHere of [0, 1, 2, 8]) {
                const v = lastChairVerdict({
                  seatsPlanned: planned,
                  seatedHere,
                  openInGame: open,
                  gameHasList,
                  canCarryLine,
                  spareWaiters,
                });
                expect(v.seats).toBeLessThanOrEqual(planned);
                expect(v.seats).toBeGreaterThanOrEqual(0);
                const fillsTheGame = v.seats > 0 && v.seats >= open;
                if (!fillsTheGame) continue;
                // The game's last chair was taken: a list exists, or one is
                // started with it, or the table could not otherwise deal.
                expect(gameHasList || v.startsLine || v.reason === 'dealable').toBe(true);
                if (v.reason === 'dealable') expect(seatedHere + v.seats).toBe(2);
              }
            }
          }
        }
      }
    }
  });

  it('leaves exactly one chair open, never more, when it trims', () => {
    const v = lastChairVerdict({
      seatsPlanned: 4,
      seatedHere: 5,
      openInGame: 4,
      gameHasList: false,
      canCarryLine: true,
      spareWaiters: 0,
    });
    expect(v).toEqual({ seats: 3, startsLine: false, reason: 'left_open' });
  });

  it('a game with a chair open at ANOTHER of its tables is not trimmed (one game, many tables)', () => {
    const tables = [
      { id: 'main', cluster_id: 'g', lifecycle: 'live', max_players: 9 },
      { id: 'feeder', cluster_id: 'g', lifecycle: 'live', max_players: 9 },
      { id: 'breaking', cluster_id: 'g', lifecycle: 'breaking', max_players: 9 },
    ];
    const open = openChairsByGame({
      tables,
      occupiedByTable: (id) => (id === 'main' ? 8 : id === 'feeder' ? 6 : 2),
      pendingArrivalsByTable: (id) => (id === 'feeder' ? 1 : 0),
    });
    // 1 on the Main, 2 on the feeder (a planned arrival holds one); the
    // breaking table gives nobody a chair.
    expect(open.get('game:g')).toBe(3);
    expect(
      lastChairVerdict({
        seatsPlanned: 1,
        seatedHere: 8,
        openInGame: 3,
        gameHasList: false,
        canCarryLine: true,
        spareWaiters: 0,
      }).reason
    ).toBe('room');
  });

  it('an unknown Lightning set cannot start a line, so the chair stays open', () => {
    expect(
      lastChairVerdict({
        seatsPlanned: 1,
        seatedHere: 5,
        openInGame: 1,
        gameHasList: false,
        canCarryLine: false,
        spareWaiters: 9,
      })
    ).toEqual({ seats: 0, startsLine: false, reason: 'left_open' });
  });
});

describe('LAW: the line is long enough for every size, and reaches the feeder rule', () => {
  it('a full game always wants at least one name; a full ring wants the four that open its feeder', () => {
    for (const max of SIZES) {
      for (let bucket = 0; bucket < 40; bucket++) {
        const want = fullGameWaitTarget(`t-${max}`, max, NOW + bucket * 20 * 60_000);
        expect(want).toBeGreaterThanOrEqual(1);
        expect(want).toBeLessThanOrEqual(Math.max(1, Math.min(5, max)));
        if (max >= 9) expect(want).toBeGreaterThanOrEqual(4);
      }
    }
  });
});

describe('LAW: the wiring - the chair and the line are one decision', () => {
  const trim = FLEET.indexOf('const lastChair = lastChairVerdict({');
  const hourlyTrim = FLEET.indexOf('cleared.splice(hourly.maxHorses);');
  const seating = FLEET.indexOf('for (const { horse, seatNumber, verdict } of cleared) {');

  it('the verdict is the LAST trim before a seat is bought', () => {
    expect(trim).toBeGreaterThan(-1);
    expect(hourlyTrim).toBeGreaterThan(-1);
    expect(trim).toBeGreaterThan(hourlyTrim);
    expect(seating).toBeGreaterThan(trim);
    // Nothing between the verdict and the seating can add a seat back.
    expect(FLEET.slice(trim, seating)).not.toMatch(/cleared\.push\(/);
    expect(FLEET).toContain('cleared.splice(lastChair.seats);');
  });

  it('the game is the unit: every live table of it, spent down as the cycle seats', () => {
    expect(FLEET).toContain('const openChairsLeft = openChairsByGame({');
    expect(FLEET).toMatch(
      /openChairsLeft\.set\(\s*lastChairKey,\s*Math\.max\(0, \(openChairsLeft\.get\(lastChairKey\) \?\? 0\) - 1\)/
    );
    expect(FLEET).toContain('openInGame: openChairsLeft.get(lastChairKey) ?? 0,');
    expect(FLEET).toContain('gameHasList: listFeedsTable(table, listFedGames),');
  });

  it('a game that filled this cycle asks for its line in this cycle', () => {
    const ask = FLEET.indexOf(
      'gameOwesALine({ canCarryLine, openInGame: openChairsLeft.get(lastChairKey) ?? 0 })'
    );
    expect(ask).toBeGreaterThan(seating);
    expect(sliceBetween(FLEET.slice(ask), 'gameOwesALine(', 'gameId:')).toContain(
      'horseQueueAsks.push({'
    );
    // ...and the planner is told about the seats this cycle took, so it sees
    // the game as full now rather than one cycle later.
    expect(FLEET).toContain('seated: seats.length + (seatedThisCycle.get(String(t.id)) ?? 0),');
    expect(FLEET).toMatch(/book,\s+seatedThisCycleByTable\s+\);/);
  });

  it('a horse joins the same list a person joins, as a waiting row in arrival order', () => {
    const sync = FLEET.slice(FLEET.indexOf('private async syncHorseGameQueues('));
    expect(sync).toMatch(
      /\.from\('cash_game_waitlist'\)\s+\.insert\(plan\.add\.map\(\(a\) => \(\{ \.\.\.a, status: 'waiting' \}\)\)\)/
    );
    // No created_at is written: the database stamps arrival, which is the order.
    expect(read('./HorseGameQueue.ts')).toContain(
      'add: Array<{ game_id: string; user_id: string }>;'
    );
  });
});

describe('LAW: no variant, style or table size is ever left out again', () => {
  it('the last-chair rule and the queue admission read no variant, style or handedness', () => {
    const code = (src: string) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');
    for (const src of [code(LAST_CHAIR), code(ADMISSION)]) {
      expect(src).not.toMatch(
        /\b(game_variant|variant|nlh|holdem|plo\d?|template_name|handedness)\b/i
      );
      expect(src).not.toMatch(/is_horse|isHorse/);
    }
  });

  it('only a Lightning game (no list by owner ruling) is outside the rule', () => {
    const at = FLEET.indexOf('const lastChairLightning =');
    const block = FLEET.slice(at, FLEET.indexOf('const lastChair = lastChairVerdict({'));
    expect(block).toContain('cashPlanLightningGames.has(String(table.cluster_id))');
    expect(block).toContain('if (!lastChairLightning) {');
    expect(block).not.toMatch(/game_variant|isHoldemOrPlo|isPloVariant|max_players/);
  });

  it('how Hold-em was left out: both feeder branches of the tick now ask the hourly cap first', () => {
    const fullRing = readFileSync(
      join(MIGRATIONS, '20261121174545_full_ring_feeder_and_opening_count_honour_hourly_cap.sql'),
      'utf8'
    );
    const sixMax = readFileSync(
      join(MIGRATIONS, '20261118165301_a_feeder_the_hourly_cap_would_refuse_is_not_opened.sql'),
      'utf8'
    );
    // Six-max (buyer-driven) was guarded on the 18th; full ring only on the 21st.
    expect(sixMax).toContain('AND public.fn_cash_hourly_feeder_admissible(g.id) THEN');
    expect(sixMax).toContain(
      'The full-ring feeder start (which moves seated players, not new buyers) is'
    );
    expect(fullRing).toContain('FULL-RING FEEDER HONOURS HOURLY CAP');
    expect(fullRing).toContain('AND public.fn_cash_hourly_feeder_admissible(g.id) THEN');
    // Both ticks, the capped and the uncapped one.
    expect(fullRing).toContain('fn_cash_cluster_tick_uncapped(uuid,integer)');
  });
});
