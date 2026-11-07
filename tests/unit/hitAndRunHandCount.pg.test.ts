import { expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * HIT AND RUN (owner 2026-11-06), on real isolated PostgreSQL: the installed
 * migration's state machine, guard, Lightning source rule, grandfathered
 * leaves, blind-off read and the Lightning settlement trigger.
 */
const MIGRATION = 'supabase/migrations/20261106203853_hit_and_run_ten_hands_in_profit.sql';

const STUB = `
DO $r$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $r$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION public.fn_caller_is_engine() RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.fn_platform_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.fn_cash_stay_remaining_ms(integer, boolean, timestamptz) RETURNS integer
  LANGUAGE sql AS $$ SELECT 0 $$;
CREATE TABLE public.tables (id uuid PRIMARY KEY, tournament_id uuid);
CREATE TABLE public.table_seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), table_id uuid, user_id uuid, seat_number int,
  stack numeric, left_at timestamptz, occupancy_id uuid DEFAULT gen_random_uuid(),
  leave_pending boolean DEFAULT false, is_sitting_out boolean DEFAULT false);
CREATE TABLE public.cash_player_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid, club_id uuid, scope_type text,
  scope_id uuid, table_id uuid, cluster_id uuid, baseline numeric DEFAULT 0,
  stay_clock_ms int DEFAULT 0, stay_remaining_ms int DEFAULT 0, stay_running boolean DEFAULT false,
  stay_last_tick_at timestamptz DEFAULT now(), opened_at timestamptz DEFAULT now(), closed_at timestamptz);
CREATE TABLE public.lightning_pool_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid, cash_player_session_id uuid,
  exited_at timestamptz, cluster_id uuid, cluster_epoch int DEFAULT 1, state text DEFAULT 'active',
  anchor_seat_id uuid);
CREATE TABLE public.lightning_pool_slot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), player_id uuid, cluster_id uuid,
  cluster_epoch int DEFAULT 1, pool_session_id uuid);
CREATE TABLE public.lightning_hand_player (hand_id uuid, player_id uuid, pool_slot_id uuid);
CREATE TABLE public.lightning_hand (hand_id uuid, cluster_id uuid, cluster_epoch int DEFAULT 1);
CREATE TABLE public.seat_departure_requests (
  occupancy_id uuid, user_id uuid, table_id uuid, seat_number int, leave_mode text,
  created_at timestamptz DEFAULT now());
CREATE FUNCTION public.fn_cash_session_open(p_user_id uuid, p_table_id uuid, p_buy_in numeric)
  RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO public.cash_player_session(player_id, scope_type, scope_id, table_id, baseline)
  VALUES (p_user_id, 'table', p_table_id, p_table_id, coalesce(p_buy_in, 0)) RETURNING id $$;
-- Pre-images the migration replaces (its md5 guard is pointed at these).
CREATE FUNCTION public.fn_cash_session_evaluate(p_table_id uuid, p_entries jsonb) RETURNS jsonb
  LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
CREATE FUNCTION public.fn_cash_leave_check(p_user_id uuid, p_table_id uuid) RETURNS jsonb
  LANGUAGE sql AS $$ SELECT jsonb_build_object('allowed', true, 'stay_remaining_ms', 0) $$;
CREATE FUNCTION public.fn_lightning_cash_clock_at_settlement() RETURNS trigger
  LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$;
`;

const T = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const Q = '33333333-3333-3333-3333-333333333333';
const C = '44444444-4444-4444-4444-444444444444';

it('counts ten hands in profit, adds ten per double, clears on losing the profit, and holds the voluntary door', () => {
  const root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin) throw new Error('PostgreSQL binaries are required for the hit-and-run regression');
  const cache = resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'hit-and-run-'));
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
    expect(() => sql(migration)).toThrow(/HIT_AND_RUN_SOURCE_CHANGED/);
    const md5 = (fn: string) => one(`SELECT md5(pg_get_functiondef('${fn}'::regprocedure))`);
    const pointed = migration
      .replace(
        '63c48e5d33b963562295d32e6fbee380',
        md5('public.fn_cash_session_evaluate(uuid,jsonb)')
      )
      .replace('71e3be7e9846022ebbab884a049e60df', md5('public.fn_cash_leave_check(uuid,uuid)'))
      .replace(
        '9e84b5c6f32b44ed7d8ccc546381f738',
        md5('public.fn_lightning_cash_clock_at_settlement()')
      );
    sql(pointed);

    sql(`INSERT INTO tables VALUES ('${T}', NULL);
      INSERT INTO table_seats(table_id,user_id,seat_number,stack) VALUES ('${T}','${P}',1,200),('${T}','${Q}',2,200);
      INSERT INTO cash_player_session(player_id,scope_type,scope_id,table_id,baseline)
        VALUES ('${P}','table','${T}','${T}',200),('${Q}','table','${T}','${T}',200);`);

    let n = 0;
    const hand = (
      user: string,
      stack: number,
      opts: { ack?: boolean; id?: string; source?: string } = {}
    ) => {
      const id = opts.id ?? `h${++n}`;
      sql(`UPDATE table_seats SET stack=${stack} WHERE user_id='${user}';`);
      const raw = one(
        `SELECT fn_cash_session_evaluate('${T}', jsonb_build_array(jsonb_build_object('user_id','${user}','stack',${stack},'active',true,'hand_id','${id}'${
          opts.ack === false ? '' : ",'hit_run',true"
        }${opts.source ? `,'hand_source','${opts.source}'` : ''})))`
      );
      return JSON.parse(raw)[0] as Record<string, any>;
    };
    const check = (user: string) => JSON.parse(one(`SELECT fn_cash_leave_check('${user}','${T}')`));

    // Not in profit: nothing owed.
    expect(hand(P, 190)).toMatchObject({
      hands_required: 0,
      hands_remaining: 0,
      leave_locked: false,
    });
    // In profit: the countdown starts at ten; the hand that got them there is not one of them.
    expect(hand(P, 250)).toMatchObject({
      hands_required: 10,
      hands_played: 0,
      hands_remaining: 10,
    });
    expect(check(P)).toEqual({ allowed: false, stay_remaining_ms: 0, hands_remaining: 10 });
    for (let i = 0; i < 4; i++) hand(P, 260);
    expect(hand(P, 260, { id: `h${n}` })).toMatchObject({ hands_played: 4, hands_remaining: 6 }); // replay is a no-op
    // THE CHARLES RULE: doubling the countdown's stack adds ten hands.
    expect(hand(P, 520)).toMatchObject({
      hands_required: 20,
      hands_played: 5,
      hands_remaining: 15,
      hit_run_doubles: 1,
    });
    expect(hand(P, 1040)).toMatchObject({
      hands_required: 30,
      hands_played: 6,
      hit_run_doubles: 2,
    });
    // Losing all the profit clears it: free to go.
    expect(hand(P, 200)).toMatchObject({
      hands_required: 0,
      hands_remaining: 0,
      hit_run_completed: false,
    });
    expect(check(P).allowed).toBe(true);
    // Back in profit, never having completed: the ten-hand clock starts again.
    expect(hand(P, 300)).toMatchObject({
      hands_required: 10,
      hands_played: 0,
      hands_remaining: 10,
    });
    for (let i = 0; i < 9; i++) hand(P, 310);
    expect(check(P)).toMatchObject({ allowed: false, hands_remaining: 1 });
    expect(hand(P, 320)).toMatchObject({
      hit_run_completed: true,
      hands_remaining: 0,
      leave_locked: false,
    });
    // Completed: free for the rest of the session, doubles or not.
    expect(hand(P, 5000)).toMatchObject({
      hands_required: 10,
      hands_remaining: 0,
      hit_run_completed: true,
    });
    expect(check(P).allowed).toBe(true);

    // An engine that does not serve the rule never makes the door refuse.
    expect(hand(Q, 300, { ack: false })).toMatchObject({ hands_required: 10, hands_remaining: 0 });
    expect(check(Q).allowed).toBe(true);
    expect(hand(Q, 300)).toMatchObject({ hands_remaining: 9 });
    expect(check(Q)).toMatchObject({ allowed: false, hands_remaining: 9 });

    // Blinded off: the Lightning host's read names a pool seat that still owes.
    sql(`INSERT INTO lightning_pool_session(id,player_id,cash_player_session_id,cluster_id,anchor_seat_id)
         SELECT '${C}', '${Q}', s.id, '${C}', ts.id FROM cash_player_session s
           JOIN table_seats ts ON ts.user_id=s.player_id WHERE s.player_id='${Q}';`);
    expect(one(`SELECT count(*) FROM fn_lightning_blind_off_players(ARRAY['${C}']::uuid[])`)).toBe(
      '0'
    );
    expect(one(`SELECT fn_cash_session_set_blind_off('${T}','${Q}',true)`)).toBe('t');
    expect(one(`SELECT fn_lightning_blind_off_players(ARRAY['${C}']::uuid[])`)).toBe(Q);

    // A session playing through a Lightning pool counts only Lightning hands.
    expect(hand(Q, 300)).toMatchObject({ hands_remaining: 9 });
    expect(hand(Q, 300, { source: 'lightning' })).toMatchObject({ hands_remaining: 8 });

    // The Lightning settlement trigger reports each participant's hand.
    sql(`INSERT INTO lightning_pool_slot(id,player_id,cluster_id,pool_session_id) VALUES ('${P}','${Q}','${C}','${C}');
         UPDATE cash_player_session SET cluster_id='${C}' WHERE player_id='${Q}';
         CREATE TRIGGER lightning_cash_clock_at_settlement AFTER INSERT ON lightning_hand
           FOR EACH ROW EXECUTE FUNCTION fn_lightning_cash_clock_at_settlement();
         INSERT INTO lightning_hand_player VALUES ('${T}','${Q}','${P}');
         INSERT INTO lightning_hand VALUES ('${T}','${C}',1);`);
    expect(
      one(
        `SELECT hr_hands_played || '/' || hr_hands_required FROM cash_player_session WHERE player_id='${Q}'`
      )
    ).toBe('3/10');
    // The same Lightning hand reported again is not a second hand.
    sql(`INSERT INTO lightning_hand VALUES ('${T}','${C}',1);`);
    expect(one(`SELECT hr_hands_played FROM cash_player_session WHERE player_id='${Q}'`)).toBe('3');

    // A leave asked for BEFORE the countdown started is honoured; one after is not.
    sql(`UPDATE lightning_pool_session SET exited_at=now();
         UPDATE table_seats SET stack=200 WHERE user_id='${Q}';`);
    hand(Q, 200);
    sql(`UPDATE table_seats SET leave_pending=true WHERE user_id='${Q}';
         INSERT INTO seat_departure_requests SELECT occupancy_id,user_id,table_id,seat_number,'voluntary',now()-interval '1 second'
           FROM table_seats WHERE user_id='${Q}';`);
    expect(hand(Q, 400)).toMatchObject({ hands_remaining: 10 });
    expect(check(Q)).toEqual({ allowed: true, stay_remaining_ms: 0, hands_remaining: 0 });
    sql(`UPDATE seat_departure_requests SET created_at=now()+interval '1 minute';`);
    expect(check(Q)).toMatchObject({ allowed: false, hands_remaining: 10 });
    sql(`UPDATE table_seats SET leave_pending=false WHERE user_id='${Q}';
         UPDATE seat_departure_requests SET created_at=now()-interval '1 hour';`);
    expect(check(Q).allowed).toBe(false); // a request no longer pending grandfathers nothing

    // The player's own status read, for the felt and the confirmation.
    const mine = one(
      `SET test.uid='${Q}'; SELECT hands_remaining || ':' || hands_required || ':' || blind_off FROM fn_my_hit_run_status('${T}')`
    );
    expect(mine.split('\n').pop()).toBe('10:10:true');
    expect(
      one(`SET test.uid='${P}'; SELECT count(*) FROM fn_my_hit_run_status()`).split('\n').pop()
    ).toBe('1');

    // No session at all: allowed.
    expect(check('55555555-5555-5555-5555-555555555555').allowed).toBe(true);
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    rmSync(scratch, { recursive: true, force: true });
  }
}, 60_000);
