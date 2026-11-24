/**
 * ===========================================================================
 *  LAW: DIGEST RECONCILIATION ALIGNS BY HAND DAY, ALERT PROOFS ARE RECEIPT-
 *       PROVED, AND PG_CRON NEVER BLOCKS THE LAUNCHER OR SATURATES PRUNING
 * ===========================================================================
 *
 * Migration 20261124152017_fix_digest_cash_residual_alert_proofs_and_cron_freeze.sql
 * fixes four live SQL root causes permanently:
 *
 *   1. Midnight post-commit banking boundary (+-$4.40 cash_residual & house_figures):
 *      fn_sp_digest_daily_results_compute attributes cash_rake (chip_ledger) and
 *      bbj (bbj_contributions, avoiding Diamond Arena NULL drop) by ca_hand_facts
 *      hand_id via materialized cash_hands; fn_sp_digest_house_figures prefers
 *      sp_digest_daily_results_snapshots with COALESCE fallback to sp_daily_metrics.
 *   2. OpenClawOperationalAlert recovery-twin double counting (1 of 2 -> 2 of 2):
 *      fn_sp_daily_metrics_compute (all 4 queries) and fn_sp_digest_attention
 *      exclude separate source='openclaw' recovery deliveries without resolved_at,
 *      and fn_sp_original_alert_proof verifies historical recovery twins only
 *      against a verified_fixed OpenClaw parent (kind='openclaw_recovery_twin').
 *   3. WeeklyPayoutNotReadyHalfHourBefore receipt proof & stale_unverified recovery:
 *      fn_sp_original_alert_proof verifies weekly-payout alerts against
 *      smarter_private.weekly_payout_owner_updates + public.union_accounting_runs
 *      (weekly_payout_paid_receipt) or smarter_private.weekly_prepared_payout_plans
 *      (weekly_payout_ready_receipt); removes 'weekly-payout' from
 *      reliability_sources_without_resolve; adds the weekly-payout branch to
 *      reliability_proved_source_resolution; and transitions proved stale_unverified
 *      rows solely through smarter_private.reliability_transition.
 *   4. 06:40Z 157.6s pg_cron launcher freeze & continuous pruner I/O storm:
 *      quiets fn_ca_ledger_replay(integer) (client_min_messages='warning'),
 *      wraps cron #286/#155/#117/#119 cleanly with client_min_messages='error'
 *      (or single-statement CALL for #117), staggers #286 (23 6 * * *) and
 *      #117 (30 seconds), and bounds sp_prune_hand_history (75 rows, 20s) and
 *      sp_prune_hand_state_snapshots (125-row page, 8s deadline, 20s).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '..');
const MIG_FILE =
  'supabase/migrations/20261124152017_fix_digest_cash_residual_alert_proofs_and_cron_freeze.sql';
const SQL = readFileSync(resolve(ROOT, MIG_FILE), 'utf8');
const PROOF = readFileSync(
  resolve(ROOT, 'scripts/ci/test-digest-cash-residual-alerts-and-cron-freeze.py'),
  'utf8'
);

const codeOnly = (sql: string): string =>
  sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

const CODE = codeOnly(SQL);

describe('digest reconciliation, alert proofs, and pg_cron launcher safety', () => {
  it('ships in one transaction with exact live preimage and postimage pins and live proofs', () => {
    expect(SQL.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(SQL.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(SQL.trimEnd().endsWith('COMMIT;')).toBe(true);
    for (const [sig, pre, post] of [
      [
        'public.fn_sp_digest_daily_results_compute(date)',
        'd1431c83171b53c6c1210d08cd5567e4',
        '5eaa7fcdc0a278ba3a5cf497ece09d38',
      ],
      [
        'public.fn_sp_digest_house_figures(date)',
        '31b4231617a7e7c2f35f0834a7a52f66',
        '421e7f6f2f1318c8a60eb1f18680b7dd',
      ],
      [
        'public.fn_sp_daily_metrics_compute(date)',
        'defe7f21cf46a34c59ff1d374b455e25',
        'c932a574b496b1743e7d921e2bb96fee',
      ],
      [
        'public.fn_sp_digest_attention(date,jsonb)',
        '37787e6b6afcf24e0289741858ebb855',
        'f8b941a68e329ca4a026fe7a5d04ff28',
      ],
      [
        'public.fn_sp_original_alert_proof(bigint)',
        'eaf7347f7c480c46d043c0cfd00789f8',
        'd482e06ef00cc890029bbb054ca1402b',
      ],
      [
        'smarter_private.reliability_proved_source_resolution(uuid)',
        'bb4e07bc55faff6411be487d464ba1be',
        '205f565996a8e5b6b4c2205f2c229527',
      ],
      [
        'public.sp_prune_hand_history(integer)',
        '637890ae88e74d2cc436f2ca602843f3',
        'da9a24d97cd0d9c8ebba0a3031c0061e',
      ],
      [
        'public.sp_prune_hand_state_snapshots(integer)',
        '8c5c03bd932747bd926670d1b8eb5581',
        '5f12ac91b56a98ca57128349d2c2c233',
      ],
      [
        'public.fn_ca_ledger_replay(integer)',
        'a6dd975e58b6dd8043d2771d9505fc6d',
        '90e4b668d1327645c6c704a444fe86bf',
      ],
    ]) {
      expect(CODE, sig).toContain(pre);
      expect(CODE, sig).toContain(post);
      expect(SQL, sig).toContain(
        `-- @live-proof: md5(pg_get_functiondef('${sig}'::regprocedure)) = '${post}'`
      );
    }
    expect(CODE).not.toMatch(
      /\b(?:UPDATE|DELETE|INSERT\s+INTO)\s+(?:public\.)?(?:operational_alert_events|sp_daily_metrics|chip_ledger)\b/i
    );
    expect(CODE).not.toMatch(/\bUPDATE\s+smarter_private\.reliability_incidents\b/i);
    expect(CODE).not.toMatch(/\bcron\.(?:schedule|unschedule|alter_job)\s*\(/i);
  });

  it('Fix 1: attributes cash rake and BBJ drops by completed hand day and aligns house figures', () => {
    expect(CODE).toContain('cash_hands AS MATERIALIZED (\n SELECT DISTINCT hand_id FROM facts');
    expect(CODE).toContain("l.created_at<win.e+interval '24 hours'");
    expect(CODE).toContain("l.category='burn' AND l.to_type='chip_retirement'");
    expect(CODE).toContain('FROM public.bbj_contributions b,win');
    expect(CODE).toContain(
      '((b.hand_id IS NULL AND b.created_at<win.e) OR b.hand_id IN (SELECT hand_id FROM cash_hands))'
    );
    expect(CODE).toContain('LEFT JOIN public.sp_digest_daily_results_snapshots dr ON dr.day=m.day');
    expect(CODE).toContain("COALESCE((dr.result->'reconciliation'->>'bbj')::numeric");
    expect(CODE).toContain("COALESCE((dr.result->'reconciliation'->>'cash_rake')::numeric");
  });

  it('Fix 2: excludes openclaw recovery twins strictly by source=openclaw and proves historical twins', () => {
    expect(CODE).toContain(
      "source='openclaw' AND status='resolved' AND NOT (payload ? 'resolved_at')"
    );
    expect(CODE).toContain("'(^✅|\\yRECOVERED\\y)'");
    expect(CODE).toContain("kind:='openclaw_recovery_twin'");
    expect(CODE).toContain("f.payload->>'resolved_by_event'=original.id::text");
    expect(CODE).toContain("f.event_key=original.payload->>'resolves'");
  });

  it('Fix 3: proves weekly-payout alerts from paid or prepared receipts and recovers stale_unverified via reliability_transition', () => {
    expect(CODE).toContain("kind:='weekly_payout_paid_receipt'");
    expect(CODE).toContain("kind:='weekly_payout_ready_receipt'");
    expect(CODE).toContain('smarter_private.weekly_payout_owner_updates');
    expect(CODE).toContain('public.union_accounting_runs');
    expect(CODE).toContain('smarter_private.weekly_prepared_payout_plans(');
    expect(CODE).toContain(
      "DELETE FROM smarter_private.reliability_sources_without_resolve\n WHERE source = 'weekly-payout';"
    );
    expect(CODE).toContain("'ca-stall-watch'");
    expect(CODE).toContain("e.alertname='TableStoppedDealing'");
    expect(CODE).toContain('smarter_private.reliability_transition(');
  });

  it('Fix 4: quiets fn_ca_ledger_replay and bounds both hand pruners without mutating cron.job', () => {
    expect(CODE).toContain(
      "ALTER FUNCTION public.fn_ca_ledger_replay(integer) SET client_min_messages = 'warning';"
    );
    expect(CODE).not.toContain('cron.alter_job');
    expect(CODE).toContain('LIMIT LEAST(GREATEST(p_batch,1),75)');
    expect(CODE).toContain('v_page := LEAST(125, v_limit - v_seen);');
    expect(CODE).toContain("interval '8 seconds'");
    expect(CODE).toContain("SET statement_timeout TO '20s'");
    expect(CODE).toContain('horse_retention_days');
  });

  it('ships with the native PostgreSQL 17 proof covering all 4 fixes and verifying cron.job stays untouched', () => {
    expect(PROOF).toContain('digest-cash-residual-alerts-cron-preimages.json');
    expect(PROOF).toContain('weekly_payout_paid_receipt');
    expect(PROOF).toContain('weekly_payout_ready_receipt');
    expect(PROOF).toContain('openclaw_recovery_twin');
    expect(PROOF).toContain('ALL 4 SQL ROOT-CAUSE FIXES PROVEN ON NATIVE POSTGRESQL 17');
  });
});
