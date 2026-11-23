/**
 * LAW: A CALLED NAME KEEPS ITS PLACE, AND A FULL GAME ASKS FOR ITS LINE THE
 * MOMENT IT FILLS (Dan 2026-11-22)
 *
 * Dan, verbatim: "Horses need to join waiting lists. All games should not be
 * 'full with no waiting lists' in fact there should always be one-seats open
 * if there is no waiting lists ... MAKE SURE THIS FUNCTIONALITY IS FULLY
 * UPDATED AND CORRECTED", then "FINISH UP ANY AND ALL UNFINISHED WORK ... MAKE
 * SURE THEY ARE FULLY WIRED IN AND TESTED BEFORE CLAIMING SUCCESS."
 *
 * The rules this pins, each one a defect that shipped:
 *
 *  1. A player keeps their place in line until they are offered a seat they
 *     can take. The hourly cash policy's 2-4 minute clocks refused called
 *     names at a new feeder (a sixty-second hold lapsed, and a lapsed call
 *     leaves the list); the engine skipped calls at a paced table; and a
 *     table the cap is closing was called to a horse it would refuse.
 *  2. The pacing limits the NUMBER of horse tables and spaces the fleet's own
 *     unsolicited seating. It never refuses the game's own seating: a called
 *     name or a sanctioned move (the second bumped player of a full-ring
 *     feeder start was refused by the arrival clock).
 *  3. A person taking a game's last chair is answered with a name on the list
 *     at that seat event, not at the next fleet cycle.
 *  4. A game whose only full table is being closed by the cap still gets a
 *     line (the walk used to skip such a table before asking for one).
 *  5. A horse's patience (25 to 55 minutes on a line) never leaves a full
 *     game with nobody waiting: the last name stays until a free horse can
 *     take its place.
 *
 * The database half is proved on a disposable PostgreSQL against production's
 * own recorded bodies by scripts/ci/test-a-called-name-keeps-its-place-
 * postgres.py (red on the installed bodies, green after the migration); this
 * file pins the engine half and the migration's shape.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fullWithNobodyWaiting,
  lineOnArrival,
  LINE_CONTEXT_MAX_AGE_MS,
  type LineContext,
} from './HorseLineOnArrival.js';
import { hourlyAdmissionForWalk, LINE_ONLY_HOURLY_ADMISSION } from './HorseQueueAdmission.js';
import { planHorseQueues, queuePatienceMs } from './HorseGameQueue.js';
import { noteCashSeatCommitted, onCashSeatCommitted } from '../cluster/cashSeatCommittedSignal.js';
import { blankNonCode, sliceCall, sliceMethod } from '../testHelpers/sourceWindow.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8');
const ROOT = join(HERE, '../../..');
const FLEET = read('./HorseFleetManager.ts');
const ENGINE = read('../engine/ServerTableEngine.ts');
const ENGINE_BASE = read('../engine/ServerTableEngineBase.ts');
const MIGRATION = readFileSync(
  join(
    ROOT,
    'supabase/migrations/20261123013241_a_called_name_keeps_its_place_under_the_hourly_cap.sql'
  ),
  'utf8'
);
const PROOF = 'scripts/ci/test-a-called-name-keeps-its-place-postgres.py';
const CI = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');

/** Every cash variant the floor deals, and every size a cash game is made at. */
const VARIANTS = ['nlh', 'plo4', 'plo5', 'plo6', 'plo8', 'flh', 'flo8', 'short_deck', 'pineapple'];
const SIZES = [2, 3, 4, 5, 6, 7, 8, 9];
const NOW = 1_800_000_000_000;

/** The body of one function in the migration, up to its closing dollar quote. */
const sqlFunction = (name: string, close: string): string => {
  const start = MIGRATION.indexOf(`FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`${name} not in the migration`);
  return MIGRATION.slice(start, MIGRATION.indexOf(close, start) + close.length);
};

const horseIds = (n: number) => Array.from({ length: n }, (_, i) => `horse-${i}`);
const context = (over: Partial<LineContext> = {}): LineContext => ({
  builtAt: NOW - 30_000,
  poolByGame: new Map([['game-1', horseIds(6)]]),
  seatedAnywhere: new Set<string>(),
  gameInfo: new Map([['game-1', { variant: 'nlh', bigBlind: 2 }]]),
  disabledGameIds: new Set<string>(),
  ...over,
});

describe("LAW: a called name is the game's own seating, and no clock refuses it (SQL)", () => {
  const admit = sqlFunction('fn_cash_hourly_table_admit', '$fn$;');
  const offer = sqlFunction('fn_offer_open_seat', '$function$;');
  const predicate = sqlFunction('fn_cash_hourly_call_admissible', '$fn$;');
  const projection = sqlFunction('fn_cash_hourly_table_admissions', '$fn$;');

  it("the admission names the game's own seating: a live call to THIS table, or a sanctioned move", () => {
    expect(admit).toContain(
      'SELECT EXISTS(SELECT 1 FROM public.table_waitlist h WHERE h.table_id=p_table_id AND h.user_id=p_user_id'
    );
    expect(admit).toContain(
      "AND h.status='notified' AND coalesce(h.hold_expires_at,h.notified_at+interval '60 seconds')>now_at) INTO called;"
    );
    expect(admit).toContain('own_seating:=coalesce(funded_move,false) OR called;');
  });

  it('neither 2-4 minute clock refuses it, and both clocks still restart (they only move later)', () => {
    expect(admit).toContain('IF pace.next_horse_at>now_at AND NOT own_seating THEN');
    expect(admit).toMatch(
      /IF NOT \(own_seating AND t\.cluster_id IS NOT NULL AND t\.role='feeder'\)\s+AND EXISTS\(SELECT 1 FROM public\.cash_hourly_table_pacing WHERE scope='floor' AND next_open_at>now_at\) THEN/
    );
    expect(admit).toContain(
      'SET next_open_at=greatest(next_open_at,now_at+public.fn_cash_hourly_table_delay(p_table_id))'
    );
    expect(admit).toContain(
      'SET next_horse_at=greatest(next_horse_at,now_at+public.fn_cash_hourly_table_delay(p_table_id))'
    );
    // Exactly one refusal of each clock remains, both guarded.
    expect(admit.split("RAISE EXCEPTION 'cash_hourly_horse_arrival_paced'").length - 1).toBe(1);
    expect(admit.split("RAISE EXCEPTION 'cash_hourly_table_start_paced'").length - 1).toBe(1);
  });

  it('the cap still applies to everyone, and an opening feeder holds the slot it was admitted on', () => {
    expect(admit).toContain("RAISE EXCEPTION 'cash_hourly_table_cap_reached:%',cap");
    expect(admit).toContain(
      'IF (empty AND n+reserved-CASE WHEN releases_source THEN 1 ELSE 0 END>=cap)'
    );
    expect(admit).toMatch(/AND tb\.lifecycle='opening'[\s\S]*AND tb\.id<>p_table_id;/);
    // The fleet's projection counts the same reservations, so it does not try a refused start.
    expect(projection).toContain('opening AS MATERIALIZED(SELECT tb.id FROM public.tables tb');
    expect(projection).toContain(
      'THEN b.occupied+b.reserved-CASE WHEN EXISTS(SELECT 1 FROM opening o WHERE o.id=t.id) THEN 1 ELSE 0 END<b.cap'
    );
  });

  it('a seat is called only to a player the policy will seat; anyone else keeps their place', () => {
    // Both candidate loops, the table list and the game list, ask before holding.
    expect(
      offer.split('IF NOT public.fn_cash_hourly_call_admissible(p_table_id, v_next.user_id) THEN')
        .length - 1
    ).toBe(2);
    // Passed over means CONTINUE: no row of theirs is written, so the place is untouched.
    for (const at of [0, 1]) {
      const from = offer.split(
        'IF NOT public.fn_cash_hourly_call_admissible(p_table_id, v_next.user_id) THEN'
      )[at + 1];
      const branch = from.slice(0, from.indexOf('END IF;'));
      expect(branch).toContain('CONTINUE;');
      expect(branch).not.toMatch(/UPDATE|INSERT|DELETE|expired/i);
    }
    // The answer says players were passed over instead of "nobody waiting".
    expect(offer).toContain(
      "'reason', CASE WHEN v_passed_over > 0 THEN 'hourly_cap_passes_over' ELSE 'nobody_waiting' END"
    );
  });

  it('the call predicate reads the cap and no clock but the floor clock of a non-feeder start', () => {
    expect(predicate).toContain('fn_cash_hourly_table_capacity_census()');
    expect(predicate).toContain('fn_cash_hourly_table_excess(p_table_id)');
    expect(predicate).not.toContain('next_horse_at');
    expect(predicate).not.toContain('cash_hourly_table_starts');
    expect(predicate).toMatch(
      /\(SELECT cluster_id IS NOT NULL AND role='feeder' FROM t\)\s+OR NOT EXISTS\(SELECT 1 FROM public\.cash_hourly_table_pacing/
    );
    // A person is never refused by the hourly policy.
    expect(predicate).toContain(
      'WHEN NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_user_id AND is_horse) THEN true'
    );
  });

  it('the throughput cohort counts the new predicate, so the cohort names the changed policy', () => {
    expect(MIGRATION).toContain("('public.fn_cash_hourly_call_admissible(uuid,uuid)'),");
    expect(MIGRATION).toContain('CASE WHEN count(definition)=13 THEN');
  });

  it('it is installable while the current engine runs: functions only, pinned, one transaction', () => {
    expect(MIGRATION).not.toMatch(/@install-window/);
    expect(MIGRATION).not.toMatch(/\b(ALTER|LOCK|DROP)\s+TABLE\b/i);
    expect(MIGRATION).toContain('called_name_keeps_place_preimage_changed');
    expect(MIGRATION.match(/^BEGIN;$/gm)?.length).toBe(1);
    expect(MIGRATION.match(/^COMMIT;$/gm)?.length).toBe(1);
    expect(MIGRATION).toMatch(/SET LOCAL lock_timeout = '3s';/);
  });

  it('it never touches the cluster tick, so it installs in either order with PR #11790', () => {
    expect(MIGRATION).not.toMatch(/FUNCTION public\.fn_cash_cluster_tick/);
    expect(MIGRATION).not.toMatch(/'public\.fn_cash_cluster_tick(_uncapped)?\(uuid,integer\)'/);
  });

  it('the native proof runs in the required server shards, beside the hourly caps proof', () => {
    expect(readFileSync(join(ROOT, PROOF), 'utf8')).toContain('20261123013241');
    const hourly = CI.indexOf('python3 -B scripts/ci/test-hourly-cash-caps-postgres.py');
    const ours = CI.indexOf(`python3 -B ${PROOF}`);
    expect(hourly).toBeGreaterThan(-1);
    expect(ours).toBeGreaterThan(hourly);
  });
});

describe('LAW: the engine answers every call; the database decides', () => {
  it('claimOfferedSeats is handed every table, not only the ones the projection admits', () => {
    const call = sliceCall(FLEET, 'await this.claimOfferedSeats(');
    expect(blankNonCode(call)).not.toMatch(/hourlyAdmissions/);
    expect(call).toMatch(/claimOfferedSeats\(\s+tables,/);
  });

  it('claimOfferedSeats itself never consults the hourly projection', () => {
    const body = sliceMethod(FLEET, 'private async claimOfferedSeats(');
    expect(blankNonCode(body)).not.toMatch(/hourlyAdmissions|readHourlyCashAdmissions/);
  });
});

describe("LAW: a full table the cap is closing still asks for its game's line", () => {
  it("the walk's admission: the database's own, else line-only for a physically full table", () => {
    const own = { maxHorses: 1, startsGame: true };
    expect(hourlyAdmissionForWalk(own, false)).toBe(own);
    expect(hourlyAdmissionForWalk(own, true)).toBe(own);
    expect(hourlyAdmissionForWalk(undefined, true)).toBe(LINE_ONLY_HOURLY_ADMISSION);
    expect(hourlyAdmissionForWalk(undefined, false)).toBeUndefined();
    // Line-only buys nothing and starts nothing.
    expect(LINE_ONLY_HOURLY_ADMISSION).toEqual({ maxHorses: 0, startsGame: false });
    expect(Object.isFrozen(LINE_ONLY_HOURLY_ADMISSION)).toBe(true);
  });

  it("is wired as the walk's hourly gate, asked with the same full-table test as the queue path", () => {
    const gate = FLEET.indexOf('const hourly = hourlyAdmissionForWalk(');
    const skip = FLEET.indexOf('if (!hourly || (hourly.startsGame && hourlyAutonomousStarted)) {');
    expect(gate).toBeGreaterThan(-1);
    expect(skip).toBeGreaterThan(gate);
    const call = sliceCall(FLEET, 'hourlyAdmissionForWalk(\n');
    expect(call).toContain('hourlyAdmissions.get(table.id)');
    expect(call).toContain('isFullClassicQueueTable(');
    expect(call).toContain('cashPlanLightningGames');
    // A line-only table reaches the queue ask and seats nobody: countOnly is
    // only ever raised, and the walk stops at it before any seat is bought.
    expect(FLEET).not.toMatch(/countOnly\s*=\s*false/);
    expect(FLEET.indexOf('if (countOnly) continue;')).toBeGreaterThan(
      FLEET.indexOf('if (queueOnly) {\n              horseQueueAsks.push({')
    );
    expect(FLEET.indexOf('cleared.splice(hourly.maxHorses);')).toBeGreaterThan(
      FLEET.indexOf('if (countOnly) continue;')
    );
  });
});

describe("LAW: patience never empties a full game's list", () => {
  const full = [{ gameId: 'g', maxPlayers: 9, seated: 9 }];
  const stale = (id: string, user: string, game = 'g') => ({
    id,
    game_id: game,
    user_id: user,
    created_at: new Date(NOW - queuePatienceMs(id) - 1000).toISOString(),
  });
  const plan = (over: Partial<Parameters<typeof planHorseQueues>[0]> = {}) =>
    planHorseQueues({
      asks: [],
      tables: full,
      rows: [stale('r1', 'h1')],
      excludedGameIds: new Set(),
      humanWaitingGameIds: new Set(),
      seatedByGame: new Map(),
      nowMs: NOW,
      gameInfo: new Map([['g', { variant: 'nlh', bigBlind: 2 }]]),
      ...over,
    });

  it('the only name of a full game stays while nobody free can take its place', () => {
    expect(plan()).toEqual({ cancel: [], add: [] });
    // A withheld cycle, or an ask whose pool is spent, the same.
    expect(plan({ asks: [{ gameId: 'g', waitTarget: 2, pool: [] }] })).toEqual({
      cancel: [],
      add: [],
    });
  });

  it('it gives up the moment another horse can stand in its place', () => {
    const p = plan({
      asks: [{ gameId: 'g', waitTarget: 1, pool: ['h2'], variant: 'nlh', bigBlind: 2 }],
    });
    expect(p.cancel).toEqual(['r1']);
    expect(p.add).toEqual([{ game_id: 'g', user_id: 'h2' }]);
  });

  it('never keeps a horse that is seated anywhere, off duty, or for a game that wants no horse line', () => {
    expect(plan({ seatedAnywhere: new Set(['h1']) }).cancel).toEqual(['r1']);
    expect(plan({ onDuty: () => false }).cancel).toEqual(['r1']);
    expect(plan({ excludedGameIds: new Set(['g']) }).cancel).toEqual(['r1']);
    expect(plan({ humanWaitingGameIds: new Set(['g']) }).cancel).toEqual(['r1']);
    // A game with a chair open is being called into it; its line is not owed.
    expect(plan({ tables: [{ gameId: 'g', maxPlayers: 9, seated: 8 }] }).cancel).toEqual(['r1']);
  });

  it('with another name still waiting, patience rotates the line as before', () => {
    const fresh = {
      id: 'r2',
      game_id: 'g',
      user_id: 'h2',
      created_at: new Date(NOW - 60_000).toISOString(),
    };
    expect(plan({ rows: [stale('r1', 'h1'), fresh] }).cancel).toEqual(['r1']);
  });
});

describe('LAW: a person taking the last chair is answered with a name on the list at once', () => {
  const game = (max: number, seated: string[][], listed = 0) => ({
    tables: seated.map((_, i) => ({
      id: `t-${i}`,
      lifecycle: 'live',
      status: 'running',
      max_players: max,
    })),
    seatedByTable: new Map(seated.map((s, i) => [`t-${i}`, new Set(s)])),
    namesOnList: listed,
  });
  const fullOf = (max: number, who: string) => Array.from({ length: max }, (_, i) => `${who}-${i}`);

  for (const variant of VARIANTS) {
    for (const max of SIZES) {
      it(`${variant} ${max}-handed: the fill that leaves nobody waiting puts one horse down now`, () => {
        const g = game(max, [['person', ...fullOf(max - 1, 'seated')]]);
        const pick = lineOnArrival({
          gameId: 'game-1',
          ...g,
          otherRows: [],
          context: context({ gameInfo: new Map([['game-1', { variant, bigBlind: 2 }]]) }),
          lightningGames: new Set(),
          nowMs: NOW,
        });
        expect(pick).not.toBeNull();
        expect(pick!.game_id).toBe('game-1');
        expect(horseIds(6)).toContain(pick!.user_id);
      });
    }
  }

  it('never when the game already has a name waiting, or a chair open at any of its tables', () => {
    const base = {
      gameId: 'game-1',
      otherRows: [],
      context: context(),
      lightningGames: new Set<string>(),
      nowMs: NOW,
    };
    expect(lineOnArrival({ ...base, ...game(6, [fullOf(6, 'a')], 1) })).toBeNull();
    expect(lineOnArrival({ ...base, ...game(6, [fullOf(6, 'a'), fullOf(5, 'b')]) })).toBeNull();
    expect(lineOnArrival({ ...base, ...game(6, [fullOf(6, 'a'), fullOf(6, 'b')]) })).not.toBeNull();
  });

  it('never for a Lightning game (no list by owner ruling), an unread Lightning set, or a switched-off game', () => {
    const base = { gameId: 'game-1', otherRows: [], nowMs: NOW, ...game(6, [fullOf(6, 'a')]) };
    expect(
      lineOnArrival({ ...base, context: context(), lightningGames: new Set(['game-1']) })
    ).toBeNull();
    expect(lineOnArrival({ ...base, context: context(), lightningGames: null })).toBeNull();
    expect(
      lineOnArrival({
        ...base,
        context: context({ disabledGameIds: new Set(['game-1']) }),
        lightningGames: new Set(),
      })
    ).toBeNull();
  });

  it('only from a fresh pool, never a horse seated anywhere, and only an on-duty horse', () => {
    const base = {
      gameId: 'game-1',
      otherRows: [],
      lightningGames: new Set<string>(),
      nowMs: NOW,
      ...game(6, [fullOf(6, 'a')]),
    };
    expect(lineOnArrival({ ...base, context: null })).toBeNull();
    expect(
      lineOnArrival({ ...base, context: context({ builtAt: NOW - LINE_CONTEXT_MAX_AGE_MS - 1 }) })
    ).toBeNull();
    const busy = new Set(horseIds(6).slice(0, 5));
    expect(lineOnArrival({ ...base, context: context({ seatedAnywhere: busy }) })?.user_id).toBe(
      'horse-5'
    );
    expect(
      lineOnArrival({
        ...base,
        context: context({ seatedAnywhere: busy }),
        onDuty: (id) => id !== 'horse-5',
      })
    ).toBeNull();
    // A horse seated at this very game is never its own waiter.
    const here = game(2, [['horse-0', 'horse-1']]);
    const pick = lineOnArrival({
      ...base,
      ...here,
      context: context({ poolByGame: new Map([['game-1', ['horse-0', 'horse-1']]]) }),
    });
    expect(pick).toBeNull();
  });

  it('a breaking or closed table is not part of the question', () => {
    expect(
      fullWithNobodyWaiting({
        tables: [
          { id: 'main', lifecycle: 'live', status: 'running', max_players: 6 },
          { id: 'old', lifecycle: 'breaking', status: 'running', max_players: 6 },
        ],
        seatedAt: (id) => (id === 'main' ? 6 : 2),
        namesOnList: 0,
      })
    ).toBe(true);
  });

  it('the signal reaches its one listener, and a listener that throws never reaches the table', () => {
    const heard: string[] = [];
    onCashSeatCommitted((t) => heard.push(t));
    noteCashSeatCommitted('t-1');
    noteCashSeatCommitted(null);
    onCashSeatCommitted(() => {
      throw new Error('fleet failed');
    });
    expect(() => noteCashSeatCommitted('t-2')).not.toThrow();
    onCashSeatCommitted(null);
    noteCashSeatCommitted('t-3');
    expect(heard).toEqual(['t-1']);
  });

  it('is wired at both seat events the engine already hears, and to the fleet', () => {
    // The player's own client reporting its committed buy-in.
    const seat = sliceMethod(ENGINE, 'public async noteSeatArrival(');
    expect(seat).toMatch(
      /if \(seatedNow && committed\.length >= \(Number\(this\.tableInfo\.max_players\) \|\| Infinity\)\)\s+noteCashSeatCommitted\(this\.tableId\);/
    );
    // The hand boundary adopting a roster that gained a player and fills the table.
    const roster = sliceMethod(ENGINE_BASE, 'protected adoptSeatRoster(');
    expect(roster).toContain('noteCashSeatCommitted(this.tableId);');
    expect(roster).toContain('nextRoster.some((p) => !previous.has(p.user_id))');
    expect(roster).toContain('!tournamentTable &&');
    // The fleet listens while it runs and stops listening when it stops.
    expect(FLEET).toContain('onCashSeatCommitted((tableId) => this.lineOnSeatCommitted(tableId));');
    expect(FLEET).toContain('onCashSeatCommitted(null);');
    const ask = sliceMethod(FLEET, 'private async askLineOnArrival(');
    expect(ask).toContain('const pick = lineOnArrival({');
    expect(ask).toMatch(
      /\.from\('cash_game_waitlist'\)\s*\.insert\(\{ \.\.\.pick, status: 'waiting' \}\)/
    );
    // The context is the walk's own sittable pool, kept at the end of the cycle.
    expect(FLEET).toContain('for (const h of pool) linePool.add(String(h.id));');
    expect(FLEET).toContain('this.lineContext = {');
  });
});
