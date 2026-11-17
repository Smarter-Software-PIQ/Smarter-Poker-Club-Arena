import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { declaredProofs, proofIsRunnable } from '../scripts/ci/check-migrations-are-live.mjs';
import { splitConcurrentPreamble } from '../scripts/ci/migration-concurrent-preamble.mjs';
const sql = readFileSync(
  'supabase/migrations/20261116205043_data_rake_union_headlines_use_invoice_accounting.sql',
  'utf8'
);
const native = readFileSync('scripts/ci/test-club-data-legacy-pacific-postgres.py', 'utf8');
describe('Data Rake agrees with the invoice-backed Data question', () => {
  it('reports original BBJ independently and never treats an old projection as zero', () => {
    const recon = readFileSync(
      'supabase/migrations/20261116230906_data_reconciliation_exposes_original_bbj_contributions_and_a.sql',
      'utf8'
    );
    expect(recon).toContain('ra.bbj_attributed_contribution');
    expect(recon).toContain('COALESCE(a.funding_club_id, s.club_id)');
    expect(recon).toContain("'bbj_awards', a.amount");
    expect(recon).toContain('bbj_version=1');
    expect(recon).toContain('pg_snapshot_xmin(v_snap)<=s.bbj_attachment_xid');
    expect(recon).toContain("WHERE f.kind='CASH'");
    expect(recon).toContain("WHERE fl.k='CASH'");
    expect(recon).toContain('WHEN rr.id IS NOT NULL AND rr.bbj_contribution=0 THEN 0');
    expect(recon).toContain('CLUB_DATA_BBJ_ORIGINAL_SOURCE_INCOMPLETE');
    expect(recon).not.toMatch(
      /(?:UPDATE|INSERT INTO|DELETE FROM) public\.(?:rake_attributions|rake_records|wallet_transactions|agent_commissions|accounting_cash_rake_sources)\b/i
    );
    const proofs = declaredProofs(recon);
    expect(proofs).toHaveLength(1);
    expect(proofIsRunnable(proofs[0])).toBe(true);
    const driver = readFileSync('scripts/ci/club-data-accounting-seed.mjs', 'utf8');
    expect(driver).toContain('seeded.rows[0].bbj_version === 1');
    expect(driver).toContain('rebuild || seeded.rowCount > 0');
    const split = splitConcurrentPreamble(recon);
    expect(split.ok).toBe(true);
    if (!split.ok) throw new Error(split.reason);
    expect(split.indexes).toHaveLength(1);
    expect(split.indexes[0].name).toBe('ca_club_bbj_only_receipt_measured_span');
    expect(split.indexes[0].statement).toContain(
      "CASE WHEN jsonb_typeof(stack_result->'bbj')='number'"
    );
    expect(recon).not.toContain("IF v_day < date '2026-11-09'");
    expect(recon).toContain("SET LOCAL TimeZone='UTC'");
    expect(split.body.indexOf('CLUB_DATA_BBJ_SPARSE_INDEX_NOT_QUALIFIED')).toBeLessThan(
      split.body.indexOf('ALTER TABLE public.ca_club_acct_fact')
    );
    expect(recon).toContain('i.indisvalid AND i.indisready AND i.indislive');
    expect(recon).toContain("am.amname='gist'");
    expect(recon).toContain("'bbj_original_source_gap'");
    expect(recon).toContain('b.created_at>=v_lo AND b.created_at<v_hi');
    expect(recon).toContain("o.game_scope->>'game_union_id'=v_union::text");
    expect(recon).not.toContain('CREATE TRIGGER');
    expect(recon).not.toContain('FUNCTION public.bbj_record_contribution(');
  });
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
