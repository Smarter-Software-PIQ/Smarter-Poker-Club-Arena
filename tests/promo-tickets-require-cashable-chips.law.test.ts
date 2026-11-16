import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = (path: string) => readFileSync(path, 'utf8');
const sql = read(
  'supabase/migrations/20261116154719_promo_tickets_require_cashable_wallets_and_direct_entries_retain_principal.sql'
);
const workflow = read('.github/workflows/promo-play-through.yml');
const page = read('src/pages/CashierTradePage.tsx');

describe('Tickets use cashable player or agent chips; promo enters tournaments directly', () => {
  it('runs the original money owners and source fixtures in the maintained native workflow', () => {
    for (const path of [
      'scripts/ci/test-promo-ticket-play-through.py',
      'scripts/ci/fixtures/promo-ticket-play-through/**',
      'tests/fixtures/promo-ticket-play-through/**',
      'supabase/migrations/*_promo_tickets_*.sql',
      'supabase/migrations/*_promo_principal_*.sql',
    ])
      expect(workflow).toContain(path);
    expect(workflow).toContain(
      'python3 -B scripts/ci/test-promo-ticket-play-through.py --output artifacts/promo-ticket-play-through'
    );
  });
  it('refuses new promo purchases before debits and retains only the original replay path', () => {
    expect(sql).toContain('promo_ticket_purchase_forbidden');
    expect(sql).toContain('b6ff2586a9f6b58cd334e25367b40756');
    expect(sql).not.toContain('CREATE FUNCTION public.fn_ca_promo_ticket_principal');
    expect(sql).not.toContain('ca_promo_ticket_entry_bridges');
    expect(page).toContain('Historical Promo Ticket Recovery');
    expect(page).toContain('value="agent_wallet"');
    expect(page).toContain('(Cashable Chips Only)');
  });
  it('protects both original source wallets and exact entry refund provenance', () => {
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.fn_ca_issue_cashable_ticket_owned(uuid,uuid,numeric,text,text,text) FROM PUBLIC,anon,authenticated,service_role;'
    );
    expect(sql).toContain('funding_source');
    expect(sql).toContain('fn_ca_promo_integrity_locked_at');
    expect(sql).toContain('promo_refund_entitlement_does_not_match_credit');
    expect(sql).toContain('fn_ca_promo_lock_grant_funds');
    expect(sql).toContain('CREATE FUNCTION public.fn_cashier_agent_ticket_batch');
    expect(page).toContain("'fn_cashier_agent_ticket_batch'");
    expect(page).toContain(
      "else if (kind === 'ticket' && uncertainRecovery.source === 'agent_wallet')"
    );
  });
});
