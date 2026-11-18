/**
 * A MIGRATION'S PINS ARE CHECKED AGAINST PRODUCTION BEFORE IT MERGES
 * (2026-11-18, incident 075013fd): the native proof.
 *
 * #11256's 20261118034950 merged green and production's applier refused it
 * with 55000 migration_left_a_stale_pin: the installed
 * smarter_private.original_erased_cash_base_discharge(bigint,text) pins
 * b7911a24..., the body of fn_ca_tally_balance_move that the file rewrites.
 * #11270 re-landed it with that pin declared (-- @stale-pin-ok), so today's
 * production can no longer show the refusal. This rebuilds the moment of the
 * merge on a real PostgreSQL:
 *
 *   - the schema the cash-rake harness already builds
 *     (scripts/ci/test-deadlock-lock-orders-r5.py, RAKE_SCHEMA), and every
 *     function it reads in production's own text as read on 2026-11-18
 *     (scripts/ci/fixtures/cash-rake-pending/live-definitions.json; each md5
 *     is asserted equal to production's);
 *   - a pinning function in smarter_private that holds b7911a24..., as the
 *     real one does.
 *
 * Then it asks the capture's read-only questions of that database
 * (migration-pins-capture.mjs, the SQL the workflow sends to production) and
 * runs both halves of migration-pins-before-merge.mjs on #11256's ORIGINAL
 * file, reconstructed byte for byte from main's (md5 64b1b59e... is the blob
 * at f5d1ec06cb), and on the re-landed file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  CATALOG_SQL_CATALOG_PATH,
  CATALOG_SQL_PUBLIC_PATH,
  PINS_SQL,
} from '../../scripts/ci/migration-pins-capture.mjs';
import {
  classifyExact,
  loadCatalog,
  pinRehearsalSQL,
  staticPinFindings,
  verdict,
} from '../../scripts/ci/migration-pins-before-merge.mjs';

const ROOT = resolve(__dirname, '../..');
const NAME = '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql';
const RELANDED = readFileSync(join(ROOT, 'supabase/migrations', NAME), 'utf8');
const ORIGINAL = RELANDED.replace(
  /-- STALE PIN, DECLARED[\s\S]*?\n-- @stale-pin-ok:[^\n]*\n\n/,
  ''
);
const TALLY_BEFORE = 'b7911a245d4bf33134a9a2f474c1f410';
const PINNER = 'smarter_private.original_erased_cash_base_discharge(bigint,text)';

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

function psql(db: string, sql: string, extra: string[] = []) {
  const r = spawnSync(
    `${bin}/psql`,
    [
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      join(scratch, 's'),
      '-p',
      '5432',
      '-U',
      'postgres',
      '-d',
      db,
      ...extra,
    ],
    { input: sql, encoding: 'utf8', env }
  );
  return {
    status: r.status ?? 1,
    out: (r.stdout ?? '') + (r.stderr ?? ''),
    stdout: r.stdout ?? '',
  };
}
const ok = (db: string, sql: string) => {
  const r = psql(db, sql, ['-A', '-t']);
  expect(r.status, r.out).toBe(0);
  return r.stdout.trim();
};
const TSV = ['-A', '-t', '-F', '\t'];

/** The cash-rake harness's schema, taken from the harness itself so the two cannot drift. */
function rakeSchema() {
  const py = readFileSync(join(ROOT, 'scripts/ci/test-deadlock-lock-orders-r5.py'), 'utf8');
  const body = /RAKE_SCHEMA = f"""([\s\S]*?)"""/.exec(py)?.[1];
  if (!body) throw new Error('RAKE_SCHEMA not found in test-deadlock-lock-orders-r5.py');
  const vars = Object.fromEntries(
    [...py.matchAll(/^(RU|RC|RT1|RT2) = '([^']+)'/gm)].map((m) => [m[1], m[2]])
  );
  return body
    .replace(/\{(RU|RC|RT1|RT2)\}/g, (_, k) => vars[k])
    .replaceAll('{{', '{')
    .replaceAll('}}', '}');
}

function seed(db: string, withPinner: boolean) {
  ok('postgres', `CREATE DATABASE ${db}`);
  ok(db, rakeSchema());
  const fixture = JSON.parse(
    readFileSync(join(ROOT, 'scripts/ci/fixtures/cash-rake-pending/live-definitions.json'), 'utf8')
  );
  for (const f of Object.values<any>(fixture.functions)) {
    ok(db, 'SET check_function_bodies = off;\n' + f.definition + ';');
    expect(
      ok(db, `SELECT md5(pg_get_functiondef('${f.signature}'::regprocedure))`),
      `${f.signature} is production's text`
    ).toBe(f.md5);
  }
  if (withPinner)
    ok(
      db,
      `CREATE FUNCTION ${PINNER.replace('(bigint,text)', '(p_week bigint, p_source text)')}
 RETURNS boolean LANGUAGE plpgsql SET search_path TO 'pg_catalog' AS $f$
BEGIN
  IF md5(pg_get_functiondef('public.fn_ca_tally_balance_move()'::regprocedure)) IS DISTINCT FROM '${TALLY_BEFORE}' THEN
    RAISE EXCEPTION 'original_cash_discharge_money_source_changed';
  END IF;
  RETURN true;
END $f$;`
    );
}

/** What the capture job reads from production, asked of this database. */
function capture(db: string) {
  const a = psql(db, CATALOG_SQL_CATALOG_PATH, TSV);
  const b = psql(db, CATALOG_SQL_PUBLIC_PATH, TSV);
  const c = psql(db, PINS_SQL, TSV);
  for (const r of [a, b, c]) expect(r.status, r.out).toBe(0);
  return loadCatalog(a.stdout, b.stdout, c.stdout);
}

beforeAll(() => {
  if (!bin) throw new Error('PostgreSQL binaries are required for the pin pre-merge proof');
  scratch = mkdtempSync(join(tmpdir(), 'pins-premerge-'));
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
  ok('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  seed('pinned', true);
  seed('unpinned', false);
}, 120_000);

afterAll(() => {
  if (started)
    spawnSync(`${bin}/pg_ctl`, ['-D', join(scratch, 'd'), '-m', 'immediate', '-w', 'stop'], {
      env,
    });
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("#11256's original 20261118034950 fails before merge when its tally pin exists", () => {
  it('the reconstructed original is byte for byte the file #11256 merged', () => {
    expect(createHash('md5').update(ORIGINAL).digest('hex')).toBe(
      '64b1b59e893ec26624c77bed021d4d52'
    );
    expect(ORIGINAL).not.toContain('@stale-pin-ok');
  });

  it("the capture sees the pin the way the applier's guard does", () => {
    const cat = capture('pinned');
    expect(cat.pinnersOf(TALLY_BEFORE)).toEqual([PINNER]);
    const tally = cat.byKey.get('public.fn_ca_tally_balance_move()')!;
    expect(tally[0].catalogMd5).toBe(TALLY_BEFORE);
  });

  it("EXACT: the applier's own guard refuses the original with 55000, naming the pinner, and installs nothing", () => {
    const r = psql('pinned', pinRehearsalSQL(NAME, ORIGINAL));
    const exact = classifyExact(r.status, r.out);
    expect(exact.outcome, r.out).toBe('stale-pin');
    expect(exact.detail).toContain(
      `public.fn_ca_tally_balance_move() (old md5 ${TALLY_BEFORE}) is still pinned by ${PINNER}`
    );
    expect(ok('pinned', "SELECT to_regclass('public.cash_rake_pending') IS NULL")).toBe('t');
    expect(
      ok(
        'pinned',
        "SELECT md5(pg_get_functiondef('public.fn_ca_tally_balance_move()'::regprocedure))"
      )
    ).toBe(TALLY_BEFORE);
  });

  it('STATIC: the same refusal from the file and the captured catalog alone', () => {
    const stat = staticPinFindings(ORIGINAL, capture('pinned'));
    expect(stat.stale).toHaveLength(1);
    expect(stat.stale[0]).toMatchObject({
      signature: 'public.fn_ca_tally_balance_move()',
      md5: TALLY_BEFORE,
      pinner: PINNER,
    });
    expect(stat.changed.map((c) => c.signature)).toEqual(
      expect.arrayContaining([
        'public.fn_ca_tally_balance_move()',
        'public.fn_ca_supply_snapshot()',
        'public.fn_ca_account_balance(text,uuid,uuid,text)',
        'public.fn_rake_bbj_invariants(integer)',
        'public.fn_project_hand_side_effects(uuid)',
        'public.trg_finish_hand_post_commit_obligations()',
      ])
    );
    expect(verdict({ outcome: 'not-installable' }, stat).fail).toBe(true);
  });

  it('the re-landed file (#11270) declares the pin: both halves pass and it installs', () => {
    expect(staticPinFindings(RELANDED, capture('pinned')).stale).toEqual([]);
    const r = psql('pinned', pinRehearsalSQL(NAME, RELANDED));
    expect(classifyExact(r.status, r.out).outcome, r.out).toBe('installed');
    expect(
      ok(
        'pinned',
        "SELECT md5(pg_get_functiondef('public.fn_ca_tally_balance_move()'::regprocedure))"
      )
    ).toBe('c8c24d5a2c098d3189127e9e870601a3');
  });

  it('with no pinning function the original installs: the check refuses pins, not migrations', () => {
    expect(staticPinFindings(ORIGINAL, capture('unpinned')).stale).toEqual([]);
    const r = psql('unpinned', pinRehearsalSQL(NAME, ORIGINAL));
    expect(classifyExact(r.status, r.out).outcome, r.out).toBe('installed');
  });
});
