import { expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * THE CHARLES RULE IS JUDGED BEFORE THE HOUSE TAKE (owner report 2026-11-10).
 * A countdown at reference 114.46 won an all-in pot of 229.67; rake 1.25 and
 * the jackpot drop 0.30 left it paid 228.12, and the old `stack >= 2 * ref`
 * test refused the double by 0.80. Installed on real isolated PostgreSQL.
 */
const MIGRATION =
  'supabase/migrations/20261110155259_charles_rule_doubles_are_judged_before_the_house_take.sql';

const STUB = `
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $r$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_cash_stay_remaining_ms(integer, boolean, timestamptz) RETURNS integer
  LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION public.fn_cash_hit_run_hands_remaining(
  p_required integer, p_played integer, p_completed boolean, p_ack boolean,
  p_stack numeric, p_baseline numeric) RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN coalesce(p_ack, false) AND NOT coalesce(p_completed, false)
                   AND coalesce(p_required, 0) > 0 AND coalesce(p_played, 0) < p_required
                   AND coalesce(p_stack, 0) > coalesce(p_baseline, 0)
              THEN p_required - coalesce(p_played, 0) ELSE 0 END $$;
CREATE TABLE public.clubs (id uuid PRIMARY KEY, hit_run_enabled boolean, hit_run_hands int);
CREATE TABLE public.tables (id uuid PRIMARY KEY, tournament_id uuid, club_id uuid);
CREATE TABLE public.table_seats (
  table_id uuid, user_id uuid, stack numeric, left_at timestamptz);
CREATE TABLE public.cash_player_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid, scope_type text, scope_id uuid,
  table_id uuid, baseline numeric, stay_clock_ms int DEFAULT 0, stay_remaining_ms int DEFAULT 0,
  stay_running boolean DEFAULT false, stay_last_tick_at timestamptz DEFAULT now(),
  closed_at timestamptz, hr_hands_required int DEFAULT 0, hr_hands_played int DEFAULT 0,
  hr_reference_stack numeric, hr_doubles int DEFAULT 0, hr_completed boolean DEFAULT false,
  hr_last_hand_ref text, hr_started_at timestamptz, hr_engine_ack boolean DEFAULT true,
  hr_blind_off boolean DEFAULT false);
CREATE TABLE public.lightning_pool_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cash_player_session_id uuid, exited_at timestamptz);
CREATE TABLE public.hand_history (id uuid PRIMARY KEY, winners jsonb, pots jsonb);
CREATE FUNCTION public.fn_cash_session_open(uuid, uuid, numeric) RETURNS uuid
  LANGUAGE sql AS $$ SELECT NULL::uuid $$;
-- The pre-image the migration replaces (its md5 guard is pointed at this).
CREATE FUNCTION public.fn_cash_session_evaluate(p_table_id uuid, p_entries jsonb) RETURNS jsonb
  LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
`;

const CLUB = '10000000-0000-4000-8000-000000000001';
const T = '10000000-0000-4000-8000-000000000002';
const DAN = '10000000-0000-4000-8000-000000000003';
const VILLAIN = '10000000-0000-4000-8000-000000000004';
const SPLIT = '10000000-0000-4000-8000-000000000005';
const H = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

it('adds back the house take from the pots a player won before judging a Charles Rule double', () => {
  const root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin) throw new Error('PostgreSQL binaries are required for the Charles Rule regression');
  // PostgreSQL refuses to run its server as root. A root shell (an agent
  // container's pre-push) runs the server as an unprivileged system user in a
  // world-writable scratch directory; every other shell runs it as itself.
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const serverUser = 'nobody';
  const cache = asRoot ? tmpdir() : resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'charles-rule-'));
  if (asRoot) chmodSync(scratch, 0o777);
  const port = 20000 + Math.floor(Math.random() * 30000);
  const data = resolve(scratch, 'data');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    LC_ALL: process.env.LC_ALL || 'C',
    PGHOST: '127.0.0.1',
    PGPORT: String(port),
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
  const sql = (text: string) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q'], text);
  const one = (text: string) =>
    run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', text]).trim();
  let started = false;
  try {
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
    started = true;
    sql(STUB);

    // The guard refuses an installed image it was not written against.
    const migration = readFileSync(resolve(root, MIGRATION), 'utf8');
    expect(() => sql(migration)).toThrow(/CHARLES_RULE_SOURCE_CHANGED/);
    const pre = one(
      `SELECT md5(pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure))`
    );
    sql(migration.replace('51e5cf628d1f522425b7be60f69a438a', pre));

    sql(`INSERT INTO clubs VALUES ('${CLUB}', true, 10);
      INSERT INTO tables VALUES ('${T}', NULL, '${CLUB}');
      INSERT INTO table_seats VALUES ('${T}','${DAN}',114.46,NULL),('${T}','${SPLIT}',150,NULL);
      -- The owner's countdown as production held it: started at 114.46.
      INSERT INTO cash_player_session(player_id,scope_type,scope_id,table_id,baseline,
        hr_hands_required,hr_hands_played,hr_reference_stack,hr_started_at)
        VALUES ('${DAN}','table','${T}','${T}',100,10,0,114.46,now()),
               ('${SPLIT}','table','${T}','${T}',100,10,0,150,now());
      -- Production hand f7f69559: one pot of 229.67, paid 228.12 (rake 1.25, BBJ 0.30).
      INSERT INTO hand_history VALUES ('${H(1)}',
        '[{"amount":228.12,"userId":"${DAN}","potIndex":0}]',
        '[{"index":0,"amount":229.67,"eligible":["${VILLAIN}","${DAN}"]}]');
      -- A split pot: 1.34 gross, 0.28 taken, each of two winners paid 0.53.
      INSERT INTO hand_history VALUES ('${H(2)}',
        '[{"amount":0.53,"userId":"${SPLIT}","potIndex":0},{"amount":0.53,"userId":"${VILLAIN}","potIndex":0}]',
        '[{"index":0,"amount":1.34}]');`);

    expect(Number(one(`SELECT fn_cash_hit_run_house_take('${H(1)}','${DAN}')`))).toBe(1.55);
    expect(Number(one(`SELECT fn_cash_hit_run_house_take('${H(2)}','${SPLIT}')`))).toBe(0.14);
    // Not a winner, or no such hand: the house took nothing from them.
    expect(Number(one(`SELECT fn_cash_hit_run_house_take('${H(1)}','${VILLAIN}')`))).toBe(0);
    expect(Number(one(`SELECT fn_cash_hit_run_house_take('${H(9)}','${DAN}')`))).toBe(0);

    const hand = (user: string, stack: number, handId: string) => {
      sql(`UPDATE table_seats SET stack=${stack} WHERE user_id='${user}';`);
      return JSON.parse(
        one(
          `SELECT fn_cash_session_evaluate('${T}', jsonb_build_array(jsonb_build_object(
            'user_id','${user}','stack',${stack},'active',true,'hand_id','${handId}','hit_run',true)))`
        )
      )[0] as Record<string, unknown>;
    };

    // 228.12 held + 1.55 taken = 229.67 >= 228.92: a double. Ten hands are added
    // and the new reference is the stack actually held.
    expect(hand(DAN, 228.12, H(1))).toMatchObject({
      hands_required: 20,
      hands_played: 1,
      hit_run_doubles: 1,
    });
    expect(one(`SELECT hr_reference_stack FROM cash_player_session WHERE player_id='${DAN}'`)).toBe(
      '228.12'
    );
    // A hand with no history row adds nothing back: the stack alone decides.
    expect(hand(DAN, 456, H(3))).toMatchObject({ hands_required: 20, hit_run_doubles: 1 });
    expect(hand(DAN, 456.24, H(4))).toMatchObject({ hands_required: 30, hit_run_doubles: 2 });
    // A small pot is not a double just because the rake is added back.
    expect(hand(SPLIT, 150.53, H(2))).toMatchObject({ hands_required: 10, hit_run_doubles: 0 });
  } finally {
    if (started) {
      try {
        run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
      } catch {
        /* already stopped */
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
