import { describe, expect, it } from 'vitest';
import { isBountyOnlyPko, resolvePayoutStructure } from '../../src/lib/payoutStructure';

// Dan, 2026-11-05: a PKO Free Buy pays only for eliminations (50% to the
// eliminator's wallet, 50% onto their head); the last player standing keeps
// their own bounty; 0 places are paid for finishing position.
const ladder = [
  { place: 1, percentage: 50 },
  { place: 2, percentage: 30 },
  { place: 3, percentage: 20 },
];

describe('a bounty-only PKO pays no places', () => {
  it('a free-entry PKO with no guarantee and no place money shows zero paid places', () => {
    const t = {
      is_pko: true,
      buy_in_amount: 0,
      guaranteed_prize: 0,
      prize_pool: 0,
      payout_structure: ladder,
    };
    expect(isBountyOnlyPko(t)).toBe(true);
    expect(resolvePayoutStructure(t)).toEqual([]);
  });

  it('a paid PKO keeps its place ladder', () => {
    const t = {
      is_pko: true,
      buy_in_amount: 18,
      guaranteed_prize: 750,
      prize_pool: 0,
      payout_structure: ladder,
    };
    expect(isBountyOnlyPko(t)).toBe(false);
    expect(resolvePayoutStructure(t)).toHaveLength(3);
  });

  it('a free PKO that somehow holds place money or a guarantee is not hidden', () => {
    expect(
      isBountyOnlyPko({ is_pko: true, buy_in_amount: 0, guaranteed_prize: 0, prize_pool: 250 })
    ).toBe(false);
    expect(
      isBountyOnlyPko({ is_pko: true, buy_in_amount: 0, guaranteed_prize: 500, prize_pool: 0 })
    ).toBe(false);
    expect(
      isBountyOnlyPko({ is_pko: false, buy_in_amount: 0, guaranteed_prize: 0, prize_pool: 0 })
    ).toBe(false);
  });

  it('a free mystery bounty PKO is never bounty only: its chests pay in the money', () => {
    const t = {
      is_pko: true,
      is_mystery_bounty: true,
      buy_in_amount: 0,
      guaranteed_prize: 0,
      prize_pool: 0,
      payout_structure: ladder,
    };
    expect(isBountyOnlyPko(t)).toBe(false);
    expect(resolvePayoutStructure(t)).toHaveLength(3);
  });
});
