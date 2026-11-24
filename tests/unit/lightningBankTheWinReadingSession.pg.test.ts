import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import {
  SCRATCH_POSTGRES_PORT,
  scratchPostgresListenOptions,
  scratchPostgresSocket,
  showServerLogWhenStartFails,
} from '../helpers/scratchPostgres';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * THE LIGHTNING BANK-THE-WIN READING READS ONLY THE SESSION (2026-11-15), on
 * real isolated PostgreSQL. The pre-image is the function exactly as
 * 20261111174148 installed it (extracted from that migration); the fix is
 * 20261115000756 exactly as written, its md5 guard pointed at the pre-image.
 */
const ORIGINAL =
  'supabase/migrations/20261111174148_charles_rule_big_win_and_durable_bank_the_win_state.sql';
const FIX =
  'supabase/migrations/20261115000756_lightning_bank_the_win_reading_reads_only_the_session.sql';
const PRODUCTION_GUARD = 'a7e9ad154abfb5678c2b3e341b63f3de';
const SIG = 'public.fn_lightning_bank_the_win_reading(uuid,uuid)';

const STUB = `
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $r$;
CREATE TABLE public.tables (id uuid PRIMARY KEY, max_buy_in numeric);
CREATE TABLE public.table_seats (id uuid PRIMARY KEY, table_id uuid, user_id uuid, stack numeric,
  left_at timestamptz, leave_pending boolean DEFAULT false);
CREATE TABLE public.cash_player_session (id uuid PRIMARY KEY, player_id uuid, baseline numeric,
  start_basis numeric, hands_since_big_pot integer, closed_at timestamptz);
CREATE TABLE public.cash_games (id uuid PRIMARY KEY, cluster_epoch integer);
CREATE TABLE public.lightning_pool_session (id uuid PRIMARY KEY, cluster_id uuid,
  cluster_epoch integer, player_id uuid, cash_player_session_id uuid, anchor_seat_id uuid,
  entered_at timestamptz, exited_at timestamptz);
CREATE TABLE public.lightning_hand (hand_id uuid PRIMARY KEY, cluster_id uuid,
  cluster_epoch integer, formed_at timestamptz, settled_at timestamptz, player_count smallint);
CREATE INDEX lightning_hand_by_cluster_epoch
  ON public.lightning_hand (cluster_id, cluster_epoch, formed_at DESC);
CREATE TABLE public.lightning_hand_player (hand_id uuid, player_id uuid,
  PRIMARY KEY (hand_id, player_id));
CREATE INDEX lightning_hand_player_by_player ON public.lightning_hand_player (player_id);
CREATE TABLE public.blind_order_stub (cluster_id uuid, player_id uuid, rank int);
CREATE FUNCTION public.fn_lightning_blind_order(p_cluster_id uuid, p_cluster_epoch integer, p_players uuid[])
  RETURNS TABLE (p2_rank integer, player_id uuid) LANGUAGE sql STABLE AS $$
  SELECT b.rank, b.player_id FROM public.blind_order_stub b
   WHERE b.cluster_id = p_cluster_id AND (p_players IS NULL OR b.player_id = ANY (p_players)) $$;
CREATE FUNCTION public.fn_cash_session_hands_owed(p_s public.cash_player_session, p_stack numeric)
  RETURNS integer LANGUAGE sql STABLE AS $$ SELECT 0 $$;
`;

const CL = '10000000-0000-4000-8000-000000000005';
const OTHER_CL = '10000000-0000-4000-8000-000000000006';
const TABLE = '10000000-0000-4000-8000-000000000004';
const HORSE = '30000000-0000-4000-8000-000000000001';
const SEAT = '40000000-0000-4000-8000-000000000001';
const CPS = '50000000-0000-4000-8000-000000000001';
const POOL_OLD = '60000000-0000-4000-8000-000000000001';
const POOL_NOW = '60000000-0000-4000-8000-000000000002';
const POOL_LATER = '60000000-0000-4000-8000-000000000003';
const H = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let sql: (text: string) => string;
let one: (text: string) => string;
let cleanup: () => void = () => undefined;
let root = '';

function originalImage(): string {
  const text = readFileSync(resolve(root, ORIGINAL), 'utf8');
  const start = text.indexOf('CREATE FUNCTION public.fn_lightning_bank_the_win_reading(');
  const open = text.indexOf('$function$', start);
  const end = text.indexOf('$function$;', open + 1) + '$function$;'.length;
  expect(start).toBeGreaterThan(0);
  return text.slice(start, end);
}

function reading(): Record<string, unknown> {
  return JSON.parse(one(`SELECT fn_lightning_bank_the_win_reading('${CL}', '${HORSE}')`));
}

/** A settled (or unsettled) hand the Horse was dealt into. */
function hand(n: number, cluster: string, epoch: number, at: string, size: number, settled = true) {
  sql(`INSERT INTO lightning_hand VALUES ('${H(n)}', '${cluster}', ${epoch}, '${at}',
         ${settled ? `'${at}'::timestamptz + interval '20 seconds'` : 'NULL'}, ${size});
       INSERT INTO lightning_hand_player VALUES ('${H(n)}', '${HORSE}');`);
}

beforeAll(() => {
  root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin)
    throw new Error('PostgreSQL binaries are required for the bank-the-win reading regression');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const serverUser = 'nobody';
  const cache = asRoot ? tmpdir() : resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'lightning-bank-reading-'));
  if (asRoot) chmodSync(scratch, 0o777);
  const socket = scratchPostgresSocket();
  const data = resolve(scratch, 'data');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LC_ALL: process.env.LC_ALL || 'C',
    PGHOST: socket,
    PGPORT: SCRATCH_POSTGRES_PORT,
    PGDATABASE: 'postgres',
    PGUSER: asRoot ? serverUser : process.env.USER || 'runner',
    PGSSLMODE: 'disable',
  };
  delete env.PGSERVICE;
  delete env.PGSERVICEFILE;
  const server = (cmd: string) => cmd === 'initdb' || cmd === 'pg_ctl';
  const run = (cmd: string, args: string[], input?: string) =>
    asRoot && server(cmd)
      ? execFileSync('runuser', ['-u', serverUser, '--', `${bin}/${cmd}`, ...args], {
          cwd: scratch,
          env,
          input,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      : execFileSync(`${bin}/${cmd}`, args, {
          cwd: root,
          env,
          input,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
  sql = (text) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q'], text);
  one = (text) => run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', text]).trim();
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
  cleanup = () => {
    try {
      run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
      rmSync(socket, { recursive: true, force: true });
    }
  };
  sql(STUB);
  sql(`INSERT INTO tables VALUES ('${TABLE}', 100);
       INSERT INTO table_seats (id, table_id, user_id, stack) VALUES ('${SEAT}', '${TABLE}', '${HORSE}', 450);
       INSERT INTO cash_player_session VALUES ('${CPS}', '${HORSE}', 100, 100, 12, NULL);
       INSERT INTO cash_games VALUES ('${CL}', 2), ('${OTHER_CL}', 2);
       INSERT INTO blind_order_stub VALUES ('${CL}', '${HORSE}', 1);
       -- An earlier, closed pool session in this cluster, and the open one.
       INSERT INTO lightning_pool_session VALUES
         ('${POOL_OLD}', '${CL}', 1, '${HORSE}', '${CPS}', '${SEAT}', '2026-11-14T08:00Z', '2026-11-14T09:00Z'),
         ('${POOL_NOW}', '${CL}', 2, '${HORSE}', '${CPS}', '${SEAT}', '2026-11-14T12:00Z', NULL);`);
  // A long history before this session: what the old read sorted every call.
  sql(`INSERT INTO lightning_hand
         SELECT ('20000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, '${CL}', 1,
                '2026-11-14T08:00Z'::timestamptz + g * interval '100 ms',
                '2026-11-14T08:00Z'::timestamptz + g * interval '100 ms' + interval '5 s', 6
           FROM generate_series(1, 20000) g;
       INSERT INTO lightning_hand_player
         SELECT ('20000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid, '${HORSE}'
           FROM generate_series(1, 20000) g;
       ANALYZE;`);
}, 120_000);

afterAll(() => cleanup());

describe('the Lightning bank-the-win reading', () => {
  it('the pre-image reports a hand from an EARLIER session as the last hand (the defect)', () => {
    sql(originalImage());
    // Nothing dealt in the open session yet: the old read answers 6 from the closed one.
    expect(reading()).toMatchObject({ found: true, players_per_hand: 6, blind_rank: 1 });
  });

  it('the fix refuses an installed image it was not written against', () => {
    const fix = readFileSync(resolve(root, FIX), 'utf8');
    expect(fix).toContain(PRODUCTION_GUARD);
    expect(() => sql(fix.replace(PRODUCTION_GUARD, '00000000000000000000000000000000'))).toThrow(
      /LIGHTNING_BANK_THE_WIN_READING_SOURCE_CHANGED/
    );
  });

  it('after the fix, only the open session counts: none dealt yet reads 0', () => {
    const fix = readFileSync(resolve(root, FIX), 'utf8');
    const installed = one(`SELECT md5(pg_get_functiondef('${SIG}'::regprocedure))`);
    sql(fix.replace(PRODUCTION_GUARD, installed));
    expect(reading()).toMatchObject({
      found: true,
      table_id: TABLE,
      start_basis: 100,
      hands_since_big_pot: 12,
      hands_owed: 0,
      blind_rank: 1,
      pool_players: 1,
      players_per_hand: 0,
    });
  });

  it('reads the newest SETTLED hand of the open session, in its cluster and epoch only', () => {
    hand(1, CL, 2, '2026-11-14T12:01Z', 5);
    hand(2, CL, 2, '2026-11-14T12:02Z', 4);
    hand(3, CL, 2, '2026-11-14T12:03Z', 6, false); // newest, not yet settled
    hand(4, OTHER_CL, 2, '2026-11-14T12:04Z', 3); // another pool
    hand(5, CL, 1, '2026-11-14T12:05Z', 2); // a stale epoch row
    expect(reading()).toMatchObject({ players_per_hand: 4 });
  });

  it('counts only hands formed since THIS session entered, even inside the same epoch', () => {
    // Review note N3 (#10885): an earlier, closed pool session of the SAME
    // epoch. Without the entered_at bound its hand would answer for a session
    // that has not been dealt a settled hand yet.
    sql(`UPDATE lightning_pool_session SET exited_at = '2026-11-14T13:00Z' WHERE id = '${POOL_NOW}';
         INSERT INTO lightning_pool_session VALUES
           ('${POOL_LATER}', '${CL}', 2, '${HORSE}', '${CPS}', '${SEAT}', '2026-11-14T14:00Z', NULL);`);
    expect(reading()).toMatchObject({ found: true, players_per_hand: 0 });
    hand(6, CL, 2, '2026-11-14T14:01Z', 3);
    expect(reading()).toMatchObject({ players_per_hand: 3 });
    sql(`UPDATE lightning_pool_session SET exited_at = '2026-11-14T15:00Z' WHERE id = '${POOL_LATER}';
         UPDATE lightning_pool_session SET exited_at = NULL WHERE id = '${POOL_NOW}';`);
  });

  it('keeps its grants: the engine may read it, no client role may', () => {
    for (const [role, allowed] of [
      ['anon', 'f'],
      ['authenticated', 'f'],
      ['service_role', 't'],
    ])
      expect(one(`SELECT has_function_privilege('${role}', '${SIG}', 'EXECUTE')`)).toBe(allowed);
  });

  it('a Horse that has left the pool is not found', () => {
    sql(
      `UPDATE lightning_pool_session SET exited_at = '2026-11-14T13:00Z' WHERE id = '${POOL_NOW}'`
    );
    expect(reading()).toEqual({ found: false });
  });
});
