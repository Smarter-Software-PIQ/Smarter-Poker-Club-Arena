import { expect, it } from 'vitest';
import { mttPaidAuthority } from '../e2e/support/mttPaidAuthority';

const midnight = {
  tournament_type: 'MTT',
  prize_pool_finalized: true,
  is_pko: true,
  is_mystery_bounty: false,
  buy_in_amount: 0,
  guaranteed_prize: 0,
  prize_pool: 0,
  payout_structure: JSON.stringify(
    Array.from({ length: 26 }, (_, index) => ({ place: index + 1, percentage: 100 / 26 }))
  ),
};

it('expects zero paid places for a finalized bounty-only PKO with a compatibility ladder', () => {
  expect(mttPaidAuthority(midnight).expected).toBe(0);
});

it('requires the economics to be present before certifying zero', () => {
  const { prize_pool: omitted, ...partial } = midnight;
  expect(omitted).toBe(0);
  expect(() => mttPaidAuthority(partial)).toThrow('missing PKO authority: prize_pool');
});

it('reads funded and mystery ladders and preserves omission rules', () => {
  for (const control of [
    { buy_in_amount: 1 },
    { guaranteed_prize: 1 },
    { prize_pool: 1 },
    { is_mystery_bounty: true },
  ]) {
    expect(mttPaidAuthority({ ...midnight, ...control }).expected).toBe(26);
  }
  for (const control of [
    { prize_pool_finalized: false },
    { tournament_type: 'SATELLITE' },
    { satellite_target_id: 'target' },
    { prize_pool: 1, payout_structure: 'invalid' },
  ]) {
    expect(mttPaidAuthority({ ...midnight, ...control }).expected).toBeNull();
  }
});
