/**
 * A MIGRATION PASSES PRODUCTION'S DDL GUARDS BEFORE IT MERGES
 * (2026-11-18, incident 075013fd): the native proof.
 *
 * Two merged pull requests passed every check and were refused at install by
 * guards that exist only on production:
 *   #11256  20261118034950  55000 migration_left_a_stale_pin (the applier's
 *           in-transaction guard): smarter_private.original_erased_cash_base_
 *           discharge pins b7911a24..., the fn_ca_tally_balance_move body the
 *           file rewrites. Re-landed with the pin declared (#11270).
 *   #11266  20261118071728  42501 from event trigger ab_ca_money_rpc_registered
 *           (fn_ca_money_rpc_registry_guard): fn_ca_bank_pending_hand_obligations
 *           writes balance columns and is not in ca_money_rpc_registry. Fixed
 *           by #11288 (the registry row above the CREATE FUNCTION).
 *
 * This rebuilds both merge moments on a real PostgreSQL, from production's own
 * text: the schemas the cash-rake / hand-bank harness builds
 * (scripts/ci/test-deadlock-lock-orders-r5.py), the functions those files
 * rewrite (scripts/ci/fixtures/cash-rake-pending and hand-bank-pending), and
 * production's money-RPC guard, classifier, registry rows and event trigger
 * (scripts/ci/fixtures/production-ddl-guards; every md5 asserted equal to
 * production's). A "production" database gets the guard armed and the pinning
 * function; the capture's read-only questions (migration-guards-capture.mjs)
 * are asked of it; and the CLI the workflow runs
 * (migration-guards-before-merge.mjs rehearse) then checks each file on a
 * "copy" that, like the schema-only archive, has the functions but neither
 * the event triggers nor the guards' rows.
 *
 * Both originals FAIL, reconstructed byte for byte; both fixed files PASS.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CAPTURES } from '../../scripts/ci/migration-guards-capture.mjs';
import {
  armSQL,
  classifyExact,
  loadCatalog,
  pinRehearsalSQL,
  staticPinFindings,
} from '../../scripts/ci/migration-guards-before-merge.mjs';

const ROOT = resolve(__dirname, '../..');
const MIG = join(ROOT, 'supabase/migrations');
const RAKE = '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql';
const RAKE_SWITCH = '20261118035606_a_cash_hand_never_waits_on_a_tournament_wallet_lock.sql';
const BANK = '20261118071728_a_hands_bbj_drop_and_insurance_wait_in_their_own_rows_not_on.sql';
const RAKE_RELANDED = readFileSync(join(MIG, RAKE), 'utf8');
const RAKE_ORIGINAL = RAKE_RELANDED.replace(
  /-- STALE PIN, DECLARED[\s\S]*?\n-- @stale-pin-ok:[^\n]*\n\n/,
  ''
);
/** #11288's change, byte for byte: the registry row above the CREATE FUNCTION. */
const BANK_FIX_BLOCK =
  "-- A function that can move money is registered before it exists\n-- (fn_ca_money_rpc_registry_guard). Production refused this file without it\n-- on 2026-11-18 13:30 UTC (42501); nothing installed.\nINSERT INTO public.ca_money_rpc_registry (proname, status, notes) VALUES\n  ('fn_ca_bank_pending_hand_obligations', 'approved',\n   'Incident 075013fd: banks a hand''s stored BBJ drop and insurance legs (hand_bank_obligation_pending) through the same bbj_record_contribution / record_insurance_transaction calls the envelope used to make, argument for argument. Engine-only (fn_caller_is_engine). Never waits on a shared row: try-lock on the union pool key and insurance-bank key, pool and wallet rows NOWAIT, 250 ms budget. Journaled by the callees; the pending row is deleted in the same transaction and the felt tally (zy_ca_tally_balance_move / zz_ca_balance_has_its_ledger_row) proves the movement. Inserts a bbj_pools row only where the envelope would have.');\n\n";
const CREATE_BANKER = 'CREATE FUNCTION public.fn_ca_bank_pending_hand_obligations(';
const bankOnMain = readFileSync(join(MIG, BANK), 'utf8');
/** #11266's merged file (main's until #11288 lands; main's without #11288's block after). */
const BANK_ORIGINAL = bankOnMain.replace(BANK_FIX_BLOCK, '');
/** #11288's head (182a8e64), or main's file once it has landed. */
const BANK_FIXED = bankOnMain.includes(BANK_FIX_BLOCK)
  ? bankOnMain
  : BANK_ORIGINAL.replace(CREATE_BANKER, BANK_FIX_BLOCK + CREATE_BANKER);
const TALLY_BEFORE = 'b7911a245d4bf33134a9a2f474c1f410';
const PINNER = 'smarter_private.original_erased_cash_base_discharge(bigint,text)';
const GUARDS = JSON.parse(
  readFileSync(
    join(ROOT, 'scripts/ci/fixtures/production-ddl-guards/live-definitions.json'),
    'utf8'
  )
);

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
const psqlArgv = (db: string) => [
  `${bin}/psql`,
  '-h',
  join(scratch, 's'),
  '-p',
  '5432',
  '-U',
  'postgres',
  '-d',
  db,
];

function psql(db: string, sql: string, extra: string[] = []) {
  const [cmd, ...args] = psqlArgv(db);
  const r = spawnSync(cmd, [...args, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...extra], {
    input: sql,
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: r.status ?? 1,
    out: (r.stdout ?? '') + (r.stderr ?? ''),
    stdout: r.stdout ?? '',
  };
}
const ok = (db: string, sql: string) => {
  const r = psql(db, sql, ['-A', '-t']);
  expect(r.status, r.out.slice(-2000)).toBe(0);
  return r.stdout.trim();
};
const TSV = ['-A', '-t', '-F', '\t'];

/** A schema string from the harness itself, with its f-string constants filled in. */
const harness = readFileSync(join(ROOT, 'scripts/ci/test-deadlock-lock-orders-r5.py'), 'utf8');
const constants = Object.fromEntries(
  [...harness.matchAll(/^([A-Z][A-Z0-9_]*) = '([^']*)'$/gm)].map((m) => [m[1], m[2]])
);
function fromHarness(name: string) {
  const m = new RegExp(`^${name} = (f?)"""([\\s\\S]*?)"""`, 'm').exec(harness);
  if (!m) throw new Error(`${name} not found in test-deadlock-lock-orders-r5.py`);
  if (!m[1]) return m[2];
  return m[2]
    .replace(/\{([A-Z][A-Z0-9_]*)\}/g, (_, k) => {
      if (!(k in constants)) throw new Error(`${name}: unknown constant ${k}`);
      return constants[k];
    })
    .replaceAll('{{', '{')
    .replaceAll('}}', '}');
}

function loadFunctions(db: string, fixture: string) {
  const fx = JSON.parse(
    readFileSync(join(ROOT, 'scripts/ci/fixtures', fixture, 'live-definitions.json'), 'utf8')
  );
  for (const f of Object.values<any>(fx.functions)) {
    ok(db, 'SET check_function_bodies = off;\n' + f.definition + ';');
    expect(
      ok(db, `SELECT md5(pg_get_functiondef('${f.signature}'::regprocedure))`),
      `${f.signature} is production's text`
    ).toBe(f.md5);
  }
}

/** Production's money-RPC guard, classifier and tables; rows and the event trigger only where production has them. */
function guards(db: string, production: boolean) {
  for (const t of Object.values<string>(GUARDS.tables)) ok(db, t + ';');
  for (const f of Object.values<any>(GUARDS.functions)) {
    ok(db, f.definition + ';');
    expect(
      ok(db, `SELECT md5(pg_get_functiondef('${f.signature}'::regprocedure))`),
      `${f.signature} is production's text`
    ).toBe(f.md5);
  }
  if (!production) return;
  for (const [n, s] of GUARDS.registry_rows)
    ok(db, `INSERT INTO public.ca_money_rpc_registry(proname, status) VALUES ('${n}', '${s}');`);
  for (const e of GUARDS.event_triggers)
    ok(
      db,
      `CREATE EVENT TRIGGER ${e.name} ON ${e.event} WHEN TAG IN (${e.tags.map((t: string) => `'${t}'`).join(', ')}) EXECUTE FUNCTION ${e.function.replace('()', '')}();`
    );
}

/** The cash-rake harness database, then (bank) the hand-bank one on top, as #11266 was written against. */
function build(db: string, { production, bank }: { production: boolean; bank: boolean }) {
  ok('postgres', `CREATE DATABASE ${db}`);
  ok(db, fromHarness('RAKE_SCHEMA'));
  loadFunctions(db, 'cash-rake-pending');
  ok(db, fromHarness('RAKE_TRIGGERS'));
  guards(db, production);
  // The pinning function: on "production" and on the copy alike (it is schema, and the archive carries it).
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
  if (!bank) return;
  ok(db, fromHarness('BANK_SCHEMA'));
  loadFunctions(db, 'hand-bank-pending');
  ok(db, fromHarness('BANK_TRIGGERS'));
  ok(
    db,
    `BEGIN;
SELECT set_config('app.ledger_category', 'mint', true), set_config('app.ledger_counterparty', 'system_mint', true);
UPDATE union_wallets SET insurance_wallet = 10 WHERE union_id = '${constants.RU}';
COMMIT;`
  );
  // #11256 is installed, as on production from 2026-11-18 (its pin declared).
  ok(db, RAKE_RELANDED);
  ok(db, readFileSync(join(MIG, RAKE_SWITCH), 'utf8'));
}

/** The capture job's read-only questions, asked of the "production" database. */
function capture(db: string, dir: string) {
  mkdirSync(dir, { recursive: true });
  for (const [sql, file] of Object.values(CAPTURES)) {
    const r = psql(db, sql, sql.startsWith('COPY') ? [] : TSV);
    expect(r.status, r.out).toBe(0);
    writeFileSync(join(dir, file), r.stdout);
  }
}

/** The workflow's check, run against a copy, for one file. */
function rehearse(copy: string, captureDir: string, name: string, sql: string) {
  const work = mkdtempSync(join(scratch, 'run-'));
  mkdirSync(join(work, 'mig'));
  writeFileSync(join(work, 'mig', name), sql);
  writeFileSync(join(work, 'installed.txt'), '');
  writeFileSync(join(work, 'changed.txt'), `supabase/migrations/${name}\n`);
  const r = spawnSync(
    process.execPath,
    [join(ROOT, 'scripts/ci/migration-guards-before-merge.mjs'), 'rehearse'],
    {
      encoding: 'utf8',
      env: {
        ...env,
        REHEARSAL_PSQL: psqlArgv(copy).join(' '),
        MIG_DIR: join(work, 'mig'),
        INSTALLED: join(work, 'installed.txt'),
        CHANGED: join(work, 'changed.txt'),
        CAPTURE_DIR: captureDir,
        EVIDENCE: join(work, 'evidence'),
        MIN_CAPTURED_FUNCTIONS: '1',
        GITHUB_STEP_SUMMARY: '',
      },
    }
  );
  return { status: r.status, summary: readFileSync(join(work, 'evidence', 'summary.md'), 'utf8') };
}

beforeAll(() => {
  if (!bin) throw new Error('PostgreSQL binaries are required for the DDL-guard pre-merge proof');
  scratch = mkdtempSync(join(tmpdir(), 'guards-premerge-'));
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
  ok('postgres', 'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;');
  build('rakeprod', { production: true, bank: false });
  capture('rakeprod', join(scratch, 'cap-rake'));
  build('bankprod', { production: true, bank: true });
  capture('bankprod', join(scratch, 'cap-bank'));
}, 300_000);

afterAll(() => {
  if (started)
    spawnSync(`${bin}/pg_ctl`, ['-D', join(scratch, 'd'), '-m', 'immediate', '-w', 'stop'], {
      env,
    });
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("#11256's original 20261118034950 is refused before merge by the applier's stale-pin guard", () => {
  it('the reconstructed original is byte for byte the file #11256 merged', () => {
    expect(createHash('md5').update(RAKE_ORIGINAL).digest('hex')).toBe(
      '64b1b59e893ec26624c77bed021d4d52'
    );
  });

  it("the capture sees the pin the way the applier's guard does", () => {
    const cap = join(scratch, 'cap-rake');
    const cat = loadCatalog(
      readFileSync(join(cap, 'guards-catalog.tsv'), 'utf8'),
      readFileSync(join(cap, 'guards-public.tsv'), 'utf8'),
      readFileSync(join(cap, 'guards-hex.tsv'), 'utf8')
    );
    expect(cat.pinnersOf(TALLY_BEFORE)).toEqual([PINNER]);
    expect(staticPinFindings(RAKE_ORIGINAL, cat).stale).toEqual([
      expect.objectContaining({
        signature: 'public.fn_ca_tally_balance_move()',
        md5: TALLY_BEFORE,
        pinner: PINNER,
      }),
    ]);
    expect(staticPinFindings(RAKE_RELANDED, cat).stale).toEqual([]);
  });

  it('the workflow check FAILS the original, naming the pinner, and installs nothing', () => {
    build('rakecopy1', { production: false, bank: false });
    const r = rehearse('rakecopy1', join(scratch, 'cap-rake'), RAKE, RAKE_ORIGINAL);
    expect(r.status, r.summary).toBe(1);
    expect(r.summary).toContain('**FAIL** (decided by the exact half)');
    expect(r.summary).toContain(
      `public.fn_ca_tally_balance_move() (old md5 ${TALLY_BEFORE}) is still pinned by ${PINNER}`
    );
    expect(ok('rakecopy1', "SELECT to_regclass('public.cash_rake_pending') IS NULL")).toBe('t');
  });

  it('the workflow check PASSES the re-landed file (#11270)', () => {
    build('rakecopy2', { production: false, bank: false });
    const r = rehearse('rakecopy2', join(scratch, 'cap-rake'), RAKE, RAKE_RELANDED);
    expect(r.status, r.summary).toBe(0);
    expect(r.summary).toContain('ok (decided by the exact half)');
  });
});

describe("#11266's original 20261118071728 is refused before merge by production's money-RPC registry guard", () => {
  it("the reconstructed files are #11266's merged bytes and #11288's head", () => {
    expect(createHash('md5').update(BANK_ORIGINAL).digest('hex')).toBe(
      'd85aab854b945f9095a26b4f9793db48'
    );
    expect(createHash('md5').update(BANK_FIXED).digest('hex')).toBe(
      '05761e575e41920cc7de82e07fc4e4ba'
    );
  });

  it("the capture carries production's event trigger and registry rows, and the copy is armed with them", () => {
    const cap = join(scratch, 'cap-bank');
    const triggers = readFileSync(join(cap, 'guards-event-triggers.tsv'), 'utf8');
    expect(triggers).toContain(
      'ab_ca_money_rpc_registered\tddl_command_end\tpublic.fn_ca_money_rpc_registry_guard()\tpublic\tCREATE FUNCTION'
    );
    const arm = armSQL(triggers, {
      'public.ca_money_rpc_registry': readFileSync(
        join(cap, 'guards-copy-ca_money_rpc_registry.txt'),
        'utf8'
      ),
    });
    expect(arm.armed.map((a) => a.name)).toEqual(['ab_ca_money_rpc_registered']);
    expect(readFileSync(join(cap, 'guards-copy-ca_money_rpc_registry.txt'), 'utf8')).toContain(
      'record_insurance_transaction'
    );
  });

  it('EXACT on "production" itself: the original is refused with 42501 by fn_ca_money_rpc_registry_guard', () => {
    ok('postgres', 'CREATE DATABASE bankexact TEMPLATE bankprod');
    const r = psql('bankexact', pinRehearsalSQL(BANK, BANK_ORIGINAL));
    const exact = classifyExact(r.status, r.out, ['public.fn_ca_money_rpc_registry_guard()']);
    expect(exact.outcome, r.out.slice(-1500)).toBe('guard-refused');
    expect(exact.guard).toBe('fn_ca_money_rpc_registry_guard');
    expect(exact.detail).toContain(
      'REFUSED: fn_ca_bank_pending_hand_obligations writes balance columns and is not in ca_money_rpc_registry'
    );
  });

  it('the workflow check FAILS the original on a copy that, like the archive, had no trigger and no registry rows', () => {
    build('bankcopy1', { production: false, bank: true });
    const r = rehearse('bankcopy1', join(scratch, 'cap-bank'), BANK, BANK_ORIGINAL);
    expect(r.status, r.summary).toBe(1);
    expect(r.summary).toContain('**FAIL** (decided by the exact half)');
    expect(r.summary).toContain('fn_ca_money_rpc_registry_guard');
    expect(r.summary).toContain(
      'fn_ca_bank_pending_hand_obligations writes balance columns and is not in ca_money_rpc_registry'
    );
    // The static half, which decides when a file cannot install on the copy, says the same.
    expect(r.summary).toContain(
      'guard: fn_ca_money_rpc_registry_guard (event trigger ab_ca_money_rpc_registered): fn_ca_bank_pending_hand_obligations writes balance columns'
    );
  });

  it("the workflow check PASSES #11288's fixed file", () => {
    build('bankcopy2', { production: false, bank: true });
    const r = rehearse('bankcopy2', join(scratch, 'cap-bank'), BANK, BANK_FIXED);
    expect(r.status, r.summary).toBe(0);
    expect(r.summary).toContain('ok (decided by the exact half)');
  });
});
