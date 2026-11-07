/**
 * LAW: a qualified river bluff candidate bluffs, in Hold'em and in PLO, and
 * nothing switches that off.
 *
 * Dan, 2026-11-06 20:52 Chicago: "MAKE SURE THAT YOU FULLY UPGRADE ENHANCE,
 * OPTIMIZE AND IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION FOR BOTH
 * HOLDEM AND PLO. ITS IMPORTANT TO ALSO CHECK THAT THERE IS NOTHING THAT IS
 * EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF' RIVER BLUFFS FOR QUALIFIED
 * CANDITATES OR SITUATIONS."
 *
 * Every assertion drives the real HorseLogic.decide on a heads-up river
 * checked to hero (see HorseV54RiverBluff.test-support.ts for the line: 1/2
 * cash, 100bb, raise and call, flop and turn barrels called) against an
 * opponent memory has never seen. It pins:
 *  1. An unknown opponent is bluffed: air and missed draws bet at a non-zero,
 *     bounded frequency in nlh, plo4 and plo5, on every line that tells a
 *     story (turn barrel, delayed bet, checked-through turn).
 *  2. Blockers bluff more than the same air without them; missed draws more
 *     than junk.
 *  3. Showdown value is never bluffed by this layer.
 *  4. Reads reshape, never switch off: a station gets fewer bluffs (never
 *     zero), a river folder more.
 *  5. Pot limit is respected; tournaments bluff, but less on a bubble.
 *  6. The owner rulings still win: the PLO paired-board river check
 *     (2026-11-06) converts the bluff to a check.
 *  7. The arithmetic: at a pot-sized bet, one bluff per two value bets.
 * A red law means a river bluff is again shut off for a qualified candidate.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  NLH_AIR_BLOCKER,
  NLH_MIDDLE_PAIR,
  NLH_AIR_MULTIWAY,
  NLH_AIR_BUBBLE,
  PLO4_NUT_BLOCKER_AIR,
  PLO4_TWO_PAIR,
  c,
  decideSpot,
  seedOpponentRiverRead,
  spotState,
  type V54Spot,
} from './HorseV54RiverBluff.test-support.js';
import {
  riverBluffBalancedProbability,
  riverBluffEligibility,
  riverMissedDraw,
  riverNutBlocker,
  RIVER_BLUFF_MAX_PROBABILITY,
} from './HorseRiverBluffRange.js';

const TIMEOUT = 240_000 * (process.env.RUNNER_ENVIRONMENT === 'self-hosted' ? 3 : 1);
const SEEDS = Array.from({ length: 360 }, (_, i) => 104_729 + i * 15_485_863);
const H = 'hearts';
const D = 'diamonds';
const S = 'spades';
const C = 'clubs';

enableBrainTelemetry();
afterEach(() => {
  HorseMind.reset();
  drainFires();
});

interface Run {
  bluffRate: number;
  baselineFires: number;
  bets: Array<{ action: string; amount?: number }>;
  fires: Record<string, number>;
}

function run(spot: V54Spot, prepare: () => void = () => HorseMind.reset()): Run {
  prepare();
  drainFires();
  const bets: Run['bets'] = [];
  for (const seed of SEEDS) {
    const d = decideSpot(spot, seed, { telemetry: true });
    if (d.action === 'bet' || d.action === 'all_in' || d.action === 'raise')
      bets.push({ action: d.action, amount: d.amount });
  }
  const fires = Object.fromEntries(
    drainFires()
      .filter((r) => r.feature.startsWith('river_bluff_baseline') || r.feature.startsWith('plo_'))
      .map((r) => [r.feature, r.fires])
  );
  const baselineFires = Object.entries(fires)
    .filter(([k]) => /^river_bluff_baseline_(junk|missedDraw|blocker|blockerAndDraw)$/.test(k))
    .reduce((n, [, v]) => n + v, 0);
  return { bluffRate: bets.length / SEEDS.length, baselineFires, bets, fires };
}

/** 9-8-5-K-2 rainbow-ish: the only straight is seven-six. */
const NLH_BOARD = NLH_AIR_BLOCKER.board;
const NLH_BLOCKER_DRAW: V54Spot = { ...NLH_AIR_BLOCKER, name: 'nlh_76_blocker_gutshot' };
const NLH_JUNK: V54Spot = {
  ...NLH_AIR_BLOCKER,
  name: 'nlh_junk',
  hole: [c('Q', C), c('3', D)],
};
const NLH_MISSED_FLUSH: V54Spot = {
  ...NLH_AIR_BLOCKER,
  name: 'nlh_missed_flush_draw',
  // J-T of hearts: hearts on the turn (9h, 2h is the river; Jh Th + 9h + ...)
  board: [c('9', H), c('8', S), c('4', H), c('K', C), c('2', D)],
  hole: [c('J', H), c('3', H)],
};
const NLH_DELAYED: V54Spot = { ...NLH_AIR_BLOCKER, name: 'nlh_delayed', line: 'turn' };
const NLH_CHECKED_THROUGH: V54Spot = {
  ...NLH_AIR_BLOCKER,
  name: 'nlh_checked_through',
  line: 'passive',
};
const PLO4_BLOCKER = PLO4_NUT_BLOCKER_AIR;
const PLO4_NO_BLOCKER: V54Spot = {
  ...PLO4_NUT_BLOCKER_AIR,
  name: 'plo4_same_air_no_ace',
  hole: [c('Q', S), c('8', H), c('4', C), c('3', D)],
};
const PLO5_BLOCKER: V54Spot = {
  ...PLO4_NUT_BLOCKER_AIR,
  name: 'plo5_nut_blocker_air',
  variant: 'plo5',
  hole: [c('A', S), c('Q', H), c('4', C), c('3', D), c('7', H)],
};
/** PLO4 board paired on the turn after hero's turn bet was called. */
const PLO4_PAIRED_TURN: V54Spot = {
  ...PLO4_NUT_BLOCKER_AIR,
  name: 'plo4_paired_turn',
  board: [c('K', S), c('9', S), c('6', D), c('6', C), c('J', H)],
  hole: [c('A', S), c('Q', H), c('4', C), c('3', D)],
};

describe('LAW: an unknown opponent is bluffed on the river', () => {
  it(
    'nlh: air with a blocker and a missed draw bets at a bounded, non-zero rate',
    () => {
      const r = run(NLH_BLOCKER_DRAW);
      expect(r.bluffRate).toBeGreaterThan(0.2);
      expect(r.bluffRate).toBeLessThanOrEqual(RIVER_BLUFF_MAX_PROBABILITY + 0.08);
      expect(r.baselineFires).toBe(r.bets.length);
    },
    TIMEOUT
  );

  it(
    'plo4 and plo5: the nut-flush blocker with air bets at a bounded, non-zero rate',
    () => {
      for (const spot of [PLO4_BLOCKER, PLO5_BLOCKER]) {
        const r = run(spot);
        expect(r.bluffRate, spot.name).toBeGreaterThan(0.2);
        expect(r.bluffRate, spot.name).toBeLessThanOrEqual(RIVER_BLUFF_MAX_PROBABILITY + 0.08);
        expect(r.baselineFires, spot.name).toBe(r.bets.length);
      }
    },
    TIMEOUT
  );

  it(
    'every story line bluffs without a read: barrel, delayed bet, checked-through turn',
    () => {
      for (const spot of [NLH_BLOCKER_DRAW, NLH_DELAYED, NLH_CHECKED_THROUGH]) {
        const r = run(spot);
        expect(r.bluffRate, spot.name).toBeGreaterThan(0.12);
      }
      // Junk is bluffed least, but never zero.
      expect(run(NLH_JUNK).bluffRate).toBeGreaterThan(0.05);
    },
    TIMEOUT
  );
});

describe('LAW: the right combos carry the bluffs', () => {
  it(
    'nlh: the straight blocker with a missed gutshot bluffs more than junk on the same board',
    () => {
      expect(riverNutBlocker(NLH_BLOCKER_DRAW.hole, NLH_BOARD, false, false)).toBe(true);
      expect(riverNutBlocker(NLH_JUNK.hole, NLH_BOARD, false, false)).toBe(false);
      const strong = run(NLH_BLOCKER_DRAW).bluffRate;
      const junk = run(NLH_JUNK).bluffRate;
      expect(strong).toBeGreaterThan(junk * 1.6);
    },
    TIMEOUT
  );

  it(
    'nlh: a missed flush draw bluffs more than junk',
    () => {
      expect(riverMissedDraw(NLH_MISSED_FLUSH.hole, NLH_MISSED_FLUSH.board, false)).toBe(true);
      expect(riverMissedDraw(NLH_JUNK.hole, NLH_BOARD, false)).toBe(false);
      expect(run(NLH_MISSED_FLUSH).bluffRate).toBeGreaterThan(run(NLH_JUNK).bluffRate);
    },
    TIMEOUT
  );

  it(
    'plo4: the ace of the flush suit bluffs more than the same air without it',
    () => {
      const withAce = run(PLO4_BLOCKER).bluffRate;
      const without = run(PLO4_NO_BLOCKER).bluffRate;
      expect(without).toBeGreaterThan(0.08);
      expect(withAce).toBeGreaterThan(without * 1.15);
    },
    TIMEOUT
  );
});

describe('LAW: showdown value is not bluffed', () => {
  it(
    'middle pair in nlh and top two in plo4 never take the baseline bluff',
    () => {
      for (const spot of [NLH_MIDDLE_PAIR, PLO4_TWO_PAIR]) {
        const r = run(spot);
        expect(r.baselineFires, spot.name).toBe(0);
      }
    },
    TIMEOUT
  );

  it('the eligibility refuses equity at or above the air bar', () => {
    const { hero, gs } = spotState(NLH_BLOCKER_DRAW);
    const base = {
      omaha: false,
      potLimit: false,
      hiLo: false,
      lowPossible: false,
      fixedLimit: false,
      shortDeck: false,
      multiBoard: false,
      bombPot: false,
      holeCount: 2,
      hole: hero.cards,
      board: gs.communityCards,
      history: gs.actionHistory ?? [],
      heroId: 'hero',
      opponentId: 'opp3',
      opponentsLive: 1,
      opponentCanRespond: true,
      inPosition: true,
      initiative: 'hero' as const,
      scareCard: false,
      nutBlocker: true,
      riverHelpsHero: false,
      rangesFavorOpponent: false,
      barrelPlan: false,
      calledBarrels: 0,
    };
    expect(riverBluffEligibility({ ...base, equity: 0.1 }).eligible).toBe(true);
    expect(riverBluffEligibility({ ...base, equity: 0.4 }).reason).toBe('showdown_value');
    expect(riverBluffEligibility({ ...base, equity: 0.1, opponentsLive: 2 }).reason).toBe(
      'multiway'
    );
  });
});

describe('LAW: reads reshape the bluff, they never switch it off', () => {
  it(
    'a station gets fewer bluffs than an unknown, never zero; a folder gets more',
    () => {
      const unknown = run(NLH_BLOCKER_DRAW).bluffRate;
      const station = run(NLH_BLOCKER_DRAW, () => seedOpponentRiverRead(3, 30)).bluffRate;
      const folder = run(NLH_BLOCKER_DRAW, () => seedOpponentRiverRead(21, 30)).bluffRate;
      expect(station).toBeGreaterThan(0);
      expect(station).toBeLessThan(unknown * 0.6);
      expect(folder).toBeGreaterThan(unknown);
    },
    TIMEOUT
  );
});

describe('LAW: limits and tournaments', () => {
  it(
    'a PLO bluff never exceeds the pot',
    () => {
      const { gs } = spotState(PLO4_BLOCKER);
      for (const b of run(PLO4_BLOCKER).bets) {
        expect(b.amount ?? 0).toBeLessThanOrEqual(gs.pot + 0.005);
      }
    },
    TIMEOUT
  );

  it(
    'a tournament bubble still bluffs, never more than cash',
    () => {
      const cash = run(NLH_BLOCKER_DRAW).bluffRate;
      const bubble = run(NLH_AIR_BUBBLE).bluffRate;
      expect(bubble).toBeGreaterThan(0.05);
      expect(bubble).toBeLessThanOrEqual(cash + 0.03);
    },
    TIMEOUT
  );

  it(
    'multiway rivers are left to the layers below',
    () => {
      const r = run(NLH_AIR_MULTIWAY);
      expect(r.baselineFires).toBe(0);
      expect(r.fires.river_bluff_baseline_skip_multiway).toBe(SEEDS.length);
    },
    TIMEOUT
  );
});

describe('LAW: owner rulings still win', () => {
  it(
    'the PLO paired-board river check (Dan 2026-11-06) turns the bluff into a check',
    () => {
      const r = run(PLO4_PAIRED_TURN);
      expect(r.bets.length).toBe(0);
      if ((r.fires.river_bluff_baseline_blockerAndDraw ?? 0) > 0)
        expect(r.fires.plo_paired_board_river_check).toBeGreaterThan(0);
    },
    TIMEOUT
  );
});

describe('LAW: the balance arithmetic', () => {
  it('a pot-sized bet supports one bluff per two value bets', () => {
    // b <= v * s/(1+s): at a pot-sized bet (s = 1) half a bluff per value
    // combo. With half a value combo per air combo each air combo bluffs a
    // quarter of the time: 0.25 bluffs to 0.5 value, one bluff per two value.
    expect(riverBluffBalancedProbability(1, 0.5, 1)).toBeCloseTo(0.25, 6);
    // The public bands cannot see missed draws: never more than 0.6 value
    // per air is believed, so a band read of all value still caps at 0.3.
    expect(riverBluffBalancedProbability(1, 1, 1)).toBeCloseTo(0.3, 6);
    // Smaller bets carry fewer bluffs: a half-pot bet, s/(1+s) = 1/3.
    expect(riverBluffBalancedProbability(0.5, 0.5, 1)).toBeCloseTo(1 / 6, 6);
    expect(riverBluffBalancedProbability(0, 1, 1)).toBe(0);
  });
});
