/**
 * LAW: fixed limit, short deck, bomb pots and multi-board pots have a river
 * bluff path of their own, and nothing switches it off.
 *
 * Dan, 2026-11-06 20:52 Chicago: "MAKE SURE THAT YOU FULLY UPGRADE ENHANCE,
 * OPTIMIZE AND IMPROVE THE RIVER BLUFFING RANGE AND ACTIVATION ... CHECK THAT
 * THERE IS NOTHING THAT IS EVER BLOCKING OR PRENENTING, OR 'SHUTTING OFF'
 * RIVER BLUFFS FOR QUALIFIED CANDITATES OR SITUATIONS."
 *
 * #9803 (HorseRiverBluffRange.ts) excluded these four game types outright.
 * Production deals all of them (hand_history, 9 days to 2026-11-07: flh
 * 152,805 hands, flo8 66,170, short_deck 22,989, double-board bomb pots in
 * plo5/plo8/short_deck/flo8). Every assertion drives the real
 * HorseLogic.decide on a heads-up river checked to hero against an opponent
 * memory has never seen (HorseRiverBluffOtherGames.test-support.ts). It pins:
 *  1. Fixed limit bluffs with the one fixed bet, at a low but real rate that
 *     is below the no-limit rate of the same spot; blockers more than junk;
 *     a station fewer, never zero.
 *  2. Short deck reads draws and blockers in the engine's 36-card ranking
 *     (A-6-7-8-9 is a straight) and bluffs; showdown value never.
 *  3. Bomb pots bluff on postflop stories only; a preflop record never
 *     becomes a story.
 *  4. Multi-board pots bluff only with air on every board, at a share
 *     divided by the board count (V36 rule 2).
 *  5. Each path is its own opts flag, default on; false restores the
 *     exclusion (ablation only).
 * A red law means a river bluff is again shut off for a qualified candidate
 * in one of these games.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import type { HorseDecideOpts } from './HorseLogic.js';
import {
  c,
  decideOtherGame,
  seedOpponentRiverRead,
  type OtherGameSpot,
} from './HorseRiverBluffOtherGames.test-support.js';
import {
  riverBluffEligibility,
  riverBluffLine,
  riverBluffProbability,
  riverBluffSize,
  riverMissedDraw,
  riverNutBlocker,
  RIVER_BLUFF_MAX_PROBABILITY,
  type RiverBluffSpot,
} from './HorseRiverBluffRange.js';
import type { ActionRecord } from '../types.js';

const TIMEOUT = 240_000 * (process.env.RUNNER_ENVIRONMENT === 'self-hosted' ? 3 : 1);
const SEEDS = Array.from({ length: 300 }, (_, i) => 104_729 + i * 15_485_863);
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

function run(
  spot: OtherGameSpot,
  opts: HorseDecideOpts = {},
  prepare: () => void = () => HorseMind.reset()
): Run {
  prepare();
  drainFires();
  const bets: Run['bets'] = [];
  for (const seed of SEEDS) {
    const d = decideOtherGame(spot, seed, { telemetry: true, ...opts });
    if (d.action === 'bet' || d.action === 'all_in' || d.action === 'raise')
      bets.push({ action: d.action, amount: d.amount });
  }
  const fires = Object.fromEntries(
    drainFires()
      .filter((r) => r.feature.startsWith('river_bluff_baseline'))
      .map((r) => [r.feature, r.fires])
  );
  const baselineFires = Object.entries(fires)
    .filter(([k]) => /^river_bluff_baseline_(junk|missedDraw|blocker|blockerAndDraw)$/.test(k))
    .reduce((n, [, v]) => n + v, 0);
  return { bluffRate: bets.length / SEEDS.length, baselineFires, bets, fires };
}

/** 9-8-5-K-2: the only straight is seven-six. */
const B985 = [c('9', H), c('8', S), c('5', D), c('K', C), c('2', H)];
/** 6-3: blocks the 7-6 straight, a missed gutshot. */
const NLH_REF: OtherGameSpot = {
  name: 'nlh_ref',
  variant: 'nlh',
  hole: [c('6', C), c('3', D)],
  board: B985,
};
const FLH_BLOCKER: OtherGameSpot = { ...NLH_REF, name: 'flh_blocker', variant: 'flh' };
const FLH_JUNK: OtherGameSpot = { ...FLH_BLOCKER, name: 'flh_junk', hole: [c('Q', C), c('3', D)] };
const FLH_MIDDLE_PAIR: OtherGameSpot = {
  ...FLH_BLOCKER,
  name: 'flh_middle_pair',
  hole: [c('9', C), c('6', D)],
};
/** Fixed-limit Omaha hi-lo with no low possible: the ace blocks broadway. */
const FLO8_NO_LOW: OtherGameSpot = {
  name: 'flo8_no_low',
  variant: 'flo8',
  hole: [c('A', H), c('4', C), c('3', D), c('2', H)],
  board: [c('K', S), c('J', S), c('9', D), c('T', H), c('6', C)],
};
/** Short deck: A-Q on 7-8-9-K-J. The queen blocks the K-high straight, and
 *  the ace (low, as a five) with 7-8-9 was a gutshot that missed. */
const SD_AQ: OtherGameSpot = {
  name: 'sd_aq',
  variant: 'short_deck',
  hole: [c('A', C), c('Q', D)],
  board: [c('7', H), c('8', S), c('9', D), c('K', C), c('J', H)],
};
const SD_TOP_PAIR: OtherGameSpot = { ...SD_AQ, name: 'sd_top_pair', hole: [c('K', D), c('6', C)] };
const NLH_BOMB: OtherGameSpot = { ...NLH_REF, name: 'nlh_bomb', bombPot: true };
const NLH_BOMB_PASSIVE: OtherGameSpot = { ...NLH_BOMB, name: 'nlh_bomb_passive', line: 'passive' };
const NLH_DOUBLE: OtherGameSpot = {
  ...NLH_REF,
  name: 'nlh_double_board',
  board2: [c('Q', S), c('J', H), c('4', C), c('T', D), c('2', C)],
};
/** The same, but the six pairs board two: showdown value there. */
const NLH_DOUBLE_PAIR_TWO: OtherGameSpot = {
  ...NLH_DOUBLE,
  name: 'nlh_double_board_pair_two',
  board2: [c('Q', S), c('J', H), c('6', H), c('T', D), c('2', C)],
};
/** Production's bomb pot: PLO5, two boards. */
const PLO5_BOMB_DOUBLE: OtherGameSpot = {
  name: 'plo5_bomb_double',
  variant: 'plo5',
  bombPot: true,
  hole: [c('A', S), c('Q', H), c('4', C), c('3', D), c('7', H)],
  board: [c('K', S), c('9', S), c('6', D), c('2', S), c('J', C)],
  board2: [c('T', C), c('8', D), c('5', H), c('2', D), c('K', H)],
};

const ALL_OFF: HorseDecideOpts = {
  riverBluffFixedLimit: false,
  riverBluffShortDeck: false,
  riverBluffBombPot: false,
  riverBluffMultiBoard: false,
};

describe('LAW: fixed limit bluffs the river with the one fixed bet', () => {
  it(
    'flh: blocker air bets the big bet at a low, real rate below no limit',
    () => {
      const fl = run(FLH_BLOCKER);
      const nl = run(NLH_REF);
      expect(fl.bluffRate).toBeGreaterThan(0.08);
      expect(fl.bluffRate).toBeLessThan(nl.bluffRate * 0.6);
      expect(fl.baselineFires).toBe(fl.bets.length);
      expect(fl.fires.river_bluff_baseline_bet_fixedLimit).toBe(fl.bets.length);
      // The one legal river bet: the big bet of a 1/2 fixed-limit game.
      for (const b of fl.bets) expect(b).toEqual({ action: 'bet', amount: 4 });
    },
    TIMEOUT
  );

  it(
    'flh: the blocker bluffs more than junk; junk still bluffs; showdown value never',
    () => {
      const blocker = run(FLH_BLOCKER).bluffRate;
      const junk = run(FLH_JUNK).bluffRate;
      expect(junk).toBeGreaterThan(0.02);
      expect(blocker).toBeGreaterThan(junk * 1.6);
      expect(run(FLH_MIDDLE_PAIR).baselineFires).toBe(0);
    },
    TIMEOUT
  );

  it(
    'flh: a station gets fewer bluffs than an unknown, never zero',
    () => {
      const unknown = run(FLH_BLOCKER).bluffRate;
      const station = run(FLH_BLOCKER, {}, () => seedOpponentRiverRead(3, 30)).bluffRate;
      expect(station).toBeGreaterThan(0);
      expect(station).toBeLessThan(unknown * 0.7);
    },
    TIMEOUT
  );

  it(
    'flo8 with no low possible bluffs the high',
    () => {
      const r = run(FLO8_NO_LOW);
      expect(r.bluffRate).toBeGreaterThan(0.05);
      expect(r.fires.river_bluff_baseline_bet_fixedLimit ?? 0).toBeGreaterThan(0);
    },
    TIMEOUT
  );

  it('the size is the fixed bet, or all in for less', () => {
    const base = {
      potLimit: false,
      pot: 20,
      nutBlocker: false,
      riverHelpsHero: false,
      icmRisk: 0,
      u: 0.5,
    };
    expect(riverBluffSize({ ...base, effectiveStack: 190, fixedLimitBet: 4 })).toEqual({
      sizeFrac: 0.2,
      shove: false,
    });
    expect(riverBluffSize({ ...base, effectiveStack: 3, fixedLimitBet: 4 })).toEqual({
      sizeFrac: 0.15,
      shove: true,
    });
    expect(riverBluffSize({ ...base, effectiveStack: 190, fixedLimitBet: null }).sizeFrac).toBe(0);
  });
});

describe('LAW: short deck uses the engine ranking', () => {
  it('A-6-7-8-9 is a straight: the ace (low) is a short-deck draw and blocker', () => {
    const turnBoard = SD_AQ.board;
    expect(riverMissedDraw(SD_AQ.hole, turnBoard, false, true)).toBe(true);
    expect(riverMissedDraw(SD_AQ.hole, turnBoard, false, false)).toBe(false);
    // A-6-7-J-J: in short deck 8-9 makes A-6-7-8-9, the only straight; a full
    // deck has none, so nothing blocks it there.
    const wheelBoard = [c('A', C), c('6', D), c('7', H), c('J', S), c('J', C)];
    expect(riverNutBlocker([c('9', H), c('T', C)], wheelBoard, false, false, true)).toBe(true);
    expect(riverNutBlocker([c('9', H), c('T', C)], wheelBoard, false, false, false)).toBe(false);
    // The flush board's nut blocker is the top unseen card of the suit.
    const flushBoard = [c('A', H), c('9', H), c('6', H), c('K', C), c('7', D)];
    expect(riverNutBlocker([c('K', H), c('8', C)], flushBoard, false, false, true)).toBe(true);
  });

  it(
    'short deck: blocker air bluffs at a bounded, non-zero rate; top pair never',
    () => {
      const r = run(SD_AQ);
      expect(r.bluffRate).toBeGreaterThan(0.2);
      expect(r.bluffRate).toBeLessThanOrEqual(RIVER_BLUFF_MAX_PROBABILITY + 0.08);
      expect(r.fires.river_bluff_baseline_blockerAndDraw).toBe(r.bets.length);
      expect(run(SD_TOP_PAIR).baselineFires).toBe(0);
    },
    TIMEOUT
  );
});

describe('LAW: bomb pots bluff on postflop stories only', () => {
  it(
    'a bomb pot bluffs the barrel and the checked-through turn without any preflop action',
    () => {
      const barrel = run(NLH_BOMB);
      const passive = run(NLH_BOMB_PASSIVE);
      expect(barrel.bluffRate).toBeGreaterThan(0.2);
      expect(passive.bluffRate).toBeGreaterThan(0.15);
      expect(barrel.fires.river_bluff_baseline_bet_bombPot).toBe(barrel.bets.length);
    },
    TIMEOUT
  );

  it('a preflop record is never a story in a bomb pot', () => {
    const rec = (userId: string, action: ActionRecord['action'], stage: string): ActionRecord =>
      ({ seat: userId === 'hero' ? 1 : 3, userId, action, amount: 4, timestamp: 1, stage }) as
        ActionRecord;
    // Hero "raised preflop", the opponent bet flop and turn, hero called
    // both: no postflop line hero can tell. Out of position: no stab either.
    const history = [
      rec('hero', 'raise', 'preflop'),
      rec('opp3', 'bet', 'flop'),
      rec('hero', 'call', 'flop'),
      rec('opp3', 'bet', 'turn'),
      rec('hero', 'call', 'turn'),
    ];
    const spot = {
      bombPot: true,
      history,
      heroId: 'hero',
      opponentId: 'opp3',
      initiative: 'opp',
      inPosition: false,
      scareCard: false,
      nutBlocker: false,
      riverHelpsHero: false,
    } as unknown as RiverBluffSpot;
    expect(riverBluffLine(spot)).toBe('none');
    expect(riverBluffLine({ ...spot, initiative: 'hero' })).toBe('none');
  });
});

describe('LAW: a multi-board bluff must fold out every board', () => {
  it(
    'air on both boards bluffs, at no more than the single-board share over two',
    () => {
      const single = run(NLH_REF).bluffRate;
      const double = run(NLH_DOUBLE);
      expect(double.bluffRate).toBeGreaterThan(0.05);
      expect(double.bluffRate).toBeLessThan(single * 0.6);
      expect(double.fires.river_bluff_baseline_bet_multiBoard).toBe(double.bets.length);
    },
    TIMEOUT
  );

  it(
    'showdown value on any board is not bluffed',
    () => {
      expect(run(NLH_DOUBLE_PAIR_TWO).baselineFires).toBe(0);
    },
    TIMEOUT
  );

  it(
    "production's double-board PLO5 bomb pot bluffs, pot limit",
    () => {
      const r = run(PLO5_BOMB_DOUBLE);
      expect(r.bluffRate).toBeGreaterThan(0.03);
      expect(r.bluffRate).toBeLessThanOrEqual(RIVER_BLUFF_MAX_PROBABILITY / 2 + 0.05);
      expect(r.fires.river_bluff_baseline_bet_multiBoard ?? 0).toBe(r.bets.length);
    },
    TIMEOUT
  );

  it('the share is divided by the board count', () => {
    const elig = (boardCount: number) => ({
      eligible: true,
      reason: 'eligible' as const,
      line: 'barrel' as const,
      selection: 'blocker' as const,
      missedDraw: false,
      unblocker: false,
      boardCount,
      selectionWeight: 1.15,
      gameTypes: [],
    });
    const p = (n: number) =>
      riverBluffProbability({
        eligibility: elig(n),
        sizeFrac: 1,
        valueShare: 0.5,
        airShare: 1,
        reads: { station: false, riverFoldRate: null, overFolderFrequency: 0, bluffMod: 1 },
        icmRisk: 0,
        omahaThirdBarrel: false,
      });
    expect(p(2)).toBeCloseTo(p(1) / 2, 9);
    expect(p(3)).toBeCloseTo(p(1) / 3, 9);
  });

  it('a multi-board spot without every board read stays with the layers below', () => {
    const spot = {
      omaha: false,
      potLimit: false,
      hiLo: false,
      lowPossible: false,
      fixedLimit: false,
      shortDeck: false,
      multiBoard: true,
      bombPot: false,
      holeCount: 2,
      hole: NLH_DOUBLE.hole,
      board: NLH_DOUBLE.board,
      history: [],
      heroId: 'hero',
      opponentId: 'opp3',
      opponentsLive: 1,
      opponentCanRespond: true,
      equity: 0.05,
      inPosition: true,
      initiative: 'none' as const,
      scareCard: false,
      nutBlocker: false,
      riverHelpsHero: false,
      rangesFavorOpponent: false,
      barrelPlan: false,
      calledBarrels: 0,
    };
    expect(riverBluffEligibility(spot).reason).toBe('domain');
    expect(
      riverBluffEligibility({
        ...spot,
        boards: [NLH_DOUBLE.board, NLH_DOUBLE.board2!],
        boardEquities: [0.05, 0.4],
        nutBlockerByBoard: [false, false],
      }).reason
    ).toBe('showdown_value');
  });
});

describe('LAW: each path is its own flag, default on', () => {
  it(
    'false restores the exclusion for that type only',
    () => {
      for (const spot of [FLH_BLOCKER, SD_AQ, NLH_BOMB, NLH_DOUBLE]) {
        expect(run(spot, ALL_OFF).baselineFires, spot.name).toBe(0);
      }
      // One type off does not switch another off.
      expect(run(SD_AQ, { riverBluffFixedLimit: false }).baselineFires).toBeGreaterThan(0);
    },
    TIMEOUT
  );
});
