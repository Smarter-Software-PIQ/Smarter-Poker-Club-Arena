/**
 * V83: AN AGGRESSION READ NEEDS BLUFFS BEHIND IT (2026-11-06).
 *
 * The legacy exploit read called an opponent a maniac (callDownMod 1.2) on
 * the postflop aggression factor alone: AF > 2.5. Horse-vs-horse play sits at
 * AF ~2.43, so a small change in how often a player is checked to moved a
 * value-heavy bettor across the line, and callDownMod > 1 switched off every
 * one-pair fold and shade layer at once. In R7's certification league the
 * opponent read 2.66 while 85% of its big river bets showed down strong, and
 * the R7 seat called down one pair and lost -5.54 bb/100.
 *
 * V83 keeps neutral respect when 20+ big river bets reached showdown and 75%+
 * of them were strong. Everything else is the pre-V83 read.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HorseMind,
  aggressionShownAsValue,
  V83_MIN_BIG_BET_SHOWDOWNS,
  V83_VALUE_SHARE,
} from './HorseMind.js';
import { HorseLogic } from './HorseLogic.js';
import { seedFastRandom } from './HorseEval.js';
import { enableBrainTelemetry, drainFires } from './BrainTelemetry.js';
import type { Card, CardRank, CardSuit, SeatPlayer } from '../types.js';

/** The R7 league opponent (sandbox 1, league-2) at the end of the run. */
const VALUE_AGGRESSOR = {
  hands: 46400,
  vpip: 30571,
  pfr: 20462,
  aggr: 35172,
  passive: 15857,
  folds: 18822,
  facedAggr: 34115,
  postAggr: 14638,
  postPassive: 5505, // AF 2.66
  bigBetSD: 255,
  bigBetSDStrong: 218, // 85% strong
};

const PLAYERS = [
  {
    seat: 1,
    user_id: 'hero',
    stack: 10000,
    bet: 0,
    is_folded: false,
    is_sitting_out: false,
    cards: [],
  },
  {
    seat: 2,
    user_id: 'villain',
    stack: 10000,
    bet: 0,
    is_folded: false,
    is_sitting_out: false,
    cards: [],
  },
] as unknown as SeatPlayer[];

function seed(overrides: Partial<typeof VALUE_AGGRESSOR> = {}): void {
  HorseMind.reset();
  expect(HorseMind.importStats([{ user_id: 'villain', ...VALUE_AGGRESSOR, ...overrides }])).toBe(1);
  // The credible-read path replaces callDownMod when it engages; these
  // fixtures exercise the legacy ratio read only.
  expect(HorseMind.opponentRead('villain')).toBeNull();
}

describe('V83 aggressionShownAsValue', () => {
  it('needs the sample before the share counts', () => {
    expect(aggressionShownAsValue(null)).toBe(false);
    expect(aggressionShownAsValue(undefined)).toBe(false);
    expect(aggressionShownAsValue({ bigBetSD: 0, bigBetSDStrong: 0 })).toBe(false);
    expect(
      aggressionShownAsValue({ bigBetSD: V83_MIN_BIG_BET_SHOWDOWNS - 1, bigBetSDStrong: 19 })
    ).toBe(false);
    expect(
      aggressionShownAsValue({ bigBetSD: V83_MIN_BIG_BET_SHOWDOWNS, bigBetSDStrong: 15 })
    ).toBe(true);
  });

  it('is a value share threshold at 75%', () => {
    expect(V83_VALUE_SHARE).toBe(0.75);
    expect(aggressionShownAsValue({ bigBetSD: 100, bigBetSDStrong: 75 })).toBe(true);
    expect(aggressionShownAsValue({ bigBetSD: 100, bigBetSDStrong: 74 })).toBe(false);
    expect(aggressionShownAsValue({ bigBetSD: NaN, bigBetSDStrong: 1 })).toBe(false);
  });
});

describe('V83 legacy exploit read', () => {
  beforeEach(() => HorseMind.reset());
  afterEach(() => HorseMind.reset());

  it('a value-backed aggressor keeps neutral respect (the R7 league opponent)', () => {
    seed();
    expect(HorseMind.exploit('villain').callDownMod).toBe(1);
    expect(HorseMind.exploit('villain', true, {}).callDownMod).toBe(1);
    expect(HorseMind.exploit('villain', true, { aggressionNeedsBluffs: true }).callDownMod).toBe(1);
    expect(HorseMind.tableExploit(1, PLAYERS).callDownMod).toBe(1);
  });

  it('explicit false is the pre-V83 ratio-only read', () => {
    seed();
    expect(
      HorseMind.exploit('villain', true, { aggressionNeedsBluffs: false }).callDownMod
    ).toBeCloseTo(1.2, 10);
    expect(
      HorseMind.tableExploit(1, PLAYERS, true, { aggressionNeedsBluffs: false }).callDownMod
    ).toBeCloseTo(1.2, 10);
  });

  it('an aggressor whose big bets show down as bluffs is still a maniac', () => {
    seed({ bigBetSD: 255, bigBetSDStrong: 120 });
    expect(HorseMind.exploit('villain').callDownMod).toBeCloseTo(1.2, 10);
  });

  it('an aggressor without enough showdowns is still read on the ratio', () => {
    seed({ bigBetSD: 12, bigBetSDStrong: 12 });
    expect(HorseMind.exploit('villain').callDownMod).toBeCloseTo(1.2, 10);
  });

  it('below the line nothing changes, and the passive branch is untouched', () => {
    seed({ postAggr: 13799, postPassive: 5662 }); // AF 2.44
    expect(HorseMind.exploit('villain').callDownMod).toBe(1);
    expect(HorseMind.exploit('villain', true, { aggressionNeedsBluffs: false }).callDownMod).toBe(
      1
    );
    seed({ postAggr: 3000, postPassive: 6000 }); // AF 0.5, shown strong
    expect(HorseMind.exploit('villain').callDownMod).toBeCloseTo(0.85, 10);
    expect(
      HorseMind.exploit('villain', true, { aggressionNeedsBluffs: false }).callDownMod
    ).toBeCloseTo(0.85, 10);
  });

  it('bluffMod and valueThinMod are the same with the gate on or off', () => {
    for (const o of [{}, { folds: 30000 }, { folds: 5000 }]) {
      seed(o);
      const on = HorseMind.exploit('villain');
      const off = HorseMind.exploit('villain', true, { aggressionNeedsBluffs: false });
      expect(on.bluffMod).toBe(off.bluffMod);
      expect(on.valueThinMod).toBe(off.valueThinMod);
    }
  });
});

describe('V83 in the decision: the one-pair turn shade comes back against a value-backed aggressor', () => {
  const SUITS: Record<string, CardSuit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' };
  const cards = (text: string): Card[] => {
    const out: Card[] = [];
    for (let i = 0; i + 1 < text.length; i += 2)
      out.push({ rank: text[i] as CardRank, suit: SUITS[text[i + 1]] });
    return out;
  };
  /** Villain raised, c-bet the flop and bets pot on the turn; hero holds top
   *  pair, weak kicker (the V65 fixture, HorseTurnOnePairShade.test.ts). */
  const spot = () => {
    const players = [
      {
        seat: 1,
        user_id: 'hero',
        username: 'h',
        stack: 400,
        bet: 0,
        totalInvested: 18,
        cards: cards('Ks5d'),
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
      {
        seat: 2,
        user_id: 'villain',
        username: 'v',
        stack: 364,
        bet: 36,
        totalInvested: 54,
        cards: [],
        is_folded: false,
        is_all_in: false,
        is_sitting_out: false,
      },
    ] as unknown as SeatPlayer[];
    const history = [
      { stage: 'preflop', seat: 2, userId: 'villain', action: 'raise', amount: 6, timestamp: 1 },
      { stage: 'preflop', seat: 1, userId: 'hero', action: 'call', amount: 4, timestamp: 2 },
      { stage: 'flop', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 3 },
      { stage: 'flop', seat: 2, userId: 'villain', action: 'bet', amount: 8, timestamp: 4 },
      { stage: 'flop', seat: 1, userId: 'hero', action: 'call', amount: 8, timestamp: 5 },
      { stage: 'turn', seat: 1, userId: 'hero', action: 'check', amount: 0, timestamp: 8 },
      { stage: 'turn', seat: 2, userId: 'villain', action: 'bet', amount: 36, timestamp: 9 },
    ];
    return {
      hero: players[0],
      gs: {
        players,
        communityCards: cards('Kh9d3s7c'),
        pot: 72,
        currentBet: 36,
        minRaise: 36,
        stage: 'turn',
        gameVariant: 'nlh',
        gameMode: 'cash',
        bigBlind: 2,
        dealerSeat: 1,
        actionHistory: history,
      },
    };
  };
  const fires = () => Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
  const run = (opts: Record<string, unknown>, overrides: Partial<typeof VALUE_AGGRESSOR> = {}) => {
    seed(overrides);
    seedFastRandom(0x5eed83);
    drainFires();
    const s = spot();
    HorseLogic.decide(s.hero, s.gs as never, 'balanced', {}, { telemetry: true, ...opts } as never);
    return fires();
  };

  beforeEach(() => {
    enableBrainTelemetry();
    drainFires();
  });
  afterEach(() => {
    HorseMind.reset();
    drainFires();
  });

  it('V83 on: neutral respect, the V65 shade prices the call, the receipt fires', () => {
    const f = run({});
    expect(f['v83_aggression_shown_as_value']).toBeGreaterThanOrEqual(1);
    expect(f['v65_turn_one_pair_shade']).toBe(1);
  });

  it('V83 off: the ratio-only maniac read switches the shade off (the R7 failure)', () => {
    const f = run({ v83AggressionNeedsBluffs: false });
    expect(f['v83_aggression_shown_as_value']).toBeUndefined();
    expect(f['v65_turn_one_pair_shade']).toBeUndefined();
  });

  it('a measured bluffer is still called down unshaded with V83 on', () => {
    const f = run({}, { bigBetSDStrong: 120 });
    expect(f['v83_aggression_shown_as_value']).toBeUndefined();
    expect(f['v65_turn_one_pair_shade']).toBeUndefined();
  });
});
