import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import {
  SCRATCH_POSTGRES_PORT,
  scratchPostgresListenOptions,
  scratchPostgresSocket,
  showServerLogWhenStartFails,
} from '../helpers/scratchPostgres';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * THE LIVE CHECK TELLS A FALLING CAP FROM AN OPENED TABLE (2026-11-28).
 *
 * The drain's live check (scripts/sql/variety-drain-live-check.sql) failed
 * `tables_within_cap` and `cap_every_cycle` on every beat that read more
 * counted tables than the cap. The hourly cap falls through the night (40 at
 * 10 PM CST, 18 at 1 AM, 7 at 6 AM), so every night the room sat above a cap
 * that had just dropped under it, and the rows failed with no table opened:
 * 137 failing beats on the 10 PM and 1 AM seals of 2026-11-27/28, none of them
 * a Horse-side open. A row that fails every night is a row nobody reads.
 *
 * The rows now fail on what they were written to guard: a table that ENTERS
 * the counted room while it is at or above the cap, with no person behind it.
 * This file runs the shipped statement on a real PostgreSQL against a seeded
 * room, because the proof that matters is the other direction (a check that
 * turns from FAIL to PASS must not hide a real defect): a Horse-started table
 * seated over the cap still fails, on a level cap and across a falling one.
 */
const ROOT = resolve(__dirname, '../..');
const BODY = readFileSync(resolve(ROOT, 'scripts/sql/variety-drain-live-check.sql'), 'utf8')
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')
  .trim()
  .replace(/;\s*$/, '');

/** Only what the statement reads. The two hourly functions answer from test tables. */
const SCHEMA = `
CREATE TABLE public.ca_engine_deploy_attempts (at timestamptz, shipped boolean, target_sha text);
CREATE TABLE public.ca_horse_fleet_heartbeat (beat_at timestamptz, detail jsonb);
CREATE TABLE public.tables (id uuid PRIMARY KEY, name text, lifecycle text, role text, main_index integer,
  cluster_id uuid, tournament_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.profiles (id uuid PRIMARY KEY, is_horse boolean);
CREATE TABLE public.table_seats (table_id uuid, user_id uuid, joined_at timestamptz, left_at timestamptz);
CREATE TABLE public.hand_history (table_id uuid, tournament_id uuid, has_human boolean, created_at timestamptz);
CREATE TABLE public.cash_hourly_table_origins (table_id uuid PRIMARY KEY, human_started boolean);
CREATE TABLE public.cash_game_waitlist (game_id uuid, user_id uuid, status text, created_at timestamptz, updated_at timestamptz);
CREATE TABLE public.horse_error_log (created_at timestamptz);
CREATE TABLE public.test_cap (from_ts timestamptz, cap integer);
CREATE TABLE public.test_now (counted integer);
CREATE FUNCTION public.fn_cash_hourly_table_range(p_at timestamptz DEFAULT clock_timestamp())
 RETURNS TABLE(local_hour integer, target_min integer, table_cap integer) LANGUAGE sql STABLE AS $$
  SELECT 0, 0, c.cap FROM public.test_cap c WHERE c.from_ts <= p_at ORDER BY c.from_ts DESC LIMIT 1 $$;
CREATE FUNCTION public.fn_cash_hourly_table_capacity_census()
 RETURNS TABLE(table_id uuid, occupied bigint, humans bigint, opened_at timestamptz) LANGUAGE sql STABLE AS $$
  SELECT gen_random_uuid(), 2::bigint, 0::bigint, now() FROM public.test_now n, generate_series(1, n.counted) $$;
`;

const HORSE = '51000000-0000-4000-8000-000000000001';
const PERSON = '51000000-0000-4000-8000-000000000002';
const TABLE = '51000000-0000-4000-8000-0000000000a1';
const GAME = '51000000-0000-4000-8000-0000000000c1';
const TABLE_NAME = 'PLO4 0.25/0.50 Classic Feeder';

/** The release is 20 minutes old; `sec` counts from it (negative: before it). */
const RELEASE_AGE_S = 1200;
const at = (sec: number) => `(now() - interval '${RELEASE_AGE_S - sec} seconds')`;
/** Beat `i` of the window: the fleet's first beat is 3 minutes after the release, then every 30 s. */
const beatAt = (i: number) => 180 + i * 30;

type Row = [verdict: string, evidence: string];
type Room = { counted: number; cap: number };

const bin = [
  '/opt/homebrew/bin',
  '/usr/lib/postgresql/18/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/lib/postgresql/15/bin',
  '/usr/lib/postgresql/14/bin',
  '/usr/bin',
].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));

describe('the drain live check on a seeded room (real PostgreSQL)', () => {
  let scratch = '';
  let socket = '';
  let data = '';
  let started = false;
  let env: NodeJS.ProcessEnv = {};
  const run = (cmd: string, args: string[], input?: string) =>
    execFileSync(`${bin}/${cmd}`, args, {
      cwd: ROOT,
      env,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  const sql = (text: string) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q'], text);

  /**
   * Seed one room and run the shipped statement.
   *   before   the old fleet's last reading, 5 minutes before the release
   *   beats    the readings of the window, one per beat
   *   caps     the cap in force from each second (the first entry is the cap before the release)
   *   now      the census at this moment (the cap now is the last of `caps`)
   *   extra    more rows, in the same transaction
   */
  const check = (room: {
    before?: Room;
    beats: Array<Room | null>;
    caps: Array<[fromSec: number | null, cap: number]>;
    now: number;
    extra?: string;
  }): Record<string, Row> => {
    const beat = (sec: number, r: Room | null) =>
      `INSERT INTO public.ca_horse_fleet_heartbeat VALUES (${at(sec)}, ` +
      (r
        ? `jsonb_build_object('cash_room', jsonb_build_object('cap', ${r.cap}, 'counted', ${r.counted})));`
        : `'{}'::jsonb);`);
    const seed = [
      'BEGIN;',
      `TRUNCATE public.ca_engine_deploy_attempts, public.ca_horse_fleet_heartbeat, public.tables,
         public.profiles, public.table_seats, public.hand_history, public.cash_hourly_table_origins,
         public.cash_game_waitlist, public.horse_error_log, public.test_cap, public.test_now;`,
      `INSERT INTO public.ca_engine_deploy_attempts VALUES (${at(0)}, true, 'seal');`,
      `INSERT INTO public.profiles VALUES ('${HORSE}', true), ('${PERSON}', false);`,
      `INSERT INTO public.tables (id, name, lifecycle, role, main_index, cluster_id)
         VALUES ('${TABLE}', '${TABLE_NAME}', 'live', 'feeder', NULL, '${GAME}');`,
      ...room.caps.map(
        ([from, cap]) =>
          `INSERT INTO public.test_cap VALUES (${from === null ? `'-infinity'` : at(from)}, ${cap});`
      ),
      `INSERT INTO public.test_now VALUES (${room.now});`,
      ...(room.before ? [beat(-300, room.before)] : []),
      ...room.beats.map((r, i) => beat(beatAt(i), r)),
      room.extra ?? '',
      'COMMIT;',
    ].join('\n');
    sql(seed);
    const out = run(
      'psql',
      ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-q'],
      `SELECT json_object_agg(q.check_name, json_build_array(q.verdict, q.evidence)) FROM (${BODY}) q;`
    );
    return JSON.parse(out.trim()) as Record<string, Row>;
  };

  /** A table seated first by a Horse between beat 0 and beat 1: a Horse-started table. */
  const horseStarted = `
    INSERT INTO public.cash_hourly_table_origins VALUES ('${TABLE}', false);
    INSERT INTO public.table_seats VALUES ('${TABLE}', '${HORSE}', ${at(beatAt(0) + 12)}, NULL);`;
  /** A person-started table whose person leaves between beat 0 and beat 1; its Horse stays and deals on. */
  const personLeft = (humanStarted: boolean) => `
    INSERT INTO public.cash_hourly_table_origins VALUES ('${TABLE}', ${humanStarted});
    INSERT INTO public.table_seats VALUES ('${TABLE}', '${HORSE}', ${at(-200)}, NULL);
    INSERT INTO public.hand_history VALUES ('${TABLE}', NULL, true, ${at(beatAt(0) + 10)});
    INSERT INTO public.hand_history VALUES ('${TABLE}', NULL, false, ${at(beatAt(1) + 8)});`;

  beforeAll(() => {
    if (!bin) throw new Error('PostgreSQL binaries are required for the drain live check');
    const cache = resolve(ROOT, 'node_modules/.cache');
    mkdirSync(cache, { recursive: true });
    scratch = mkdtempSync(resolve(cache, 'drain-live-check-cap-'));
    socket = scratchPostgresSocket();
    data = resolve(scratch, 'data');
    env = {
      ...process.env,
      LC_ALL: process.env.LC_ALL || 'C',
      PGHOST: socket,
      PGPORT: SCRATCH_POSTGRES_PORT,
      PGDATABASE: 'postgres',
      PGUSER: process.env.USER || 'runner',
      PGSSLMODE: 'disable',
    };
    delete env.PGSERVICE;
    delete env.PGSERVICEFILE;
    run('initdb', ['-D', data, '-A', 'trust']);
    showServerLogWhenStartFails(resolve(scratch, 'postgres.log'), () =>
      run('pg_ctl', [
        '-D',
        data,
        '-l',
        resolve(scratch, 'postgres.log'),
        '-o',
        scratchPostgresListenOptions(socket),
        '-w',
        'start',
      ])
    );
    started = true;
    sql(SCHEMA);
  }, 120_000);

  afterAll(() => {
    if (started) {
      try {
        run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
      } catch {
        /* already stopped */
      }
    }
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    if (socket) rmSync(socket, { recursive: true, force: true });
  });

  it('a room winding down to a cap that fell is INFO, not a failure (the 1 AM CST seal of 2026-11-28)', () => {
    const rows = check({
      before: { counted: 25, cap: 25 },
      beats: [
        { counted: 25, cap: 18 },
        { counted: 25, cap: 18 },
        { counted: 24, cap: 18 },
        { counted: 23, cap: 18 },
      ],
      caps: [
        [null, 25],
        [-60, 18],
      ],
      now: 23,
    });
    expect(rows.cap_every_cycle[0]).toBe('PASS');
    expect(rows.cap_every_cycle[1]).toContain(
      '0 table(s) entered the counted room at or above the cap with no person-side cause, over 4 heartbeat(s)'
    );
    expect(rows.tables_within_cap[0]).toBe('INFO');
    expect(rows.tables_within_cap[1]).toContain('23 counted, cap 18 (now); 5 over a cap that fell');
    expect(rows.cap_wind_down[0]).toBe('INFO');
    expect(rows.cap_wind_down[1]).toContain(
      '4 of 4 heartbeat(s) read more counted tables than the cap, at most 7 over; 25 counted at the first, 23 at the newest (falling)'
    );
    expect(rows.cap_wind_down[1]).toMatch(
      /the cap fell: \d\d:\d\d:\d\d [AP]M CT 25 to 18 \(25 counted\)/
    );
  });

  it('STILL FAILS: a Horse-started table seated while the beat before it read the room at the cap', () => {
    const rows = check({
      beats: [
        { counted: 18, cap: 18 },
        { counted: 19, cap: 18 },
        { counted: 19, cap: 18 },
      ],
      caps: [
        [null, 40],
        [-7200, 18],
      ],
      now: 19,
      extra: horseStarted,
    });
    expect(rows.cap_every_cycle[0]).toBe('FAIL');
    expect(rows.cap_every_cycle[1]).toContain(
      '1 table(s) entered the counted room at or above the cap with no person-side cause'
    );
    expect(rows.cap_every_cycle[1]).toMatch(
      /unexplained: \d\d:\d\d:\d\d [AP]M CT 18 to 19 at cap 18/
    );
    /* the room is over the cap now because of that open: never read as a wind-down */
    expect(rows.tables_within_cap[0]).toBe('FAIL');
    expect(rows.tables_within_cap[1]).toContain(
      'over the cap after a table entered at or above it with no person-side cause (cap_every_cycle)'
    );
    expect(rows.tables_within_cap[1]).not.toContain('winding down');
  });

  it('STILL FAILS: a table that enters over the cap across a falling cap, or while the room winds down', () => {
    /* 40 of 40, the cap falls to 29, and the room reads 41: over the cap on both sides of the hour */
    const acrossTheFall = check({
      before: { counted: 40, cap: 40 },
      beats: [
        { counted: 40, cap: 40 },
        { counted: 41, cap: 29 },
      ],
      caps: [
        [null, 40],
        [beatAt(0) + 15, 29],
      ],
      now: 41,
      extra: horseStarted,
    });
    expect(acrossTheFall.cap_every_cycle[0]).toBe('FAIL');
    expect(acrossTheFall.tables_within_cap[0]).toBe('FAIL');
    /* 25 of 18 and winding down, then a table is added: the wind-down never excuses it */
    const duringTheWindDown = check({
      before: { counted: 25, cap: 25 },
      beats: [
        { counted: 25, cap: 18 },
        { counted: 24, cap: 18 },
        { counted: 25, cap: 18 },
      ],
      caps: [
        [null, 25],
        [-60, 18],
      ],
      now: 25,
    });
    expect(duringTheWindDown.cap_every_cycle[0]).toBe('FAIL');
    expect(duringTheWindDown.cap_every_cycle[1]).toMatch(/unexplained: .* 24 to 25 at cap 18/);
    /* two tables in one cycle from below the cap: one fits, one is over */
    const twoAtOnce = check({
      beats: [
        { counted: 17, cap: 18 },
        { counted: 19, cap: 18 },
      ],
      caps: [[null, 18]],
      now: 19,
    });
    expect(twoAtOnce.cap_every_cycle[0]).toBe('FAIL');
    expect(twoAtOnce.cap_every_cycle[1]).toContain('1 table(s) entered');
  });

  it('STILL FAILS: a table that enters over the cap after the newest heartbeat, and a room above every cap of the day', () => {
    const sinceTheNewestBeat = check({
      beats: [
        { counted: 18, cap: 18 },
        { counted: 18, cap: 18 },
      ],
      caps: [
        [null, 40],
        [-7200, 18],
      ],
      now: 19,
    });
    expect(sinceTheNewestBeat.cap_every_cycle[0]).toBe('PASS');
    expect(sinceTheNewestBeat.tables_within_cap[0]).toBe('FAIL');
    expect(sinceTheNewestBeat.tables_within_cap[1]).toContain(
      'a table entered the counted room at or above the cap since the newest heartbeat with no person-side cause'
    );
    /* no beat carries the room: only a cap of the last 24 hours can explain a room over the cap */
    const noReading = (now: number) =>
      check({
        beats: [null, null],
        caps: [
          [null, 40],
          [-7200, 18],
        ],
        now,
      });
    const aboveTheDay = noReading(41);
    expect(aboveTheDay.cap_every_cycle[0]).toBe('INFO');
    expect(aboveTheDay.tables_within_cap[0]).toBe('FAIL');
    expect(aboveTheDay.tables_within_cap[1]).toContain(
      'above every cap of the last 24 hours (highest 40)'
    );
    const underTheDay = noReading(23);
    expect(underTheDay.tables_within_cap[0]).toBe('INFO');
    expect(underTheDay.tables_within_cap[1]).toContain(
      'none carries it: judged against the caps of the last 24 hours only'
    );
  });

  it('a rise a person explains passes and is named; the same rise at a Horse-started table fails', () => {
    /* 12:16:13 AM CST 2026-11-28: the person left a person-started feeder and its Horses stayed */
    const room = (humanStarted: boolean) =>
      check({
        beats: [
          { counted: 25, cap: 25 },
          { counted: 26, cap: 25 },
          { counted: 25, cap: 25 },
        ],
        caps: [[null, 25]],
        now: 25,
        extra: personLeft(humanStarted),
      });
    const person = room(true);
    expect(person.cap_every_cycle[0]).toBe('PASS');
    expect(person.cap_every_cycle[1]).toMatch(
      /explained by a person: \d\d:\d\d:\d\d [AP]M CT 25 to 26 at cap 25 \(the person left person-started table PLO4 0\.25\/0\.50 Classic Feeder\)/
    );
    expect(person.tables_within_cap[0]).toBe('PASS');
    const horse = room(false);
    expect(horse.cap_every_cycle[0]).toBe('FAIL');
    expect(horse.cap_every_cycle[1]).toMatch(/unexplained: .* 25 to 26 at cap 25$/);
    /* a person on a waiting list is never gated by the hourly policy */
    const waiting = check({
      beats: [
        { counted: 25, cap: 25 },
        { counted: 26, cap: 25 },
      ],
      caps: [[null, 25]],
      now: 26,
      extra: `INSERT INTO public.cash_game_waitlist VALUES ('${GAME}', '${PERSON}', 'seated', ${at(beatAt(0) - 20)}, ${at(beatAt(0) + 5)});`,
    });
    expect(waiting.cap_every_cycle[0]).toBe('PASS');
    expect(waiting.cap_every_cycle[1]).toContain(
      `a person was on the waiting list of ${TABLE_NAME}`
    );
    /* a Horse on a waiting list explains nothing */
    const horseWaiting = check({
      beats: [
        { counted: 25, cap: 25 },
        { counted: 26, cap: 25 },
      ],
      caps: [[null, 25]],
      now: 26,
      extra: `INSERT INTO public.cash_game_waitlist VALUES ('${GAME}', '${HORSE}', 'seated', ${at(beatAt(0) - 20)}, ${at(beatAt(0) + 5)});`,
    });
    expect(horseWaiting.cap_every_cycle[0]).toBe('FAIL');
  });

  it('a table opened under the cap, a rising cap and a rise that ends at the cap all pass', () => {
    const rows = check({
      before: { counted: 16, cap: 18 },
      beats: [
        { counted: 17, cap: 18 },
        { counted: 18, cap: 18 },
        { counted: 20, cap: 25 },
        { counted: 25, cap: 25 },
      ],
      caps: [
        [null, 18],
        [beatAt(1) + 15, 25],
      ],
      now: 25,
      extra: horseStarted,
    });
    expect(rows.cap_every_cycle[0]).toBe('PASS');
    expect(rows.tables_within_cap[0]).toBe('PASS');
    expect(rows.tables_within_cap[1]).toBe('25 counted, cap 25 (now)');
    expect(rows.cap_wind_down[1]).toBe('0 of 4 heartbeat(s) read more counted tables than the cap');
    /* 39 of 40 rises to 40 as the cap falls to 29: the table may have opened before the hour */
    const beforeTheHour = check({
      beats: [
        { counted: 39, cap: 40 },
        { counted: 40, cap: 29 },
      ],
      caps: [
        [null, 40],
        [beatAt(0) + 15, 29],
      ],
      now: 40,
    });
    expect(beforeTheHour.cap_every_cycle[0]).toBe('PASS');
    expect(beforeTheHour.tables_within_cap[0]).toBe('INFO');
  });

  it('a first-owed time stamped by the restarted fleet keeps the minimums label; one from before the release removes it', () => {
    /* The fleet keeps first-owed times in memory and restarts with the release:
       on the 1 AM CST seal of 2026-11-28 all nine owed games read 1:05:15 AM,
       the first cycle, and the label was dropped though no true wait was known. */
    const owed = (sinceSec: number) =>
      check({
        beats: [],
        caps: [[null, 18]],
        now: 18,
        extra: [0, 1, 2]
          .map(
            (i) => `INSERT INTO public.ca_horse_fleet_heartbeat VALUES (${at(beatAt(i))},
              jsonb_build_object('variety_owed_games', jsonb_build_array('${GAME}'),
                'variety_owed_since', jsonb_build_object('${GAME}',
                  to_char(${at(sinceSec)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));`
          )
          .join('\n'),
      });
    const restarted = owed(beatAt(0) - 4);
    expect(restarted.owed_waiting_now[1]).toBe(
      '1 waiting; longest so far 1 min (1 already owed at the release: their waits are minimums)'
    );
    const carried = owed(-2400);
    expect(carried.owed_waiting_now[1]).toBe('1 waiting; longest so far 44 min');
  });
});
