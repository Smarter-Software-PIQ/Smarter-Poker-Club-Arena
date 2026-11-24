/**
 * SETTLED BBJ ALERTS CLOSE ONLY ON CONSERVED PAYOUT RECEIPTS (2026-11-24).
 *
 * Incident 7a0c2e25-dada-4cf5-8441-d39bbfe823c8: when FeeReconciler re-drives
 * and pays a queued BBJ payout (e.g. hand #60701395 paid 1,978.16 chips 4m32s
 * later), the processBBJPayout.exhausted alert and its drift incident stayed
 * open indefinitely because smarter_private.financial_alerts_proven_over had
 * no receipt-proven branch for BBJ payouts.
 *
 * Migration 20261124074800 adds branch (e) to financial_alerts_proven_over:
 * closes processBBJPayout.exhausted and FeeReconciler.exhausted (kind=bbj_payout)
 * ONLY when public.bbj_payouts exists for (table_id, hand_number), total_amount > 0,
 * recipient + unpaid unclaimed shares equal total_amount, and zero unresolved
 * pending_fee_distributions (kind='bbj_payout') rows remain.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..', 'supabase', 'migrations');
const MIGRATION = '20261124074800_harden_stall_12m_and_bbj_alert_closure.sql';
const files = readdirSync(DIR)
  .filter((f) => /^\d{14}_.+\.sql$/.test(f))
  .sort();
const sql = readFileSync(join(DIR, MIGRATION), 'utf8');

describe('settled BBJ alerts close only on conserved payout receipts', () => {
  it('pins the live financial_alerts_proven_over preimage and revokes public/API EXECUTE', () => {
    expect(sql).toMatch(/^-- @live-proof: /m);
    expect(sql).toContain("md5(v_proven_def) IS DISTINCT FROM 'f62e5ddbd69d550b445b6d537e473d9e'");
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION smarter_private.financial_alerts_proven_over(boolean,integer) FROM PUBLIC, anon, authenticated, service_role;'
    );
  });

  it('requires bbj_payouts receipt, exact recipient+unclaimed conservation, and zero open queue rows', () => {
    expect(sql).toContain("a.source='processBBJPayout.exhausted'");
    expect(sql).toContain("a.source='FeeReconciler.exhausted' AND a.context->>'kind'='bbj_payout'");
    expect(sql).toContain('FROM public.bbj_payouts p');
    expect(sql).toContain('FROM public.bbj_payout_recipients r WHERE r.payout_id=p.id');
    expect(sql).toContain(
      'FROM public.bbj_unclaimed_shares u WHERE u.payout_id=p.id AND u.paid_at IS NULL'
    );
    expect(sql).toContain('FROM public.pending_fee_distributions q');
    expect(sql).toContain("q.kind='bbj_payout'");
    expect(sql).toContain('q.resolved_at IS NULL');
    expect(sql).toContain("'kind','bbj_payout_paid'");
  });

  it('no later migration drops bbj_payout_paid from financial_alerts_proven_over', () => {
    const idx = files.indexOf(MIGRATION);
    expect(idx).toBeGreaterThanOrEqual(0);
    for (const f of files.slice(idx + 1)) {
      const body = readFileSync(join(DIR, f), 'utf8');
      if (
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+smarter_private\.financial_alerts_proven_over\b/i.test(
          body
        )
      ) {
        expect(body, `${f} redefines financial_alerts_proven_over without bbj_payout_paid`).toContain(
          'bbj_payout_paid'
        );
      }
    }
  });
});
