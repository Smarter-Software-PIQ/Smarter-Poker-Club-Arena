import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Promo-funded fees preserve gross rake and exclude free earnings', () => {
  it('runs native financial proof before retaining its result', () => {
    const workflow = readFileSync('.github/workflows/promo-play-through.yml', 'utf8');
    expect(workflow).toContain('supabase/migrations/*_promo_funded_fees_*.sql');
    expect(workflow).toContain('tests/fixtures/promo-fee-basis/**');
    expect(workflow).toContain('python3 -B scripts/ci/test-promo-fee-basis.py');
    expect(workflow).toContain('artifacts/promo-fee-basis/RESULTS.json');
    expect(workflow.indexOf('name: Retain the regression evidence')).toBeGreaterThan(
      workflow.indexOf('name: Promo fees preserve gross rake and exclude free earnings')
    );
  });

  it('keeps actual source accrual and certified rakeback owners in that proof', () => {
    const native = readFileSync('scripts/ci/test-promo-fee-basis.py', 'utf8');
    for (const owner of [
      'fn_accrue_cash_hand_commissions',
      'fn_capture_accounting_tournament_fee',
      'fn_post_accounting_commission_source',
      'fn_rakeback_split_write',
      'fn_ca_promo_play_through_fees_between',
    ])
      expect(native).toContain(owner);
    expect(native).toContain('concurrent.futures.ThreadPoolExecutor');
    expect(native).toContain('original_promo_entry_funding_missing');
    expect(native).toContain('fixture_second_tier_refusal');
  });
});
