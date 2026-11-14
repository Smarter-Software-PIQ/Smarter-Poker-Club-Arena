import { expect, it } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  } finally {
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']);
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
