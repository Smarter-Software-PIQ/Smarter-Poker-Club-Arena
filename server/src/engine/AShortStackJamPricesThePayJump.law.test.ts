/**
 * LAW: A SHORT-STACK JAM PRICES THE PAY JUMP (2026-11-15, hand 59441335).
 *
 * At a nine-handed final table of an 86-entrant bounty freezeout (13 paid,
 * in the money), a Horse in the cutoff with 2.1 big blinds open-jammed 85o.
 * The folded-to jam read the chip-EV Nash table (HorseAnteAwarePushFold),
 * which jams 99.6% of hands at that depth: nothing priced the payouts. The
 * payout-aware read (nashPushFoldIcm) shipped opt-in.
 *
 * nashPushFoldIcm STAYS DEFAULT OFF. It changes a preflop range, so it is
 * held by the owner's preflop range hold until he lifts it by name (the
 * option switch registers it off-only). What ships live is the plain repair
 * underneath it: a bust in the money is worth its place (IcmModel
 * bubbleFactor), which every live bubble-factor reader now prices.
 *
 * What this law holds:
 *  0. Unset is the chip-EV decision, seed for seed, and the receipt does
 *     not fire: nothing here changes live play until the option is lifted.
 *  1. With the option on, a pay jump live and the stacks, payouts and
 *     hero's identity in the trusted context, the jam and the call against
 *     a jam read hero's bubble factor (payJumpBubbleFactor), moved toward 1
 *     by the payout weight prize / (prize + bounty), and a bust is worth the
 *     place it finishes, not zero.
 *  2. Sensible jams at 2.1bb still jam; the bottom of the chip-EV range
 *     tightens (option on).
 *  3. Where no pay jump is live, the data is missing or untrusted, and in
 *     satellites, PKOs, mystery bounties, bounty-only events, heads-up,
 *     cash, Omaha and fixed limit, the option-on decision is exactly the
 *     default (chip-EV) one.
 *  4. With the option on, the call against a jam is tighter than chip EV on
 *     the bubble and in the money, unchanged where no pay jump is live, and
 *     priced on the chips contested: a deep stack still calls a crumbs jam.
 *  5. Owner rulings, in both arms: a 20bb+ stack calls a jam of under 3bb
 *     with almost anything; no open-shove from under the gun at 20bb or
 *     from 35bb.
 *
 * What it does not hold: the reported hand's 85o. With ninth place paid
 * whatever happens, hero's bubble factor is about 1.17 (bubbleFactor said 5
 * until 2026-11-15, when it priced a bust at zero), and at that factor
 * the payout-aware table still jams 85o at 2.1bb. The Phase 7 arbiter's
 * band units (equity error x 100 x payout weight) are not changed here: the
 * corrected units overrule bubble folds that ACommittedStackIsNotFoldedAtAPrice
 * holds. The changelog states both.
 */
import { describe, expect, it } from 'vitest';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { payJumpBubbleFactor } from './HorseLogic.js';
import { nashJamProbability } from './HorseAnteAwarePushFold.js';
import { nashV2JamProbability } from './HorseNashPushFoldV2.js';
import { bubbleFactor, icmEquity, withIcmBustPaysPlace } from './IcmModel.js';
import {
  BOUNTY_FREEZEOUT,
  HAND_STACKS,
  NO_BOUNTY,
  PAYOUT_86,
  buildSpot,
  callSpot,
  decideSeeds,
  repositoryPayoutLadder,
  share,
  type SpotSpec,
} from './AShortStackJamPricesThePayJump.test-support.js';

const HAND_STACK_VECTOR = Object.values(HAND_STACKS).sort((a, b) => b - a);
const HERO_INDEX = HAND_STACK_VECTOR.indexOf(12_609);
const WEIGHT =
  BOUNTY_FREEZEOUT.prizePoolCents /
  (BOUNTY_FREEZEOUT.prizePoolCents + BOUNTY_FREEZEOUT.bountyPoolCents);
/** The option-on arm (default OFF, owner preflop range hold). */
const ON = { nashPushFoldIcm: true, icmBustPaysPlace: true } as const;
/** The paid-bust valuation alone (icmBustPaysPlace): the baseline the payout-aware read is compared with. */
const BUST_ONLY = { icmBustPaysPlace: true } as const;
const factorAt = (spec: SpotSpec) => {
  const { gs, hero } = buildSpot(spec);
  // with icmBustPaysPlace on, as HorseLogic.decide scopes it for the ON arm
  return withIcmBustPaysPlace(true, () =>
    payJumpBubbleFactor(gs, hero.stack / gs.bigBlind, hero.user_id)
  );
};

describe('nashPushFoldIcm is default OFF: unset is the chip-EV decision', () => {
  it('at the reported node and the bubble call, unset equals explicit false seed for seed', () => {
    for (const hand of ['85o', '72o', '32o', 'A5o', 'KQo']) {
      expect(decideSeeds({ hand }, 15), hand).toEqual(
        decideSeeds({ hand }, 15, { nashPushFoldIcm: false })
      );
    }
    for (const hand of ['A8o', 'KTo', 'JTs', '66']) {
      expect(decideSeeds(callSpot(hand), 10), hand).toEqual(
        decideSeeds(callSpot(hand), 10, { nashPushFoldIcm: false })
      );
    }
  });

  it('unset, the receipt does not fire', () => {
    enableBrainTelemetry();
    drainFires();
    decideSeeds({ hand: '72o' }, 1, { telemetry: true });
    expect(drainFires().find((row) => row.feature === 'pay_jump_push_fold_seen')).toBeUndefined();
  });
});

describe('hand 59441335: with the option on, the jam reads the payouts', () => {
  it('builds the repository ladder for 86 entrants: 13 places summing to 100', () => {
    expect(PAYOUT_86).toHaveLength(13);
    expect(PAYOUT_86.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(repositoryPayoutLadder(20)).toHaveLength(3);
  });

  it('a bust in the money is worth its place, so the factor is not pinned at the cap', () => {
    // Until 2026-11-15 bubbleFactor priced this bust at zero and read 5.
    const factor = withIcmBustPaysPlace(true, () =>
      bubbleFactor(HAND_STACK_VECTOR, PAYOUT_86, HERO_INDEX, 12_609)
    );
    expect(factor).toBeGreaterThan(1.1);
    expect(factor).toBeLessThan(1.3);
    expect(factorAt({ hand: '85o' })).toBeCloseTo(1 + (factor - 1) * WEIGHT, 9);
    expect(factorAt({ hand: '85o', tournament: NO_BOUNTY })).toBeCloseTo(factor, 9);
  });

  it('outside the money a bust pays nothing: the factor is the zero-bust one', () => {
    const stacks = [9_000, 6_000, 3_000, 1_500, 500];
    for (let hero = 1; hero < stacks.length; hero++) {
      const now = icmEquity(stacks, [50, 30, 20], hero);
      const up = stacks.slice();
      up[hero] += stacks[hero];
      up[0] -= stacks[hero];
      const zeroBust = Math.min(5, Math.max(1, now / (icmEquity(up, [50, 30, 20], hero) - now)));
      expect(bubbleFactor(stacks, [50, 30, 20], hero, stacks[hero])).toBeCloseTo(zeroBust, 12);
    }
  });

  it('the jam is the payout-aware table at that factor, and the receipt says so', () => {
    for (const hand of ['85o', '72o', '32o', 'K5o']) {
      const { gs, hero } = buildSpot({ hand });
      const bf = payJumpBubbleFactor(gs, hero.stack / gs.bigBlind, hero.user_id)!;
      const expected = nashV2JamProbability({
        hand,
        behind: 3,
        depthBB: 12_609 / 6_000,
        anteBB: 1,
        bubble: bf,
      });
      const chipEv = nashJamProbability({ hand, behind: 3, depthBB: 12_609 / 6_000, anteBB: 1 });
      expect(chipEv).not.toBeNull();
      expect(expected).toBeLessThanOrEqual(chipEv!);
    }
    enableBrainTelemetry();
    drainFires();
    decideSeeds({ hand: '72o' }, 1, { telemetry: true, ...ON });
    const fired = drainFires().find((row) => row.feature === 'pay_jump_push_fold_seen');
    expect(fired?.fires).toBe(1);
  });

  it('the verdict: 85o at the reported node still jams, in both arms', () => {
    // 2.1bb, 15,000 already in the pot, ninth paid either way: the honest
    // factor is about 1.17 and the payout-aware table jams 85o to about 3bb.
    expect(share(decideSeeds({ hand: '85o' }, 40), 'all_in')).toBe(1);
    expect(share(decideSeeds({ hand: '85o' }, 40, ON), 'all_in')).toBe(1);
  });

  it('the bottom of the chip-EV range tightens: 72o and 32o mostly fold', () => {
    expect(share(decideSeeds({ hand: '72o' }, 40, ON), 'all_in')).toBeLessThan(0.25);
    expect(share(decideSeeds({ hand: '32o' }, 40, ON), 'all_in')).toBe(0);
    // The same seeds jammed both at chip EV, the default.
    expect(share(decideSeeds({ hand: '72o' }, 40), 'all_in')).toBe(1);
  });

  it('sensible jams at 2.1bb still jam every time', () => {
    const hands = [
      'AA',
      'TT',
      '77',
      '44',
      '22',
      'AKo',
      'AJo',
      'A9o',
      'A5o',
      'A2o',
      'A7s',
      'A2s',
      'KQo',
      'KQs',
      'KJs',
      'KTs',
      'QJs',
      'QTs',
      'JTs',
      'T9s',
      '98s',
      '87s',
      '65s',
      '54s',
    ];
    for (const hand of hands) {
      expect(share(decideSeeds({ hand }, 20, ON), 'all_in'), hand).toBe(1);
      expect(share(decideSeeds({ hand, tournament: NO_BOUNTY }, 10, ON), 'all_in'), hand).toBe(1);
      expect(share(decideSeeds({ hand }, 10), 'all_in'), hand).toBe(1);
    }
  });
});

describe('where no payout-aware read applies the decision is the chip-EV one', () => {
  const early = {
    playersLeft: 70,
    inMoney: false,
    finalTable: false,
    nearBubble: false,
    handForHand: false,
    handForHandExpected: false,
  };
  const contexts: Record<string, SpotSpec> = {
    'bounty-only event (payout weight 0)': {
      tournament: { prizePoolCents: 0, bountyPoolCents: 21_500, bountyFactor: 1 },
    },
    'early level, no pay jump live': { tournament: early },
    'no stack vector': { tournament: { stacks: [], stackByUser: {} } },
    'no payouts': { tournament: { payoutPct: [] } },
    'untrusted context': { tournament: { contextStatus: 'incomplete' } },
    satellite: { tournament: { satellite: true, satelliteSeats: 3 } },
    PKO: { tournament: { isPko: true, bountyPoolCents: 21_500, bountyFactor: 0.25 } },
    'mystery bounty': {
      tournament: { isMysteryBounty: true, bountyPoolCents: 21_500, bountyFactor: 0.25 },
    },
    'heads-up': {
      stacks: { 6: 12_609, 9: 300_000 },
      dealer: 6,
      sb: 6,
      bb: 9,
      foldedBefore: [],
      tournament: { playersLeft: 2 },
    },
    'ante cash table': { tournament: null, gs: { gameMode: 'cash', format: undefined } },
  };
  for (const [name, spec] of Object.entries(contexts)) {
    it(`${name}: no factor, and with the option on every seed equals the default`, () => {
      expect(factorAt({ ...spec, hand: '85o' })).toBeNull();
      for (const hand of ['85o', '72o', 'A5o']) {
        expect(decideSeeds({ ...spec, hand }, 15, ON)).toEqual(
          decideSeeds({ ...spec, hand }, 15, BUST_ONLY)
        );
      }
    });
  }
  const omaha = [
    { rank: 'A', suit: 'hearts' },
    { rank: '8', suit: 'clubs' },
    { rank: '5', suit: 'hearts' },
    { rank: '2', suit: 'diamonds' },
  ];
  const variants: Record<string, SpotSpec> = {
    'pot-limit Omaha (plo4)': {
      holeCards: omaha,
      gs: { gameVariant: 'plo4', bettingStructure: 'pot_limit' },
    },
    "fixed-limit hold'em (flh)": {
      gs: {
        gameVariant: 'flh',
        bettingStructure: 'fixed_limit',
        fixedLimitSmallBet: 6000,
        fixedBetSize: 6000,
      },
    },
  };
  for (const [name, spec] of Object.entries(variants)) {
    it(`${name}: with the option on every seed equals the default`, () => {
      for (const hand of ['85o', 'A5o']) {
        expect(decideSeeds({ ...spec, hand }, 10, ON)).toEqual(
          decideSeeds({ ...spec, hand }, 10, BUST_ONLY)
        );
      }
    });
  }
});

describe('the call against a lone jam reads the pay jump too', () => {
  const CALLS = [
    '99',
    '66',
    '33',
    'AJo',
    'A8o',
    'A4o',
    'A2s',
    'KQo',
    'KJs',
    'KTo',
    'QJs',
    'Q9s',
    'JTs',
    'T9s',
  ];
  const bubble = {
    playersLeft: 14,
    inMoney: false,
    finalTable: false,
    nearBubble: true,
    handForHandExpected: true,
    stacks: [
      342_381, 310_173, 191_640, 150_000, 126_232, 124_308, 120_000, 90_000, 74_332, 69_856, 60_000,
      60_000, 38_469, 25_000,
    ],
  };
  const calls = (extra: Partial<SpotSpec>, opts: Record<string, unknown> = {}) =>
    CALLS.reduce(
      (sum, hand) => sum + share(decideSeeds(callSpot(hand, extra), 10, opts), 'call'),
      0
    );

  it('on the bubble and in the money the big blind calls tighter than chip EV (option on)', () => {
    expect(factorAt(callSpot('A8o', { tournament: bubble }))).toBeGreaterThan(2);
    expect(calls({ tournament: bubble }, ON)).toBeLessThan(calls({ tournament: bubble }) - 3);
    expect(calls({}, ON)).toBeLessThan(calls({}) - 3);
  });

  it('control: with no pay jump live the option-on call is the chip-EV call, seed for seed', () => {
    const early = { playersLeft: 70, inMoney: false, finalTable: false, nearBubble: false };
    for (const hand of ['66', 'A4o', 'KTo', 'JTs']) {
      expect(decideSeeds(callSpot(hand, { tournament: early }), 10, ON)).toEqual(
        decideSeeds(callSpot(hand, { tournament: early }), 10)
      );
    }
  });
});

describe('owner rulings hold in both arms', () => {
  const ARMS: Array<[string, Record<string, unknown>]> = [
    ['default', {}],
    ['option on', ON],
  ];
  // 2026-10-26: "when a player shoves all in with less than 3 BB, a stack of
  // 20+ BB SHOULD BE CALLING WITH ALMOST ANYTHING IN A TOURNAMENT". The
  // cutoff jams 2.5bb, the button and small blind fold, the 25bb big blind
  // decides; in the money at the final table.
  const crumbs = (hand: string): SpotSpec => ({
    stacks: { ...HAND_STACKS, 6: 15_000, 9: 150_000 },
    hero: 9,
    hand,
    jammer: 6,
    foldedAfterJam: [7, 8],
  });
  const WEAK = ['72o', '32o', '83o', '94o', 'T2o', 'J3o', 'Q4o', '85o', '62o', 'K2o'];
  for (const [arm, opts] of ARMS) {
    it(`${arm}: a 25bb big blind calls a 2.5bb jam with almost anything`, () => {
      const rate =
        WEAK.reduce((sum, hand) => sum + share(decideSeeds(crumbs(hand), 8, opts), 'call'), 0) /
        WEAK.length;
      expect(rate).toBeGreaterThanOrEqual(0.9);
    });
  }
  // 2026-10-25: "SINCE WHEN IS IT GTO TO OPEN RIP 20BB FROM UTG?!" and
  // "BIGGER STACKS SHOULD NOT BE OPEN RIPPING 35+ BIGS". Under the gun
  // (seat 1, folded to nobody) at 20bb and 35bb.
  const utg = (hand: string, chips: number): SpotSpec => ({
    stacks: { ...HAND_STACKS, 1: chips },
    hero: 1,
    hand,
    foldedBefore: [],
  });
  // Deep decisions are slow (the tournament utility runs): few seeds, a
  // spread of hands, so the pre-push gate stays inside its budget.
  const OPENS = ['AA', 'KK', '77', 'AKo', 'AQs', 'KQo', 'T9s'];
  for (const [arm, opts] of ARMS) {
    it(`${arm}: no open-shove from under the gun at 20bb or 35bb`, () => {
      for (const chips of [120_000, 210_000]) {
        for (const hand of OPENS) {
          expect(share(decideSeeds(utg(hand, chips), 3, opts), 'all_in'), `${hand} ${chips}`).toBe(
            0
          );
        }
      }
    });
  }
});
