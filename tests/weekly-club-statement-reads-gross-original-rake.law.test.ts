/**
 * WEEKLY CLUB ACCOUNTING SUMMARY AND RAKE SNAPSHOT READ GROSS ORIGINAL RAKE
 * (2026-11-24, Incident 605ea9ca).
 *
 * Migration 20261116154831 narrowed public.accounting_payable_earning_sources.rake_credit
 * to payable_rake_credit (gross minus promo_excluded_credit) so agent commission and
 * player rakeback exclude promo-funded fees, while preserving gross original rake in
 * contract->>'rake_credit'.
 *
 * Both fn_club_weekly_accounting_summary (which reconciles union_basis against
 * close_row.totals->'basis_by_club', private_basis against private_burned, and
 * tournament_source_groups against accounting_tournament_fee_recognitions.net_rake)
 * and fn_capture_weekly_club_rake_snapshot (which certifies source_fingerprint_v3
 * and totals against the summary breakdown) must read gross original rake
 * COALESCE((contract->>'rake_credit')::numeric, rake_credit) without mutating
 * accounting_payable_earning_sources or any ledger table.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FILE = join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20261124010800_weekly_club_statement_reads_gross_original_rake.sql'
);
const sql = readFileSync(FILE, 'utf8');
const code = sql.replace(/^--[^\n]*/gm, '');

describe('weekly club statement and rake snapshot read gross original rake', () => {
  it('pins the exact live preimages and patches summary, tournament deposit groups, and snapshot', () => {
    expect(code).toContain("old_summary  CONSTANT text := '0b5f87114dd95cb3f2b9802f20a564ec'");
    expect(code).toContain("old_snapshot CONSTANT text := '5070d885fa29e226e4cb43370767a245'");
    expect(code).toContain(
      "COALESCE((a.contract->>''rake_credit'')::numeric,a.rake_credit) AS rake_credit"
    );
    expect(code).toContain(
      "COALESCE((e.contract->>''rake_credit'')::numeric,e.rake_credit) AS rake_credit"
    );
    expect(code).toContain(
      "COALESCE((s.contract->>''rake_credit'')::numeric,s.rake_credit) AS rake_credit"
    );
    expect(code).toContain('GROSS ORIGINAL RAKE (20261124010800)');
  });

  it('proves both patched functions before commit and carries a live-proof assertion', () => {
    expect(sql).toMatch(/^-- @probe-for: public\.fn_club_weekly_accounting_summary$/m);
    expect(sql).toMatch(/^-- @probe-for: public\.fn_capture_weekly_club_rake_snapshot$/m);
    expect(code).toContain('probe-unwind');
    expect(code).toContain('WEEKLY_STMT_GROSS_STALE_PIN');
    expect(sql).toMatch(
      /^-- @live-proof: .*fn_club_weekly_accounting_summary.*fn_capture_weekly_club_rake_snapshot/m
    );
  });

  it('preserves payable earning sources and never mutates ledgers or emits new *_ledger_ids keys', () => {
    expect(code).not.toMatch(
      /CREATE(?: OR REPLACE)? VIEW public\.accounting_payable_earning_sources/i
    );
    expect(code).not.toMatch(/INSERT INTO public\.chip_ledger/i);
    expect(code).not.toMatch(
      /UPDATE public\.(accounting_cash_rake_sources|rake_records|union_eco_ledger)/i
    );
    expect(code).not.toMatch(/'[a-z_]+_ledger_ids'\s*,/i);
  });
});
