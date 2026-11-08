/**
 * A MIGRATION MOVES THE PINS ON WHAT IT CHANGES (2026-11-07).
 *
 * Runs scripts/ci/migration-stale-pins.mjs's guard on a real PostgreSQL:
 * a migration that changes or drops a function whose old body md5 is still
 * pinned by another installed function is rolled back; one that moves the pin
 * in the same transaction, or declares the pin with @stale-pin-ok, installs.
 * 20261107021911 is the case that motivated it: it changed
 * fn_union_pnl_evidence_report and left original_inventory_proof_sources_match
 * pinned to the old body, which silently stopped the 2026-10-19 close.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  stalePinGuardSQL,
  isPinChecked,
  allowedStalePins,
} from '../../scripts/ci/migration-stale-pins.mjs';

const FILE = 'supabase/migrations/20261108000001_example.sql';
const bin = [
  process.env.PG_BIN,
  '/opt/homebrew/opt/postgresql@17/bin',
  '/opt/homebrew/bin',
  '/usr/lib/postgresql/18/bin',
  '/usr/lib/postgresql/17/bin',
  '/usr/lib/postgresql/16/bin',
  '/usr/bin',
].find((dir) => dir && ['initdb', 'pg_ctl', 'psql'].every((n) => existsSync(`${dir}/${n}`)));

let scratch = '';
let started = false;
const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
for (const k of Object.keys(env)) if (k.startsWith('PG')) delete env[k];

function psql(sql: string) {
  return spawnSync(
    `${bin}/psql`,
    [
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      join(scratch, 's'),
      '-p',
      '5432',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    {
      input: sql,
      encoding: 'utf8',
      env,
    }
  );
}
function install(source: string) {
  return psql(stalePinGuardSQL(FILE, source, source));
}
const md5Of = (sig: string, path = 'pg_catalog') =>
  psql(
    `SET search_path=${path}; SELECT md5(pg_get_functiondef('${sig}'::regprocedure));`
  ).stdout.trim();

beforeAll(() => {
  if (!bin) throw new Error('PostgreSQL binaries are required for the stale-pin guard test');
  scratch = mkdtempSync(join(tmpdir(), 'pin-'));
  execFileSync(
    `${bin}/initdb`,
    ['-D', join(scratch, 'd'), '-U', 'postgres', '-A', 'trust', '--no-locale'],
    { env, stdio: 'pipe' }
  );
  execFileSync('mkdir', [join(scratch, 's')]);
  execFileSync(
    `${bin}/pg_ctl`,
    [
      '-D',
      join(scratch, 'd'),
      '-l',
      join(scratch, 'log'),
      '-o',
      `-k ${join(scratch, 's')} -p 5432 -c listen_addresses=`,
      '-w',
      'start',
    ],
    { env, stdio: 'pipe' }
  );
  started = true;
  const r = psql(`CREATE SCHEMA smarter_private;
    CREATE TABLE public.thing(id int);
    CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
    CREATE FUNCTION public.typed(t public.thing) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;
    CREATE FUNCTION public.loose() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$;`);
  expect(r.status, r.stderr).toBe(0);
});
afterAll(() => {
  if (started)
    spawnSync(`${bin}/pg_ctl`, ['-D', join(scratch, 'd'), '-m', 'immediate', '-w', 'stop'], {
      env,
    });
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('a migration moves the pins on what it changes', () => {
  it('applies to migrations from 20261108000000 on and reads declared pins', () => {
    expect(isPinChecked('supabase/migrations/20261107234051_x.sql')).toBe(false);
    expect(isPinChecked(FILE)).toBe(true);
    expect(
      allowedStalePins(`-- @stale-pin-ok: ${'b'.repeat(32)} accepted former body\nBEGIN;`)
    ).toEqual(['b'.repeat(32)]);
    expect(
      stalePinGuardSQL(
        'supabase/migrations/20261101000000_x.sql',
        'BEGIN;\nCOMMIT;',
        'BEGIN;\nCOMMIT;'
      )
    ).toBe('BEGIN;\nCOMMIT;');
  });

  it('refuses a change that leaves another function pinned to the old body, and installs nothing', () => {
    const old = md5Of('public.f()');
    expect(
      psql(
        `CREATE FUNCTION smarter_private.pin() RETURNS boolean LANGUAGE sql AS $$ SELECT md5(pg_get_functiondef('public.f()'::regprocedure))='${old}' $$;`
      ).status
    ).toBe(0);
    const r = install(
      `BEGIN;\nCREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;\nCOMMIT;\n`
    );
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(
      /migration_left_a_stale_pin: public\.f\(\) \(old md5 [0-9a-f]{32}\) is still pinned by smarter_private\.pin\(\)/
    );
    expect(md5Of('public.f()')).toBe(old);
  });

  it('installs when the same migration moves the pin', () => {
    const r = install(`BEGIN;
CREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;
DO $m$ BEGIN EXECUTE format('CREATE OR REPLACE FUNCTION smarter_private.pin() RETURNS boolean LANGUAGE sql AS $b$ SELECT md5(pg_get_functiondef(''public.f()''::regprocedure))=%L $b$', md5(pg_get_functiondef('public.f()'::regprocedure))); END $m$;
COMMIT;
`);
    expect(r.status, r.stderr).toBe(0);
    expect(psql('SELECT smarter_private.pin();').stdout.trim()).toBe('t');
  });

  it('installs a declared pin on a former body', () => {
    const old = md5Of('public.f()');
    const r = install(
      `-- @stale-pin-ok: ${old} the accepted-bodies list keeps naming it\nBEGIN;\nCREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 3 $$;\nCOMMIT;\n`
    );
    expect(r.status, r.stderr).toBe(0);
  });

  it('refuses a drop, and a change made inside a subtransaction', () => {
    const pinned = md5Of('public.loose()');
    expect(
      psql(
        `CREATE FUNCTION smarter_private.pin2() RETURNS text LANGUAGE sql AS $$ SELECT '${pinned}' $$;`
      ).status
    ).toBe(0);
    const drop = install(`BEGIN;\nDROP FUNCTION public.loose();\nCOMMIT;\n`);
    expect(drop.stderr).toMatch(/loose\(\) \(old md5 .*pin2\(\)/);
    const sub = install(
      `BEGIN;\nDO $m$ BEGIN BEGIN CREATE OR REPLACE FUNCTION public.loose() RETURNS int LANGUAGE sql AS $b$ SELECT 9 $b$; EXCEPTION WHEN others THEN RAISE; END; END $m$;\nCOMMIT;\n`
    );
    expect(sub.stderr).toMatch(/loose\(\) \(old md5 .*pin2\(\)/);
  });

  it('finds a pin computed on the public search path for a function taking a user type', () => {
    const viaPublic = md5Of('public.typed(public.thing)', 'public');
    expect(viaPublic).not.toBe(md5Of('public.typed(public.thing)'));
    expect(
      psql(
        `CREATE FUNCTION smarter_private.pin3() RETURNS text LANGUAGE sql AS $$ SELECT '${viaPublic}' $$;`
      ).status
    ).toBe(0);
    const r = install(
      `BEGIN;\nCREATE OR REPLACE FUNCTION public.typed(t public.thing) RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;\nCOMMIT;\n`
    );
    expect(r.stderr).toMatch(
      /public\.typed\(public\.thing\) \(old md5 [0-9a-f]{32}\) is still pinned by smarter_private\.pin3\(\)/
    );
  });

  it('is wired into the applier before the history insert and the final COMMIT', () => {
    const applier = readFileSync(
      resolve(__dirname, '../../scripts/ci/apply-recorded-migration.mjs'),
      'utf8'
    );
    expect(applier).toContain("import { stalePinParts } from './migration-stale-pins.mjs';");
    expect(applier).toContain('stalePin = stalePinParts(file, sql, transactionBody);');
    expect(applier).toContain(
      'begin + stalePin.snapshot + middle + stalePin.check + historyStatement'
    );
    expect(applier.indexOf('stalePin = stalePinParts(')).toBeLessThan(
      applier.indexOf('const atomicSQL = transactionBody.replace(')
    );
  });
});
