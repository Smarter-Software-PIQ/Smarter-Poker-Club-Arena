import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { declaredProofs, proofIsRunnable } from '../scripts/ci/check-migrations-are-live.mjs';
const sql = readFileSync(
  'supabase/migrations/20261116205043_data_rake_union_headlines_use_invoice_accounting.sql',
  'utf8'
);
const native = readFileSync('scripts/ci/test-club-data-legacy-pacific-postgres.py', 'utf8');
describe('Data Rake agrees with the invoice-backed Data question', () => {
  it('routes by recorded window eligibility without changing the financial producers', () => {
    expect(sql).toContain('public.fn_ca_club_data_reads_union_basis(v_context,v_start,v_end)');
    expect(sql).toContain('public.ca_club_acct_fact_ct');
    expect(sql).toContain('public.ca_club_acct_hands_ct');
    expect(sql).toContain('public.fn_ca_club_acct_coverage(v_context,v_start,v_end)');
    expect(sql).toContain('v_prev_invoice IS DISTINCT FROM v_invoice');
    expect(sql).toContain('CLUB_DATA_PACIFIC_WINDOW_INCOMPLETE');
    expect(sql).not.toMatch(
      /(?:UPDATE|INSERT INTO|DELETE FROM) public\.(?:ca_club_acct_fact|rake_records|wallet_transactions|agent_commissions)\b/i
    );
    expect(sql).not.toContain('FUNCTION public.fn_ca_rake_by_agent_pacific(');
    expect(sql).not.toContain('FUNCTION public.fn_ca_club_pacific_member_fee_totals(');
  });
  it('freezes the answered basis and keeps old requests from answering a new question', () => {
    expect(sql).toContain('ca-data-pacific-invoice:');
    expect(sql).toContain("snapshot_shape.document -> ''accounting_basis''");
    const proofs = declaredProofs(sql);
    expect(proofs).toHaveLength(1);
    expect(proofIsRunnable(proofs[0])).toBe(true);
    expect(native).toContain('actual frozen export receipt states the invoice accounting question');
    expect(native).toContain('same invoice export request resumes its immutable original receipt');
    expect(native).toContain(
      'union totals deduplicate shared games and raw hands across member clubs'
    );
    expect(native).toContain(
      'agent gross production and personal net fee source bodies remain untouched'
    );
  });
});
