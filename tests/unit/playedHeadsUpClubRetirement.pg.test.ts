import { expect, it } from 'vitest';
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

it('installs the qualified retirement and refuses a changed protected unwind', () => {
  const root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/opt/postgresql@17/bin',
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin) throw new Error('PostgreSQL binaries are required for the heads-up fixture regression');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const serverUser = 'nobody';
  const cache = asRoot ? tmpdir() : resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'heads-up-retirement-'));
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
  const sql = (text: string) => run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q'], text);
  const one = (text: string) =>
    run('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', text]).trim();
  let started = false;
  try {
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

    sql(`CREATE SCHEMA smarter_private; CREATE SCHEMA auth;
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.ca_money_rpc_registry(proname text PRIMARY KEY,status text,notes text);
    `);
    sql(readFileSync(resolve(root, 'tests/unit/fixtures/heads-up-retirement-estate.sql'), 'utf8'));
    const unwind = readFileSync(
      resolve(root, 'tests/unit/fixtures/heads-up-fixture-unwind.sql'),
      'utf8'
    );
    const migration = readFileSync(
      resolve(
        root,
        'supabase/migrations/20261114200423_retire_played_heads_up_certification_clubs.sql'
      ),
      'utf8'
    );
    sql(unwind.replace('A cancellation', 'A changed cancellation'));
    expect(() => sql(migration)).toThrow(/Welcome unwind changed/);
    sql(unwind);
    sql(migration);
    expect(
      one(
        "SELECT md5(pg_get_functiondef('public.fn_unwind_unused_first_club_welcome_package(uuid,uuid)'::regprocedure))"
      )
    ).toBe('68a129330e900f837c4222b6a49ae470');
    expect(
      one(
        "SELECT has_function_privilege('authenticated','public.fn_ca_retire_heads_up_fixture(uuid,text)','EXECUTE')"
      )
    ).toBe('f');
    expect(
      one(
        "SELECT has_function_privilege('service_role','smarter_private.unwind_heads_up_fixture(uuid,uuid,uuid[])','EXECUTE')"
      )
    ).toBe('f');
    sql(`CREATE FUNCTION auth.role() returns text language sql as $$ select 'service_role'::text $$;
       CREATE FUNCTION smarter_private.cancellation_lane(uuid) returns void language sql as $$select$$;

       INSERT INTO clubs(id,name) VALUES ('11111111-1111-1111-1111-111111111111','Ordinary club');`);
    expect(() =>
      one(
        "SELECT public.fn_ca_retire_heads_up_fixture('11111111-1111-1111-1111-111111111111','test')"
      )
    ).toThrow(/Not a reserved heads-up fixture/);
    const club = '10000000-0000-0000-0000-000000000001';
    const retire = (reason: string) =>
      JSON.parse(one(`SELECT public.fn_ca_retire_heads_up_fixture('${club}','${reason}')`));
    expect(() =>
      one(`SELECT fn_unwind_unused_first_club_welcome_package('${club}',gen_random_uuid())`)
    ).toThrow(/BOARD_LINEAGE_AMBIGUOUS/);
    expect(() => retire('refuse')).toThrow(/Fixture retirement refused/);
    expect(one(`SELECT active FROM tournament_schedules WHERE club_id='${club}'`)).toBe('t');
    expect(one(`SELECT chip_treasury FROM clubs WHERE id='${club}'`)).toBe('99699.90');
    expect(one('SELECT count(*) FROM club_welcome_reset_receipts')).toBe('0');
    sql('UPDATE tournament_escrow SET fee_balance=0.10');
    expect(() => retire('test')).toThrow(/settlement is unfinished/);
    sql('UPDATE tournament_escrow SET fee_balance=0');
    expect(retire('test').success).toBe(true);
    expect(retire('test').already_retired).toBe(true);
    expect(one('SELECT count(*) FROM club_welcome_reset_receipts')).toBe('1');
    expect(one(`SELECT active FROM tournament_schedules WHERE club_id='${club}'`)).toBe('f');
    expect(one(`SELECT count(*) FROM tournaments WHERE status='CANCELLED'`)).toBe('2');
    expect(
      one(
        `SELECT count(*) FROM hand_history JOIN tournaments ON tournaments.id=tournament_id WHERE status='COMPLETED'`
      )
    ).toBe('1');
    // Reconstruct the deployed deactivation from its two protected migrations.
    const source = (file: string) =>
      readFileSync(resolve(root, 'supabase/migrations', file), 'utf8');
    const functionThroughComment = (file: string, name: string) => {
      const text = source(file);
      return text.slice(
        text.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '('),
        text.indexOf('COMMENT ON FUNCTION public.' + name + '(')
      );
    };
    sql('DROP FUNCTION fn_spin_deactivate(uuid,uuid)');
    sql(
      functionThroughComment(
        '20260822030000_union_level_spin_reserve_wallet.sql',
        'fn_spin_reserve_owner'
      )
    );
    sql(
      functionThroughComment(
        '20260902010000_return_inactive_spin_seed_principal.sql',
        'fn_spin_deactivate'
      )
    );
    sql(source('20261002201605_spin_deactivation_names_the_reserve_row.sql'));
    // Exercise the read-side pool predicate on both sides of its exact prefix bounds.
    sql(`CREATE FUNCTION public.fn_get_club_welcome_package_reset_impact(pool uuid) RETURNS boolean
      LANGUAGE sql AS $fn$
        SELECT EXISTS(SELECT 1 FROM public.wallet_credit_idempotency i, (SELECT pool AS id) b
          WHERE i.key LIKE 'bbjpromo:'||b.id::text||':%')
      $fn$`);
    sql(source('20261114224153_scope_spin_deactivation_to_reserve_member_clubs.sql'));
    const promoPrefix = 'bbjpromo:' + club;
    sql(
      `INSERT INTO wallet_credit_idempotency(key) VALUES ('${promoPrefix}9'),('${promoPrefix};x')`
    );
    expect(one(`SELECT fn_get_club_welcome_package_reset_impact('${club}')`)).toBe('f');
    sql(`INSERT INTO wallet_credit_idempotency(key) VALUES ('${promoPrefix}:payout')`);
    expect(one(`SELECT fn_get_club_welcome_package_reset_impact('${club}')`)).toBe('t');
    const patched = one("SELECT pg_get_functiondef('fn_spin_deactivate(uuid,uuid)'::regprocedure)");
    const count = patched.match(/SELECT count\(\*\)::integer INTO v_live_games[\s\S]*?;/)?.[0];
    if (!count || count.includes('fn_spin_reserve_owner(t.club_id)'))
      throw new Error('Missing indexed Spin lookup');
    // 1 independent, 2 self-owned union, 3 and 4 union members, 5 absent club
    // row, 6 union owner with no clubs row, 7 null tournament owner.
    sql(`CREATE TABLE scope_ids AS SELECT n,gen_random_uuid() AS id FROM generate_series(1,7) n`);
    sql(`INSERT INTO clubs(id,union_id) SELECT a.id,b.id FROM scope_ids a
          LEFT JOIN scope_ids b ON b.n=CASE WHEN a.n IN (2,3) THEN 2 WHEN a.n=4 THEN 6 END
          WHERE a.n BETWEEN 1 AND 4;
        INSERT INTO tournaments(id,club_id,tournament_type,status)
          SELECT gen_random_uuid(),CASE WHEN n<7 THEN id END,'SPIN','REGISTERING' FROM scope_ids;
        INSERT INTO tournaments(id,club_id,tournament_type,status)
          SELECT gen_random_uuid(),id,'SPIN','COMPLETED' FROM scope_ids;
        INSERT INTO tournaments(id,club_id,tournament_type,status)
          SELECT gen_random_uuid(),id,'SNG','REGISTERING' FROM scope_ids;`);
    const countSQL = count
      .replace(' INTO v_live_games', '')
      .replace(/v_owner/g, 'scope.id')
      .replace(';', '');
    expect(
      one(`SELECT array_agg((${countSQL}) ORDER BY scope.n)
      FROM (SELECT * FROM scope_ids UNION ALL SELECT 8,NULL::uuid) scope`)
    ).toBe('{1,2,0,0,1,2,0,0}');
    // Exercise the actual impact wrapper against the terminal receipt written above.
    // The reset walk throws if called. A matching receipt skips that walk while
    // an unrelated, missing or malformed receipt still takes the pre-reset path.
    const originalImpact = source('20261002152925_club_retirement_safe_unwind.sql');
    const beginImpact = originalImpact.indexOf('CREATE FUNCTION public.fn_club_retirement_impact(');
    const endImpact = originalImpact.indexOf('$function$;', beginImpact) + '$function$;'.length;
    sql(`DROP FUNCTION public.fn_club_retirement_impact(uuid);
      ALTER TABLE public.wheel_configs ADD COLUMN host_kind text;
      ALTER TABLE public.diamond_game_configs ADD COLUMN host_kind text;
      CREATE FUNCTION public.fn_club_retirement_impact_core_20260906(uuid) RETURNS jsonb
      LANGUAGE sql AS $$ SELECT '{"open_obligations":2,"wallet_chips":11}'::jsonb $$;
      DROP FUNCTION public.fn_get_club_welcome_package_reset_impact(uuid);
      CREATE FUNCTION public.fn_get_club_welcome_package_reset_impact(uuid) RETURNS jsonb
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'package history inspected'; END $$;
      INSERT INTO public.tournament_schedules(id,club_id,active) VALUES(gen_random_uuid(),'${club}',true);`);
    sql(originalImpact.slice(beginImpact, endImpact));
    const inspect = (id: string) =>
      JSON.parse(one(`SELECT public.fn_club_retirement_impact('${id}')`));
    expect(() => inspect(club)).toThrow(/package history inspected/);
    sql(source('20261114231625_skip_settled_welcome_history_in_retirement_impact.sql'));
    expect(inspect(club)).toMatchObject({
      open_obligations: 3,
      active_tournament_schedules: 1,
      wallet_chips: 11,
      pristine_welcome_retire_available: false,
    });
    expect(() => inspect('11111111-1111-1111-1111-111111111111')).toThrow(
      /package history inspected/
    );
    sql("UPDATE public.club_welcome_reset_receipts SET result = result - 'operation_id'");
    expect(() => inspect(club)).toThrow(/package history inspected/);
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
    rmSync(scratch, { recursive: true, force: true });
    rmSync(socket, { recursive: true, force: true });
  }
}, 120_000);
