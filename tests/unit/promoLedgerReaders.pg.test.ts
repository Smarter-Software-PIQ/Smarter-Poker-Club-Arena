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
import { stalePinGuardSQL } from '../../scripts/ci/migration-stale-pins.mjs';

it('counts typed promo legs on every reader and rejects a changed preimage', () => {
  const root = resolve(__dirname, '../..');
  const bin = [
    '/opt/homebrew/opt/postgresql@17/bin',
    '/opt/homebrew/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/usr/bin',
  ].find((dir) => ['initdb', 'pg_ctl', 'psql'].every((name) => existsSync(`${dir}/${name}`)));
  if (!bin) throw new Error('PostgreSQL binaries are required for the promo ledger regression');
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const serverUser = 'nobody';
  const cache = asRoot ? tmpdir() : resolve(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const scratch = mkdtempSync(resolve(cache, 'promo-reader-'));
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

    sql(`CREATE TABLE public.clubs(id uuid PRIMARY KEY);
      CREATE TABLE public.agents(id uuid PRIMARY KEY,user_id uuid,promo_wallet_balance numeric DEFAULT 100);
      CREATE TABLE public.unions(id uuid PRIMARY KEY);
      CREATE TABLE public.union_wallets(id uuid PRIMARY KEY,union_id uuid);
      CREATE TABLE public.ca_ledger_replay_readings(read_snapshot text PRIMARY KEY,read_at timestamptz,committed_legs uuid[]);
      CREATE TABLE public.chip_ledger(id uuid DEFAULT gen_random_uuid(),created_at timestamptz DEFAULT now(),
        from_type text,from_entity_id uuid,from_label text,to_type text,to_entity_id uuid,to_label text,
        amount numeric,metadata jsonb);
      CREATE FUNCTION public.fn_ca_xid8(xid) RETURNS xid8 LANGUAGE sql IMMUTABLE AS $$ SELECT $1::text::xid8 $$;
      INSERT INTO agents VALUES('10000000-0000-0000-0000-000000000001','47965354-0e56-43ef-931c-ddaab82af765');
      INSERT INTO unions VALUES('20000000-0000-0000-0000-000000000001');`);
    const fixtures = JSON.parse(
      readFileSync(resolve(root, 'tests/unit/fixtures/promo-ledger-readers.json'), 'utf8')
    );
    const installOriginal = () =>
      fixtures.forEach((f: { definition: string }) => sql(f.definition));
    installOriginal();
    const snapshot = one('SELECT pg_current_snapshot()::text');
    const owner = '47965354-0e56-43ef-931c-ddaab82af765';
    // Independent journal arithmetic from the incident: 270-30-50-100+30-25+35+50-40-40=100.
    sql(`INSERT INTO chip_ledger(from_type,from_entity_id,from_label,to_type,to_entity_id,to_label,amount)
      SELECT 'promo_wallet', CASE WHEN delta<0 THEN '${owner}'::uuid ELSE '10000000-0000-0000-0000-000000000001'::uuid END,
        CASE WHEN ord>8 THEN 'agents.promo_wallet_balance' END,
        CASE WHEN ord=6 THEN 'player_wallet' WHEN ord>8 THEN 'escrow' ELSE 'promo_wallet' END,
        CASE WHEN delta>0 THEN '${owner}'::uuid ELSE '10000000-0000-0000-0000-000000000001'::uuid END,
        CASE WHEN ord=6 THEN 'club_members.chip_balance' END,abs(delta)
      FROM unnest(ARRAY[270,-30,-50,-100,30,-25,35,50,-40,-40]) WITH ORDINALITY t(delta,ord);`);
    const queries = [
      "public.fn_ca_leg_accounts(now()-interval '1 hour',now()+interval '1 hour')",
      `public.fn_ca_leg_accounts_since_snapshot(now()-interval '1 hour','${snapshot}'::pg_snapshot)`,
      `public.fn_ca_leg_accounts_since_snapshot_for(now()-interval '1 hour','${snapshot}'::pg_snapshot,ARRAY['${owner}']::uuid[])`,
    ];
    const net = (reader: string) =>
      one(
        `SELECT net FROM ${reader} WHERE entity_id='${owner}' AND column_name='agents.promo_wallet_balance'`
      );
    for (const query of queries) expect(net(query)).toBe('-80.00');
    const migrationSource = readFileSync(
      resolve(
        root,
        'supabase/migrations/20261115064521_promo_ledger_readers_resolve_their_own_account_type.sql'
      ),
      'utf8'
    );
    const migration = stalePinGuardSQL(
      'supabase/migrations/20261115064521_promo_ledger_readers_resolve_their_own_account_type.sql',
      migrationSource,
      migrationSource
    );
    sql(fixtures[0].definition.replace('WITH sides AS', 'WITH sides AS /* drift */'));
    expect(() => sql(migration)).toThrow(/PROMO_READER_PREIMAGE_CHANGED/);
    installOriginal();
    sql(`CREATE TABLE public.ca_drift_incidents(id uuid PRIMARY KEY,status text,source text,discrepancy_amount numeric,expected_amount numeric,actual_amount numeric,root_cause text,correction_ref text,closure_basis text);
      INSERT INTO ca_drift_incidents(id,status,source,discrepancy_amount,expected_amount,actual_amount) VALUES('7b5937ca-770f-476f-bbc5-c3d7d655b944','open','fn_ca_ledger_replay',180,-80,100);
      CREATE TABLE public.ca_account_snapshots(id bigserial PRIMARY KEY,account_key text,account_type text,entity_id uuid,club_id uuid,column_name text,
        balance numeric,taken_at timestamptz,is_baseline boolean,unexplained numeric,cum_unexplained numeric,basis_version text,note text,read_snapshot text);
      INSERT INTO ca_account_snapshots(id,account_key,account_type,entity_id,column_name,balance,taken_at,unexplained,cum_unexplained,basis_version,read_snapshot)
      SELECT id,'promo_wallet:${owner}:agents.promo_wallet_balance','promo_wallet','${owner}','agents.promo_wallet_balance',bal,at,err,err,'one-snapshot-v4','${snapshot}'
      FROM (VALUES(48396,0,now()-interval '1 hour',0),(84765,100,now(),180))v(id,bal,at,err);
      CREATE FUNCTION public.fn_ca_incident_action(uuid,text,text,uuid,text,text) RETURNS jsonb LANGUAGE plpgsql AS $f$
      BEGIN UPDATE public.ca_drift_incidents SET status='resolved',root_cause=$5,correction_ref=$6,closure_basis='operator' WHERE id=$1; RETURN jsonb_build_object('ok',true); END $f$;
      UPDATE public.agents SET promo_wallet_balance=101 WHERE user_id='${owner}';`);
    // The actual production resolution trigger must accept the migration's evidence.
    sql(readFileSync(resolve(root, 'tests/unit/fixtures/promo-resolution-guard.sql'), 'utf8'));
    sql(`CREATE TRIGGER resolution_guard BEFORE UPDATE ON public.ca_drift_incidents
      FOR EACH ROW EXECUTE FUNCTION public.fn_ca_resolution_needs_a_cause()`);
    expect(() => sql(migration)).toThrow(/PROMO_READING_STILL_DISAGREES/);
    expect(net(queries[0])).toBe('-80.00'); // refusal rolled back all reader replacements
    sql(`UPDATE public.agents SET promo_wallet_balance=100 WHERE user_id='${owner}'`);
    expect(() =>
      sql(migration.replace("'migration 20261115064521_", "'supabase/migrations/20261115064521_"))
    ).toThrow(/Supply correction_ref/);
    expect(net(queries[0])).toBe('-80.00');
    sql(migration);
    expect(one('SELECT status FROM ca_drift_incidents')).toBe('resolved');
    expect(one('SELECT count(*) FROM ca_account_snapshots')).toBe('3');
    expect(one('SELECT unexplained FROM ca_account_snapshots WHERE id=84765')).toBe('180');
    expect(
      one("SELECT cum_unexplained FROM ca_account_snapshots WHERE note LIKE '20261115064521:%'")
    ).toBe('0');
    expect(one(`SELECT sum(promo_wallet_balance) FROM agents WHERE user_id='${owner}'`)).toBe(
      '100'
    );
    for (const query of queries) expect(net(query)).toBe('100.00');
    const hashes = fixtures.map((f: { signature: string }) =>
      one(`SELECT md5(pg_get_functiondef('public.${f.signature}'::regprocedure))`)
    );
    expect(() => sql(migration)).toThrow(/PROMO_READER_PREIMAGE_CHANGED/);
    expect(
      fixtures.map((f: { signature: string }) =>
        one(`SELECT md5(pg_get_functiondef('public.${f.signature}'::regprocedure))`)
      )
    ).toEqual(hashes);
    // Explicit labels win; promo type resolves an unlabelled union; a bare union_wallet remains unknown.
    sql(`TRUNCATE chip_ledger;
      INSERT INTO chip_ledger(from_type,from_entity_id,to_type,to_entity_id,to_label,amount) VALUES
        ('external',null,'promo_wallet','${owner}','clubs.promo_balance',7),
        ('external',null,'promo_wallet','20000000-0000-0000-0000-000000000001',null,11),
        ('external',null,'promo_wallet','30000000-0000-0000-0000-000000000001',null,13),
        ('external',null,'union_wallet','20000000-0000-0000-0000-000000000001',null,17);`);
    for (const query of queries.slice(0, 2)) {
      expect(one(`SELECT net FROM ${query} WHERE column_name='clubs.promo_balance'`)).toBe('7.00');
      expect(one(`SELECT net FROM ${query} WHERE column_name='union_wallets.promo_wallet'`)).toBe(
        '11.00'
      );
      expect(one(`SELECT net FROM ${query} WHERE account_type='unkeyable'`)).toBe('30.00');
    }
    for (const f of fixtures) {
      expect(
        one(
          `SELECT prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=public'] FROM pg_proc WHERE oid='public.${f.signature}'::regprocedure`
        )
      ).toBe('t');
    }
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
    rmSync(scratch, { recursive: true, force: true });
    rmSync(socket, { recursive: true, force: true });
  }
}, 120_000);
