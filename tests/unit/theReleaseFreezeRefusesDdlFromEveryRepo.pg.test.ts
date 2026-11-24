/**
 * THE RELEASE FREEZE REFUSES MIGRATION DDL FROM EVERY REPO (2026-11-24): the
 * native proof for migration
 * 20261124085047_the_release_freeze_refuses_migration_ddl_from_every_repo.
 *
 * A real PostgreSQL gets production's break-window guard exactly as the
 * migration history last defines it (the engine recovery contract, whose md5
 * pins must hold, proves the bodies are production's), then the migration
 * itself, verbatim. A governed session (a non-superuser member of postgres,
 * as the management API, MCP, the pooler and psql log in) is then asked for DDL
 * at pinned instants:
 *   - inside the 23:45-04:15 Chicago freeze: refused, nothing applied;
 *   - the installer's route ('apply-recorded-migration', and the window
 *     installer 'install-window-migrations'): allowed (the 04:00 window and the
 *     04:15 held sends);
 *   - an override that is a reason: allowed and recorded once; a switch: refused;
 *   - outside the freeze, GRANT/REVOKE, temp objects, a superuser: allowed;
 *   - the hourly break inside the freeze: the break-window guard decides
 *     exactly as before (its message, its one override row).
 * Only the two clock functions are wrapped to read a pinned instant, AFTER the
 * migration's own postimage has run against the real ones.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = join(ROOT, 'supabase/migrations');
const MIGRATION = '20261124085047_the_release_freeze_refuses_migration_ddl_from_every_repo.sql';

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

function psql(sql: string, user = 'postgres') {
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
      user,
      '-d',
      'postgres',
    ],
    { input: sql, encoding: 'utf8', env }
  );
}
const ok = (r: ReturnType<typeof psql>) => expect(r.status, r.stderr).toBe(0);

/** The last definition of public.<name> in the migration history, verbatim. */
function lastDefinition(name: string): string {
  const re = new RegExp(
    `CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1`,
    'g'
  );
  let last = '';
  for (const f of readdirSync(MIGRATIONS)
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    if (f >= MIGRATION) break;
    for (const m of readFileSync(join(MIGRATIONS, f), 'utf8').matchAll(re)) last = m[0];
  }
  if (!last) throw new Error(`no definition of public.${name}`);
  return last + ';\n';
}

let n = 0;
/** Governed DDL at a pinned instant; returns the psql result. */
function governed(at: string, app: string, body: string) {
  n += 1;
  return psql(
    `SET test.now = '${at}'; SET application_name = '${app}';\n${body.replaceAll('$N', String(n))}`,
    'operator'
  );
}
const overrides = () =>
  psql('SELECT count(*) FROM public.ca_break_window_migration_overrides').stdout.trim();

const FREEZE = '2026-11-22 07:15:48+00'; // the 11-22 hand install (01:15:48 CST)
const OUTSIDE = '2026-11-22 12:15:48+00';
const BREAK_IN_FREEZE = '2026-11-22 06:52:00+00';

beforeAll(() => {
  if (!bin) throw new Error('PostgreSQL binaries are required for the release freeze guard test');
  scratch = mkdtempSync(join(tmpdir(), 'freeze-'));
  execFileSync(
    `${bin}/initdb`,
    ['-D', join(scratch, 'd'), '-U', 'postgres', '-A', 'trust', '--no-locale'],
    {
      env,
      stdio: 'pipe',
    }
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
  ok(
    psql(`
      CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
      CREATE ROLE operator LOGIN NOSUPERUSER; GRANT postgres TO operator;
      CREATE SCHEMA smarter_private;
      CREATE TABLE public.ca_break_window_migration_overrides (
        id bigserial PRIMARY KEY, occurred_at timestamptz NOT NULL DEFAULT now(), txid bigint NOT NULL,
        reason text NOT NULL, session_role text, application_name text, first_command text, query_snippet text);
      CREATE FUNCTION public.fn_entry_purchases_frozen() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
      CREATE FUNCTION public.fn_ca_stage_b_ledger_bootstrap_allowed(text, text, text) RETURNS boolean
        LANGUAGE sql AS $$ SELECT false $$;
      ${lastDefinition('fn_ca_break_window_governs')}
      ${lastDefinition('fn_ca_break_window_refuses_migrations')}
      ${lastDefinition('fn_ca_break_window_ddl_guard')}
      ${lastDefinition('fn_engine_recovery_window_contract')}
      CREATE EVENT TRIGGER ca_break_window_refuses_ddl ON ddl_command_end
        EXECUTE FUNCTION public.fn_ca_break_window_ddl_guard();
      CREATE EVENT TRIGGER ca_break_window_refuses_drops ON sql_drop
        EXECUTE FUNCTION public.fn_ca_break_window_ddl_guard();
    `)
  );
  // Production's exact bodies: the recovery contract's md5 pins hold.
  expect(psql('SELECT public.fn_engine_recovery_window_contract()').stdout.trim()).toBe(
    'engine-recovery-window-v1'
  );
  // The migration, verbatim (its postimage asserts the contract still holds).
  ok(psql(readFileSync(join(MIGRATIONS, MIGRATION), 'utf8')));
  expect(psql('SELECT public.fn_engine_recovery_window_contract()').stdout.trim()).toBe(
    'engine-recovery-window-v1'
  );
  // Only now: both clocks read the pinned instant (test.now).
  ok(
    psql(`
      ALTER FUNCTION public.fn_ca_break_window_refuses_migrations(timestamptz) RENAME TO real_break;
      CREATE FUNCTION public.fn_ca_break_window_refuses_migrations(p_at timestamptz) RETURNS text
        LANGUAGE sql AS $$ SELECT public.real_break(current_setting('test.now')::timestamptz) $$;
      ALTER FUNCTION smarter_private.fn_ca_release_freeze_refuses_migrations(timestamptz, text) RENAME TO real_freeze;
      CREATE FUNCTION smarter_private.fn_ca_release_freeze_refuses_migrations(p_at timestamptz, p_app text) RETURNS text
        LANGUAGE sql AS $$ SELECT smarter_private.real_freeze(current_setting('test.now')::timestamptz, p_app) $$;
    `)
  );
}, 120_000);

afterAll(() => {
  if (started)
    spawnSync(`${bin}/pg_ctl`, ['-D', join(scratch, 'd'), '-m', 'immediate', '-w', 'stop'], {
      env,
    });
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe('the release freeze refuses migration DDL from every repo', () => {
  it('refuses a governed session inside the freeze, and nothing is applied', () => {
    for (const app of ['mgmt-api', 'Supavisor', 'psql', '']) {
      const r = governed(FREEZE, app, 'CREATE TABLE public.refused_$N (id int);');
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(
        /migration refused: 01:15:48 America\/Chicago is inside the nightly release schema freeze/
      );
      expect(r.stderr).toMatch(/Merge the change and let it install after 04:15 America\/Chicago/);
    }
    expect(psql("SELECT count(*) FROM pg_class WHERE relname LIKE 'refused_%'").stdout.trim()).toBe(
      '0'
    );
    ok(psql('CREATE TABLE public.drop_target (id int);'));
    const drop = governed(FREEZE, 'mgmt-api', 'DROP TABLE public.drop_target;');
    expect(drop.stderr).toMatch(/nightly release schema freeze/);
    expect(psql("SELECT to_regclass('public.drop_target') IS NOT NULL").stdout.trim()).toBe('t');
  });

  it("admits the installer's route: the 04:00 window and the 04:15 held sends", () => {
    ok(governed(FREEZE, 'apply-recorded-migration', 'CREATE TABLE public.applier_$N (id int);'));
    ok(governed(FREEZE, 'install-window-migrations', 'CREATE TABLE public.window_$N (id int);'));
    // 04:05 CST: inside the freeze, outside the hourly break.
    ok(
      governed(
        '2026-11-22 10:05:00+00',
        'apply-recorded-migration',
        'CREATE TABLE public.window_route_$N (id int);'
      )
    );
    ok(
      governed('2026-11-22 10:15:00+00', 'mgmt-api', 'CREATE TABLE public.after_thaw_$N (id int);')
    );
  });

  it('admits an outage named as a reason, once, and refuses a switch', () => {
    const before = Number(overrides());
    const sw = governed(
      FREEZE,
      'mgmt-api',
      "BEGIN; SET LOCAL ca.break_window_migration_override = 'on'; CREATE TABLE public.switch_$N (id int); COMMIT;"
    );
    expect(sw.stderr).toMatch(/is 'on', which is a switch, not a reason/);
    ok(
      governed(
        FREEZE,
        'mgmt-api',
        "BEGIN; SET LOCAL ca.break_window_migration_override = 'Nightly 20K winner unpaid: settlement guard times out'; CREATE TABLE public.outage_a_$N (id int); CREATE TABLE public.outage_b_$N (id int); COMMIT;"
      )
    );
    expect(Number(overrides())).toBe(before + 1);
    expect(
      psql(
        'SELECT reason FROM public.ca_break_window_migration_overrides ORDER BY id DESC LIMIT 1'
      ).stdout.trim()
    ).toBe('release freeze: Nightly 20K winner unpaid: settlement guard times out');
  });

  it('leaves outside the freeze, privileges, temp objects and superusers alone', () => {
    ok(governed(OUTSIDE, 'mgmt-api', 'CREATE TABLE public.outside_$N (id int);'));
    ok(
      governed(
        FREEZE,
        'mgmt-api',
        'GRANT SELECT ON public.ca_break_window_migration_overrides TO anon; REVOKE SELECT ON public.ca_break_window_migration_overrides FROM anon;'
      )
    );
    ok(governed(FREEZE, 'mgmt-api', 'CREATE TEMP TABLE scratch_$N (id int);'));
    ok(psql(`SET test.now = '${FREEZE}'; CREATE TABLE public.superuser_t (id int);`));
  });

  it('lets the break-window guard decide the hourly break exactly as before', () => {
    const r = governed(BREAK_IN_FREEZE, 'mgmt-api', 'CREATE TABLE public.break_$N (id int);');
    expect(r.stderr).toMatch(
      /migration refused: 06:52:00 UTC is inside the hourly maintenance break window \(:50-:03 UTC\)/
    );
    expect(r.stderr).not.toMatch(/release schema freeze/);
    const outside = governed(
      '2026-11-22 12:52:00+00',
      'mgmt-api',
      'CREATE TABLE public.break_out_$N (id int);'
    );
    expect(outside.stderr).toMatch(/hourly maintenance break window/);
    const before = Number(overrides());
    ok(
      governed(
        BREAK_IN_FREEZE,
        'mgmt-api',
        "BEGIN; SET LOCAL ca.break_window_migration_override = 'Lightning payouts stuck: refund function fails'; CREATE TABLE public.break_ok_$N (id int); COMMIT;"
      )
    );
    // One override, one row, written by the break-window guard (no prefix).
    expect(Number(overrides())).toBe(before + 1);
    expect(
      psql(
        'SELECT reason FROM public.ca_break_window_migration_overrides ORDER BY id DESC LIMIT 1'
      ).stdout.trim()
    ).toBe('Lightning payouts stuck: refund function fails');
  });
});
