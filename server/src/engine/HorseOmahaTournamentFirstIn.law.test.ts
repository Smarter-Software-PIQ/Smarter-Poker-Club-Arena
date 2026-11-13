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

  it('stands aside at tables larger than were measured', () => {
    for (const tableSize of [4, 6, 9]) {
      expect(omahaTournamentFirstIn({ ...base, tableSize, percentile: 0.99 })).toBeNull();
      expect(
        omahaTournamentFirstIn({
          ...base,
          tableSize,
          position: 'late',
          liveOpponents: 2,
          percentile: 0.99,
        })
      ).toBeNull();
    }
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

  it('three-handed it acts only when one place is paid; heads-up any payout', () => {
    const three = { ...base, tableSize: 3, playersLeft: 3, percentile: 0.99 };
    expect(omahaTournamentFirstIn({ ...three, paidPlacesLeft: 3 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...three, paidPlacesLeft: 2 })).toBeNull();
    expect(omahaTournamentFirstIn({ ...three, paidPlacesLeft: Number.NaN })).toBeNull();
    expect(omahaTournamentFirstIn({ ...three, paidPlacesLeft: 1 })).toEqual({ a: 'jam' });
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
      maxTableSize: 3,
      bigBlindDefendShare: 0.75,
      bigBlindMaxPrice: 0.5,
      bigBlindClosingShare: 0.75,
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

    it('a three-handed final table with pay jumps keeps the engine folds', () => {
      const payJumps = (opts: HorseDecideOpts) => {
        const actions: string[] = [];
        for (let i = 0; i < 60; i++) {
          HorseMind.reset();
          const { hero, state } = smallBlindSpot('plo4', 3, 10, 'tournament', 9700 + i * 29);
          if (state.tournament) {
            state.tournament.payoutPct = [50, 30, 20];
            state.tournament.spotsPaid = 3;
          }
          const d = HorseLogic.decide(hero, state, 'balanced', {}, { mind: false, ...opts });
          actions.push(`${d.action}:${d.amount ?? ''}`);
        }
        return actions;
      };
      const on = payJumps({});
      expect(on).toEqual(payJumps({ omahaTournamentFirstIn: false }));
      expect(on.some((a) => a.startsWith('fold'))).toBe(true);
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
