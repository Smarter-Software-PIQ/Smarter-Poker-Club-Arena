/**
 * SPEC-FL-03 (Fixed-Limit lane, 2026-11-14). Live, fixed-limit hold'em hands
 * in the top 3 percent flat-called one river bet 61 percent of the time
 * heads-up, and those flat calls won 81 percent. The value raise clears its
 * bar easily (equity 0.95 to 0.99 against 0.72); what turns the raise into a
 * call is the no-limit frequency draw `fastRandom() < 0.55 x aggression +
 * checkRaiseFreq` (0.74 for the live Hybrid persona), written for a raise
 * that risks a stack. In fixed limit the raise risks one bet.
 *
 * Law (option fixedLimitRiverOneBetValueRaise, opt-in, default off): with
 * the option on, fixed-limit hold'em on the river facing exactly one wager
 * on an uncapped street, two pair or better whose equity against the betting
 * range clears the one-bet break-even always raises. One pair still calls
 * (the river one-pair raise ban stays). With the option off the same hands
 * still flat some of the time.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  FIXED_LIMIT_ONE_BET_RAISE_BREAK_EVEN,
  fixedLimitOneBetValueRaise,
} from './HorseFixedLimitWagerRead.js';
import { HU_RIVER_DONK, tally } from './FixedLimitWagerRead.test-support.js';

const flh = (hero: string) => `${hero} Qd Td Kh 9d 4c 7s 2d`;
afterEach(() => HorseMind.reset());

describe("fixed-limit hold'em: a strong hand raises one river bet (option on)", () => {
  it.each([
    ['top two pair', 'Kd 9h'],
    ['a set', '4h 4d'],
    ['bottom two pair', '4h 2h'],
  ])(
    '%s always raises, memory on and off; off it flats some of the time',
    (_name, hero) => {
      for (const mind of [true, false]) {
        const on = tally(
          'flh',
          2,
          flh(hero),
          HU_RIVER_DONK,
          {
            mind,
            fixedLimitRiverOneBetValueRaise: true,
          },
          20
        );
        expect(on).toEqual({ raise: 20 });
      }
      const off = tally('flh', 2, flh(hero), HU_RIVER_DONK, { mind: false }, 20);
      expect(off.call ?? 0).toBeGreaterThanOrEqual(3);
      expect(off.fold ?? 0).toBe(0);
    },
    120_000
  );

  it('top pair top kicker still calls: one pair does not raise the river', () => {
    expect(
      tally('flh', 2, flh('Kd Ah'), HU_RIVER_DONK, {
        mind: true,
        fixedLimitRiverOneBetValueRaise: true,
      })
    ).toEqual({ call: 12 });
  }, 120_000);

  it("the rule is one wager, river, hold'em, uncapped; the bar is 0.60", () => {
    const spot = {
      isFixedLimit: true,
      isOmaha: false,
      isRiver: true,
      wagersOnStreet: 1,
      wagersCapped: false,
      raiseLegal: true,
    };
    expect(FIXED_LIMIT_ONE_BET_RAISE_BREAK_EVEN).toBe(0.6);
    expect(fixedLimitOneBetValueRaise(spot)).toBe(true);
    for (const off of [
      { isFixedLimit: false },
      { isOmaha: true },
      { isRiver: false },
      { wagersOnStreet: 2 },
      { wagersOnStreet: 0 },
      { wagersCapped: true },
      { raiseLegal: false },
    ])
      expect(fixedLimitOneBetValueRaise({ ...spot, ...off })).toBe(false);
  });
});
