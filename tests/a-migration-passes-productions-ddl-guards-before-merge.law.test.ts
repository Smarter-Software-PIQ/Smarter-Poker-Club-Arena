/**
 * A MIGRATION PASSES PRODUCTION'S DDL GUARDS BEFORE IT MERGES
 * (2026-11-18, incident 075013fd).
 *
 * Two merged pull requests passed every check and were refused at install by
 * guards that run only on production:
 *   #11256 20261118034950: 55000 migration_left_a_stale_pin, the applier's
 *     in-transaction guard (smarter_private.original_erased_cash_base_discharge
 *     pins the fn_ca_tally_balance_move body the file rewrites). Revert #11260,
 *     re-land #11270.
 *   #11266 20261118071728: 42501 from event trigger ab_ca_money_rpc_registered
 *     (fn_ca_money_rpc_registry_guard): fn_ca_bank_pending_hand_obligations
 *     writes balance columns and is not in ca_money_rpc_registry. Fixed by
 *     #11288.
 *
 * The pull-request gate is the `guards` job of
 * window-migrations-install-before-merge.yml
 * (scripts/ci/migration-guards-before-merge.mjs): production's event
 * triggers and the rows they read are put back on the throwaway copy of
 * production's schema, and every changed migration is installed there through
 * the applier's own stale-pin guard; when a file cannot install on an empty
 * schema, production's own classifiers decide statically. This law pins its
 * shape and its static reading;
 * tests/unit/aMigrationPassesProductionsDdlGuardsBeforeMerge.pg.test.ts is the
 * native proof that both originals fail and both fixed files pass.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  identityArgs,
  instrumentProbesSQL,
  loadCatalog,
  pinRehearsalSQL,
  planGuardCheck,
  PRODUCTION_CONTROL_FIXTURES,
  REHEARSAL_PROBE_USER_ID,
  armSQL,
  classifyExact,
  functionBodies,
  registryInserts,
  seedProductionFixturesSQL,
  staticGuardFindings,
  NOT_REHEARSED,
  regprocedureKey,
  scanMigration,
  signatureKey,
  staticPinFindings,
  statementText,
  verdict,
} from '../scripts/ci/migration-guards-before-merge.mjs';
import {
  CAPTURES,
  CATALOG_SQL_CATALOG_PATH,
  CATALOG_SQL_PUBLIC_PATH,
  EVENT_TRIGGERS_SQL,
  GUARD_TABLES,
  PINS_SQL,
  PINS_SQL_PUBLIC_PATH,
} from '../scripts/ci/migration-guards-capture.mjs';

const ROOT = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8');
const NAME = '20261118034950_a_cash_hands_rake_waits_in_its_own_row_not_on_the_union_wall.sql';
const RELANDED = read(`supabase/migrations/${NAME}`);
const ORIGINAL = RELANDED.replace(
  /-- STALE PIN, DECLARED[\s\S]*?\n-- @stale-pin-ok:[^\n]*\n\n/,
  ''
);
const TALLY = 'public.fn_ca_tally_balance_move()';
const BEFORE = 'b7911a245d4bf33134a9a2f474c1f410';
const PINNER = 'smarter_private.original_erased_cash_base_discharge(bigint,text)';
const h = (c: string) => c.repeat(32);

/** Production as it stood when #11256 merged, reduced to what the check reads. */
function productionAtMerge(extraPins: string[] = []) {
  const catalog = [
    [1, TALLY, BEFORE],
    [2, 'public.fn_ca_supply_snapshot()', 'de5f2ec2b0897d91d12689288723b57f'],
    [3, PINNER, h('9')],
  ];
  return loadCatalog(
    catalog.map((r) => r.join('\t')).join('\n'),
    catalog.map(([oid]) => `${oid}\t${h('8')}`).join('\n'),
    [`${PINNER}\t${BEFORE}`, ...extraPins].join('\n')
  );
}

describe("a migration's pins are checked against production before it merges", () => {
  it("#11256's original 20261118034950 is refused by the static reading of production at merge", () => {
    const stat = staticPinFindings(ORIGINAL, productionAtMerge());
    expect(stat.stale).toEqual([
      expect.objectContaining({ signature: TALLY, md5: BEFORE, pinner: PINNER, verdict: 'stale' }),
    ]);
    expect(verdict({ outcome: 'not-installable' }, stat)).toMatchObject({
      fail: true,
      by: 'static',
    });
  });

  it("the re-landed file's -- @stale-pin-ok is honoured by the applier's own parser", () => {
    const stat = staticPinFindings(RELANDED, productionAtMerge());
    expect(stat.stale).toEqual([]);
    expect(stat.findings).toEqual([expect.objectContaining({ md5: BEFORE, verdict: 'allowed' })]);
  });

  it('a pin held by a function the same file changes counts as moved', () => {
    const sql = `BEGIN;\nCREATE OR REPLACE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 2 $$;\nCREATE OR REPLACE FUNCTION public.g() RETURNS int LANGUAGE plpgsql AS $b$ BEGIN RETURN 1; END $b$;\nCOMMIT;`;
    const cat = loadCatalog(
      `1\tpublic.f()\t${h('a')}\n2\tpublic.g()\t${h('b')}\n3\tpublic.h()\t${h('c')}`,
      `1\t${h('a')}\n2\t${h('b')}\n3\t${h('c')}`,
      `public.g()\t${h('a')}\npublic.h()\t${h('a')}0`
    );
    const stat = staticPinFindings(sql, cat);
    expect(stat.findings.map((f) => [f.pinner, f.verdict]).sort()).toEqual([
      ['public.g()', 'moved'],
      ['public.h()', 'stale'],
    ]);
  });

  it('the exact half governs: an install that passes passes, a guard refusal fails, and the static half decides only when it cannot install', () => {
    const stale = {
      stale: [{ signature: 'x', md5: h('a'), how: '', pinner: 'p', verdict: 'stale' }],
    } as any;
    expect(verdict({ outcome: 'installed' }, stale).fail).toBe(false);
    expect(
      verdict({ outcome: 'guard-refused', guard: 'g', detail: 'd' }, { stale: [] } as any).fail
    ).toBe(true);
    expect(
      verdict(
        { outcome: 'not-installable' },
        { stale: [] } as any,
        {
          findings: [{ guard: 'g', fn: 'f', reason: 'r' }],
        } as any
      ).fail
    ).toBe(true);
  });

  it('reads what a migration changes from statements, not from the bodies it installs', () => {
    const sql = `
-- CREATE OR REPLACE FUNCTION public.commented() ...
BEGIN;
CREATE OR REPLACE FUNCTION public.pinner(p_at timestamptz, VARIADIC p_ids int[] DEFAULT '{}', OUT r int)
LANGUAGE plpgsql AS $f$ BEGIN IF md5('x') = '${h('d')}' THEN NULL; END IF; END $f$;
ALTER FUNCTION public.a(text) SET search_path = pg_catalog;
ALTER FUNCTION public.b(text) OWNER TO postgres;
DROP FUNCTION IF EXISTS public.c(integer, character varying), smarter_private.d(bigint) CASCADE;
DO $$ BEGIN PERFORM pg_temp.ca_patch('public.e(uuid,timestamptz)'::regprocedure, '${h('e')}', ARRAY['a'], ARRAY['b']); END $$;
COMMIT;`;
    const scan = scanMigration(sql);
    expect(scan.definite.map((d) => `${d.how} ${d.key}`)).toEqual([
      'CREATE OR REPLACE public.pinner(timestamp with time zone,integer[])',
      'ALTER public.a(text)',
      'DROP public.c(integer,character varying)',
      'DROP smarter_private.d(bigint)',
      'pg_temp.ca_patch public.e(uuid,timestamp with time zone)',
    ]);
    expect(scan.preimages).toEqual([
      {
        key: 'public.e(uuid,timestamp with time zone)',
        md5: h('e'),
        how: 'pg_temp.ca_patch preimage',
      },
    ]);
    // the md5 inside the installed body is a pin, not a preimage
    expect(scan.md5Literals).toEqual([h('e')]);
    expect(statementText(sql)).not.toContain('commented');
  });

  it('keys signatures the way regprocedure prints them', () => {
    expect(
      identityArgs('p_club uuid, p_at timestamp with time zone DEFAULT now(), OUT x int')
    ).toEqual(['uuid', 'timestamp with time zone']);
    expect(signatureKey('fn', 'int4, bool, varchar(20), double precision')).toBe(
      'public.fn(integer,boolean,character varying,double precision)'
    );
    expect(regprocedureKey('smarter_private.f(public.thing,text[])')).toBe(
      'smarter_private.f(thing,text[])'
    );
  });

  it('checks only what the applier will run: uninstalled, not superseded, changed by the branch', () => {
    const f = (name: string, sql = 'BEGIN;\nSELECT 1;\nCOMMIT;\n') => ({ name, sql });
    const plan = planGuardCheck(
      [
        f('20261107000000_old.sql'),
        f('20261118000000_installed.sql'),
        f('20261118000001_mine.sql'),
        f('20261118000002_replaced.sql', '-- SUPERSEDED BY 20261118000001\nBEGIN;\nCOMMIT;\n'),
        f('20261118000003_main_pending.sql'),
      ],
      new Set(['20261118000000']),
      new Set([
        '20261107000000_old.sql',
        '20261118000000_installed.sql',
        '20261118000001_mine.sql',
        '20261118000002_replaced.sql',
      ])
    );
    // Production's event triggers fire on every file; only the stale-pin guard has a floor.
    expect(plan.checked).toEqual(['20261107000000_old.sql', '20261118000001_mine.sql']);
    expect(plan.skipped.map((s) => s.name)).toEqual([
      '20261118000000_installed.sql',
      '20261118000002_replaced.sql',
    ]);
    expect(plan.prerequisites).toEqual(['20261118000003_main_pending.sql']);
  });

  it("the exact half is the applier's own guard, spliced the applier's way", () => {
    const sql = pinRehearsalSQL(NAME, ORIGINAL);
    expect(sql.indexOf('$ca_stale_pin_snapshot$')).toBeGreaterThan(sql.indexOf('BEGIN;'));
    expect(sql.indexOf('$ca_stale_pin_check$')).toBeLessThan(sql.lastIndexOf('COMMIT;'));
    expect(sql).toContain('migration_left_a_stale_pin');
  });

  it("the capture's questions are read-only and ask every schema for pins, as the guard does", () => {
    for (const q of [
      CATALOG_SQL_CATALOG_PATH,
      CATALOG_SQL_PUBLIC_PATH,
      PINS_SQL,
      EVENT_TRIGGERS_SQL,
    ])
      expect(q).not.toMatch(/\b(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT)\b/i);
    expect(CATALOG_SQL_CATALOG_PATH).toContain('SET search_path = pg_catalog');
    expect(CATALOG_SQL_PUBLIC_PATH).toContain('SET search_path = public');
    // Only (pinner, current md5) pairs leave production: the public repository
    // publishes this run's artifacts (security review 2026-11-18).
    for (const q of [PINS_SQL, PINS_SQL_PUBLIC_PATH]) {
      expect(q).toMatch(
        /SELECT DISTINCT [^\n]+, cur\.m\n\s+FROM runs JOIN cur ON runs\.run = cur\.m/
      );
      expect(q).not.toMatch(/SELECT DISTINCT[^\n]*runs\.run/);
      expect(q).toContain("n.nspname IN ('public', 'smarter_private')");
    }
    expect(PINS_SQL_PUBLIC_PATH).toContain('SET search_path = public');
    expect(GUARD_TABLES).toEqual([
      'public.ca_money_rpc_registry',
      'smarter_private.function_body_lineage',
    ]);
    for (const t of GUARD_TABLES)
      expect(Object.values(CAPTURES).map(([q]) => q)).toContain(`COPY ${t} TO STDOUT;`);
  });

  it("re-creates every production event trigger on the copy except the wall-clock guard and Supabase's own", () => {
    const tsv = [
      'ab_ca_money_rpc_registered\tddl_command_end\tpublic.fn_ca_money_rpc_registry_guard()\tpublic\tCREATE FUNCTION',
      'ca_break_window_refuses_ddl\tddl_command_end\tpublic.fn_ca_break_window_ddl_guard()\tpublic\t',
      'ca_superseded_function_body_is_refused\tddl_command_end\tsmarter_private.fn_ca_function_lineage_on_create()\tsmarter_private\tCREATE FUNCTION|CREATE PROCEDURE',
      'pgrst_ddl_watch\tddl_command_end\textensions.pgrst_ddl_watch()\textensions\t',
    ].join('\n');
    const arm = armSQL(tsv, {
      'public.ca_money_rpc_registry': 'fn_x\tapproved\t\\N\t2026-11-18\n',
    });
    expect(arm.armed.map((a) => a.name)).toEqual([
      'ab_ca_money_rpc_registered',
      'ca_superseded_function_body_is_refused',
    ]);
    expect(arm.skipped.map((a) => a.name)).toEqual([
      'ca_break_window_refuses_ddl',
      'pgrst_ddl_watch',
    ]);
    expect(Object.keys(NOT_REHEARSED)).toEqual([
      'ca_break_window_refuses_ddl',
      'ca_break_window_refuses_drops',
      'ca_live_tables_refuse_manual_ddl',
      'ca_live_tables_refuse_manual_ddl_held',
    ]);
    expect(arm.triggerSql).toContain(
      "CREATE EVENT TRIGGER ca_superseded_function_body_is_refused ON ddl_command_end WHEN TAG IN ('CREATE FUNCTION', 'CREATE PROCEDURE') EXECUTE FUNCTION smarter_private.fn_ca_function_lineage_on_create();"
    );
    expect(arm.loadSql).toContain('COPY public.ca_money_rpc_registry FROM STDIN;\nfn_x\tapproved');
    expect(() => armSQL('x; DROP\tddl_command_end\tpublic.f()\tpublic\t', {})).toThrow(/malformed/);
  });

  it("a refusal is a guard's only when a refusing guard RAISEd it, never a logging trigger's error", () => {
    const logger =
      'ERROR:  permission denied for table ca_ddl_events\nCONTEXT:  SQL statement "INSERT INTO public.ca_ddl_events"\nPL/pgSQL function ca_log_ddl_event() line 8 at SQL statement\n';
    expect(classifyExact(3, logger, ['public.ca_log_ddl_event()']).outcome).toBe('not-installable');
    const rls =
      'ERROR:  x\nCONTEXT:  PL/pgSQL function fn_rls_on_new_public_table() line 3 at RAISE\n';
    expect(classifyExact(3, rls, ['public.fn_rls_on_new_public_table()']).outcome).toBe(
      'not-installable'
    );
    const unarmed =
      'ERROR:  y\nCONTEXT:  PL/pgSQL function fn_ca_money_rpc_registry_guard() line 27 at RAISE\n';
    expect(classifyExact(3, unarmed, []).outcome).toBe('not-installable');
    const commit =
      'ERROR:  migration refused: f calls a function that does not exist\nCONTEXT:  PL/pgSQL function smarter_private.fn_ca_function_calls_must_resolve() line 40 at RAISE\n';
    expect(classifyExact(3, commit, [])).toMatchObject({
      outcome: 'guard-refused',
      guard: 'fn_ca_function_calls_must_resolve',
    });
  });

  it("a refusal is a guard's when psql's CONTEXT names an armed guard function", () => {
    const out =
      'ERROR:  REFUSED: fn_x writes balance columns and is not in ca_money_rpc_registry\nCONTEXT:  PL/pgSQL function fn_ca_money_rpc_registry_guard() line 27 at RAISE\n';
    expect(classifyExact(3, out, ['public.fn_ca_money_rpc_registry_guard()'])).toMatchObject({
      outcome: 'guard-refused',
      guard: 'fn_ca_money_rpc_registry_guard',
    });
    expect(
      classifyExact(3, 'ERROR:  relation "public.x" does not exist\n', [
        'public.fn_ca_money_rpc_registry_guard()',
      ]).outcome
    ).toBe('not-installable');
    expect(
      classifyExact(
        3,
        'ERROR:  migration_left_a_stale_pin: f() (old md5 x) is still pinned by g()\n'
      ).outcome
    ).toBe('guard-refused');
  });

  it('reads the bodies a file creates and where it registers them, as the money-RPC guard needs', () => {
    const sql = `BEGIN;
CREATE FUNCTION public.pay(p uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$ BEGIN UPDATE club_wallets SET chip_balance = 1; END $fn$;
INSERT INTO public.ca_money_rpc_registry (proname, status, notes) VALUES ('pay', 'approved', 'x'), ('other', 'system', 'y');
CREATE OR REPLACE FUNCTION public.later() RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
COMMIT;`;
    const fns = functionBodies(sql);
    expect(fns.map((f) => [f.kind, f.key])).toEqual([
      ['FUNCTION', 'public.pay(uuid)'],
      ['FUNCTION', 'public.later()'],
    ]);
    expect(fns[0].body).toBe(' BEGIN UPDATE club_wallets SET chip_balance = 1; END ');
    expect(registryInserts(sql).map((r) => r.proname)).toEqual(['pay', 'other']);
    // The classifier said "writes balances" for pay; the row comes AFTER its CREATE: refused, as production refuses.
    const found = staticGuardFindings(sql, fns, '0\ttrue\tfalse\tfalse\n1\tfalse\tfalse\tfalse\n');
    expect(found.findings).toEqual([
      expect.objectContaining({
        fn: 'public.pay(uuid)',
        reason: expect.stringContaining('only AFTER its CREATE FUNCTION'),
      }),
    ]);
    // Registered first, or already registered on production: passes.
    const first = sql
      .replace(/INSERT INTO[^;]*;\n/, '')
      .replace(
        'BEGIN;\n',
        "BEGIN;\nINSERT INTO public.ca_money_rpc_registry (proname, status) VALUES ('pay', 'approved');\n"
      );
    expect(
      staticGuardFindings(
        first,
        functionBodies(first),
        '0\ttrue\tfalse\tfalse\n1\tfalse\tfalse\tfalse\n'
      ).findings
    ).toEqual([]);
    expect(
      staticGuardFindings(sql, fns, '0\ttrue\ttrue\tfalse\n1\tfalse\tfalse\tfalse\n').findings
    ).toEqual([]);
    // A body production recorded as superseded is refused unless the file allows the rollback.
    expect(
      staticGuardFindings(sql, fns, '0\tfalse\tfalse\tfalse\n1\tfalse\tfalse\ttrue\n').findings[0]
        .guard
    ).toContain('fn_ca_function_lineage_on_create');
    const allowed = sql.replace(
      'BEGIN;',
      "BEGIN;\nSET LOCAL ca.allow_function_rollback = 'public.later';"
    );
    expect(
      staticGuardFindings(
        allowed,
        functionBodies(allowed),
        '0\tfalse\tfalse\tfalse\n1\tfalse\tfalse\ttrue\n'
      ).findings
    ).toEqual([]);
  });

  it('runs on every same-repository pull request: credentials only in the default-branch capture, the branch SQL only in a secretless job', () => {
    const wf = parse(
      read('.github/workflows/window-migrations-install-before-merge.yml')
    ) as Record<string, any>;
    expect(Object.keys(wf.on)).toEqual(['pull_request_target']);
    const { capture, 'capture-guards': cg, rehearse, guards: pins } = wf.jobs;
    // What the guards read is captured in its own job: its failure makes only
    // `guards` UNKNOWN and never fails `rehearse`.
    expect(rehearse.needs).toEqual(['scope', 'capture']);
    expect(JSON.stringify(capture)).not.toContain('migration-guards-capture');
    expect(cg.environment).toBe('ci-main');
    const step = cg.steps.find((s: any) => /DDL guards read/.test(s.name ?? ''));
    expect(step.env).toEqual({ DATABASE_URL: '${{ secrets.DATABASE_URL }}' });
    expect(step.run).toContain('default_transaction_read_only=on');
    expect(step.run).toContain('node scripts/ci/migration-guards-capture.mjs');
    expect(cg.steps[0].with.ref).toBe('${{ github.event.repository.default_branch }}');
    expect(cg.steps[0].with['sparse-checkout']).toContain(
      'scripts/ci/migration-guards-capture.mjs'
    );
    expect(JSON.stringify(cg)).not.toContain('head.sha');
    // Artifacts by exact name: window-rehearsal-* matches the evidence artifact.
    for (const job of [rehearse, pins])
      for (const st of job.steps.filter((x: any) =>
        String(x.uses ?? '').startsWith('actions/download-artifact')
      )) {
        expect(st.with.pattern).toBeUndefined();
        expect(st.with.name).toMatch(
          /^(window-rehearsal-schema|window-rehearsal-changed|ddl-guards-capture)$/
        );
      }
    expect(JSON.stringify(capture)).not.toContain('head.sha');
    expect(pins.name).toBe("Production's DDL guards pass before merge");
    expect(pins.environment).toBeUndefined();
    expect(JSON.stringify(pins)).not.toContain('secrets.');
    expect(pins.permissions).toEqual({ contents: 'read' });
    expect(pins.needs).toEqual(['scope', 'capture', 'capture-guards']);
    // An unreadable capture is UNKNOWN, never a pass.
    expect(JSON.stringify(pins)).toContain("needs.capture-guards.result != 'success'");
    expect(JSON.stringify(pins)).toContain(
      'node scripts/ci/migration-guards-before-merge.mjs rehearse'
    );
    const checkout = pins.steps.find((s: any) =>
      String(s.uses ?? '').startsWith('actions/checkout')
    );
    expect(checkout.with.ref).toBe('${{ github.event.repository.default_branch }}');
  });

  it('the rehearsal copy is reached as supabase_admin with its password, and a refused copy says why', () => {
    const sh = read('scripts/ci/restore-schema-for-rehearsal.sh');
    expect(sh).toContain('psql_db() { docker exec -i -e PGPASSWORD="$REHEARSAL_DB_PASSWORD"');
    expect(sh).toContain('-e POSTGRES_PASSWORD="$REHEARSAL_DB_PASSWORD"');
    expect(sh).not.toMatch(/-U supabase_admin[^\n]*2>\/dev\/null/);
    expect(sh).toContain('last answer: ${answer:-}');
    expect(sh).toContain('max_locks_per_transaction=1024');
    expect(sh).toContain('rehearsal-auth-schema.sql');
    for (const line of sh.split('\n').filter((l) => /docker exec[^\n]*-U supabase_admin/.test(l)))
      expect(line).toContain('PGPASSWORD');
    // The standby keeps its own definition on the Backup host.
    expect(read('server/standby/standby-engine.sh')).toContain(
      'psql_db() { docker exec -i "$DB_CONTAINER" psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres "$@"; }'
    );
  });

  it("the gate's own tooling is tested on production's schema by its branch, with no secret", () => {
    const wf = parse(read('.github/workflows/ddl-guards-self-test.yml')) as Record<string, any>;
    expect(Object.keys(wf.on)).toEqual(['pull_request', 'push']);
    expect(wf.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(JSON.stringify(wf)).not.toContain('secrets.');
    for (const job of Object.values<any>(wf.jobs)) expect(job.environment).toBeUndefined();
    expect(wf.jobs.locate.steps[0].run).toContain('event=pull_request_target');
    expect(wf.jobs.guards.strategy.matrix.case).toEqual([
      'rake-relanded',
      'bank-original',
      'bank-fixed',
      'money-unregistered',
      'money-registered',
    ]);
    for (const p of [
      'scripts/ci/restore-schema-for-rehearsal.sh',
      'scripts/ci/fixtures/production-ddl-guards/**',
      '.github/workflows/window-migrations-install-before-merge.yml',
    ])
      expect(wf.on.pull_request.paths).toContain(p);
  });

  it('seeds minimal idempotent production-like control fixtures and fails broken $probe$ blocks before merge', () => {
    expect(PRODUCTION_CONTROL_FIXTURES).toEqual([
      'public.ca_promo_play_through_settings',
      'public.ca_mtt_admission_contract',
      'public.profiles',
    ]);
    const seedSql = seedProductionFixturesSQL();
    expect(seedSql).toContain('SET session_replication_role = replica;');
    expect(seedSql).toContain('SET session_replication_role = origin;');
    expect(seedSql).toContain("to_regclass('public.ca_promo_play_through_settings') IS NOT NULL");
    expect(seedSql).toContain('enforced_from');
    expect(seedSql).toContain("to_regclass('public.ca_mtt_admission_contract') IS NOT NULL");
    expect(seedSql).toContain("'unlimited-mtt-v2'");
    expect(seedSql).toContain("to_regclass('public.profiles') IS NOT NULL");
    expect(seedSql).toContain(REHEARSAL_PROBE_USER_ID);
    expect(seedSql).toContain('ON CONFLICT');

    // Migrations without -- @probe-for: pass through instrumentProbesSQL untouched.
    const plain = 'BEGIN;\nSELECT 1;\nCOMMIT;\n';
    expect(instrumentProbesSQL(plain)).toBe(plain);

    // Migrations with -- @probe-for: get enter/exit markers bracketing each DO block.
    const withProbe = [
      'BEGIN;',
      '-- @probe-for: public.fn_example',
      'DO $probe$',
      'BEGIN',
      "  RAISE EXCEPTION 'probe-unwind';",
      'EXCEPTION WHEN raise_exception THEN',
      "  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;",
      'END $probe$;',
      'COMMIT;',
    ].join('\n');
    const instrumented = instrumentProbesSQL(withProbe);
    expect(instrumented).toContain('CA_REHEARSAL_PROBE_ENTER:public.fn_example');
    expect(instrumented).toContain('CA_REHEARSAL_PROBE_EXIT:public.fn_example');
    expect(instrumented.indexOf('CA_REHEARSAL_PROBE_ENTER:public.fn_example')).toBeLessThan(
      instrumented.indexOf('DO $probe$')
    );
    expect(instrumented.indexOf('CA_REHEARSAL_PROBE_EXIT:public.fn_example')).toBeGreaterThan(
      instrumented.indexOf('END $probe$;')
    );

    // A failure inside an entered $probe$ (no matching EXIT) is classified as probe-failed and fails verdict.
    const failedProbeOut = [
      'NOTICE:  CA_REHEARSAL_PROBE_ENTER:public.fn_ca_promo_roll_event_principal',
      'ERROR:  query returned no rows',
      'CONTEXT:  PL/pgSQL function inline_code_block line 4 at PERFORM',
    ].join('\n');
    const probeRes = classifyExact(3, failedProbeOut, []);
    expect(probeRes).toEqual({
      outcome: 'probe-failed',
      guard: 'migration function probe ($probe$)',
      probe: 'public.fn_ca_promo_roll_event_principal',
      detail: 'query returned no rows',
    });
    expect(verdict(probeRes, { stale: [] } as any)).toMatchObject({
      fail: true,
      by: 'exact',
      reason: expect.stringContaining('public.fn_ca_promo_roll_event_principal'),
    });

    // A failure AFTER a probe exited is NOT misclassified as probe-failed.
    const afterProbeOut = [
      'NOTICE:  CA_REHEARSAL_PROBE_ENTER:public.fn_example',
      'NOTICE:  CA_REHEARSAL_PROBE_EXIT:public.fn_example',
      'ERROR:  some_unrelated_postcheck_on_empty_table',
    ].join('\n');
    expect(classifyExact(3, afterProbeOut, []).outcome).toBe('not-installable');
  });
});
