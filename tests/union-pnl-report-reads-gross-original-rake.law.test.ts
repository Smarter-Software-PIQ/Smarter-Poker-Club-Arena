/**
 * UNION P&L EVIDENCE REPORT AND BOUNDARY STRADDLE READ GROSS ORIGINAL RAKE
 * (2026-11-23, Incident 605ea9ca).
 *
 * Migration 20261116154831 narrowed public.accounting_payable_earning_sources.rake_credit
 * to payable_rake_credit (gross minus promo_excluded_credit) so agent commission and
 * player rakeback exclude promo-funded fees, while preserving gross original rake in
 * contract->>'rake_credit'.
 *
 * Both fn_union_pnl_evidence_report (which compares gross accepted cash rake against
 * gross earned cash rake) and fn_union_pnl_week_rake_straddle must read gross original
 * rake COALESCE((s.contract->>'rake_credit')::numeric, s.rake_credit) without altering
 * accounting_payable_earning_sources or moving money/ledgers.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20261123202500_union_pnl_report_reads_gross_original_rake.sql'
);
const sql = readFileSync(FILE, 'utf8');
const code = sql.replace(/^--[^\n]*/gm, '');

describe('union P&L report reads gross original rake', () => {
  it('patches both fn_union_pnl_evidence_report and fn_union_pnl_week_rake_straddle to read contract gross rake', () => {
    expect(code).toContain("old_report   CONSTANT text := '26cb0f6e4912cd3e8980f657bb52d50c'");
    expect(code).toContain("old_straddle CONSTANT text := '9e6e85c51b06dae44b0639ee843dfa56'");
    expect(code).toContain("COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit)");
    expect(code).toContain("COALESCE((s.contract->>''rake_credit'')::numeric, s.rake_credit)");
    expect(code).toContain('GROSS ORIGINAL RAKE (20261123202500)');
  });

  it('moves downstream MD5 pins and verifies original_inventory_proof_sources_match and zero stale pins', () => {
    expect(code).toContain("old_adv      CONSTANT text := 'ba8d54bcf62c86357be6437421d1d45d'");
    expect(code).toContain('fn_accounting_union_earned_plan_advance');
    expect(code).toContain('smarter_private.original_inventory_proof_sources_match()');
    expect(code).toContain(
      'IF smarter_private.original_inventory_proof_sources_match() IS NOT TRUE THEN'
    );
    expect(code).toContain('GROSS_RAKE_STALE_PIN');
    expect(sql).toMatch(/^-- @live-proof: .*original_inventory_proof_sources_match\(\) IS TRUE/m);
  });

  it('preserves payable earning sources and never mutates ledgers or rake_records', () => {
    expect(code).not.toMatch(
      /CREATE(?: OR REPLACE)? VIEW public\.accounting_payable_earning_sources/i
    );
    expect(code).not.toMatch(/INSERT INTO public\.chip_ledger/i);
    expect(code).not.toMatch(
      /UPDATE public\.(accounting_cash_rake_sources|rake_records|union_eco_ledger)/i
    );
  });
});
