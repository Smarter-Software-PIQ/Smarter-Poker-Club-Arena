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
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { horseVariantRulesFor } from './VariantRules.js';
import {
  OMAHA_TOURNAMENT_FIRST_IN,
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
  bigBlind: 2,
  riskPremium: 0,
};

describe('omahaTournamentFirstIn: the replacement for a fold', () => {
  it('heads-up small blind first in pot-raises every hand up to 30 big blinds', () => {
    for (const percentile of [0, 0.01, 0.3, 0.99])
      for (const effectiveStackBB of [3, 8, 20, 30])
        expect(omahaTournamentFirstIn({ ...base, percentile, effectiveStackBB })).toEqual({
          a: 'jam',
        });
  });

  it('deeper than that it completes instead', () => {
    expect(omahaTournamentFirstIn({ ...base, effectiveStackBB: 30.1 })).toEqual({ a: 'call' });
  });

  it('the small blind against the big blind alone at a larger table plays the same way', () => {
    expect(omahaTournamentFirstIn({ ...base, tableSize: 6, percentile: 0.02 })).toEqual({
      a: 'jam',
    });
  });

  it('a non-blind seat first in with two opponents left plays its top 80 percent', () => {
    const button = {
      ...base,
      position: 'late' as const,
      liveOpponents: 2,
      tableSize: 3,
      toCall: 2,
    };
    expect(omahaTournamentFirstIn({ ...button, percentile: 0.21 })).toEqual({ a: 'jam' });
    expect(omahaTournamentFirstIn({ ...button, percentile: 0.19 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...button, percentile: 0.5, effectiveStackBB: 40 })).toEqual({
      a: 'raiseTo',
      to: 5,
    });
  });

  it('a pay jump narrows the share outside heads-up, and never heads-up', () => {
    const bvb = { ...base, tableSize: 3, percentile: 0.15 };
    expect(omahaTournamentFirstIn({ ...bvb, riskPremium: 0 })).toEqual({ a: 'jam' });
    expect(omahaTournamentFirstIn({ ...bvb, riskPremium: 0.1 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...bvb, riskPremium: 0.1, percentile: 0.21 })).toEqual({
      a: 'jam',
    });
    expect(omahaTournamentFirstIn({ ...bvb, riskPremium: 5, percentile: 0.51 })).toEqual({
      a: 'jam',
    });
    expect(omahaTournamentFirstIn({ ...bvb, riskPremium: 5, percentile: 0.49 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...base, riskPremium: 5, percentile: 0 })).toEqual({
      a: 'jam',
    });
  });

  it('leaves seats with three or more opponents behind alone', () => {
    for (const liveOpponents of [3, 4, 5, 7])
      expect(
        omahaTournamentFirstIn({
          ...base,
          position: 'late',
          liveOpponents,
          tableSize: 8,
          percentile: 0.99,
        })
      ).toBeNull();
  });

  it('never opens a pot somebody already entered', () => {
    expect(omahaTournamentFirstIn({ ...base, limpers: 1 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...base, raises: 1 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...base, toCall: 0 })).toBeNull();
  });

  it('the heads-up big blind defends its top 75 percent against one raise at a price of a half or better', () => {
    const bb = { ...base, position: 'bb' as const, raises: 1, toCall: 4, stack: 36, pot: 8 };
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.26 })).toEqual({ a: 'call' });
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.24 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.9, toCall: 20, pot: 12 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.9, stack: 8 })).toEqual({ a: 'jam' });
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.9, tableSize: 3 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...bb, percentile: 0.9, callers: 1 })).toBeNull();
  });

  it('publishes the measured shares', () => {
    expect(OMAHA_TOURNAMENT_FIRST_IN).toEqual({
      headsUpShare: 1,
      blindVsBlindShare: 1,
      lateShareByOpponents: [0, 0, 0.8],
      raiseMaxBB: 30,
      bigBlindDefendShare: 0.75,
      bigBlindMaxPrice: 0.5,
    });
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
      '%s heads-up: almost never folds first in, at any depth to 30 big blinds',
      (variant) => {
        for (const stackBB of [4, 8, 15, 30]) {
          const on = folds(variant, 2, stackBB, 'tournament', {});
          const off = folds(variant, 2, stackBB, 'tournament', { omahaTournamentFirstIn: false });
          // Three or four of a rank still fold (the V46 class gate); nothing else does.
          expect([variant, stackBB, on.share <= 0.05]).toEqual([variant, stackBB, true]);
          // The defect, pinned so the law is not vacuous: the earlier engine folded four in ten or more.
          expect([variant, stackBB, off.share >= 0.4]).toEqual([variant, stackBB, true]);
        }
      }
    );

    it('three-handed, the small blind against the big blind alone does the same', () => {
      expect(folds('plo4', 3, 10, 'tournament', {}).share).toBeLessThanOrEqual(0.05);
      expect(
        folds('plo4', 3, 10, 'tournament', { omahaTournamentFirstIn: false }).share
      ).toBeGreaterThanOrEqual(0.4);
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
