import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Owner rule 2026-11-05: the FULL qualifying buy-in counts toward a
// tournament's guarantee before bounty or rake allocations. 40 paid as
// 26 prize / 10 bounty / 4 rake counts 40. House/promo funding is
// H = max(0, G - C), and zero once C >= G, on every path.
// The money paths run on production's own code in
// scripts/ci/test-guarantee-counts-the-full-buy-in.py; this pins the shape.
const MIG = 'supabase/migrations/20261105220120_a_guarantee_counts_the_full_buy_in.sql';
const sql = readFileSync(MIG, 'utf8');
const code = sql.replace(/--[^\n]*/g, ' ');

describe('a guarantee counts the full buy-in', () => {
  it('subtracts the players bounty AND rake from the guarantee to get the prize floor', () => {
    expect(code).toMatch(
      /CREATE FUNCTION public\.fn_ca_place_guarantee_gross\(p_guarantee numeric, p_bounty_pool numeric, p_rake numeric\)/
    );
    expect(code).toContain('- greatest(0, round(coalesce(p_rake,0),2))');
  });

  it('patches every reader of the floor, guarded by its production md5', () => {
    for (const sig of [
      'fn_ca_overlay_shortfall(uuid)',
      'fn_ca_apply_prize_guarantee_core(uuid,text)',
      'fn_apply_prize_guarantee_before_atomic_proof(uuid,text)',
      'fn_poker_diamond_tournament_effective_guarantee(uuid)',
      'fn_ca_prize_overpay_unexplained(interval)',
      'fn_ca_tournament_settlement_mismatch(interval)',
      'fn_settle_tournament_places_atomic(uuid,text)',
      'fn_settle_final_table_deal_atomic(uuid)',
      'fn_ca_fund_overlay_on_lock()',
      'trg_tournament_atomic_place_completion_guard()',
      'fn_ca_return_excess_start_overlay_locked(uuid)',
      'fn_settle_tournament_places(uuid,uuid)',
      'fn_settle_tournament_final_table_deal(uuid)',
    ]) {
      expect(code).toContain(`('public.${sig}',`);
    }
    expect(code).toContain("RAISE EXCEPTION 'Inspected definition changed: %', r.sig;");
    expect(code).toContain('t.total_rake)');
    expect(code).toContain('NEW.total_rake)');
  });

  it('takes the last grant away from the legacy back-pay without redefining it', () => {
    expect(code).not.toContain(
      'CREATE OR REPLACE FUNCTION public.fn_ca_backpay_guarantee_shortfalls'
    );
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.fn_ca_backpay_guarantee_shortfalls\(boolean,integer\)\s+FROM PUBLIC, anon, authenticated, service_role;/
    );
    expect(code).not.toMatch(
      /GRANT EXECUTE ON FUNCTION public\.fn_ca_backpay_guarantee_shortfalls/
    );
  });

  it('records over- and under-funding without moving chips', () => {
    const body = code.slice(
      code.indexOf('CREATE FUNCTION public.fn_ca_guarantee_funding_variance_scan')
    );
    const fn = body.slice(0, body.indexOf('$function$;'));
    expect(fn).toContain('ca_guarantee_funding_variances');
    expect(fn).not.toMatch(/chip_balance|chip_treasury|promo_wallet|chip_ledger/);
    expect(code).toContain("cron.schedule('ca-guarantee-funding-variance-15m'");
  });
});
