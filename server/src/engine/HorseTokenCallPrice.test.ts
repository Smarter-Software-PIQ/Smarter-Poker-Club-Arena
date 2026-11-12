import { describe, expect, it } from 'vitest';
import {
  TOKEN_CALL_COUNTED_PRICE,
  TOKEN_CALL_PRICE,
  tokenCallIsCovered,
  tokenCallPriceApplies,
  tokenCallRequiredEquity,
} from './HorseTokenCallPrice.js';

describe('a token-priced call is not barred by stack-off premiums (PLO6-AUDIT-010)', () => {
  it('hand 58750626 seat 2: 3 chips into 2,577 needs a fraction of a percent, not the premium', () => {
    const potOdds = 3 / 2580;
    const legacy = potOdds + 0.02 + 0.07 + 0.05;
    expect(legacy).toBeGreaterThan(0.14);
    const bar = tokenCallRequiredEquity(potOdds, legacy);
    expect(bar).toBeLessThan(0.003);
    expect(bar).toBeGreaterThan(potOdds);
  });

  it('hand 58750626 seat 4: 131 into 2,577 keeps a reduced premium above its price', () => {
    const potOdds = 131 / 2708;
    const legacy = potOdds + 0.02 + 0.07 + 0.05;
    const bar = tokenCallRequiredEquity(potOdds, legacy);
    expect(bar).toBeGreaterThan(potOdds);
    expect(bar).toBeLessThan(0.1);
  });

  it('at or above the token price the bar is the same number, bit for bit', () => {
    for (const potOdds of [TOKEN_CALL_PRICE, 0.2, 0.25, 1 / 3, 0.5]) {
      const legacy = potOdds + 0.02 + 0.12 + 0.05;
      expect(Object.is(tokenCallRequiredEquity(potOdds, legacy), legacy)).toBe(true);
    }
  });

  it('the bar never drops below the price, rises with the price and is continuous at the edge', () => {
    let last = -1;
    for (let p = 0; p < TOKEN_CALL_PRICE; p += 0.005) {
      const bar = tokenCallRequiredEquity(p, p + 0.14);
      expect(bar).toBeGreaterThanOrEqual(p);
      expect(bar).toBeGreaterThan(last);
      last = bar;
    }
    const justBelow = TOKEN_CALL_PRICE - 1e-9;
    expect(tokenCallRequiredEquity(justBelow, justBelow + 0.14)).toBeCloseTo(
      TOKEN_CALL_PRICE + 0.14,
      6
    );
  });

  it('a bar already at or under the price (a bounty credit) and bad numbers are left alone', () => {
    expect(tokenCallRequiredEquity(0.05, 0.04)).toBe(0.04);
    expect(tokenCallRequiredEquity(0.05, 0.05)).toBe(0.05);
    expect(Number.isNaN(tokenCallRequiredEquity(Number.NaN, 0.2))).toBe(false);
    expect(tokenCallRequiredEquity(-0.1, 0.2)).toBe(0.2);
  });

  it('under one percent a river call is covered by the counted bound, and a hopeless hand is not', () => {
    const price = 3 / 2580;
    // A set that half of all random hands beat: 0.52 / 20 clears 0.12%.
    expect(tokenCallIsCovered(price, 0.48)).toBe(true);
    // A hand 98% of random hands beat: 0.02 / 20 = 0.1% does not clear 0.12%.
    expect(tokenCallIsCovered(price, 0.98)).toBe(false);
    expect(tokenCallIsCovered(price, 1)).toBe(false);
    // Not the river, or no count available: never covered.
    expect(tokenCallIsCovered(price, null)).toBe(false);
    // At or above one percent the clause does not speak.
    expect(tokenCallIsCovered(TOKEN_CALL_COUNTED_PRICE, 0)).toBe(false);
    expect(tokenCallIsCovered(131 / 2708, 0.46)).toBe(false);
    expect(tokenCallIsCovered(Number.NaN, 0.1)).toBe(false);
    expect(tokenCallIsCovered(price, 1.2)).toBe(false);
  });

  it('applies to Omaha high cash on one ordinary board and to nothing else', () => {
    const cash = {
      enabled: true,
      isOmaha: true,
      isHiLo: false,
      tournament: false,
      multiBoard: false,
      bombPot: false,
    };
    expect(tokenCallPriceApplies(cash)).toBe(true);
    for (const off of [
      { enabled: false },
      { isOmaha: false },
      { isHiLo: true },
      { tournament: true },
      { multiBoard: true },
      { bombPot: true },
    ])
      expect(tokenCallPriceApplies({ ...cash, ...off })).toBe(false);
  });
});
