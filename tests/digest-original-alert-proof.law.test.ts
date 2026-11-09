import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20261109162810_original_free_buy_alerts_read_the_completed_slot_receipt.sql',
  'utf8'
);

describe('the digest shares exact original alert proof with its per-type consumer', () => {
  it('binds the aggregate and versioned annotation to the same materialized proof', () => {
    expect(migration).toContain('public.fn_sp_original_alert_proof(m.id) proof FROM members m');
    expect(migration).toContain('outcomes AS MATERIALIZED');
    expect(migration).toContain("'canonical_alert_proof',jsonb_build_object('version',1");
    expect(migration).toContain(
      "'reviewed',verified OR COALESCE(original.investigation_status='historical',false)"
    );
    expect(migration).toContain("count(*) FILTER(WHERE (m.proof->>'verified')::boolean) verified");
  });

  it('requires the exact original completed slot and actual terminal escrow receipt', () => {
    expect(migration).toContain("original.source='sp-critical-pager'");
    expect(migration).toContain("original.alertname='CriticalPage.midway_free_buy_missing'");
    expect(migration).toContain("t.union_id='fade0000-0000-0000-0000-000000000001'::uuid");
    expect(migration).toContain("t.status='COMPLETED' AND t.current_players=0");
    expect(migration).toContain('s.escrow_closed_at=e.terminal_closed_at');
    expect(migration).toContain('s.bounty_payout_total=s.bounty_pool');
    expect(migration).toContain('e.prize_balance=0 AND e.bounty_balance=0 AND e.fee_balance=0');
    expect(migration).not.toMatch(
      /UPDATE\s+(?:public\.)?(?:operational_alert_events|tournaments|financial_alerts|chip_ledger)\b/i
    );
    const native = readFileSync('scripts/ci/test-digest-original-alerts.py', 'utf8');
    expect(native).toContain('digest-slot-proof-preimage.sql');
    expect(native).toContain("group['total']==group['reviewed']==group['verified']==2");
    expect(native).toContain('historical is reviewed not verified');
  });
});
