/**
 * A MIGRATION THAT CANNOT FINISH INSIDE THE INSTALL BUDGET DOES NOT MERGE
 * (2026-11-07). See scripts/ci/migration-cost-shape.mjs.
 *
 * Three merged migrations died on 2026-11-07 inside the applier's 12 s
 * transaction budget with nothing committed. Two of them read chip_ledger by a
 * LIKE prefix on idempotency_key, which no index answers. This pins that the
 * merge check refuses the pattern from COST_CHECKED_FROM on, that the applier
 * asks the same question, and that the exact bytes that failed are caught.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  CORRELATED_HOT_SUBQUERY_CHECKED_FROM,
  COST_CHECKED_FROM,
  STATEMENT_TIMEOUT_CHECKED_FROM,
  isCostChecked,
  migrationCostRisks,
} from '../../scripts/ci/migration-cost-shape.mjs';
import { migrationFiles, migrationNames } from '../helpers/migrationCorpus';

const ROOT = resolve(__dirname, '../..');

describe('a migration fits the install budget', () => {
  it('every migration from the cut-over on is free of the known budget killers', () => {
    // Every cost-checked file, read concurrently in one pass (tests/helpers/migrationCorpus.ts).
    const files = migrationFiles(migrationNames().filter(isCostChecked));
    expect(files.length).toBeGreaterThan(600);
    for (const { name, sql } of files) expect(migrationCostRisks(name, sql), name).toEqual([]);
  });

  it('catches the exact merged bytes that died in production on 2026-11-07', () => {
    for (const [file, rev] of [
      ['20261107133350_the_weekly_close_is_evidence_not_cache.sql', '978c425bef'],
    ] as const) {
      let sql = '';
      try {
        sql = execFileSync('git', ['show', `${rev}:supabase/migrations/${file}`], {
          cwd: ROOT,
          encoding: 'utf8',
        });
      } catch {
        // A shallow checkout may not hold the commit; the synthetic cases below still pin the rule.
        continue;
      }
      expect(migrationCostRisks(file, sql).length, file).toBeGreaterThan(0);
    }
  });

  it('refuses a LIKE prefix on chip_ledger.idempotency_key in code', () => {
    const sql =
      "BEGIN;\nDO $$ BEGIN\n  IF (SELECT count(*) FROM public.chip_ledger l\n       WHERE l.idempotency_key LIKE 'bounty-only-final-two-make-good:%') <> 6 THEN RAISE EXCEPTION 'x'; END IF;\nEND $$;\nCOMMIT;\n";
    expect(migrationCostRisks('x.sql', sql)).toHaveLength(1);
    const built =
      "BEGIN;\nSELECT jsonb_object_agg(to_entity_id::text,1) FROM public.chip_ledger WHERE idempotency_key LIKE 'union_close:'||c_sid||':%';\nCOMMIT;\n";
    expect(migrationCostRisks('x.sql', built)).toHaveLength(1);
  });

  it('refuses the same scan in a live-proof, which production also runs', () => {
    const sql =
      "-- @live-proof: (SELECT count(*) FROM public.chip_ledger WHERE idempotency_key LIKE 'k:%') = 6\nBEGIN;\nSELECT 1;\nCOMMIT;\n";
    expect(migrationCostRisks('x.sql', sql)).toHaveLength(1);
  });

  it('accepts named keys, and LIKE on other tables or in comments', () => {
    const ok = [
      "BEGIN;\nSELECT count(*) FROM public.chip_ledger WHERE idempotency_key = ANY (ARRAY['a','b']);\nCOMMIT;\n",
      "BEGIN;\nSELECT count(*) FROM public.chip_ledger WHERE idempotency_key = 'a';\nCOMMIT;\n",
      "BEGIN;\nSELECT count(*) FROM public.ca_manual_adjustments WHERE decision_note LIKE 'migration 2026%';\nCOMMIT;\n",
      "BEGIN;\n-- chip_ledger WHERE idempotency_key LIKE 'k:%' was the old way\nSELECT 1;\nCOMMIT;\n",
      "BEGIN;\nSELECT 1 FROM public.wallet_credit_idempotency WHERE idempotency_key LIKE 'k:%';\nSELECT 1 FROM public.chip_ledger WHERE id = 'x';\nCOMMIT;\n",
    ];
    for (const sql of ok) expect(migrationCostRisks('x.sql', sql), sql).toEqual([]);
  });

  it('refuses an install-time call of a function measured past the budget (2026-11-19, run 44503916790)', () => {
    // The exact probe 20261119083000 merged with: 238-264 s per call on production.
    const refused =
      "BEGIN;\n-- @probe-for: public.fn_sp_daily_metrics_compute\nDO $probe$\nBEGIN\n  PERFORM public.fn_sp_daily_metrics_compute(DATE '2099-01-01');\n  RAISE EXCEPTION 'probe-unwind';\nEXCEPTION WHEN raise_exception THEN\n  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;\nEND $probe$;\nCOMMIT;\n";
    expect(migrationCostRisks('x.sql', refused)).toHaveLength(1);
    expect(migrationCostRisks('x.sql', refused)[0]).toContain('public.fn_sp_daily_metrics_compute');
    // Top-level and unqualified calls, and the snapshot that wraps it, count too.
    expect(
      migrationCostRisks(
        'x.sql',
        'BEGIN;\nSELECT fn_sp_daily_metrics_compute(current_date);\nCOMMIT;\n'
      )
    ).toHaveLength(1);
    expect(
      migrationCostRisks(
        'x.sql',
        'BEGIN;\nSELECT public.fn_sp_daily_metrics_snapshot();\nCOMMIT;\n'
      )
    ).toHaveLength(1);
    // The refused bytes themselves, when the history is present.
    try {
      const sql = execFileSync(
        'git',
        [
          'show',
          'd3e6fe1fe:supabase/migrations/20261119083000_the_fleet_degraded_run_never_shadows_the_digest.sql',
        ],
        { cwd: ROOT, encoding: 'utf8' }
      );
      expect(migrationCostRisks('20261119083000_x.sql', sql)).toHaveLength(1);
    } catch {
      // A shallow checkout may not hold the commit; the synthetic case above still pins the rule.
    }
  });

  it('a function body, a view body, a DDL signature, a string literal or a comment naming the function is not an install-time call', () => {
    const ok = [
      // Redefining a function whose body calls it runs nothing at install.
      'BEGIN;\nCREATE OR REPLACE FUNCTION public.fn_sp_daily_metrics_snapshot()\n RETURNS void LANGUAGE plpgsql AS $function$\nBEGIN\n  PERFORM public.fn_sp_daily_metrics_compute(current_date);\nEND $function$;\nCOMMIT;\n',
      // DDL metadata on an over-budget function never executes it.
      "BEGIN;\nCREATE OR REPLACE FUNCTION public.bbj_drift_since(p_since timestamptz) RETURNS void LANGUAGE sql AS $f$ SELECT 1; $f$;\nREVOKE ALL ON FUNCTION public.bbj_drift_since(timestamptz) FROM PUBLIC, anon, authenticated;\nGRANT EXECUTE ON FUNCTION public.bbj_drift_since(timestamptz) TO service_role;\nALTER FUNCTION public.bbj_drift_since(timestamptz) SET statement_timeout = '30s';\nCOMMENT ON FUNCTION public.bbj_drift_since(timestamptz) IS 'hourly alarm';\nCOMMIT;\n",
      // A CREATE VIEW body is a rewrite rule, not executed at install time.
      "BEGIN;\nCREATE OR REPLACE VIEW public.v_example AS SELECT * FROM public.rake_records WHERE created_at >= now() - interval '1 day';\nCOMMIT;\n",
      // Nested dollar-quoted replacement text inside an anchored edit DO block is a string literal.
      "BEGIN;\nDO $edit$\nDECLARE v text := $n1$SELECT * FROM public.bbj_drift_since(now() - interval '1 day');$n1$;\nBEGIN\n  PERFORM length(v);\nEND $edit$;\nCOMMIT;\n",
      // The anchored-edit pattern names it in a regprocedure literal.
      "BEGIN;\nSELECT pg_get_functiondef('public.fn_sp_daily_metrics_compute(date)'::regprocedure);\nCOMMIT;\n",
      'BEGIN;\n-- PERFORM public.fn_sp_daily_metrics_compute(current_date) was the old probe\nSELECT 1;\nCOMMIT;\n',
      // Another schema's same-named function is not this one.
      'BEGIN;\nSELECT other.fn_sp_daily_metrics_compute(current_date);\nCOMMIT;\n',
    ];
    for (const sql of ok) expect(migrationCostRisks('x.sql', sql), sql).toEqual([]);
  });

  it('catches the exact reverted bytes of incident 37a45c05 (20261126203947, run 45903772035) and PR #12141', () => {
    // Even with a pre-cutover reserved timestamp (like PR #12141), calling
    // bbj_drift_since + gating on wall-clock ms is refused before merge.
    const pr12141Shape = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '8s';
DO $post$
DECLARE v_t0 timestamptz; v_ms numeric;
BEGIN
  v_t0 := clock_timestamp();
  PERFORM * FROM public.bbj_drift_since(now() - interval '1 day');
  v_ms := extract(epoch FROM clock_timestamp() - v_t0) * 1000;
  IF v_ms > 2000 THEN
    RAISE EXCEPTION 'BBJ_DRIFT_STILL_SLOW % ms', round(v_ms);
  END IF;
END $post$;
COMMIT;`;
    const prRisks = migrationCostRisks(
      '20261126222226_the_bbj_drift_alarm_installs_inside_its_budget.sql',
      pr12141Shape
    );
    expect(prRisks.some((r) => r.includes('public.bbj_drift_since'))).toBe(true);
    expect(prRisks.some((r) => r.includes('wall-clock duration'))).toBe(true);

    // The exact reverted commit 4dc04652224f bytes, when history is present.
    try {
      const sql = execFileSync(
        'git',
        [
          'show',
          '4dc04652224f:supabase/migrations/20261126203947_the_bbj_drift_alarm_reads_its_window_once.sql',
        ],
        { cwd: ROOT, encoding: 'utf8' }
      );
      const risks = migrationCostRisks(`${STATEMENT_TIMEOUT_CHECKED_FROM}_replayed_bbj.sql`, sql);
      expect(risks.some((r) => r.includes('public.bbj_drift_since'))).toBe(true);
      expect(risks.some((r) => r.includes('wall-clock duration'))).toBe(true);
      expect(risks.some((r) => r.includes('public.rake_records'))).toBe(true);
      expect(risks.some((r) => r.includes('statement_timeout'))).toBe(true);
    } catch {
      // A shallow checkout may not hold the commit; the synthetic case above still pins the rule.
    }
  });

  it('catches the cousin spin-reserve view scan + wall-clock gate (run 45903604551) on any new file', () => {
    const sql = readFileSync(
      join(
        ROOT,
        'supabase/migrations/20261126195422_the_spin_reserve_gauge_reads_each_table_once.sql'
      ),
      'utf8'
    );
    const risks = migrationCostRisks(`${STATEMENT_TIMEOUT_CHECKED_FROM}_spin_gauge_copy.sql`, sql);
    expect(risks.some((r) => r.includes('public.v_spin_reserve_health'))).toBe(true);
    expect(risks.some((r) => r.includes('wall-clock duration'))).toBe(true);
    expect(risks.some((r) => r.includes('statement_timeout'))).toBe(true);
  });

  it('refuses install-time calls of all catalogued over-budget functions, even after a single-quoted CREATE FUNCTION', () => {
    const afterSingleQuotedFn = `BEGIN;
CREATE OR REPLACE FUNCTION public.helper_one() RETURNS int LANGUAGE sql AS 'SELECT 1';
DO $probe$
BEGIN
  PERFORM public.fn_tournament_money_conservation();
END $probe$;
COMMIT;`;
    const risks = migrationCostRisks('x.sql', afterSingleQuotedFn);
    expect(risks).toHaveLength(1);
    expect(risks[0]).toContain('public.fn_tournament_money_conservation');

    for (const fn of [
      'public.bbj_drift_since(now())',
      'public.fn_bbj_reconcile(gen_random_uuid())',
      'public.fn_bbj_reconcile_all()',
      'public.fn_bbj_promo_bank_check()',
    ]) {
      expect(migrationCostRisks('x.sql', `BEGIN;\nSELECT ${fn};\nCOMMIT;\n`).length, fn).toBe(1);
    }
  });

  it('refuses wall-clock latency RAISE EXCEPTION gates while allowing RAISE NOTICE and interval windows', () => {
    const directGate = `BEGIN;
DO $post$
DECLARE v_t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM 1;
  IF clock_timestamp() - v_t0 > interval '5 seconds' THEN
    RAISE EXCEPTION 'too slow';
  END IF;
END $post$;
COMMIT;`;
    expect(migrationCostRisks('x.sql', directGate)).toHaveLength(1);

    const allowed = [
      // Logging duration with RAISE NOTICE never aborts an install.
      `BEGIN;
DO $post$
DECLARE v_t0 timestamptz := clock_timestamp();
BEGIN
  RAISE NOTICE 'done in % ms', round(extract(epoch FROM clock_timestamp() - v_t0) * 1000);
END $post$;
COMMIT;`,
      // Subtracting an interval from clock_timestamp() is a window filter, not a latency gate.
      `BEGIN;
DO $post$
BEGIN
  IF EXISTS (SELECT 1 FROM public.clubs WHERE created_at > clock_timestamp() - interval '1 hour') THEN
    RAISE EXCEPTION 'recent club';
  END IF;
END $post$;
COMMIT;`,
      // The union-sweep probe mandated by the-union-sweep-proves-its-budget-before-commit.law.test.ts.
      `BEGIN;
-- @probe-for: public.fn_union_integrity_sweep
DO $probe$
DECLARE t0 timestamptz := clock_timestamp();
BEGIN
  PERFORM public.fn_union_integrity_sweep_all(24);
  IF clock_timestamp() - t0 > interval '90 seconds' THEN
    RAISE EXCEPTION 'sweep too slow';
  END IF;
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
COMMIT;`,
    ];
    for (const sql of allowed) expect(migrationCostRisks('x.sql', sql), sql).toEqual([]);
  });

  it('refuses SET LOCAL statement_timeout above the ordinary 12 s transaction budget from the cut-over on', () => {
    const bad = [
      "BEGIN;\nSET LOCAL statement_timeout = '30s';\nSELECT 1;\nCOMMIT;\n",
      "BEGIN;\nSET LOCAL statement_timeout = '0';\nSELECT 1;\nCOMMIT;\n",
      "BEGIN;\nDO $$ BEGIN PERFORM set_config('statement_timeout', '60s', true); END $$;\nCOMMIT;\n",
    ];
    for (const sql of bad) {
      expect(
        migrationCostRisks(`${STATEMENT_TIMEOUT_CHECKED_FROM}_bad_timeout.sql`, sql),
        sql
      ).toHaveLength(1);
    }

    const ok = [
      "BEGIN;\nSET LOCAL statement_timeout = '8s';\nSELECT 1;\nCOMMIT;\n",
      "BEGIN;\nSET LOCAL statement_timeout = '12000ms';\nSELECT 1;\nCOMMIT;\n",
      // Cron body strings and ALTER FUNCTION runtime configs are not install-time SET LOCAL.
      "BEGIN;\nSELECT cron.schedule('j', '0 * * * *', 'SET statement_timeout = ''30s''; SELECT 1;');\nCOMMIT;\n",
      "BEGIN;\nALTER FUNCTION public.fn_example() SET statement_timeout = '30s';\nCOMMIT;\n",
      // An admitted offline budget raises the matching statement_timeout ceiling.
      "-- @install-budget-seconds: 30\nBEGIN;\nSET LOCAL lock_timeout = '2s';\nSET LOCAL statement_timeout = '25s';\nSELECT 1;\nCOMMIT;\n",
      // Daily maintenance window files have their own 5 s check.
      "-- @install-window: daily-maintenance\nBEGIN;\nSET LOCAL statement_timeout = '30s';\nSELECT 1;\nCOMMIT;\n",
    ];
    for (const sql of ok) {
      expect(
        migrationCostRisks(`${STATEMENT_TIMEOUT_CHECKED_FROM}_ok_timeout.sql`, sql),
        sql
      ).toEqual([]);
    }
  });

  it('refuses correlated scalar aggregate subqueries over hot tables inside new functions and views', () => {
    const bad = [
      `BEGIN;
CREATE OR REPLACE VIEW public.v_spin_reserve_health AS
SELECT c.id,
       (SELECT COALESCE(SUM(l.amount), 0)
          FROM public.spin_reserve_ledger l
         WHERE l.club_id = c.id) AS reserve_sum
  FROM public.clubs c;
COMMIT;`,
      `BEGIN;
CREATE OR REPLACE FUNCTION public.fn_bad_bbj_report(p_since timestamptz)
RETURNS TABLE(pool_id uuid, contributed numeric)
LANGUAGE sql
AS $fn$
SELECT p.id,
       (SELECT COALESCE(SUM(bc.amount), 0)
          FROM public.bbj_contributions bc
         WHERE bc.pool_id = p.id
           AND bc.created_at >= p_since)
  FROM public.bbj_pools p;
$fn$;
COMMIT;`,
    ];
    for (const sql of bad) {
      const risks = migrationCostRisks(`${CORRELATED_HOT_SUBQUERY_CHECKED_FROM}_bad_corr.sql`, sql);
      expect(risks, sql).toHaveLength(1);
      expect(risks[0]).toContain('correlated scalar aggregate subquery over hot table');
    }

    const ok = [
      // Single-pass GROUP BY CTE + LEFT JOIN passes cleanly.
      `BEGIN;
CREATE OR REPLACE VIEW public.v_spin_reserve_health AS
WITH totals AS (
  SELECT club_id, SUM(amount) AS reserve_sum
    FROM public.spin_reserve_ledger
   GROUP BY club_id
)
SELECT c.id, COALESCE(t.reserve_sum, 0) AS reserve_sum
  FROM public.clubs c
  LEFT JOIN totals t ON t.club_id = c.id;
COMMIT;`,
      // Point-key idempotency_key lookup is O(1) and allowed.
      `BEGIN;
CREATE OR REPLACE FUNCTION public.fn_ok_point_lookup()
RETURNS TABLE(k text, cnt bigint)
LANGUAGE sql
AS $fn$
SELECT r.k,
       (SELECT count(*) FROM public.chip_ledger l WHERE l.idempotency_key = r.k)
  FROM public.some_keys r;
$fn$;
COMMIT;`,
    ];
    for (const sql of ok) {
      expect(
        migrationCostRisks(`${CORRELATED_HOT_SUBQUERY_CHECKED_FROM}_ok_corr.sql`, sql),
        sql
      ).toEqual([]);
    }
  });

  it('judges only from the cut-over on, so merged history is not re-judged', () => {
    expect(isCostChecked(`${COST_CHECKED_FROM}_x.sql`)).toBe(true);
    expect(isCostChecked('20261107133350_the_weekly_close_is_evidence_not_cache.sql')).toBe(false);
  });

  it('the applier asks the same question before it sends anything', () => {
    const applier = readFileSync(join(ROOT, 'scripts/ci/apply-recorded-migration.mjs'), 'utf8');
    expect(applier).toContain("from './migration-cost-shape.mjs'");
    const shapeAt = applier.indexOf('const shape = migrationTransactionShape(file, sql);');
    const costAt = applier.indexOf('const risks = migrationCostRisks(file, sql);');
    expect(shapeAt).toBeGreaterThan(0);
    expect(costAt).toBeGreaterThan(shapeAt);
    // The refusal sits inside the same if-block as the cost question.
    const block = applier.slice(costAt, applier.indexOf('}', costAt));
    expect(block).toContain('if (risks.length) refused(');
    expect(costAt).toBeLessThan(applier.indexOf('client.connect('));
  });
});
