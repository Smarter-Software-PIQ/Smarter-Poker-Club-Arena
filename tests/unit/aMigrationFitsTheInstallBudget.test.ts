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
  unboundedInstallTimeFunctionCalls,
} from '../../scripts/ci/migration-cost-shape.mjs';
import { missingProbes } from '../../scripts/ci/migration-function-probes.mjs';
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

  it('catches the exact #12217 unbounded watcher probe (20261127172908, run 46054847104) on any new file and accepts -- @probe-exempt', () => {
    const pr12217Shape = `BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '8s';
CREATE OR REPLACE FUNCTION public.fn_ca_free_buy_funding_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
 SET lock_timeout TO '2s'
 SET statement_timeout TO '60s'
AS $function$
BEGIN
  RETURN '{}'::jsonb;
END $function$;
REVOKE ALL ON FUNCTION public.fn_ca_free_buy_funding_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_free_buy_funding_watch() TO service_role;
-- @probe-for: public.fn_ca_free_buy_funding_watch
DO $probe$
BEGIN
  PERFORM public.fn_ca_free_buy_funding_watch();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;
COMMIT;`;

    // Caught even on an older reserved timestamp (closed historical grandfather set, not version cutoff).
    const risks = migrationCostRisks('20261126000000_open_pr_watcher.sql', pr12217Shape);
    expect(risks.some((r) => r.includes('public.fn_ca_free_buy_funding_watch'))).toBe(true);
    // The structural guard independently catches it without relying on OVER_BUDGET_FUNCTIONS.
    const structural = unboundedInstallTimeFunctionCalls(
      '20261126000000_open_pr_watcher.sql',
      pr12217Shape
    );
    expect(structural).toHaveLength(1);
    expect(structural[0]).toContain("SET statement_timeout = '60s'");

    // Replacing the live probe with -- @probe-exempt satisfies BOTH guards cleanly.
    const fixed = pr12217Shape.replace(
      /-- @probe-for:[\s\S]*END \$probe\$;/,
      '-- @probe-exempt: public.fn_ca_free_buy_funding_watch zero-arg 14-day multi-table cron watcher exceeds 12 s install budget'
    );
    expect(migrationCostRisks('20261127200000_fixed_watcher.sql', fixed)).toEqual([]);
    expect(missingProbes(fixed)).toEqual([]);

    // The exact merged commit f9abf5eb78fb bytes, when history is present.
    try {
      const sql = execFileSync(
        'git',
        [
          'show',
          'f9abf5eb78fb:supabase/migrations/20261127172908_cron_watchers_materialize_and_prune_without_deadlock.sql',
        ],
        { cwd: ROOT, encoding: 'utf8' }
      );
      const copyRisks = migrationCostRisks('20261127200000_replayed_cron_watchers.sql', sql);
      expect(copyRisks.some((r) => r.includes('public.fn_ca_free_buy_funding_watch'))).toBe(true);
      // Bounded sibling probes in the same file (future timestamp + 36500-day floor) are NOT flagged.
      const copyStructural = unboundedInstallTimeFunctionCalls(
        '20261127200000_replayed_cron_watchers.sql',
        sql
      );
      expect(copyStructural).toHaveLength(1);
      expect(copyStructural[0]).toContain('public.fn_ca_free_buy_funding_watch');
      expect(copyStructural[0]).not.toContain('fn_ca_guarantee_funding_variance_scan');
      expect(copyStructural[0]).not.toContain('fn_ca_diamond_prune_history');
    } catch {
      // A shallow checkout may not hold the commit; the synthetic case above still pins the rule.
    }
  });

  it('refuses unbounded install-time calls to over-budget-timeout routines and background watchers while allowing bounded empty probes', () => {
    const badCases: Array<[string, string]> = [
      [
        'zero-arg routine with SET statement_timeout > 12s',
        `BEGIN;
CREATE OR REPLACE FUNCTION public.fn_custom_heavy_job()
 RETURNS void LANGUAGE plpgsql SET statement_timeout TO '45s'
AS $f$ BEGIN NULL; END $f$;
DO $p$ BEGIN PERFORM public.fn_custom_heavy_job(); END $p$;
COMMIT;`,
      ],
      [
        'trailing SET statement_timeout = 0 (disabled) called with NULL',
        `BEGIN;
CREATE OR REPLACE FUNCTION public.fn_custom_batch(p_since timestamptz DEFAULT NULL)
 RETURNS void AS $f$ BEGIN NULL; END $f$ LANGUAGE plpgsql SET statement_timeout = '0';
DO $p$ BEGIN PERFORM public.fn_custom_batch(NULL::timestamptz); END $p$;
COMMIT;`,
      ],
      [
        'ALTER FUNCTION raising statement_timeout called with live now() - interval lookback',
        `BEGIN;
ALTER FUNCTION public.fn_custom_report(timestamptz) SET statement_timeout = '90s';
DO $p$ BEGIN PERFORM public.fn_custom_report(now() - interval '7 days'); END $p$;
COMMIT;`,
      ],
      [
        'anchored-edit / existing zero-arg cron watcher without CREATE FUNCTION in file',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(); END $p$;
COMMIT;`,
      ],
      [
        'existing scanner called with NULL default or live clock_timestamp()',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_guarantee_funding_variance_scan(NULL); END $p$;
COMMIT;`,
      ],
      [
        'smarter_private sweep called with current_timestamp',
        `BEGIN;
DO $p$ BEGIN PERFORM smarter_private.fn_ledger_sweep(current_timestamp); END $p$;
COMMIT;`,
      ],
      [
        'existing pruner called with zero arguments',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_diamond_prune_history(); END $p$;
COMMIT;`,
      ],
    ];
    for (const [label, sql] of badCases) {
      const risks = migrationCostRisks('20261127200000_bad_unbounded.sql', sql);
      expect(risks.length, label).toBeGreaterThan(0);
    }

    const okCases: Array<[string, string]> = [
      [
        'future-bounded timestamp probe on 60s scan routine',
        `BEGIN;
CREATE OR REPLACE FUNCTION public.fn_ca_guarantee_funding_variance_scan(p_since timestamptz DEFAULT NULL)
 RETURNS integer LANGUAGE plpgsql SET statement_timeout TO '60s'
AS $f$ BEGIN RETURN 0; END $f$;
DO $p$ BEGIN PERFORM public.fn_ca_guarantee_funding_variance_scan(clock_timestamp() + interval '1 day'); END $p$;
COMMIT;`,
      ],
      [
        'epoch-bounded probe on 120s watcher routine',
        `BEGIN;
CREATE OR REPLACE FUNCTION public.fn_ca_horse_exposure_watch(p_at timestamptz, p_dry boolean)
 RETURNS void LANGUAGE plpgsql SET statement_timeout TO '120s'
AS $f$ BEGIN NULL; END $f$;
DO $p$ BEGIN PERFORM public.fn_ca_horse_exposure_watch('1970-01-01'::timestamptz, true); END $p$;
COMMIT;`,
      ],
      [
        'high retention floor probe on 120s prune routine',
        `BEGIN;
CREATE OR REPLACE FUNCTION public.fn_ca_diamond_prune_history(a int, b int, c int)
 RETURNS jsonb LANGUAGE plpgsql SET statement_timeout TO '120s'
AS $f$ BEGIN RETURN '{}'::jsonb; END $f$;
DO $p$ BEGIN PERFORM public.fn_ca_diamond_prune_history(36500, 36500, 36500); END $p$;
COMMIT;`,
      ],
      [
        'explicit numeric window on union sweep or zero-day collusion scan',
        `BEGIN;
DO $p$ BEGIN
  PERFORM public.fn_ca_collusion_scan(0);
  PERFORM public.fn_union_integrity_sweep_all(24);
END $p$;
COMMIT;`,
      ],
      [
        'DDL grants, revokes, triggers, and routine body references never count as install calls',
        `BEGIN;
REVOKE ALL ON FUNCTION public.fn_ca_new_drift_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_new_drift_watch() TO service_role;
ALTER FUNCTION public.fn_ca_new_drift_watch() SET statement_timeout = '60s';
CREATE TRIGGER trg_after_x AFTER INSERT ON public.clubs EXECUTE FUNCTION public.fn_ca_new_drift_watch();
CREATE OR REPLACE FUNCTION public.fn_caller() RETURNS void LANGUAGE plpgsql AS $f$
BEGIN PERFORM public.fn_ca_new_drift_watch(); END $f$;
COMMIT;`,
      ],
      [
        'ordinary fast helper with SET statement_timeout <= 12s',
        `BEGIN;
CREATE OR REPLACE FUNCTION public.fn_fast_check()
 RETURNS int LANGUAGE plpgsql SET statement_timeout TO '5s'
AS $f$ BEGIN RETURN 1; END $f$;
DO $p$ BEGIN PERFORM public.fn_fast_check(); END $p$;
COMMIT;`,
      ],
    ];
    for (const [label, sql] of okCases) {
      expect(migrationCostRisks('20261127200000_ok_bounded.sql', sql), label).toEqual([]);
    }
  });

  it('covers live public.hand_history in wide install scans and correlated hot-table subqueries', () => {
    const wideScan = `BEGIN;
DO $p$ BEGIN
  PERFORM count(*) FROM public.hand_history WHERE created_at >= now() - interval '1 day';
END $p$;
COMMIT;`;
    expect(
      migrationCostRisks('20261127200000_hh_scan.sql', wideScan).some((r) =>
        r.includes('public.hand_history')
      )
    ).toBe(true);

    const corrSubquery = `BEGIN;
CREATE OR REPLACE FUNCTION public.fn_bad_hh_report() RETURNS TABLE(tid uuid, cnt bigint) LANGUAGE sql AS $f$
  SELECT t.id, (SELECT count(*) FROM public.hand_history h WHERE h.table_id = t.id) FROM public.tables t;
$f$;
COMMIT;`;
    expect(
      migrationCostRisks(`${CORRELATED_HOT_SUBQUERY_CHECKED_FROM}_hh_corr.sql`, corrSubquery).some(
        (r) => r.includes('hot table hand_history')
      )
    ).toBe(true);
  });

  it('refuses quoted/custom schema calls, single-quoted DO blocks, DEFAULT/named NULL, localtimestamp, and negative/zero future clock shifts', () => {
    const refusedCases: Array<[string, string, string]> = [
      [
        'quoted schema call',
        `BEGIN;
DO $p$ BEGIN
  PERFORM "public"."fn_ca_new_drift_watch"();
END $p$;
COMMIT;`,
        'public.fn_ca_new_drift_watch',
      ],
      [
        'single-quoted DO block with escaped quote',
        `BEGIN;
DO 'BEGIN PERFORM public.fn_ca_new_drift_watch(); RAISE NOTICE ''done''; END';
COMMIT;`,
        'public.fn_ca_new_drift_watch',
      ],
      [
        'non-public/smarter_private schema routine with over-budget SET statement_timeout',
        `BEGIN;
CREATE OR REPLACE FUNCTION ops.fn_heavy_rollup()
 RETURNS void LANGUAGE plpgsql SET statement_timeout TO '60s'
AS $f$ BEGIN NULL; END $f$;
SELECT ops.fn_heavy_rollup();
COMMIT;`,
        'ops.fn_heavy_rollup',
      ],
      [
        'DEFAULT argument',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(DEFAULT); END $p$;
COMMIT;`,
        'NULL/DEFAULT-only arguments',
      ],
      [
        'named parameter => NULL',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(p_since => NULL::timestamptz); END $p$;
COMMIT;`,
        'NULL/DEFAULT-only arguments',
      ],
      [
        'localtimestamp live clock argument',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(localtimestamp); END $p$;
COMMIT;`,
        'live current/lookback clock argument',
      ],
      [
        'negative interval shift',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(now() + interval '-14 days'); END $p$;
COMMIT;`,
        'live current/lookback clock argument',
      ],
      [
        'zero interval shift',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(clock_timestamp() + interval '0 seconds'); END $p$;
COMMIT;`,
        'live current/lookback clock argument',
      ],
      [
        'negative multiplier * interval',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(now() + (-14) * interval '1 day'); END $p$;
COMMIT;`,
        'live current/lookback clock argument',
      ],
      [
        'interval * negative multiplier',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(now() + interval '1 day' * -14); END $p$;
COMMIT;`,
        'live current/lookback clock argument',
      ],
      [
        'make_interval with negative days',
        `BEGIN;
DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(now() + make_interval(days => -14)); END $p$;
COMMIT;`,
        'live current/lookback clock argument',
      ],
    ];
    for (const [label, sql, needle] of refusedCases) {
      const risks = migrationCostRisks('20261127210000_hardened_guard.sql', sql);
      expect(
        risks.some((r) => r.includes(needle)),
        `${label}: got ${JSON.stringify(risks)}`
      ).toBe(true);
    }

    const allowedFutureCases = [
      `BEGIN; DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(clock_timestamp() + interval '1 day'); END $p$; COMMIT;`,
      `BEGIN; DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(current_date + 7); END $p$; COMMIT;`,
      `BEGIN; DO $p$ BEGIN PERFORM public.fn_ca_new_drift_watch(now() + make_interval(days => 1)); END $p$; COMMIT;`,
    ];
    for (const sql of allowedFutureCases) {
      expect(migrationCostRisks('20261127210000_pos_shift.sql', sql), sql).toEqual([]);
    }
  });

  it('refuses install-time probes that both INSERT into operational_alert_events and call reliability_ingest_alert (PR #12325 / incident 37a45c05)', () => {
    // Reproduces the exact bug in PR #12325 (20261128074415, Apply Merged Migration run 46134399527):
    // INSERT INTO operational_alert_events fires the production AFTER INSERT trigger which ingests
    // (id, 1, firing) into reliability_observations, making the direct reliability_ingest_alert call
    // hit ON CONFLICT DO NOTHING and return NULL.
    const doubleIngestSql = `
      BEGIN;
      DO $probe$
      DECLARE v_id bigint; v_inc uuid;
      BEGIN
        INSERT INTO public.operational_alert_events (source, event_key, alertname, status, severity, payload)
        VALUES ('financial-alerts-backfill', 'probe-k', 'fn_ca_hand_gap_watch', 'firing', 'critical', '{}'::jsonb)
        RETURNING id INTO v_id;
        v_inc := smarter_private.reliability_ingest_alert(
          v_id, 'financial-alerts-backfill', 'probe-k', 'fn_ca_hand_gap_watch', 'firing', 'critical',
          '{}'::jsonb, clock_timestamp(), clock_timestamp(), 1, 'new', 'INSERT'
        );
        RAISE EXCEPTION 'probe-unwind';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
      END $probe$;
      COMMIT;
    `;
    const risks = migrationCostRisks('20261128170001_probe_double_ingest.sql', doubleIngestSql);
    expect(risks.some((r) => r.includes('AFTER INSERT trigger on operational_alert_events'))).toBe(
      true
    );

    // Direct reliability_ingest_alert call with a synthetic negative id (PR #12343 fix) is allowed.
    const cleanProbeSql = `
      BEGIN;
      DO $probe$
      DECLARE v_inc uuid;
      BEGIN
        v_inc := smarter_private.reliability_ingest_alert(
          -9223372036854775001, 'financial-alerts-backfill', 'probe-k', 'fn_ca_hand_gap_watch', 'firing', 'critical',
          '{}'::jsonb, clock_timestamp(), clock_timestamp(), 1, 'new', 'INSERT'
        );
        RAISE EXCEPTION 'probe-unwind';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
      END $probe$;
      COMMIT;
    `;
    expect(migrationCostRisks('20261128170002_clean_probe.sql', cleanProbeSql)).toEqual([]);

    // CREATE FUNCTION bodies referencing both are not install-time calls and remain allowed.
    const fnBodySql = `
      BEGIN;
      CREATE OR REPLACE FUNCTION smarter_private.fn_probe_helper() RETURNS void LANGUAGE plpgsql AS $fn$
      BEGIN
        INSERT INTO public.operational_alert_events (source, event_key, alertname, status, severity, payload)
        VALUES ('x', 'y', 'z', 'firing', 'info', '{}'::jsonb);
        PERFORM smarter_private.reliability_ingest_alert(1, 'x', 'y', 'z', 'firing', 'info', '{}'::jsonb, now(), now(), 1, 'new', 'INSERT');
      END;
      $fn$;
      COMMIT;
    `;
    expect(migrationCostRisks('20261128170003_fn_body_only.sql', fnBodySql)).toEqual([]);
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
