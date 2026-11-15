import { expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * HIT AND RUN (owner 2026-11-06), on real isolated PostgreSQL: the installed
 * migration's state machine, guard, Lightning source rule, grandfathered
 * leaves, blind-off read and the Lightning settlement trigger.
 *
 * This file installs that first migration alone, so it still shows its
 * original "clears on losing the profit" branch. Owner 2026-11-13 replaced
 * that branch: the countdown now pauses and resumes where it left off
 * (20261114050737, pinned in charlesRuleBigWin.pg.test.ts).
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
  // PostgreSQL refuses to run its server as root. A root shell (an agent
  // container's pre-push) runs the server as an unprivileged system user in a
  // world-writable scratch directory; every other shell runs it as itself.
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const serverUser = 'nobody';
  const cache = asRoot ? tmpdir() : resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'hit-and-run-'));
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

    // CLUB DATA: owners see who owes hands, agents their downline, anyone else is refused.
    const CLUB = '66666666-6666-6666-6666-666666666666';
    sql(`ALTER TABLE tables ADD COLUMN name text, ADD COLUMN stakes text;
      UPDATE tables SET name='Main', stakes='1/2';
      CREATE TABLE public.profiles(id uuid PRIMARY KEY, alias text, username text, display_name text,
        first_name text, last_name text, full_name text, status text);
      INSERT INTO profiles(id, username, status) VALUES ('${P}','pee','active'),('${Q}','queue','active');
      CREATE TABLE public.club_members(club_id uuid, user_id uuid);
      INSERT INTO club_members VALUES ('${CLUB}','${P}'),('${CLUB}','${Q}');
      CREATE FUNCTION public.fn_ca_club_data_scope(p uuid) RETURNS text LANGUAGE sql
        AS $$ SELECT nullif(current_setting('test.scope', true), '') $$;
      CREATE FUNCTION public.fn_ca_club_data_clubs(p uuid) RETURNS uuid[] LANGUAGE sql AS $$ SELECT ARRAY[p] $$;
      CREATE FUNCTION public.fn_ca_club_data_downline(p uuid, u uuid) RETURNS uuid[] LANGUAGE sql
        AS $$ SELECT ARRAY['${Q}'::uuid] $$;
      CREATE FUNCTION public.fn_arena_name(a text, b text, c text, d text, e text, f text) RETURNS text
        LANGUAGE sql AS $$ SELECT coalesce(a, b) $$;`);
    sql(
      readFileSync(
        resolve(
          root,
          'supabase/migrations/20261107020241_club_data_shows_hit_and_run_countdowns.sql'
        ),
        'utf8'
      )
    );
    const club = (scope: string) =>
      JSON.parse(
        one(`SET test.scope='${scope}'; SELECT ca_club_hit_run_status('${CLUB}')::text`)
          .split('\n')
          .pop()!
      );
    const whole = club('club');
    expect(whole).toMatchObject({ contract: 'ca_club_hit_run_status.v1', scope: 'club' });
    expect(whole.rows.find((r: any) => r.user_id === Q)).toMatchObject({
      username: 'queue',
      table_name: 'Main',
      stakes: '1/2',
      hands_remaining: 10,
      hands_required: 10,
      blind_off: true,
    });
    expect(whole.rows.every((r: any) => r.hands_remaining > 0)).toBe(true);
    const downline = club('downline');
    expect(downline.rows.map((r: any) => r.user_id)).toEqual([Q]);
    expect(() => club('')).toThrow(/not authorized for this club/);
    sql(`UPDATE profiles SET status='deleted' WHERE id='${Q}';`);
    expect(club('club').rows.some((r: any) => r.user_id === Q)).toBe(false);
    sql(`DELETE FROM club_members WHERE user_id='${P}';`);
    expect(club('club').rows).toEqual([]);
    expect(
      one(
        `SELECT has_function_privilege('anon','public.ca_club_hit_run_status(uuid)','EXECUTE')::text`
      )
    ).toBe('false');

    // A CLUB SETTING: the hosting club chooses 5, 10, 15 or 20 hands, or switches the count off.
    const O = '77777777-7777-7777-7777-777777777777';
    const R = '88888888-8888-8888-8888-888888888888';
    sql(`ALTER TABLE tables ADD COLUMN club_id uuid;
      UPDATE tables SET club_id='${CLUB}';
      CREATE TABLE public.clubs(id uuid PRIMARY KEY, owner_id uuid);
      INSERT INTO clubs VALUES ('${CLUB}','${O}');
      CREATE FUNCTION public.fn_club_role(u uuid, c uuid) RETURNS text LANGUAGE sql
        AS $$ SELECT CASE WHEN u='${O}' THEN 'owner' WHEN u='${R}' THEN 'member' END $$;
      CREATE FUNCTION public.fn_ca_is_club_staff(c uuid, u uuid) RETURNS boolean LANGUAGE sql
        AS $$ SELECT u='${O}' $$;
      INSERT INTO table_seats(table_id,user_id,seat_number,stack) VALUES ('${T}','${R}',3,200);
      INSERT INTO cash_player_session(player_id,scope_type,scope_id,table_id,baseline)
        VALUES ('${R}','table','${T}','${T}',200);`);
    sql(
      readFileSync(
        resolve(
          root,
          'supabase/migrations/20261107040516_clubs_choose_their_hand_count_before_leaving.sql'
        ),
        'utf8'
      )
    );
    const asUser = (uid: string, q: string) =>
      one(`SET test.uid='${uid}'; SELECT coalesce((${q})::text, 'null')`).split('\n').pop()!;
    const setHr = (uid: string, on: boolean, hands: number) =>
      JSON.parse(asUser(uid, `fn_set_club_hit_run('${CLUB}', ${on}, ${hands})`));
    // The default is unchanged: on, ten.
    expect(JSON.parse(asUser(R, `fn_club_hit_run_setting('${CLUB}')`))).toMatchObject({
      enabled: true,
      hands: 10,
      can_edit: false,
    });
    expect(
      asUser('99999999-9999-9999-9999-999999999999', `fn_club_hit_run_setting('${CLUB}')`)
    ).toBe('null');
    // Only staff may change it, and only to an offered number.
    expect(setHr(R, true, 5)).toEqual({ ok: false, reason: 'not_a_club_admin' });
    expect(setHr(O, true, 7)).toEqual({ ok: false, reason: 'hands_not_offered' });
    expect(setHr('', true, 5)).toEqual({ ok: false, reason: 'not_signed_in' });
    expect(setHr(O, true, 5)).toMatchObject({ ok: true, enabled: true, hands: 5 });
    // Five hands, and five more per double.
    expect(hand(R, 250)).toMatchObject({ hands_required: 5, hands_remaining: 5 });
    expect(hand(R, 500)).toMatchObject({ hands_required: 10, hands_played: 1, hands_remaining: 9 });
    expect(check(R)).toMatchObject({ allowed: false, hands_remaining: 9 });
    // Switched off: every open countdown at the club's tables clears at once, and none starts.
    expect(setHr(O, false, 5).countdowns_cleared).toBeGreaterThanOrEqual(1);
    expect(check(R).allowed).toBe(true);
    expect(hand(R, 600)).toMatchObject({
      hands_required: 0,
      hands_remaining: 0,
      leave_locked: false,
    });
    // Back on at ten: the next hand in profit starts a fresh ten.
    expect(setHr(O, true, 10)).toMatchObject({ ok: true });
    expect(hand(R, 600)).toMatchObject({ hands_required: 10, hands_remaining: 10 });
    expect(
      one(
        `SELECT has_function_privilege('anon','public.fn_set_club_hit_run(uuid,boolean,integer)','EXECUTE')::text`
      )
    ).toBe('false');

    // No session at all: allowed.
    expect(check('55555555-5555-5555-5555-555555555555').allowed).toBe(true);
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
    rmSync(scratch, { recursive: true, force: true });
  }
}, 60_000);
