/**
 * STRUCTURAL HARDENING INVARIANT (2026-11-24, post-fix audit of 605ea9ca & 7a0c2e25):
 *
 * 1. Every gross reconciliation consumer of public.accounting_payable_earning_sources
 *    (Union P&L report/straddle, weekly club statement summary/snapshot, fallback
 *    earned-plan v3, and own-agent contract interpretation/admission) reads gross
 *    original rake COALESCE((contract->>'rake_credit')::numeric, rake_credit) while
 *    keeping accounting_payable_earning_sources payable for commission & rakeback.
 * 2. server/src/services/supabase/bbj.ts never returns null directly when
 *    hand_bank_obligation_pending is absent without re-reading bbj_contributions
 *    (closing the concurrent-banker TOCTOU race from incident 7a0c2e25 forever).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sliceMethod } from './helpers/sourceWindow';

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const HARDEN_SQL = read(
  'supabase/migrations/20261124022200_harden_gross_original_rake_fallbacks_and_own_agent.sql'
);
const HARDEN_CODE = HARDEN_SQL.replace(/^--[^\n]*/gm, '');
const BBJ_TS = read('server/src/services/supabase/bbj.ts');

describe('gross original rake fallbacks and own-agent interpretation are hardened', () => {
  it('pins all three live preimages and patches earned_plan_v3, own_agent_interpreted_contract, and admit_own_agent_source', () => {
    expect(HARDEN_CODE).toContain("old_v3  CONSTANT text := 'e42fa0ee1e5d6ce48ad27ed79ed9ed53'");
    expect(HARDEN_CODE).toContain("old_oic CONSTANT text := '038e7a69161b7d9b8434fe270fe45f59'");
    expect(HARDEN_CODE).toContain("old_adm CONSTANT text := '4977d4df8d76714ca36bd1d5f3471e61'");
    expect(HARDEN_CODE).toContain('GROSS ORIGINAL RAKE HARDENING (20261124022200)');
    expect(HARDEN_CODE).toContain('fn_ca_promo_payable_contract(canonical');
    expect(HARDEN_CODE).toContain(
      "COALESCE((s.contract->>''promo_excluded_credit'')::numeric,0) IS DISTINCT FROM s.rake_credit"
    );
  });

  it('proves all three patched functions before commit and carries @live-proof', () => {
    expect(HARDEN_SQL).toMatch(/^-- @probe-for: public\.fn_accounting_union_earned_plan_v3$/m);
    expect(HARDEN_SQL).toMatch(/^-- @probe-for: smarter_private\.own_agent_interpreted_contract$/m);
    expect(HARDEN_SQL).toMatch(/^-- @probe-for: smarter_private\.admit_own_agent_source$/m);
    expect(HARDEN_CODE).toContain('probe-unwind');
    expect(HARDEN_CODE).toContain('HARDEN_GROSS_STALE_PIN');
    expect(HARDEN_SQL).toMatch(/^-- @live-proof: .*fn_accounting_union_earned_plan_v3/m);
  });

  it('leaves accounting_payable_earning_sources payable and never mutates ledgers', () => {
    expect(HARDEN_CODE).not.toMatch(
      /CREATE(?: OR REPLACE)? VIEW public\.accounting_payable_earning_sources/i
    );
    expect(HARDEN_CODE).not.toMatch(/INSERT INTO public\.chip_ledger/i);
  });
});

describe('BBJ payout closes the concurrent-banker TOCTOU race structurally (7a0c2e25)', () => {
  it('re-reads bbj_contributions via readContributionPoolId and checks hand_atomic_commits when hand_bank_obligation_pending is absent', () => {
    const fnBody = sliceMethod(BBJ_TS, 'async function bankThisHandsPendingDrop(');
    expect(fnBody).not.toMatch(/if\s*\(\s*!pending\?\.hand_id\s*\)\s*return\s+null\s*;/);
    expect(fnBody).toMatch(
      /if\s*\(\s*!pending\?\.hand_id\s*\)\s*\{[\s\S]*?readContributionPoolId\(params\)[\s\S]*?if\s*\(\s*banked\s*\)\s*return\s+banked\s*;/
    );
    expect(fnBody).toMatch(/from\(\s*['"]hand_atomic_commits['"]\s*\)/);
    expect(fnBody).toMatch(/\.is\(\s*['"]post_commit_completed_at['"]\s*,\s*null\s*\)/);
  });
});
