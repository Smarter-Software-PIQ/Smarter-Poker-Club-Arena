import { describe, expect, it } from 'vitest';
import { cashAutoTopUpTarget, cashBuyInRange, cashBuyInLabel } from '../../src/lib/cashBuyIn';
describe('fixed-limit has a minimum and no table maximum', () => {
  it.each(['flh', 'flo8'])('does not restore a 200BB cap for %s', (game_variant) => {
    expect(
      cashBuyInRange({ game_variant, big_blind: 10, min_buy_in: 400, max_buy_in: null })
    ).toEqual({ min: 400, max: 0, unlimited: true });
    expect(
      cashBuyInRange({ game_variant, big_blind: 10, min_buy_in: 400, max_buy_in: 2000 })
    ).toEqual({ min: 400, max: 0, unlimited: true });
    expect(cashBuyInLabel({ game_variant, big_blind: 10, min_buy_in: 400 })).toBe(
      '400 Min / No Maximum'
    );
  });
  it('preserves no-limit and pot-limit maximums', () => {
    for (const game_variant of ['nlh', 'plo4'])
      expect(
        cashBuyInRange({ game_variant, big_blind: 2, min_buy_in: 80, max_buy_in: 400 })
      ).toEqual({ min: 80, max: 400 });
  });
});

it('keeps the voluntary auto-top-up target in actual blinds while admission stays uncapped', () => {
  const table = { game_variant: 'flh', big_blind: 2, min_buy_in: 80, max_buy_in: null };
  expect(cashAutoTopUpTarget(table)).toBe(400);
  expect(cashBuyInRange(table).max).toBe(0);
  expect(cashAutoTopUpTarget({ ...table, big_blind: null })).toBe(0);
});
