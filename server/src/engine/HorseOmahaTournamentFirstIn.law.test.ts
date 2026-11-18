/**
 * OMAHA TOURNAMENT SHORT-HANDED FIRST-IN.
 *
 * Owner order, Dan 2026-11-12: a person won the PLO4 Dinner Break MTT and the
 * audit found the Horses walking the big blind: heads-up the small blind
 * folded its first action 47 to 71 percent of the time in production, and
 * 48 to 84 percent in this harness on the previous source.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { omahaVariantSpot } from '../benchmark/OmahaVariantPolicyEvidence.js';
import { calculateContestablePot, calculatePots } from './PokerEngine.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { fastRandom, omahaPreflopPercentile, seedFastRandom } from './HorseEval.js';
import { horseVariantRulesFor } from './VariantRules.js';
import {
  OMAHA_TOURNAMENT_FIRST_IN,
  omahaSmallBlindStealTable,
  omahaTournamentFirstIn,
  type OmahaTournamentFirstInInput,
} from './HorseOmahaTournamentFirstIn.js';
import type { Card, CardRank, CardSuit } from '../types.js';

const RANKS: CardRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS: CardSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

const base: OmahaTournamentFirstInInput = {
  percentile: 0.5,
  position: 'sb',
  liveOpponents: 1,
  tableSize: 2,
  effectiveStackBB: 10,
  raises: 0,
  limpers: 0,
  callers: 0,
  toCall: 1,
  stack: 19,
  pot: 3,
  riskPremium: 0,
  allInOrFold: false,
  satelliteLocked: false,
  playersLeft: 2,
  paidPlacesLeft: 2,
};

describe('omahaTournamentFirstIn: the replacement for a fold', () => {
  it('heads-up small blind first in pot-raises every hand at 20 big blinds or less', () => {
    for (const effectiveStackBB of [2, 8, 14, 20])
      for (const percentile of [0, 0.3, 0.99])
        expect(omahaTournamentFirstIn({ ...base, percentile, effectiveStackBB })).toEqual({
          a: 'jam',
        });
  });

  it('deeper than was measured the fold stands', () => {
    expect(omahaTournamentFirstIn({ ...base, effectiveStackBB: 20.5 })).toBeNull();
  });

  it('a three-handed winner-take-all table acts to 30 big blinds; heads-up keeps 20', () => {
    // Measured 2026-11-14 (spin, seed 93002): +0.14 to +0.22 BB per hand at
    // 22/25/30 BB against every opponent; heads-up the same extension lost
    // to the re-shoving opponent (PLO5, 30 BB), so heads-up stays at 20.
    const spin = { ...base, tableSize: 3, playersLeft: 3, paidPlacesLeft: 1, percentile: 0.02 };
    for (const effectiveStackBB of [22, 25, 30])
      expect(omahaTournamentFirstIn({ ...spin, effectiveStackBB })).toEqual({ a: 'jam' });
    expect(omahaTournamentFirstIn({ ...spin, effectiveStackBB: 30.5 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...base, effectiveStackBB: 22 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...spin, effectiveStackBB: 25, paidPlacesLeft: 3 })).toBeNull();
    const close = {
      ...spin,
      position: 'bb' as const,
      raises: 1,
      toCall: 4,
      stack: 46,
      pot: 8,
      percentile: 0.9,
    };
    expect(omahaTournamentFirstIn({ ...close, effectiveStackBB: 25 })).toEqual({ a: 'call' });
    expect(omahaTournamentFirstIn({ ...close, effectiveStackBB: 31 })).toBeNull();
  });

  it('three-handed, the small blind against the big blind alone plays the same way', () => {
    expect(
      omahaTournamentFirstIn({ ...base, tableSize: 3, paidPlacesLeft: 1, percentile: 0.02 })
    ).toEqual({
      a: 'jam',
    });
  });

  it('a non-blind seat first in keeps the engine fold (a wider button range was rejected)', () => {
    for (const liveOpponents of [1, 2, 3])
      expect(
        omahaTournamentFirstIn({
          ...base,
          position: 'late',
          liveOpponents,
          tableSize: 3,
          toCall: 2,
          percentile: 0.99,
        })
      ).toBeNull();
  });

  it('the short-handed rule stands aside at larger tables (four to eight dealt belong to the full-table small blind rule)', () => {
    const shortHandedOnly = { ...OMAHA_TOURNAMENT_FIRST_IN, fullTableSbStealShare: 0 };
    for (const tableSize of [4, 6, 9]) {
      expect(
        omahaTournamentFirstIn(
          { ...base, tableSize, holeCount: 4, percentile: 0.99 },
          shortHandedOnly
        )
      ).toBeNull();
      expect(
        omahaTournamentFirstIn({
          ...base,
          tableSize,
          position: 'late',
          liveOpponents: 2,
          holeCount: 4,
          percentile: 0.99,
        })
      ).toBeNull();
    }
    expect(
      omahaTournamentFirstIn({ ...base, tableSize: 9, holeCount: 4, percentile: 0.99 })
    ).toBeNull();
  });

  it('acts only at the final table: other tables still running, or an unknown field, keep the fold', () => {
    expect(omahaTournamentFirstIn({ ...base, playersLeft: 10, percentile: 0.99 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...base, playersLeft: 3, percentile: 0.99 })).toBeNull();
    expect(
      omahaTournamentFirstIn({ ...base, playersLeft: Number.NaN, percentile: 0.99 })
    ).toBeNull();
    expect(
      omahaTournamentFirstIn({
        ...base,
        tableSize: 3,
        playersLeft: 3,
        paidPlacesLeft: 1,
        percentile: 0.5,
      })
    ).toEqual({
      a: 'jam',
    });
    const bb = { ...base, position: 'bb' as const, raises: 1, toCall: 4, stack: 36, pot: 8 };
    expect(omahaTournamentFirstIn({ ...bb, playersLeft: 10, percentile: 0.99 })).toBeNull();
  });

  it('three-handed with pay jumps only the small blind acts, on its top 60 percent, when every player left is paid; heads-up any payout', () => {
    // Measured 2026-11-14 (payouts 25/17/13, seed 97003, conserved ICM
    // equity): +0.008 to +0.023 percent of the pool per hand pooled against
    // every opponent, no cell below zero.
    const three = { ...base, tableSize: 3, playersLeft: 3, percentile: 0.99 };
    const jumps = { ...three, paidPlacesLeft: 3 };
    expect(omahaTournamentFirstIn({ ...jumps, percentile: 0.41 })).toEqual({ a: 'jam' });
    expect(omahaTournamentFirstIn({ ...jumps, percentile: 0.39 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...three, paidPlacesLeft: 1, percentile: 0.02 })).toEqual({
      a: 'jam',
    });
    // A money bubble (two of three paid) or an unknown payout keeps the fold.
    expect(omahaTournamentFirstIn({ ...three, paidPlacesLeft: 2 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...three, paidPlacesLeft: Number.NaN })).toBeNull();
    // Pay jumps act to 20 BB (not the spin's 30), narrowed by the risk premium.
    expect(omahaTournamentFirstIn({ ...jumps, effectiveStackBB: 20 })).toEqual({ a: 'jam' });
    expect(omahaTournamentFirstIn({ ...jumps, effectiveStackBB: 20.5 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...jumps, riskPremium: 0.05, percentile: 0.49 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...jumps, riskPremium: 0.05, percentile: 0.52 })).toEqual({
      a: 'jam',
    });
    // The big blind keeps the engine fold with pay jumps.
    expect(
      omahaTournamentFirstIn({
        ...jumps,
        position: 'bb',
        raises: 1,
        toCall: 4,
        stack: 36,
        pot: 8,
      })
    ).toBeNull();
    // 0 is the previous rule: pay jumps stand aside.
    expect(
      omahaTournamentFirstIn(jumps, { ...OMAHA_TOURNAMENT_FIRST_IN, payJumpBlindVsBlindShare: 0 })
    ).toBeNull();
    for (const paidPlacesLeft of [1, 2, Number.NaN])
      expect(omahaTournamentFirstIn({ ...base, paidPlacesLeft, percentile: 0.99 })).toEqual({
        a: 'jam',
      });
  });

  it('All-In-Or-Fold tables and locked satellite seats keep the engine fold', () => {
    expect(omahaTournamentFirstIn({ ...base, allInOrFold: true, percentile: 0.99 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...base, satelliteLocked: true, percentile: 0.99 })).toBeNull();
    const bb = { ...base, position: 'bb' as const, raises: 1, toCall: 4, stack: 36, pot: 8 };
    expect(omahaTournamentFirstIn({ ...bb, allInOrFold: true, percentile: 0.99 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...bb, satelliteLocked: true, percentile: 0.99 })).toBeNull();
  });

  it('the risk premium narrows every share, heads-up included', () => {
    expect(omahaTournamentFirstIn({ ...base, riskPremium: 0.1, percentile: 0.19 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...base, riskPremium: 0.1, percentile: 0.21 })).toEqual({
      a: 'jam',
    });
    // Two players left in a tournament: the engine caps the premium at 0.01.
    expect(omahaTournamentFirstIn({ ...base, riskPremium: 0.01, percentile: 0.03 })).toEqual({
      a: 'jam',
    });
    expect(omahaTournamentFirstIn({ ...base, riskPremium: 5, percentile: 0.49 })).toBeNull();
  });

  it('never opens a pot somebody already entered', () => {
    expect(omahaTournamentFirstIn({ ...base, limpers: 1 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...base, raises: 1 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...base, toCall: 0 })).toBeNull();
  });

  it('the heads-up big blind calls its top 75 percent against one raise at a price of a half or better', () => {
    const bb = { ...base, position: 'bb' as const, raises: 1, toCall: 4, stack: 36, pot: 8 };
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.26 })).toEqual({ a: 'call' });
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.24 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.9, toCall: 20, pot: 12 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.9, stack: 8 })).toEqual({ a: 'call' });
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.9, tableSize: 3 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.9, callers: 1 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.9, limpers: 1 })).toBeNull();
  });

  it('a three-handed winner-take-all big blind closing against one raise calls its top 75 percent', () => {
    const close = {
      ...base,
      position: 'bb' as const,
      tableSize: 3,
      playersLeft: 3,
      paidPlacesLeft: 1,
      raises: 1,
      toCall: 4,
      stack: 36,
      pot: 8,
    };
    expect(omahaTournamentFirstIn({ ...close, percentile: 0.26 })).toEqual({ a: 'call' });
    expect(omahaTournamentFirstIn({ ...close, percentile: 0.24 })).toBeNull();
    // Pay jumps, a caller already in, or a dear price keep the fold.
    expect(omahaTournamentFirstIn({ ...close, paidPlacesLeft: 3, percentile: 0.9 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...close, callers: 1, percentile: 0.9 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...close, toCall: 20, pot: 12, percentile: 0.9 })).toBeNull();
    // Off: the measured first stage exactly.
    expect(
      omahaTournamentFirstIn(
        { ...close, percentile: 0.9 },
        { ...OMAHA_TOURNAMENT_FIRST_IN, bigBlindClosingShare: 0 }
      )
    ).toBeNull();
  });

  it('publishes the measured shares and limits', () => {
    expect(OMAHA_TOURNAMENT_FIRST_IN).toEqual({
      headsUpShare: 1,
      blindVsBlindShare: 1,
      maxStackBB: 20,
      winnerTakeAllMaxStackBB: 30,
      maxTableSize: 3,
      bigBlindDefendShare: 0.75,
      bigBlindMaxPrice: 0.5,
      bigBlindClosingShare: 0.75,
      payJumpBlindVsBlindShare: 0.6,
      fullTableSbStealShare: 0.4,
      fullTableSbStealMaxStackBB: 20,
    });
  });
});

describe('omahaTournamentFirstIn: the full-table small blind (four to eight dealt, PLO4 and PLO5)', () => {
  // Evaluated under a protocol frozen before running (ITEM4-PROTOCOL.md
  // section B): 6 and 8 handed, PLO4 and PLO5, 10/14/18 BB, eighteen or
  // twenty-four left with three paid, conserved prize equity; pooled +0.0017
  // percent of the pool per hand (SE 0.00015), no cell below -1 SE.
  const full: OmahaTournamentFirstInInput = {
    ...base,
    tableSize: 6,
    playersLeft: 18,
    paidPlacesLeft: 3,
    holeCount: 4,
    effectiveStackBB: 14,
    stack: 27,
    percentile: 0.6,
  };

  it('the small blind folded to, big blind alone, pot-raises its top 40 percent at 20 BB or less', () => {
    for (const tableSize of [4, 5, 6, 7, 8])
      for (const holeCount of [4, 5])
        for (const effectiveStackBB of [2, 10, 14, 18, 20])
          expect(
            omahaTournamentFirstIn({ ...full, tableSize, holeCount, effectiveStackBB })
          ).toEqual({ a: 'jam' });
  });

  it('the percentile edge is 0.60, flat: the risk premium does not narrow it', () => {
    expect(omahaTournamentFirstIn({ ...full, percentile: 0.6 })).toEqual({ a: 'jam' });
    expect(omahaTournamentFirstIn({ ...full, percentile: 0.5999 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...full, percentile: 0.02 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...full, percentile: 0.6, riskPremium: 0.15 })).toEqual({
      a: 'jam',
    });
  });

  it('the stack edge is 20 big blinds', () => {
    expect(omahaTournamentFirstIn({ ...full, effectiveStackBB: 20 })).toEqual({ a: 'jam' });
    expect(omahaTournamentFirstIn({ ...full, effectiveStackBB: 20.01 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...full, effectiveStackBB: 0 })).toBeNull();
  });

  it('three and nine dealt are not this rule', () => {
    // Three dealt with other tables running: the short-handed rule stands aside.
    expect(omahaTournamentFirstIn({ ...full, tableSize: 3, percentile: 0.99 })).toBeNull();
    // A three-handed spin is the short-handed rule's (every hand), not the top 40 percent.
    expect(
      omahaTournamentFirstIn({
        ...full,
        tableSize: 3,
        playersLeft: 3,
        paidPlacesLeft: 1,
        percentile: 0.02,
      })
    ).toEqual({ a: 'jam' });
    for (const tableSize of [9, 10])
      expect(omahaTournamentFirstIn({ ...full, tableSize, percentile: 0.99 })).toBeNull();
    expect(omahaSmallBlindStealTable({ tableSize: 3 })).toBe(false);
    expect(omahaSmallBlindStealTable({ tableSize: 4 })).toBe(true);
    expect(omahaSmallBlindStealTable({ tableSize: 8 })).toBe(true);
    expect(omahaSmallBlindStealTable({ tableSize: 9 })).toBe(false);
  });

  it('PLO4 and PLO5 only: PLO6 or an unknown hole-card count keeps the fold', () => {
    expect(omahaTournamentFirstIn({ ...full, holeCount: 6, percentile: 0.99 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...full, holeCount: undefined, percentile: 0.99 })).toBeNull();
  });

  it('stands aside on the bubble, hand-for-hand, in a satellite, All-In-Or-Fold and an unknown field or payout', () => {
    const fire = { ...full, percentile: 0.99 };
    expect(omahaTournamentFirstIn(fire)).toEqual({ a: 'jam' });
    // The feed's near-bubble line, as evaluated: one off the paid places or
    // within 15 percent of them.
    expect(omahaTournamentFirstIn({ ...fire, playersLeft: 4, paidPlacesLeft: 3 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, playersLeft: 17, paidPlacesLeft: 15 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, playersLeft: 115, paidPlacesLeft: 100 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, playersLeft: 116, paidPlacesLeft: 100 })).toEqual({
      a: 'jam',
    });
    // In the money (every player left paid) it acts, as the pay-jump control measured.
    expect(omahaTournamentFirstIn({ ...fire, playersLeft: 6, paidPlacesLeft: 6 })).toEqual({
      a: 'jam',
    });
    // The trusted context's flags, the locked seat and All-In-Or-Fold.
    expect(omahaTournamentFirstIn({ ...fire, nearBubble: true })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, handForHand: true })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, satellite: true })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, satelliteLocked: true })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, allInOrFold: true })).toBeNull();
    // Unknown field or payout.
    expect(omahaTournamentFirstIn({ ...fire, playersLeft: Number.NaN })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, paidPlacesLeft: Number.NaN })).toBeNull();
  });

  it('only the small blind folded to with the big blind alone: the big blind and every other spot keep the fold', () => {
    const fire = { ...full, percentile: 0.99 };
    expect(
      omahaTournamentFirstIn({ ...fire, position: 'bb', raises: 1, toCall: 4, stack: 22, pot: 8 })
    ).toBeNull();
    expect(
      omahaTournamentFirstIn({ ...fire, position: 'late', liveOpponents: 2, toCall: 2 })
    ).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, limpers: 1 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, raises: 1 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, liveOpponents: 2 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...fire, toCall: 0 })).toBeNull();
  });

  it('share 0 is the previous rule: four to eight dealt stand aside', () => {
    const off = { ...OMAHA_TOURNAMENT_FIRST_IN, fullTableSbStealShare: 0 };
    expect(omahaTournamentFirstIn({ ...full, percentile: 0.99 }, off)).toBeNull();
    expect(omahaSmallBlindStealTable({ tableSize: 6 }, off)).toBe(false);
  });
});

type Variant = 'plo4' | 'plo5' | 'plo6' | 'plo8';

/** The small blind's first decision, unraised: heads-up, or three-handed after the button folds. */
function smallBlindSpot(
  variant: Variant,
  seats: 2 | 3,
  stackBB: number,
  mode: 'cash' | 'tournament',
  seed: number
) {
  seedFastRandom(seed);
  const input = omahaVariantSpot('plo8', 'preflop', seats, mode);
  const st = input.state;
  st.gameVariant = variant;
  st.variantRules = horseVariantRulesFor(variant);
  const deck: Card[] = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
  for (let k = deck.length - 1; k > 0; k--) {
    const j = Math.floor(fastRandom() * (k + 1));
    [deck[k], deck[j]] = [deck[j], deck[k]];
  }
  const chips = stackBB * 2;
  st.players.forEach((p, idx) => {
    p.bet = idx === 0 ? 1 : idx === 1 ? 2 : 0;
    p.totalInvested = p.bet;
    p.stack = chips - p.bet;
    p.is_folded = idx === 2;
  });
  const hero = {
    ...st.players[0],
    cards: deck.slice(0, variant === 'plo8' ? 4 : Number(variant.slice(3))),
  };
  st.dealerSeat = seats === 2 ? 1 : 3;
  st.blindSeats = { smallBlind: 1, bigBlind: 2 };
  st.pot = 3;
  st.currentBet = 2;
  st.toCall = 1;
  st.minRaise = 2;
  st.lastRaise = 2;
  st.minRaiseTo = 4;
  st.maxRaiseTo = Math.min(chips, 6);
  st.pots = calculatePots(st.players);
  st.contestablePot = calculateContestablePot(st.players, hero.user_id, 1);
  st.legalActions = ['fold', 'call', 'raise', 'all_in'];
  st.actionHistory =
    seats === 3
      ? [{ userId: 'v3', seat: 3, action: 'fold', amount: 0, stage: 'preflop', timestamp: 1 }]
      : [];
  if (st.tournament) {
    st.tournament.playersLeft = seats;
    // Three-handed: a winner-take-all spin, the only three-handed payout the
    // rule acts on (heads-up keeps the fixture's own payout curve).
    // Production lists paid places only (zeros removed), so a valid
    // winner-take-all context is one place paid.
    if (seats === 3) {
      st.tournament.payoutPct = [100];
      st.tournament.spotsPaid = 1;
    }
    st.tournament.stacks = st.players.map((p) => p.stack + p.totalInvested);
    st.tournament.stackByUser = Object.fromEntries(
      st.players.map((p) => [p.user_id, p.stack + p.totalInvested])
    );
  }
  return { hero, state: st };
}

/** The heads-up big blind facing the small blind's pot raise (no limper, no caller). */
function bigBlindSpot(variant: Variant, stackBB: number, seed: number) {
  const { state: st } = smallBlindSpot(variant, 2, stackBB, 'tournament', seed);
  const chips = stackBB * 2;
  const deck: Card[] = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
  for (let k = deck.length - 1; k > 0; k--) {
    const j = Math.floor(fastRandom() * (k + 1));
    [deck[k], deck[j]] = [deck[j], deck[k]];
  }
  const sb = st.players[0];
  sb.bet = 6;
  sb.totalInvested = 6;
  sb.stack = chips - 6;
  const bbSeat = st.players[1];
  const hero = {
    ...bbSeat,
    cards: deck.slice(0, variant === 'plo8' ? 4 : Number(variant.slice(3))),
  };
  st.players[1] = hero;
  st.pot = 8;
  st.currentBet = 6;
  st.toCall = 4;
  st.minRaise = 4;
  st.lastRaise = 4;
  st.minRaiseTo = 10;
  st.maxRaiseTo = Math.min(chips, 18);
  st.pots = calculatePots(st.players);
  st.contestablePot = calculateContestablePot(st.players, hero.user_id, 4);
  st.legalActions = ['fold', 'call', 'raise', 'all_in'];
  st.actionHistory = [
    {
      userId: sb.user_id,
      seat: sb.seat,
      action: 'raise',
      amount: 6,
      stage: 'preflop',
      timestamp: 1,
    },
  ];
  if (st.tournament) {
    st.tournament.stacks = st.players.map((p) => p.stack + p.totalInvested);
    st.tournament.stackByUser = Object.fromEntries(
      st.players.map((p) => [p.user_id, p.stack + p.totalInvested])
    );
  }
  return { hero, state: st };
}

/** Three-handed winner-take-all spin: the button raised, the small blind
 *  folded, the big blind (hero) closes the action. */
function closingSpot(variant: Variant, stackBB: number, seed: number) {
  const { state: st } = smallBlindSpot(variant, 3, stackBB, 'tournament', seed);
  const chips = stackBB * 2;
  const deck: Card[] = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
  for (let k = deck.length - 1; k > 0; k--) {
    const j = Math.floor(fastRandom() * (k + 1));
    [deck[k], deck[j]] = [deck[j], deck[k]];
  }
  const sb = st.players[0];
  sb.is_folded = true;
  const button = st.players[2];
  button.is_folded = false;
  button.bet = 6;
  button.totalInvested = 6;
  button.stack = chips - 6;
  const hero = {
    ...st.players[1],
    cards: deck.slice(0, variant === 'plo8' ? 4 : Number(variant.slice(3))),
  };
  st.players[1] = hero;
  st.pot = 9;
  st.currentBet = 6;
  st.toCall = 4;
  st.minRaise = 4;
  st.lastRaise = 4;
  st.minRaiseTo = 10;
  st.maxRaiseTo = Math.min(chips, 19);
  st.pots = calculatePots(st.players);
  st.contestablePot = calculateContestablePot(st.players, hero.user_id, 4);
  st.legalActions = ['fold', 'call', 'raise', 'all_in'];
  st.actionHistory = [
    {
      userId: button.user_id,
      seat: button.seat,
      action: 'raise',
      amount: 6,
      stage: 'preflop',
      timestamp: 1,
    },
    {
      userId: sb.user_id,
      seat: sb.seat,
      action: 'fold',
      amount: 0,
      stage: 'preflop',
      timestamp: 2,
    },
  ];
  if (st.tournament) {
    st.tournament.payoutPct = [100];
    st.tournament.spotsPaid = 1;
    st.tournament.stacks = st.players.map((p) => p.stack + p.totalInvested);
    st.tournament.stackByUser = Object.fromEntries(
      st.players.map((p) => [p.user_id, p.stack + p.totalInvested])
    );
  }
  return { hero, state: st };
}

function folds(
  variant: Variant,
  seats: 2 | 3,
  stackBB: number,
  mode: 'cash' | 'tournament',
  opts: HorseDecideOpts,
  hands = 120
) {
  let n = 0;
  const actions: string[] = [];
  for (let i = 0; i < hands; i++) {
    HorseMind.reset();
    const { hero, state } = smallBlindSpot(variant, seats, stackBB, mode, 7000 + i * 131 + stackBB);
    const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, ...opts });
    actions.push(`${d.action}:${d.amount ?? ''}`);
    if (d.action === 'fold') n++;
  }
  return { share: n / hands, actions };
}

describe(
  'the small blind stops walking the big blind in Omaha tournaments',
  { timeout: 120_000 },
  () => {
    afterEach(() => HorseMind.reset());

    it.each(['plo4', 'plo5', 'plo6'] as const)(
      '%s heads-up: almost never folds first in, at any depth to 20 big blinds',
      (variant) => {
        for (const stackBB of [4, 8, 15, 20]) {
          const on = folds(variant, 2, stackBB, 'tournament', {});
          const off = folds(variant, 2, stackBB, 'tournament', { omahaTournamentFirstIn: false });
          // Three or four of a rank still fold (the V46 class gate); nothing else does.
          expect([variant, stackBB, on.share <= 0.05]).toEqual([variant, stackBB, true]);
          // The defect, pinned so the law is not vacuous: without the rule the
          // engine folds at least a quarter more of these hands.
          expect([variant, stackBB, off.share >= on.share + 0.25]).toEqual([
            variant,
            stackBB,
            true,
          ]);
        }
      }
    );

    it('three-handed, the small blind against the big blind alone does the same', () => {
      expect(folds('plo4', 3, 10, 'tournament', {}).share).toBeLessThanOrEqual(0.05);
      expect(
        folds('plo4', 3, 10, 'tournament', { omahaTournamentFirstIn: false }).share
      ).toBeGreaterThanOrEqual(0.4);
    });

    it('three-handed winner-take-all at 22 to 30 big blinds the small blind stops folding too', () => {
      for (const stackBB of [22, 25, 30]) {
        const on = folds('plo4', 3, stackBB, 'tournament', {});
        const off = folds('plo4', 3, stackBB, 'tournament', { omahaTournamentFirstIn: false });
        expect([stackBB, on.share <= 0.05]).toEqual([stackBB, true]);
        expect([stackBB, off.share >= on.share + 0.25]).toEqual([stackBB, true]);
      }
      // Deeper than 30 the engine decides alone.
      expect(folds('plo4', 3, 35, 'tournament', {}).actions).toEqual(
        folds('plo4', 3, 35, 'tournament', { omahaTournamentFirstIn: false }).actions
      );
    });

    it.each(['plo4', 'plo5', 'plo6'] as const)(
      '%s: the tournament utility arbiter evaluates and owns the widened small blind raise',
      (variant) => {
        let widened = 0;
        for (let i = 0; i < 12; i++) {
          HorseMind.reset();
          const on = smallBlindSpot(variant, 2, 15, 'tournament', 9500 + i * 7);
          const d = HorseLogic.decide(on.hero, on.state, 'balanced', {}, { mind: false });
          HorseMind.reset();
          const off = smallBlindSpot(variant, 2, 15, 'tournament', 9500 + i * 7);
          const r = HorseLogic.decide(
            off.hero,
            off.state,
            'balanced',
            {},
            {
              mind: false,
              omahaTournamentFirstIn: false,
            }
          );
          expect(d.tournamentUtility?.selectedAction).toBe(d.action);
          expect(r.tournamentUtility?.selectedAction).toBe(r.action);
          if (r.action === 'fold' && d.action === 'raise') widened++;
        }
        // Not vacuous: the reference folded and Phase 7 kept the rule's raise.
        expect(widened).toBeGreaterThanOrEqual(3);
      }
    );

    it.each(['plo4', 'plo5', 'plo6'] as const)(
      '%s: the tournament utility arbiter evaluates and owns the widened big blind call',
      (variant) => {
        let widened = 0;
        for (let i = 0; i < 24; i++) {
          HorseMind.reset();
          const on = bigBlindSpot(variant, 15, 9700 + i * 11);
          const d = HorseLogic.decide(on.hero, on.state, 'balanced', {}, { mind: false });
          HorseMind.reset();
          const off = bigBlindSpot(variant, 15, 9700 + i * 11);
          const r = HorseLogic.decide(
            off.hero,
            off.state,
            'balanced',
            {},
            {
              mind: false,
              omahaTournamentFirstIn: false,
            }
          );
          expect(d.tournamentUtility?.selectedAction).toBe(d.action);
          expect(r.tournamentUtility?.selectedAction).toBe(r.action);
          if (r.action === 'fold' && d.action === 'call') widened++;
        }
        expect(widened).toBeGreaterThanOrEqual(2);
      }
    );

    it.each(['plo4', 'plo6'] as const)(
      '%s: a winner-take-all spin big blind closing the action calls, and Phase 7 owns it',
      (variant) => {
        let widened = 0;
        for (let i = 0; i < 24; i++) {
          HorseMind.reset();
          const on = closingSpot(variant, 15, 9900 + i * 13);
          const d = HorseLogic.decide(on.hero, on.state, 'balanced', {}, { mind: false });
          HorseMind.reset();
          const off = closingSpot(variant, 15, 9900 + i * 13);
          const r = HorseLogic.decide(
            off.hero,
            off.state,
            'balanced',
            {},
            {
              mind: false,
              omahaTournamentFirstIn: { ...OMAHA_TOURNAMENT_FIRST_IN, bigBlindClosingShare: 0 },
            }
          );
          expect(d.tournamentUtility?.selectedAction).toBe(d.action);
          expect(r.tournamentUtility?.selectedAction).toBe(r.action);
          if (r.action === 'fold' && d.action === 'call') widened++;
        }
        expect(widened).toBeGreaterThanOrEqual(2);
      }
    );

    it('a league arm that names one parameter keeps every other default', () => {
      // Guard: a partial object used to replace the whole parameter set,
      // zeroing every share and switching the rule off without a trace.
      const run = (opts: HorseDecideOpts) => {
        const actions: string[] = [];
        for (let i = 0; i < 24; i++) {
          HorseMind.reset();
          const { hero, state } = smallBlindSpot('plo4', 2, 10, 'tournament', 9300 + i * 19);
          const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, ...opts });
          actions.push(`${d.action}:${d.amount ?? ''}`);
        }
        return actions;
      };
      expect(run({ omahaTournamentFirstIn: { bigBlindClosingShare: 0 } })).toEqual(run({}));
      expect(run({ omahaTournamentFirstIn: {} })).toEqual(run({}));
      expect(run({ omahaTournamentFirstIn: { headsUpShare: undefined } })).toEqual(run({}));
    });

    it('the same closing spot with pay jumps keeps the engine folds', () => {
      const run = (opts: HorseDecideOpts) => {
        const actions: string[] = [];
        for (let i = 0; i < 24; i++) {
          HorseMind.reset();
          const { hero, state } = closingSpot('plo4', 15, 9900 + i * 13);
          if (state.tournament) {
            state.tournament.payoutPct = [50, 30, 20];
            state.tournament.spotsPaid = 3;
          }
          const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, ...opts });
          actions.push(`${d.action}:${d.amount ?? ''}`);
        }
        return actions;
      };
      const on = run({});
      expect(on).toEqual(run({ omahaTournamentFirstIn: false }));
      expect(on.some((a) => a.startsWith('fold'))).toBe(true);
    });

    it('a locked satellite seat keeps its deliberate folds', () => {
      const sat = (opts: HorseDecideOpts) => {
        const actions: string[] = [];
        let locked = 0;
        for (let i = 0; i < 40; i++) {
          HorseMind.reset();
          const { hero, state } = smallBlindSpot('plo4', 3, 12, 'tournament', 9900 + i * 13);
          // The small blind is the chip leader (two seats, three left), so its
          // seat is locked and the engine folds on purpose.
          hero.stack += 24;
          state.players[0].stack += 24;
          const t = state.tournament!;
          t.stacks = state.players.map((p) => p.stack + p.totalInvested);
          t.stackByUser = Object.fromEntries(
            state.players.map((p) => [p.user_id, p.stack + p.totalInvested])
          );
          t.satellite = true;
          t.satelliteSeats = 2;
          t.spotsPaid = 2;
          t.playersLeft = 3;
          enableBrainTelemetry();
          drainFires();
          const d = HorseLogic.decide(
            hero,
            state,
            'balanced',
            {},
            {
              mind: false,
              telemetry: true,
              ...opts,
            }
          );
          if (drainFires().some((f) => f.feature === 'v37_sat_locked')) locked++;
          actions.push(`${d.action}:${d.amount ?? ''}`);
        }
        return { actions, locked };
      };
      const on = sat({});
      const off = sat({ omahaTournamentFirstIn: false });
      expect(on.locked).toBeGreaterThan(0);
      expect(on.actions).toEqual(off.actions);
    });

    it('a table whose mode the engine did not declare is untouched', () => {
      // Without the engine's explicit mode a tournament is only guessed (from
      // a snapshot, or a big blind of ten or more); the rule must not ride
      // that guess, or one seat would play differently by stake alone.
      const undeclared = (opts: HorseDecideOpts) => {
        const actions: string[] = [];
        for (let i = 0; i < 60; i++) {
          HorseMind.reset();
          const { hero, state } = smallBlindSpot('plo4', 2, 15, 'tournament', 9100 + i * 17);
          delete (state as { gameMode?: string }).gameMode;
          const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, ...opts });
          actions.push(`${d.action}:${d.amount ?? ''}`);
        }
        return actions;
      };
      expect(undeclared({})).toEqual(undeclared({ omahaTournamentFirstIn: false }));
    });

    it('deeper than 20 big blinds the engine decides alone', () => {
      expect(folds('plo4', 2, 30, 'tournament', {}).actions).toEqual(
        folds('plo4', 2, 30, 'tournament', { omahaTournamentFirstIn: false }).actions
      );
    });

    it('a three-handed final table with pay jumps: the small blind plays its top 60 percent, the rest still fold', () => {
      const payJumps = (opts: HorseDecideOpts, payoutPct = [50, 30, 20]) => {
        const actions: string[] = [];
        for (let i = 0; i < 60; i++) {
          HorseMind.reset();
          const { hero, state } = smallBlindSpot('plo4', 3, 10, 'tournament', 9700 + i * 29);
          if (state.tournament) {
            state.tournament.payoutPct = payoutPct;
            state.tournament.spotsPaid = payoutPct.length;
          }
          const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, ...opts });
          actions.push(`${d.action}:${d.amount ?? ''}`);
        }
        return actions;
      };
      const on = payJumps({});
      const off = payJumps({ omahaTournamentFirstIn: false });
      const foldCount = (a: string[]) => a.filter((x) => x.startsWith('fold')).length;
      expect(foldCount(on)).toBeLessThan(foldCount(off));
      expect(on.some((a) => a.startsWith('fold'))).toBe(true);
      // Only folds change: every hand the engine already played is untouched.
      on.forEach((a, k) => {
        if (!off[k].startsWith('fold')) expect(a).toEqual(off[k]);
      });
      // A partial arm keeps the other defaults; share 0 is the previous rule.
      expect(payJumps({ omahaTournamentFirstIn: { payJumpBlindVsBlindShare: 0 } })).toEqual(off);
      // A money bubble (three left, two paid) keeps every engine fold.
      expect(payJumps({}, [65, 35])).toEqual(payJumps({ omahaTournamentFirstIn: false }, [65, 35]));
    });

    it('a short-handed table with other tables still running keeps the engine folds', () => {
      const offFinal = (opts: HorseDecideOpts) => {
        const actions: string[] = [];
        for (let i = 0; i < 60; i++) {
          HorseMind.reset();
          const { hero, state } = smallBlindSpot('plo4', 2, 10, 'tournament', 9500 + i * 23);
          if (state.tournament) {
            const others = Array.from({ length: 8 }, () => 20 * 2);
            state.tournament.playersLeft = 10;
            state.tournament.stacks = [...(state.tournament.stacks ?? []), ...others];
          }
          const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, ...opts });
          actions.push(`${d.action}:${d.amount ?? ''}`);
        }
        return actions;
      };
      const on = offFinal({});
      expect(on).toEqual(offFinal({ omahaTournamentFirstIn: false }));
      expect(on.some((a) => a.startsWith('fold'))).toBe(true);
    });

    it('an All-In-Or-Fold table keeps its own ranges', () => {
      const aof = (opts: HorseDecideOpts) => {
        const actions: string[] = [];
        for (let i = 0; i < 60; i++) {
          HorseMind.reset();
          const { hero, state } = smallBlindSpot('plo4', 2, 10, 'tournament', 9300 + i * 19);
          (state as { allInOrFold?: boolean }).allInOrFold = true;
          const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, ...opts });
          actions.push(`${d.action}:${d.amount ?? ''}`);
        }
        return actions;
      };
      const on = aof({});
      expect(on).toEqual(aof({ omahaTournamentFirstIn: false }));
      // The AoF ranges still fold some hands: the module did not shove them.
      expect(on.some((a) => a.startsWith('fold'))).toBe(true);
    });

    it('cash games and Hi-Lo are untouched', () => {
      expect(folds('plo4', 2, 15, 'cash', {}).actions).toEqual(
        folds('plo4', 2, 15, 'cash', { omahaTournamentFirstIn: false }).actions
      );
      expect(folds('plo8', 2, 15, 'tournament', {}).actions).toEqual(
        folds('plo8', 2, 15, 'tournament', { omahaTournamentFirstIn: false }).actions
      );
    });
  }
);

/** Four to eight dealt (or any count, for the boundary cases): folded to the
 *  small blind (seat 1) with the big blind (seat 2) alone; eighteen players
 *  left over three tables, three places paid (the evaluated main grid). */
function fullTableSpot(
  variant: Variant,
  dealt: number,
  stackBB: number,
  mode: 'cash' | 'tournament',
  seed: number
) {
  seedFastRandom(seed);
  const input = omahaVariantSpot('plo8', 'preflop', dealt, mode);
  const st = input.state;
  st.gameVariant = variant;
  st.variantRules = horseVariantRulesFor(variant);
  st.format = mode === 'cash' ? 'cash' : 'mtt';
  const deck: Card[] = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
  for (let k = deck.length - 1; k > 0; k--) {
    const j = Math.floor(fastRandom() * (k + 1));
    [deck[k], deck[j]] = [deck[j], deck[k]];
  }
  const chips = stackBB * 2;
  st.players.forEach((p, idx) => {
    p.bet = idx === 0 ? 1 : idx === 1 ? 2 : 0;
    p.totalInvested = p.bet;
    p.stack = chips - p.bet;
    p.is_folded = idx >= 2;
  });
  const hero = {
    ...st.players[0],
    cards: deck.slice(0, variant === 'plo8' ? 4 : Number(variant.slice(3))),
  };
  st.dealerSeat = dealt;
  st.blindSeats = { smallBlind: 1, bigBlind: 2 };
  st.pot = 3;
  st.currentBet = 2;
  st.toCall = 1;
  st.minRaise = 2;
  st.lastRaise = 2;
  st.minRaiseTo = 4;
  st.maxRaiseTo = Math.min(chips, 6);
  st.pots = calculatePots(st.players);
  st.contestablePot = calculateContestablePot(st.players, hero.user_id, 1);
  st.legalActions = ['fold', 'call', 'raise', 'all_in'];
  st.actionHistory = Array.from({ length: dealt - 2 }, (_, k) => ({
    userId: `v${k + 3}`,
    seat: k + 3,
    action: 'fold' as const,
    amount: 0,
    stage: 'preflop' as const,
    timestamp: k + 1,
  }));
  if (st.tournament) {
    st.tournament.playersLeft = 18;
    st.tournament.payoutPct = [50, 30, 20];
    st.tournament.spotsPaid = 3;
    st.tournament.stacks = [
      ...st.players.map((p) => p.stack + p.totalInvested),
      ...Array.from({ length: Math.max(0, 18 - dealt) }, () => chips),
    ];
    st.tournament.stackByUser = Object.fromEntries(
      st.players.map((p) => [p.user_id, p.stack + p.totalInvested])
    );
  }
  return { hero, state: st };
}

/** The same table: the small blind pot-raised, the big blind (hero) to act. */
function fullTableBigBlindSpot(variant: Variant, dealt: number, stackBB: number, seed: number) {
  const { state: st } = fullTableSpot(variant, dealt, stackBB, 'tournament', seed);
  const chips = stackBB * 2;
  const deck: Card[] = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
  for (let k = deck.length - 1; k > 0; k--) {
    const j = Math.floor(fastRandom() * (k + 1));
    [deck[k], deck[j]] = [deck[j], deck[k]];
  }
  const sb = st.players[0];
  sb.bet = 6;
  sb.totalInvested = 6;
  sb.stack = chips - 6;
  const hero = {
    ...st.players[1],
    cards: deck.slice(0, variant === 'plo8' ? 4 : Number(variant.slice(3))),
  };
  st.players[1] = hero;
  st.pot = 8;
  st.currentBet = 6;
  st.toCall = 4;
  st.minRaise = 4;
  st.lastRaise = 4;
  st.minRaiseTo = 10;
  st.maxRaiseTo = Math.min(chips, 18);
  st.pots = calculatePots(st.players);
  st.contestablePot = calculateContestablePot(st.players, hero.user_id, 4);
  st.actionHistory = [
    ...(st.actionHistory ?? []),
    {
      userId: sb.user_id,
      seat: sb.seat,
      action: 'raise',
      amount: 6,
      stage: 'preflop',
      timestamp: dealt,
    },
  ];
  if (st.tournament) {
    st.tournament.stacks = [
      ...st.players.map((p) => p.stack + p.totalInvested),
      ...Array.from({ length: Math.max(0, 18 - dealt) }, () => chips),
    ];
    st.tournament.stackByUser = Object.fromEntries(
      st.players.map((p) => [p.user_id, p.stack + p.totalInvested])
    );
  }
  return { hero, state: st };
}

type FullTableState = ReturnType<typeof fullTableSpot>['state'];
interface FullTableCase {
  variant?: Variant;
  dealt?: number;
  stackBB?: number;
  mode?: 'cash' | 'tournament';
  tweak?: (state: FullTableState) => void;
}

/** The same seeded deals for every case; per hand the action, the hand's
 *  Omaha percentile and whether the full-table receipt fired. */
function fullTableRun(opts: HorseDecideOpts, c: FullTableCase = {}, hands = 40) {
  const actions: string[] = [];
  const percentiles: number[] = [];
  const receipts: boolean[] = [];
  enableBrainTelemetry();
  for (let i = 0; i < hands; i++) {
    HorseMind.reset();
    const { hero, state } = fullTableSpot(
      c.variant ?? 'plo4',
      c.dealt ?? 6,
      c.stackBB ?? 10,
      c.mode ?? 'tournament',
      9100 + i * 37
    );
    c.tweak?.(state);
    drainFires();
    const d = HorseLogic.decide(
      hero,
      state,
      'balanced',
      {},
      { mind: false, telemetry: true, ...opts }
    );
    const fired = drainFires();
    actions.push(`${d.action}:${d.amount ?? ''}`);
    percentiles.push(omahaPreflopPercentile(hero.cards, false));
    receipts.push(fired.some((f) => f.feature === 'omaha_full_table_sb_steal'));
    if (fired.some((f) => f.feature === 'omaha_tournament_first_in'))
      throw new Error('the short-handed receipt fired at a full table');
  }
  return { actions, percentiles, receipts };
}

describe(
  'four to eight dealt: the PLO4/PLO5 small blind folded to stops folding its top 40 percent',
  { timeout: 180_000 },
  () => {
    afterEach(() => HorseMind.reset());
    const foldCount = (a: string[]) => a.filter((x) => x.startsWith('fold')).length;

    it.each([
      ['plo4', 6, 10],
      ['plo5', 8, 14],
    ] as const)(
      '%s, %i dealt, %i BB: only engine folds change, each to a raise of a top-40-percent hand, with its own receipt',
      (variant, dealt, stackBB) => {
        const c = { variant, dealt, stackBB };
        const on = fullTableRun({ omahaSmallBlindSteal: true }, c);
        const off = fullTableRun({ omahaTournamentFirstIn: false }, c);
        expect(foldCount(on.actions)).toBeLessThan(foldCount(off.actions));
        let changed = 0;
        on.actions.forEach((a, k) => {
          if (a === off.actions[k]) return;
          changed++;
          // Only an engine fold changes (every hand the engine played is
          // untouched), it becomes the pot-limit raise or all-in, and only for
          // a hand at or above the 0.60 percentile.
          expect([k, off.actions[k].startsWith('fold')]).toEqual([k, true]);
          expect(a).toMatch(/^(raise|all_in):/);
          expect(on.percentiles[k]).toBeGreaterThanOrEqual(0.6);
          expect(on.receipts[k]).toBe(true);
        });
        expect(changed).toBeGreaterThan(0);
        expect(off.receipts.some(Boolean)).toBe(false);
        // A partial arm keeps the other defaults; share 0 is the previous engine.
        expect(
          fullTableRun({ omahaTournamentFirstIn: { fullTableSbStealShare: 0 } }, c).actions
        ).toEqual(off.actions);
      }
    );

    // The same deals as the plo4 / 6 dealt / 10 BB case above, where the rule
    // changes folds; here each stand-aside condition alone keeps every one.
    it.each<[string, (s: FullTableState) => void]>([
      ['the feed says near the bubble', (s) => void (s.tournament!.nearBubble = true)],
      ['hand-for-hand', (s) => void (s.tournament!.handForHand = true)],
      ['hand-for-hand expected', (s) => void (s.tournament!.handForHandExpected = true)],
      [
        'a satellite',
        (s) => {
          s.tournament!.satellite = true;
          s.tournament!.satelliteSeats = 3;
        },
      ],
      [
        'the near-bubble line (17 left, 15 paid)',
        (s) => {
          const t = s.tournament!;
          t.playersLeft = 17;
          t.payoutPct = [20, 15, 12, 10, 8, 7, 6, 5, 4, 3, 3, 2, 2, 2, 1];
          t.spotsPaid = 15;
          t.stacks = (t.stacks ?? []).slice(0, 17);
        },
      ],
      ['an unknown field', (s) => void delete s.tournament!.playersLeft],
      ['All-In-Or-Fold', (s) => void ((s as { allInOrFold?: boolean }).allInOrFold = true)],
    ])('stands aside: %s', (_name, tweak) => {
      const on = fullTableRun({ omahaSmallBlindSteal: true }, { tweak });
      expect(on.actions).toEqual(
        fullTableRun({ omahaTournamentFirstIn: false }, { tweak }).actions
      );
      expect(on.receipts.some(Boolean)).toBe(false);
      expect(foldCount(on.actions)).toBeGreaterThan(0);
    });

    it.each<[string, FullTableCase]>([
      ['three dealt with other tables running', { dealt: 3 }],
      ['nine dealt', { dealt: 9 }],
      ['PLO6', { variant: 'plo6' }],
      ['Hi-Lo', { variant: 'plo8' }],
      ['cash', { mode: 'cash' }],
      ['deeper than 20 BB', { stackBB: 25 }],
    ])('untouched: %s', (_name, c) => {
      const on = fullTableRun({ omahaSmallBlindSteal: true }, c);
      expect(on.actions).toEqual(fullTableRun({ omahaTournamentFirstIn: false }, c).actions);
      expect(on.receipts.some(Boolean)).toBe(false);
    });

    it('the option unset (the source default) leaves the full-table small blind folding as before', () => {
      const unset = fullTableRun({});
      expect(unset.actions).toEqual(fullTableRun({ omahaTournamentFirstIn: false }).actions);
      expect(unset.receipts.some(Boolean)).toBe(false);
      expect(fullTableRun({ omahaSmallBlindSteal: true }).receipts.some(Boolean)).toBe(true);
    });

    it('the big blind facing the small blind raise keeps the engine decision', () => {
      const bb = (opts: HorseDecideOpts) => {
        const actions: string[] = [];
        for (let i = 0; i < 40; i++) {
          HorseMind.reset();
          const { hero, state } = fullTableBigBlindSpot('plo4', 6, 10, 9300 + i * 41);
          const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, ...opts });
          actions.push(`${d.action}:${d.amount ?? ''}`);
        }
        return actions;
      };
      const on = bb({ omahaSmallBlindSteal: true });
      expect(on).toEqual(bb({ omahaTournamentFirstIn: false }));
      expect(on.some((a) => a.startsWith('fold'))).toBe(true);
    });
  }
);
