import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * THE CHARLES RULE AFTER A LARGE WIN (owner 2026-11-11) and the durable
 * bank-the-win state, installed on real isolated PostgreSQL from the
 * migration exactly as written (its md5 guards pointed at these stubs).
 *
 * The win is the settled hand's authoritative net (Classic poker_delta,
 * Lightning net_result), compared with 250 x the hand's recorded big blind.
 */
const MIGRATION =
  'supabase/migrations/20261111174148_charles_rule_big_win_and_durable_bank_the_win_state.sql';

const GUARDED: Record<string, string> = {
  'public.fn_cash_session_evaluate(uuid,jsonb)': 'cb8ac1ad4079d6d6bae21952043e15ae',
  'public.fn_cash_leave_check(uuid,uuid)': '504476448db50af394275027c1ff426c',
  'public.fn_my_hit_run_status(uuid)': 'a28d69027b23ac4b0125a226fdd8aed4',
  'public.fn_cash_session_open(uuid,uuid,numeric)': 'bbc08d039928fa122d3cc1846ee1c2ec',
  'public.fn_lightning_blind_off_waive(uuid,uuid,uuid,text)': '5d412f34ad062c23771c1377ecbe6085',
  'public.ca_club_hit_run_status(uuid)': '83c39a575b94a62c8df3cf8bd1c3ad5f',
};

const STUB = `
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE TABLE public.whoami (uid uuid);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT uid FROM public.whoami LIMIT 1 $$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_cash_stay_remaining_ms(integer, boolean, timestamptz) RETURNS integer
  LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.fn_cash_hit_run_house_take(uuid, uuid) RETURNS numeric
  LANGUAGE sql AS $$ SELECT 0::numeric $$;
CREATE FUNCTION public.fn_cash_hit_run_hands_remaining(
  p_required integer, p_played integer, p_completed boolean, p_ack boolean,
  p_stack numeric, p_baseline numeric) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(p_ack, false) AND NOT coalesce(p_completed, false)
                   AND coalesce(p_required, 0) > 0 AND coalesce(p_played, 0) < p_required
                   AND coalesce(p_stack, 0) > coalesce(p_baseline, 0)
              THEN p_required - coalesce(p_played, 0) ELSE 0 END $$;
CREATE TABLE public.clubs (id uuid PRIMARY KEY, hit_run_enabled boolean, hit_run_hands int);
CREATE TABLE public.tables (id uuid PRIMARY KEY, tournament_id uuid, club_id uuid, max_buy_in numeric,
  game_variant text, small_blind numeric, big_blind numeric, cluster_id uuid, name text, stakes text);
CREATE TABLE public.table_seats (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid,
  user_id uuid, stack numeric, left_at timestamptz, leave_pending boolean DEFAULT false,
  occupancy_id uuid DEFAULT gen_random_uuid(), seat_number int DEFAULT 1);
CREATE TABLE public.seat_departure_requests (occupancy_id uuid, user_id uuid, table_id uuid,
  seat_number int, leave_mode text, created_at timestamptz);
CREATE TABLE public.cash_player_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid, club_id uuid, scope_type text,
  scope_id uuid, table_id uuid, cluster_id uuid, variant text, sb numeric, bb numeric,
  baseline numeric, stay_clock_ms int DEFAULT 0, rejoin_window_ms int DEFAULT 7200000,
  stay_remaining_ms int DEFAULT 0, stay_running boolean DEFAULT false,
  stay_last_tick_at timestamptz DEFAULT now(), opened_at timestamptz DEFAULT clock_timestamp(),
  closed_at timestamptz, closed_reason text, hr_hands_required int NOT NULL DEFAULT 0,
  hr_hands_played int NOT NULL DEFAULT 0, hr_reference_stack numeric, hr_doubles int NOT NULL DEFAULT 0,
  hr_completed boolean NOT NULL DEFAULT false, hr_last_hand_ref text, hr_started_at timestamptz,
  hr_engine_ack boolean NOT NULL DEFAULT false, hr_blind_off boolean NOT NULL DEFAULT false);
CREATE UNIQUE INDEX cps_open ON public.cash_player_session (player_id, scope_type, scope_id)
  WHERE closed_at IS NULL;
CREATE TABLE public.lightning_pool_session (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid, player_id uuid, cash_player_session_id uuid, anchor_seat_id uuid,
  entered_at timestamptz DEFAULT clock_timestamp(), exited_at timestamptz);
CREATE TABLE public.lightning_hand (hand_id uuid PRIMARY KEY, cluster_id uuid, settled_at timestamptz,
  player_count int);
CREATE TABLE public.lightning_hand_player (hand_id uuid, player_id uuid, net_result numeric,
  stack_before numeric, stack_after numeric);
CREATE TABLE public.hand_history (id uuid PRIMARY KEY, big_blind numeric);
CREATE TABLE public.cash_hand_provenance_receipts (hand_id uuid, participants jsonb);
CREATE TABLE public.cash_games (id uuid PRIMARY KEY, ruleset_snapshot jsonb, cluster_epoch int);
CREATE TABLE public.cash_cluster_events (game_id uuid, table_id uuid, kind text, payload jsonb,
  cluster_epoch int);
CREATE TABLE public.blind_order_stub (cluster_id uuid, player_id uuid, rank int);
CREATE FUNCTION public.fn_lightning_blind_order(p_cluster_id uuid, p_cluster_epoch integer, p_players uuid[])
  RETURNS TABLE (p2_rank integer, player_id uuid) LANGUAGE sql STABLE AS $$
  SELECT b.rank, b.player_id FROM public.blind_order_stub b
   WHERE b.cluster_id = p_cluster_id AND (p_players IS NULL OR b.player_id = ANY (p_players)) $$;
CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text, alias text, display_name text,
  first_name text, last_name text, full_name text, status text);
CREATE TABLE public.club_members (club_id uuid, user_id uuid);
CREATE FUNCTION public.fn_ca_club_data_scope(uuid) RETURNS text LANGUAGE sql AS $$ SELECT 'club' $$;
CREATE FUNCTION public.fn_ca_club_data_clubs(uuid) RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY[$1] $$;
CREATE FUNCTION public.fn_ca_club_data_downline(uuid, uuid) RETURNS uuid[] LANGUAGE sql AS $$ SELECT NULL::uuid[] $$;
CREATE FUNCTION public.fn_arena_name(text, text, text, text, text, text) RETURNS text
  LANGUAGE sql AS $$ SELECT coalesce($2, 'Player') $$;
-- Pre-images the migration replaces (its md5 guards are pointed at these).
CREATE FUNCTION public.fn_cash_session_evaluate(p_table_id uuid, p_entries jsonb) RETURNS jsonb
  LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
CREATE FUNCTION public.fn_cash_leave_check(p_user_id uuid, p_table_id uuid) RETURNS jsonb
  LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
CREATE FUNCTION public.fn_my_hit_run_status(p_table_id uuid DEFAULT NULL)
  RETURNS TABLE(table_id uuid, hands_remaining integer, hands_required integer,
                hands_played integer, completed boolean, blind_off boolean)
  LANGUAGE sql AS $$ SELECT NULL::uuid, 0, 0, 0, false, false WHERE false $$;
CREATE FUNCTION public.fn_cash_session_open(p_user_id uuid, p_table_id uuid, p_buy_in numeric)
  RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.fn_lightning_blind_off_waive(p_player_id uuid, p_table_id uuid,
  p_cluster_id uuid, p_reason text) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.ca_club_hit_run_status(p_club_id uuid) RETURNS jsonb
  LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
`;

const CLUB = '10000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000002'; // NLH 0.25/0.50, max 100
const T2 = '10000000-0000-4000-8000-000000000003'; // a sister table of the same game
const LT = '10000000-0000-4000-8000-000000000004'; // a Lightning anchor table
const CL = '10000000-0000-4000-8000-000000000005'; // its cluster
const P = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let sql: (text: string) => string;
let one: (text: string) => string;
let cleanup: () => void = () => undefined;
let hand = 100;

beforeAll(() => {
  const root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin) throw new Error('PostgreSQL binaries are required for the Charles Rule regression');
  const cache = resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'charles-big-win-'));
  const port = 20000 + Math.floor(Math.random() * 30000);
  const data = resolve(scratch, 'data');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LC_ALL: process.env.LC_ALL || 'C',
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
    PGDATABASE: 'postgres',
    PGUSER: process.env.USER || 'runner',
    PGSSLMODE: 'disable',
  };
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  const run = (cmd: string, args: string[], input?: string) =>
    execFileSync(`${bin}/${cmd}`, args, {
      cwd: root,
      env,
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  sql = (text) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q'], text);
  one = (text) => run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', text]).trim();
  run('initdb', ['-D', data, '-A', 'trust']);
  run('pg_ctl', [
    '-D',
    data,
    '-l',
    resolve(scratch, 'postgres.log'),
    '-o',
    `-p ${port} -h 127.0.0.1 -k ''`,
    '-w',
    'start',
  ]);
  cleanup = () => {
    try {
      run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  sql(STUB);
  let migration = readFileSync(resolve(root, MIGRATION), 'utf8');
  // The guard refuses an installed image it was not written against.
  expect(() => sql(migration)).toThrow(/CHARLES_RULE_BIG_WIN_SOURCE_CHANGED/);
  for (const [sig, md5] of Object.entries(GUARDED)) {
    const stub = one(`SELECT md5(pg_get_functiondef('${sig}'::regprocedure))`);
    migration = migration.replace(md5, stub);
  }
  sql(migration);
  sql(`INSERT INTO clubs VALUES ('${CLUB}', true, 10);
    INSERT INTO tables VALUES
      ('${T}', NULL, '${CLUB}', 100, 'nlh', 0.25, 0.5, NULL, 'NLH Classic', '0.25/0.50'),
      ('${T2}', NULL, '${CLUB}', 100, 'nlh', 0.25, 0.5, NULL, 'NLH Classic 2', '0.25/0.50'),
      ('${LT}', NULL, '${CLUB}', 100, 'nlh', 0.25, 0.5, '${CL}', 'NLH Lightning', '0.25/0.50');
    INSERT INTO cash_games VALUES ('${CL}', NULL, 1);`);
}, 120_000);

afterAll(() => cleanup());

/** Seat a player and open their session through the migrated open function. */
function seat(player: string, table: string, buyIn: number, stack = buyIn): void {
  sql(`INSERT INTO table_seats (table_id, user_id, stack) VALUES ('${table}', '${player}', ${stack});
       SELECT fn_cash_session_open('${player}', '${table}', ${buyIn});
       UPDATE cash_player_session SET hr_engine_ack = true
        WHERE player_id = '${player}' AND closed_at IS NULL;`);
}

/** Settle one Classic hand: its recorded big blind and each player's poker_delta. */
function classicHand(table: string, deltas: Record<string, number>, bb = 0.5): string {
  const id = H(++hand);
  const participants = Object.entries(deltas).map(([u, d]) => ({ user_id: u, poker_delta: d }));
  sql(`INSERT INTO hand_history VALUES ('${id}', ${bb});
       INSERT INTO cash_hand_provenance_receipts VALUES ('${id}', '${JSON.stringify(participants)}');`);
  for (const [u, d] of Object.entries(deltas))
    sql(
      `UPDATE table_seats SET stack = stack + ${d} WHERE user_id = '${u}' AND table_id = '${table}' AND left_at IS NULL`
    );
  evaluate(table, Object.keys(deltas), id, 'table');
  return id;
}

function evaluate(table: string, players: string[], handId: string | null, source = 'table'): void {
  const entries = players.map((u) => ({
    user_id: u,
    active: true,
    hit_run: true,
    ...(handId ? { hand_id: handId, hand_source: source } : {}),
  }));
  sql(`SELECT fn_cash_session_evaluate('${table}', '${JSON.stringify(entries)}')`);
}

function session(player: string): Record<string, string> {
  const row = one(
    `SELECT row_to_json(s) FROM cash_player_session s WHERE player_id = '${player}' AND closed_at IS NULL`
  );
  return JSON.parse(row);
}

function owed(
  player: string,
  table: string
): { allowed: boolean; hands: number; reason: string | null } {
  const r = JSON.parse(one(`SELECT fn_cash_leave_check('${player}', '${table}')`));
  return { allowed: r.allowed, hands: Number(r.hands_remaining), reason: r.hands_reason ?? null };
}

function quietHands(table: string, player: string, n: number): void {
  for (let i = 0; i < n; i++) classicHand(table, { [player]: 0 });
}

describe('the Charles Rule after a +250 BB win', () => {
  it('applies at exactly +250 BB and above, never just below', () => {
    seat(P(1), T, 100);
    seat(P(2), T, 100);
    seat(P(3), T, 100);
    classicHand(T, { [P(1)]: 124.99, [P(2)]: 125, [P(3)]: 140 }, 0.5);
    expect(session(P(1)).hr_big_win_required).toBe(0);
    expect(owed(P(2), T)).toMatchObject({ allowed: false, hands: 10 });
    expect(owed(P(3), T)).toMatchObject({ allowed: false, hands: 10 });
    expect(Number(session(P(2)).hr_big_win_net)).toBe(125);
    expect(Number(session(P(2)).hr_big_win_bb)).toBe(0.5);
  });

  it('reads the settled net, so own contributions, uncalled returns, fees, side pots and chops are already inside it', () => {
    // A player who shoved 300 into an uncalled bet gets it back: net 0, nothing owed.
    seat(P(4), T, 100, 400);
    classicHand(T, { [P(4)]: 0 });
    expect(session(P(4)).hr_big_win_required).toBe(0);
    // Won a 400 gross side pot after putting in 300 and paying 3 rake: net 97 (194 BB).
    classicHand(T, { [P(4)]: 97 });
    expect(session(P(4)).hr_big_win_required).toBe(0);
    // A chopped pot nets each winner half the loser's money: 130 each (260 BB) qualifies.
    seat(P(5), T, 100);
    classicHand(T, { [P(4)]: 130, [P(5)]: 130 });
    expect(session(P(5)).hr_big_win_required).toBe(10);
    // The hand's own recorded big blind is the measure, never the session's.
    seat(P(6), T2, 100);
    classicHand(T2, { [P(6)]: 130 }, 1);
    expect(session(P(6)).hr_big_win_required).toBe(0);
  });

  it('starts after a completed countdown, does not count its own hand, and resets to ten on another win', () => {
    seat(P(7), T, 100);
    sql(`UPDATE cash_player_session SET hr_completed = true, hr_hands_required = 10, hr_hands_played = 10
          WHERE player_id = '${P(7)}' AND closed_at IS NULL`);
    const win = classicHand(T, { [P(7)]: 200 });
    expect(session(P(7))).toMatchObject({
      hr_big_win_hand_ref: win,
      hr_big_win_required: 10,
      hr_big_win_played: 0,
    });
    quietHands(T, P(7), 4);
    expect(owed(P(7), T).hands).toBe(6);
    // A second qualifying win: ten subsequent hands again, never 16.
    classicHand(T, { [P(7)]: 150 });
    expect(owed(P(7), T)).toMatchObject({ hands: 10, reason: 'big_win' });
    quietHands(T, P(7), 9);
    expect(owed(P(7), T).hands).toBe(1);
    quietHands(T, P(7), 1);
    expect(owed(P(7), T)).toMatchObject({ allowed: true, hands: 0, reason: null });
  });

  it('a duplicate settlement event neither creates nor resets an obligation twice', () => {
    seat(P(8), T, 100);
    const win = classicHand(T, { [P(8)]: 200 });
    quietHands(T, P(8), 3);
    evaluate(T, [P(8)], win, 'table'); // the old winning hand reported again
    const last = session(P(8)).hr_last_hand_ref;
    evaluate(T, [P(8)], last, 'table'); // the latest hand reported again
    expect(session(P(8)).hr_big_win_played).toBe(3);
    expect(owed(P(8), T).hands).toBe(7);
  });

  it('counts Lightning pool hands from their own settlement and never a table report while in the pool', () => {
    sql(`INSERT INTO table_seats (table_id, user_id, stack) VALUES ('${LT}', '${P(9)}', 100);
         SELECT fn_cash_session_open('${P(9)}', '${LT}', 100);
         UPDATE cash_player_session SET hr_engine_ack = true WHERE player_id = '${P(9)}';
         INSERT INTO lightning_pool_session (cluster_id, player_id, cash_player_session_id, anchor_seat_id)
           SELECT '${CL}', '${P(9)}', s.id, ts.id FROM cash_player_session s, table_seats ts
            WHERE s.player_id = '${P(9)}' AND ts.user_id = '${P(9)}';`);
    const lightningHand = (net: number | null, before: number, after: number) => {
      const id = H(++hand);
      sql(`INSERT INTO hand_history VALUES ('${id}', 0.5);
           INSERT INTO lightning_hand VALUES ('${id}', '${CL}', clock_timestamp(), 6);
           INSERT INTO lightning_hand_player VALUES ('${id}', '${P(9)}', ${net === null ? 'NULL' : net}, ${before}, ${after});
           UPDATE table_seats SET stack = ${after} WHERE user_id = '${P(9)}';`);
      evaluate(LT, [P(9)], id, 'lightning');
      return id;
    };
    lightningHand(126, 100, 226);
    // In profit too, so the ordinary countdown starts with it: both are owed.
    expect(owed(P(9), LT)).toMatchObject({ hands: 10, reason: 'both' });
    // A report from the anchor table is not the session's source while it is in the pool.
    const id = H(++hand);
    sql(`INSERT INTO hand_history VALUES ('${id}', 0.5)`);
    evaluate(LT, [P(9)], id, 'table');
    expect(session(P(9)).hr_big_win_played).toBe(0);
    lightningHand(0, 226, 226);
    lightningHand(null, 226, 225); // net unreadable: the stack delta stands in
    expect(session(P(9)).hr_big_win_played).toBe(2);
    expect(Number(one(`SELECT fn_cash_hand_net('${H(hand)}', '${P(9)}', 'lightning')`))).toBe(-1);
  });
});

describe('leave request ordering', () => {
  it('honours a voluntary leave asked for at or before the win, and holds one asked after it', () => {
    seat(P(10), T, 100);
    seat(P(11), T, 100);
    seat(P(12), T, 100);
    // P10 asked to leave while the hand was still running; the win settles after.
    sql(`UPDATE table_seats SET leave_pending = true WHERE user_id IN ('${P(10)}', '${P(11)}', '${P(12)}');
         INSERT INTO seat_departure_requests
           SELECT occupancy_id, user_id, table_id, seat_number, 'voluntary', clock_timestamp()
             FROM table_seats WHERE user_id = '${P(10)}';`);
    classicHand(T, { [P(10)]: 200, [P(11)]: 200, [P(12)]: 200 });
    // P11 asks after the win; P12's request carries the settlement's exact stamp (the race).
    sql(`INSERT INTO seat_departure_requests
           SELECT ts.occupancy_id, ts.user_id, ts.table_id, ts.seat_number, 'voluntary', clock_timestamp()
             FROM table_seats ts WHERE ts.user_id = '${P(11)}';
         INSERT INTO seat_departure_requests
           SELECT ts.occupancy_id, ts.user_id, ts.table_id, ts.seat_number, 'voluntary', s.hr_big_win_at
             FROM table_seats ts JOIN cash_player_session s ON s.player_id = ts.user_id AND s.closed_at IS NULL
            WHERE ts.user_id = '${P(12)}';`);
    expect(owed(P(10), T)).toMatchObject({ allowed: true, hands: 0 });
    expect(owed(P(11), T)).toMatchObject({ allowed: false, hands: 10, reason: 'both' });
    expect(owed(P(12), T)).toMatchObject({ allowed: true, hands: 0 });
    // A leave that is not pending any more is not an exemption.
    sql(`UPDATE table_seats SET leave_pending = false WHERE user_id = '${P(10)}'`);
    expect(owed(P(10), T)).toMatchObject({ allowed: false, hands: 10 });
  });
});

describe('persistence', () => {
  it('survives a reconnect, a sit out, a seat move and a restart, and a re-entry inherits it', () => {
    seat(P(13), T, 100);
    classicHand(T, { [P(13)]: 300 });
    quietHands(T, P(13), 2);
    // Reconnect / restart: an evaluation with no dealt hand advances nothing and loses nothing.
    evaluate(T, [P(13)], null);
    // Sit out: hands the player is not dealt into are simply not counted.
    classicHand(T, { [P(1)]: 0 });
    expect(owed(P(13), T).hands).toBe(8);
    // A seat move re-points the same session row to the sister table (move executors).
    sql(`UPDATE table_seats SET table_id = '${T2}' WHERE user_id = '${P(13)}' AND left_at IS NULL;
         UPDATE cash_player_session SET scope_id = '${T2}', table_id = '${T2}'
          WHERE player_id = '${P(13)}' AND closed_at IS NULL;`);
    expect(owed(P(13), T2).hands).toBe(8);
    quietHands(T2, P(13), 1);
    expect(owed(P(13), T2).hands).toBe(7);
    // Re-entry inside the rejoin window (a forced exit, then a buy-in with the whole stack).
    sql(`UPDATE cash_player_session SET closed_at = clock_timestamp(), closed_reason = 'table_closed'
          WHERE player_id = '${P(13)}' AND closed_at IS NULL;
         UPDATE table_seats SET left_at = clock_timestamp() WHERE user_id = '${P(13)}';`);
    seat(P(13), T, 400);
    expect(session(P(13))).toMatchObject({ hr_big_win_required: 10, hr_big_win_played: 3 });
    expect(owed(P(13), T).hands).toBe(7);
  });

  it('keeps the start basis through re-entry and top-ups, capped at the table maximum', () => {
    seat(P(14), T, 60);
    expect(Number(session(P(14)).start_basis)).toBe(60);
    sql(
      `UPDATE cash_player_session SET baseline = baseline + 40 WHERE player_id = '${P(14)}' AND closed_at IS NULL`
    );
    evaluate(T, [P(14)], null);
    expect(Number(session(P(14)).start_basis)).toBe(60);
    sql(`UPDATE cash_player_session SET closed_at = clock_timestamp() WHERE player_id = '${P(14)}' AND closed_at IS NULL;
         UPDATE table_seats SET left_at = clock_timestamp() WHERE user_id = '${P(14)}';`);
    seat(P(14), T2, 548.91); // the rathole rule brings the whole stack back
    expect(Number(session(P(14)).start_basis)).toBe(60);
    seat(P(15), T, 150); // nobody starts above the table maximum
    expect(Number(session(P(15)).start_basis)).toBe(100);
  });

  it('counts the bank-the-win orbit durably from a big pot of half the start basis', () => {
    seat(P(16), T, 100);
    classicHand(T, { [P(16)]: 49.99 });
    expect(session(P(16)).hands_since_big_pot).toBeNull();
    const pot = classicHand(T, { [P(16)]: 50 });
    expect(session(P(16))).toMatchObject({ big_pot_hand_ref: pot, hands_since_big_pot: 0 });
    quietHands(T, P(16), 3);
    expect(session(P(16)).hands_since_big_pot).toBe(3);
  });
});

describe('safety and coexisting obligations', () => {
  it('a bust owes nothing and the responsible-gaming waive finishes every obligation', () => {
    seat(P(17), T, 100);
    classicHand(T, { [P(17)]: 200 });
    sql(`UPDATE table_seats SET stack = 0 WHERE user_id = '${P(17)}'`);
    expect(owed(P(17), T)).toMatchObject({ allowed: true, hands: 0 });
    sql(`UPDATE table_seats SET stack = 300 WHERE user_id = '${P(17)}';
         UPDATE cash_player_session SET hr_blind_off = true WHERE player_id = '${P(17)}' AND closed_at IS NULL;`);
    expect(
      one(`SELECT fn_lightning_blind_off_waive('${P(17)}', '${T}', '${CL}', 'rg_limit')`)
    ).toBe('t');
    expect(owed(P(17), T)).toMatchObject({ allowed: true, hands: 0 });
    expect(
      Number(one(`SELECT count(*) FROM cash_cluster_events WHERE kind = 'blind_off_waived'`))
    ).toBe(1);
  });

  it('owes the larger obligation, and finishing one never clears the other', () => {
    seat(P(18), T, 100, 300); // deep enough that the big win below is not a Charles double
    classicHand(T, { [P(18)]: 10 }); // in profit: the ten-hand countdown starts
    quietHands(T, P(18), 6);
    expect(owed(P(18), T)).toMatchObject({ hands: 4, reason: 'hit_run' });
    classicHand(T, { [P(18)]: 130 }); // counts as hit-and-run hand 7, starts the big-win ten
    expect(owed(P(18), T)).toMatchObject({ hands: 10, reason: 'both' });
    quietHands(T, P(18), 3);
    expect(session(P(18)).hr_completed).toBe(true);
    expect(owed(P(18), T)).toMatchObject({ hands: 7, reason: 'big_win' });
    quietHands(T, P(18), 7);
    expect(owed(P(18), T)).toMatchObject({ allowed: true, hands: 0 });
  });

  it('shows the player their count and why it is owed', () => {
    sql(`DELETE FROM whoami; INSERT INTO whoami VALUES ('${P(11)}')`);
    const row = JSON.parse(one(`SELECT row_to_json(x) FROM fn_my_hit_run_status('${T}') x`));
    expect(row).toMatchObject({
      hands_remaining: 10,
      hands_required: 10,
      hands_played: 0,
      hands_reason: 'both',
      big_win_hands_remaining: 10,
    });
    expect(Number(row.big_win_bb)).toBe(400);
    sql(`INSERT INTO profiles (id, username) VALUES ('${P(11)}', 'eleven');
         INSERT INTO club_members VALUES ('${CLUB}', '${P(11)}');`);
    const club = JSON.parse(one(`SELECT ca_club_hit_run_status('${CLUB}')`));
    expect(club.rows).toEqual([
      expect.objectContaining({ user_id: P(11), hands_remaining: 10, hands_reason: 'both' }),
    ]);
  });

  it('gives a Lightning Horse door the pool facts: blind order, orbit counter and every hand owed', () => {
    sql(`INSERT INTO blind_order_stub VALUES ('${CL}', '${P(9)}', 2), ('${CL}', '${P(19)}', 1),
           ('${CL}', '${P(20)}', 3);`);
    const r = JSON.parse(one(`SELECT fn_lightning_bank_the_win_reading('${CL}', '${P(9)}')`));
    expect(r).toMatchObject({
      found: true,
      table_id: LT,
      blind_rank: 2,
      pool_players: 3,
      players_per_hand: 6,
    });
    expect(Number(r.start_basis)).toBe(100);
    expect(r.hands_owed).toBe(8);
    expect(
      JSON.parse(one(`SELECT fn_lightning_bank_the_win_reading('${CL}', '${P(20)}')`))
    ).toEqual({
      found: false,
    });
  });
});
