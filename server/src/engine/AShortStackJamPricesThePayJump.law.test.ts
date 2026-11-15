/**
 * LAW: A SHORT-STACK JAM PRICES THE PAY JUMP (2026-11-15, hand 59441335).
 *
 * At a nine-handed final table of an 86-entrant bounty freezeout (13 paid,
 * in the money), a Horse in the cutoff with 2.1 big blinds open-jammed 85o.
 * The folded-to jam read the chip-EV Nash table (HorseAnteAwarePushFold),
 * which jams 99.6% of hands at that depth: nothing priced the payouts. The
 * payout-aware read (nashPushFoldIcm) shipped opt-in.
 *
 * What this law holds:
 *  1. With a pay jump live and the stacks, payouts and hero's identity in
 *     the trusted context, the jam and the call against a jam read hero's
 *     bubble factor (payJumpBubbleFactor), moved toward 1 by the payout
 *     weight prize / (prize + bounty), and a bust is worth the place it
 *     finishes (bustAwareBubbleFactor), not zero.
 *  2. Sensible jams at 2.1bb still jam; the bottom of the chip-EV range
 *     tightens.
 *  3. Where no pay jump is live, the data is missing or untrusted, and in
 *     satellites, PKOs, mystery bounties, bounty-only events, heads-up and
 *     cash, the decision is exactly the chip-EV one (the explicit
 *     nashPushFoldIcm: false arm, the behaviour before).
 *  4. The call against a jam is tighter than chip EV on the bubble and in
 *     the money, and unchanged where no pay jump is live.
 *
 * What it does not hold: the reported hand's 85o. With ninth place paid
 * whatever happens, hero's bubble factor is about 1.17 (the legacy
 * bubbleFactor, which prices a bust at zero, says 5), and at that factor
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
import { bubbleFactor, bustAwareBubbleFactor } from './IcmModel.js';
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
const factorAt = (spec: SpotSpec) => {
  const { gs, hero } = buildSpot(spec);
  return payJumpBubbleFactor(gs, hero.stack / gs.bigBlind, hero.user_id);
};

describe('hand 59441335: the jam reads the payouts', () => {
  it('builds the repository ladder for 86 entrants: 13 places summing to 100', () => {
    expect(PAYOUT_86).toHaveLength(13);
    expect(PAYOUT_86.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(repositoryPayoutLadder(20)).toHaveLength(3);
  });

  it('a bust in the money is worth its place, so the factor is not pinned at the cap', () => {
    const legacy = bubbleFactor(HAND_STACK_VECTOR, PAYOUT_86, HERO_INDEX, 12_609);
    const bustAware = bustAwareBubbleFactor(HAND_STACK_VECTOR, PAYOUT_86, HERO_INDEX, 12_609);
    expect(legacy).toBe(5);
    expect(bustAware).toBeGreaterThan(1.1);
    expect(bustAware).toBeLessThan(1.3);
    expect(factorAt({ hand: '85o' })).toBeCloseTo(1 + (bustAware - 1) * WEIGHT, 9);
    expect(factorAt({ hand: '85o', tournament: NO_BOUNTY })).toBeCloseTo(bustAware, 9);
  });

  it('outside the money a bust pays nothing and the two factors agree', () => {
    const stacks = [9_000, 6_000, 3_000, 1_500, 500];
    for (let hero = 0; hero < stacks.length; hero++) {
      expect(bustAwareBubbleFactor(stacks, [50, 30, 20], hero, stacks[hero])).toBe(
        bubbleFactor(stacks, [50, 30, 20], hero, stacks[hero])
      );
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
    decideSeeds({ hand: '72o' }, 1, { telemetry: true });
    const fired = drainFires().find((row) => row.feature === 'pay_jump_push_fold_seen');
    expect(fired?.fires).toBe(1);
  });

  it('the bottom of the chip-EV range tightens: 72o and 32o mostly fold', () => {
    expect(share(decideSeeds({ hand: '72o' }, 40), 'all_in')).toBeLessThan(0.25);
    expect(share(decideSeeds({ hand: '32o' }, 40), 'all_in')).toBe(0);
    // The same seeds jammed both at chip EV.
    expect(share(decideSeeds({ hand: '72o' }, 40, { nashPushFoldIcm: false }), 'all_in')).toBe(1);
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
      expect(share(decideSeeds({ hand }, 20), 'all_in'), hand).toBe(1);
      expect(share(decideSeeds({ hand, tournament: NO_BOUNTY }, 10), 'all_in'), hand).toBe(1);
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
    it(`${name}: no factor, and every seed equals the explicit chip-EV arm`, () => {
      expect(factorAt({ ...spec, hand: '85o' })).toBeNull();
      for (const hand of ['85o', '72o', 'A5o']) {
        expect(decideSeeds({ ...spec, hand }, 15)).toEqual(
          decideSeeds({ ...spec, hand }, 15, { nashPushFoldIcm: false })
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

  it('on the bubble and in the money the big blind calls tighter than chip EV', () => {
    expect(factorAt(callSpot('A8o', { tournament: bubble }))).toBeGreaterThan(2);
    expect(calls({ tournament: bubble })).toBeLessThan(
      calls({ tournament: bubble }, { nashPushFoldIcm: false }) - 3
    );
    expect(calls({})).toBeLessThan(calls({}, { nashPushFoldIcm: false }) - 3);
  });

  it('control: with no pay jump live the call is the chip-EV call, seed for seed', () => {
    const early = { playersLeft: 70, inMoney: false, finalTable: false, nearBubble: false };
    for (const hand of ['66', 'A4o', 'KTo', 'JTs']) {
      expect(decideSeeds(callSpot(hand, { tournament: early }), 10)).toEqual(
        decideSeeds(callSpot(hand, { tournament: early }), 10, { nashPushFoldIcm: false })
      );
    }
  });
});
