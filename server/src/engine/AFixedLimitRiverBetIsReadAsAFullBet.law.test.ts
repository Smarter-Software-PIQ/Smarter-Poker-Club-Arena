/**
 * SPEC-FL-01 (Fixed-Limit lane, 2026-11-14). Every range read of a bettor is
 * keyed on the size of the bet (HorseMind's texture-expected fraction and
 * 20-big-blind mark, HorseEval's 0.7-pot tier step and big-bet contact
 * setting). A fixed-limit bet is 0.1 to 0.33 of the pot, so a fixed-limit
 * river bettor was sampled as a small no-limit bettor: heads-up on
 * K-9-4-7-2 about 37 percent of his sampled hands held no pair, and bottom
 * pair was priced at 0.35 against a price of 0.20 (an independent count
 * against the top 35 percent of holdings plus 5 percent bluffs gives 0.08).
 * Live, heads-up river calls with bottom-half hands won 3.8 percent (n=581)
 * and three-way river calls with two pair on a no-low flo8 board 4.0 percent
 * (n=480).
 *
 * Law (option fixedLimitRiverFullBetRead, opt-in, default off): with the
 * option on, a fixed-limit river wager is read as a full bet. The junk
 * folds; a hand that beats value still continues; a second pair still calls,
 * also in a larger pot; a nut low is never folded. With the option off the
 * old calls are still made (the control that keeps this law from being
 * vacuous, and the pin that off is today's brain).
 *
 * The opponent-intelligence layer is on (`mind: true`, the production
 * default): the reads this law is about do not exist with it off.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import {
  HU_LARGE_POT_DONK,
  HU_ONE_RIVER_BET,
  HU_RIVER_DONK,
  HU_THREE_BARRELS,
  THREE_WAY_BET_CALL,
  tally,
} from './FixedLimitWagerRead.test-support.js';

const ON = { mind: true, fixedLimitRiverFullBetRead: true } as const;
const OFF = { mind: true } as const;
afterEach(() => HorseMind.reset());

// flh heads-up, board K 9 4 7 2 rainbow; the opponent holds Qd Td (never shown to the policy).
const flh = (hero: string) => `${hero} Qd Td Kh 9d 4c 7s 2d`;
// flo8, board K Q J 7 2: no low is possible, the game is Omaha high.
const O_BETTOR = 'Ac Tc 9d 6s';
const O_CALLER = 'Ad Th 9c 8s';
const NO_LOW = 'Ks Qd Jh 7c 2s';
// flo8, board K Q 8 5 3: a low is possible.
const LOW_BOARD = 'Ks Qd 8h 5c 3s';

describe('a fixed-limit river bet is read as a full bet (option on)', () => {
  it('flh heads-up, pot 16, 4 to call: queen high and bottom pair fold', () => {
    expect(tally('flh', 2, flh('Qc Jc'), HU_RIVER_DONK, ON)).toEqual({ fold: 12 });
    expect(tally('flh', 2, flh('2c 3c'), HU_RIVER_DONK, ON)).toEqual({ fold: 12 });
  }, 120_000);

  it('flh heads-up: top two pair never folds, and second pair still calls', () => {
    expect(tally('flh', 2, flh('Kd 9h'), HU_RIVER_DONK, ON).fold ?? 0).toBe(0);
    expect(tally('flh', 2, flh('9h Jh'), HU_RIVER_DONK, ON)).toEqual({ call: 12 });
  }, 120_000);

  it('flh heads-up, a larger pot (32, 4 to call): second pair is not turned into a fold', () => {
    const second = tally('flh', 2, flh('9h Jh'), HU_LARGE_POT_DONK, ON, 20);
    expect(second.fold ?? 0).toBeLessThanOrEqual(2);
    expect(tally('flh', 2, flh('Kd 9h'), HU_LARGE_POT_DONK, ON).fold ?? 0).toBe(0);
  }, 120_000);

  it('flo8 three-way, no low possible, a bet and a call in front: one pair folds, two pair folds more than it calls', () => {
    const deck = (hero: string) => `${hero} ${O_BETTOR} ${O_CALLER} ${NO_LOW}`;
    expect(tally('flo8', 3, deck('Kd 6h 5c 4d'), THREE_WAY_BET_CALL, ON, 20)).toEqual({ fold: 20 });
    for (const twoPair of ['Kd Qh 5c 4d', '7d 2h Kc 9h']) {
      const on = tally('flo8', 3, deck(twoPair), THREE_WAY_BET_CALL, ON, 20);
      expect(on.fold ?? 0).toBeGreaterThan(on.call ?? 0);
    }
    // the nut straight is still a raise
    expect(tally('flo8', 3, deck('As Td 5c 4d'), THREE_WAY_BET_CALL, ON)).toEqual({ raise: 12 });
  }, 240_000);

  it('flo8 heads-up, no low possible: one pair folds to one river bet, top two pair continues', () => {
    const deck = (hero: string) => `${hero} ${O_BETTOR} ${NO_LOW}`;
    expect(tally('flo8', 2, deck('Kd 6h 5c 4d'), HU_ONE_RIVER_BET, ON)).toEqual({ fold: 12 });
    expect(tally('flo8', 2, deck('Kd Qh 5c 4d'), HU_ONE_RIVER_BET, ON).fold ?? 0).toBe(0);
  }, 120_000);

  it('flo8 heads-up: a nut low is never folded, a hand with no low and no pair still is', () => {
    const deck = (hero: string) => `${hero} Kc 7d 9c 7s ${LOW_BOARD}`;
    for (const nutLow of ['Ac 2d Jh Th', 'Ac 2d Kh Th'])
      for (const opts of [ON, OFF])
        expect(tally('flo8', 2, deck(nutLow), HU_THREE_BARRELS, opts).fold ?? 0).toBe(0);
    expect(tally('flo8', 2, deck('Jc Td 9h 9d'), HU_THREE_BARRELS, ON)).toEqual({ fold: 12 });
  }, 240_000);
});

describe('with the option off the old calls are still made', () => {
  it('flh heads-up bottom pair calls; flo8 three-way two pair never folds', () => {
    expect(tally('flh', 2, flh('2c 3c'), HU_RIVER_DONK, OFF)).toEqual({ call: 12 });
    expect(
      tally('flo8', 3, `Kd Qh 5c 4d ${O_BETTOR} ${O_CALLER} ${NO_LOW}`, THREE_WAY_BET_CALL, OFF)
    ).toEqual({ call: 12 });
  }, 120_000);
});
