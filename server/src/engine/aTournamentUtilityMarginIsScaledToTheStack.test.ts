/**
 * THE TOURNAMENT UTILITY'S MARGIN IS SCALED TO THE STACK (2026-11-15, option
 * tournamentUtilityStackScaledMargin, read === true, default OFF).
 *
 * The payout check measured its equity-uncertainty margin against the whole payout pool, wider than a short
 * stack's whole tournament equity, so it could never overrule a short stack (hand 59441335). With the option on
 * the margin is the equity standard error times the candidate's own utility sensitivity, never wider than before.
 *
 * Pinned here: off is byte-identical; the option only ever removes a shove or a call, it never turns a fold into
 * a call or a shove (the committed-stack law's folds and calls are unchanged, bubble A7o and seven-deuce
 * included); the owner's rulings hold with it on.
 */
import { describe, expect, it } from 'vitest';
import { SPOTS, build, decideBuilt } from './ACommittedStackIsNotFoldedAtAPrice.test-support.js';
import {
  HAND_STACKS,
  callSpot,
  decideSeeds,
  share,
  type SpotSpec,
} from './AShortStackJamPricesThePayJump.test-support.js';

const ON = { tournamentUtilityStackScaledMargin: true } as const;
const OFF = { tournamentUtilityStackScaledMargin: false } as const;

describe('off is the decision it was', () => {
  it('unset equals explicit false, seed for seed, at the short-stack nodes', () => {
    for (const hand of ['85o', '72o', 'A5o', '66'])
      expect(decideSeeds({ hand }, 4), hand).toEqual(decideSeeds({ hand }, 4, OFF));
    for (const hand of ['JTs', 'A8o', '72o'])
      expect(decideSeeds(callSpot(hand), 4), hand).toEqual(decideSeeds(callSpot(hand), 4, OFF));
  });
});

describe('the committed-stack law is untouched by the option', () => {
  for (const spot of SPOTS)
    it(`${spot.name}: on equals off with the committed-stack option absent and on, priced and mispriced`, () => {
      for (const arm of ['absent', true] as const)
        for (const pool of ['priced', 'mispriced'] as const) {
          const built = build(spot, pool);
          for (const seed of [1, 2]) {
            const off = decideBuilt(built, seed, arm);
            const on = decideBuilt(built, seed, arm, ON);
            expect(on.action, `${arm} ${pool} seed ${seed}`).toBe(off.action);
          }
        }
    });
});

describe('the option only removes a shove or a call, it never adds one', () => {
  const never = (off: string[], on: string[], label: string) =>
    off.forEach((action, i) => {
      if (action.startsWith('fold')) expect(on[i], `${label} seed ${i + 1}`).toBe(action);
    });
  it('the 2.1bb folded-to jam of hand 59441335: strong hands still jam, trash jams no more often', () => {
    for (const hand of ['85o', 'A5o', 'KQo', '66', 'T9s'])
      expect(decideSeeds({ hand }, 6, ON), hand).toEqual(decideSeeds({ hand }, 6));
    for (const hand of ['72o', '32o']) {
      const off = decideSeeds({ hand }, 6);
      const on = decideSeeds({ hand }, 6, ON);
      never(off, on, hand);
      expect(share(on, 'all_in'), hand).toBeLessThanOrEqual(share(off, 'all_in'));
    }
  });
  it('the bubble call against a jam: seven-deuce stays a fold, pairs and aces still call', () => {
    expect(share(decideSeeds(callSpot('72o'), 6, ON), 'call')).toBe(0);
    expect(share(decideSeeds(callSpot('72o'), 6, ON), 'all_in')).toBe(0);
    for (const hand of ['A8o', 'KTo', '66', 'A7o'])
      expect(decideSeeds(callSpot(hand), 6, ON), hand).toEqual(decideSeeds(callSpot(hand), 6));
    const off = decideSeeds(callSpot('JTs'), 6);
    const on = decideSeeds(callSpot('JTs'), 6, ON);
    never(off, on, 'JTs');
    expect(share(on, 'all_in')).toBeLessThanOrEqual(share(off, 'all_in'));
  });
});

describe('owner rulings hold with the option on', () => {
  it('a 25bb big blind calls a 2.5bb jam with almost anything', () => {
    const crumbs = (hand: string): SpotSpec => ({
      stacks: { ...HAND_STACKS, 6: 15_000, 9: 150_000 },
      hero: 9,
      hand,
      jammer: 6,
      foldedAfterJam: [7, 8],
    });
    const weak = ['72o', '32o', '83o', '94o', 'T2o', 'J3o', 'Q4o', '85o', '62o', 'K2o'];
    const rate =
      weak.reduce((sum, hand) => sum + share(decideSeeds(crumbs(hand), 4, ON), 'call'), 0) /
      weak.length;
    expect(rate).toBeGreaterThanOrEqual(0.9);
  });
  it('no open-shove from under the gun at 20bb or 35bb', () => {
    for (const chips of [120_000, 210_000])
      for (const hand of ['AA', '77', 'AKo', 'KQo', 'T9s'])
        expect(
          share(
            decideSeeds(
              { stacks: { ...HAND_STACKS, 1: chips }, hero: 1, hand, foldedBefore: [] },
              2,
              ON
            ),
            'all_in'
          ),
          `${hand} ${chips}`
        ).toBe(0);
  });
});
