/**
 * OMAHA HI-LO HEADS-UP TOURNAMENT FIRST-IN (HU-HILO-002), default OFF.
 *
 * Heads-up audit, 2026-11-13: in pot-limit Omaha hi-lo tournaments at 20 big
 * blinds or less the heads-up small blind folds 83 to 85 percent first in and
 * the big blind folds 81 to 91 percent to one raise. It is the commitment-zone
 * fold #10687 corrected for Omaha high; hi-lo was left out for want of its
 * own evaluation. `omahaHiLoTournamentFirstIn` applies the same replacement
 * with the hand's hi-lo percentile, exactly two dealt in.
 *
 * This law pins: off changes nothing; on, the fold is replaced only in
 * pot-limit hi-lo tournaments with two dealt in at 20 big blinds or less;
 * Omaha high, cash, deeper stacks, three-handed tables and fixed limit are
 * untouched; the replacement is a legal action and carries its receipt.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { omahaVariantSpot } from '../benchmark/OmahaVariantPolicyEvidence.js';
import { calculateContestablePot, calculatePots } from './PokerEngine.js';
import { HorseLogic, type HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { fastRandom, seedFastRandom } from './HorseEval.js';
import { horseVariantRulesFor } from './VariantRules.js';
import { OMAHA_HILO_TOURNAMENT_FIRST_IN } from './HorsePreflop.js';
import { OMAHA_TOURNAMENT_FIRST_IN } from './HorseOmahaTournamentFirstIn.js';
import type { Card, CardRank, CardSuit } from '../types.js';

const RANKS: CardRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS: CardSuit[] = ['clubs', 'diamonds', 'hearts', 'spades'];
type Variant = 'plo4' | 'plo5' | 'plo6' | 'plo8' | 'flo8';
const holeCount = (v: Variant) => (v === 'plo8' || v === 'flo8' ? 4 : Number(v.slice(3)));

function shuffledDeck(): Card[] {
  const deck: Card[] = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
  for (let k = deck.length - 1; k > 0; k--) {
    const j = Math.floor(fastRandom() * (k + 1));
    [deck[k], deck[j]] = [deck[j], deck[k]];
  }
  return deck;
}

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
  if (variant === 'flo8') st.bettingStructure = 'fixed_limit';
  const deck = shuffledDeck();
  const chips = stackBB * 2;
  st.players.forEach((p, idx) => {
    p.bet = idx === 0 ? 1 : idx === 1 ? 2 : 0;
    p.totalInvested = p.bet;
    p.stack = chips - p.bet;
    p.is_folded = idx === 2;
  });
  const hero = { ...st.players[0], cards: deck.slice(0, holeCount(variant)) };
  st.dealerSeat = seats === 2 ? 1 : 3;
  st.blindSeats = { smallBlind: 1, bigBlind: 2 };
  st.pot = 3;
  st.currentBet = 2;
  st.toCall = 1;
  st.minRaise = 2;
  st.lastRaise = 2;
  st.minRaiseTo = 4;
  st.maxRaiseTo = variant === 'flo8' ? 4 : Math.min(chips, 6);
  st.pots = calculatePots(st.players);
  st.contestablePot = calculateContestablePot(st.players, hero.user_id, 1);
  st.legalActions = ['fold', 'call', 'raise', 'all_in'];
  st.actionHistory =
    seats === 3
      ? [{ userId: 'v3', seat: 3, action: 'fold', amount: 0, stage: 'preflop', timestamp: 1 }]
      : [];
  if (st.tournament) {
    st.tournament.playersLeft = seats;
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
  const deck = shuffledDeck();
  const sb = st.players[0];
  sb.bet = 6;
  sb.totalInvested = 6;
  sb.stack = chips - 6;
  const hero = { ...st.players[1], cards: deck.slice(0, holeCount(variant)) };
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

type Spot = {
  hero: ReturnType<typeof smallBlindSpot>['hero'];
  state: ReturnType<typeof smallBlindSpot>['state'];
};

function sweep(make: (seed: number) => Spot, opts: HorseDecideOpts, hands = 100) {
  let folds = 0;
  let receipts = 0;
  let illegal = 0;
  const actions: string[] = [];
  for (let i = 0; i < hands; i++) {
    HorseMind.reset();
    const { hero, state } = make(8100 + i * 131);
    enableBrainTelemetry();
    drainFires();
    const d = HorseLogic.decide(
      hero,
      state,
      'balanced',
      {},
      { mind: false, telemetry: true, ...opts }
    );
    if (drainFires().some((f) => f.feature === 'omaha_hilo_tournament_first_in')) receipts++;
    if (!state.legalActions!.includes(d.action)) illegal++;
    actions.push(`${d.action}:${d.amount ?? ''}`);
    if (d.action === 'fold') folds++;
  }
  return { share: folds / hands, actions, receipts, illegal };
}

const ON: HorseDecideOpts = { omahaHiLoTournamentFirstIn: true };
const sb =
  (variant: Variant, seats: 2 | 3, stackBB: number, mode: 'cash' | 'tournament') =>
  (seed: number) =>
    smallBlindSpot(variant, seats, stackBB, mode, seed + stackBB);
const bb = (variant: Variant, stackBB: number) => (seed: number) =>
  bigBlindSpot(variant, stackBB, seed + stackBB);

describe('omahaHiLoTournamentFirstIn (HU-HILO-002, default OFF)', { timeout: 240_000 }, () => {
  afterEach(() => HorseMind.reset());

  it('publishes heads-up-only limits: the Omaha high heads-up shares, no three-handed branch', () => {
    expect(OMAHA_HILO_TOURNAMENT_FIRST_IN).toEqual({
      headsUpShare: OMAHA_TOURNAMENT_FIRST_IN.headsUpShare,
      blindVsBlindShare: 0,
      maxStackBB: 20,
      winnerTakeAllMaxStackBB: 0,
      maxTableSize: 2,
      bigBlindDefendShare: OMAHA_TOURNAMENT_FIRST_IN.bigBlindDefendShare,
      bigBlindMaxPrice: OMAHA_TOURNAMENT_FIRST_IN.bigBlindMaxPrice,
      bigBlindClosingShare: 0,
      payJumpBlindVsBlindShare: 0,
    });
    expect(Object.isFrozen(OMAHA_HILO_TOURNAMENT_FIRST_IN)).toBe(true);
  });

  it('off is today: absent, false, and any non-true scalar change no decision and fire no receipt', () => {
    for (const stackBB of [8, 12, 20]) {
      const absent = sweep(sb('plo8', 2, stackBB, 'tournament'), {});
      for (const v of [false, undefined, null, 0, 'on'] as never[]) {
        const off = sweep(sb('plo8', 2, stackBB, 'tournament'), { omahaHiLoTournamentFirstIn: v });
        expect([stackBB, String(v), off.actions]).toEqual([stackBB, String(v), absent.actions]);
        expect(off.receipts).toBe(0);
      }
      expect(absent.receipts).toBe(0);
      const bbAbsent = sweep(bb('plo8', stackBB), {});
      const bbOff = sweep(bb('plo8', stackBB), { omahaHiLoTournamentFirstIn: false });
      expect(bbOff.actions).toEqual(bbAbsent.actions);
    }
  });

  it.each([8, 12, 20])(
    'PLO8 heads-up small blind first in at %i big blinds: the walk is pinned off, gone on',
    (stackBB) => {
      const off = sweep(sb('plo8', 2, stackBB, 'tournament'), {});
      const on = sweep(sb('plo8', 2, stackBB, 'tournament'), ON);
      // The defect, pinned so the law is not vacuous.
      expect([stackBB, off.share >= 0.4]).toEqual([stackBB, true]);
      // Three or four of a rank still fold (the class gate); nothing else does.
      expect([stackBB, on.share <= 0.05]).toEqual([stackBB, true]);
      expect(on.illegal).toBe(0);
      // Every changed decision was a fold and carries the receipt.
      const changed = on.actions.filter((a, i) => a !== off.actions[i]).length;
      expect(off.actions.every((a, i) => a === on.actions[i] || a.startsWith('fold'))).toBe(true);
      expect(on.receipts).toBeGreaterThan(0);
      expect(on.receipts).toBeLessThanOrEqual(changed);
    }
  );

  it.each([8, 12, 20])(
    'PLO8 heads-up big blind facing one pot raise at %i big blinds folds much less, never its top hands',
    (stackBB) => {
      const off = sweep(bb('plo8', stackBB), {});
      const on = sweep(bb('plo8', stackBB), ON);
      expect([stackBB, on.share <= off.share - 0.25]).toEqual([stackBB, true]);
      // About the bottom quarter still folds: the rule is a share, not "call everything".
      expect([stackBB, on.share >= 0.1]).toEqual([stackBB, true]);
      expect(on.illegal).toBe(0);
      expect(off.actions.every((a, i) => a === on.actions[i] || a.startsWith('fold'))).toBe(true);
    }
  );

  it('outside its scope the option changes nothing', () => {
    const same = (make: (seed: number) => Spot, label: string, opts: HorseDecideOpts = ON) => {
      const a = sweep(make, {}, 60);
      const b = sweep(make, opts, 60);
      expect([label, b.actions]).toEqual([label, a.actions]);
      expect([label, b.receipts]).toEqual([label, 0]);
    };
    // Omaha high keeps its own rule, whatever this option says.
    for (const v of ['plo4', 'plo5', 'plo6'] as const) {
      same(sb(v, 2, 12, 'tournament'), `${v} small blind`);
      same(bb(v, 12), `${v} big blind`);
    }
    same(sb('plo8', 2, 12, 'cash'), 'plo8 cash');
    same(sb('plo8', 2, 25, 'tournament'), 'plo8 25bb small blind');
    same(bb('plo8', 25), 'plo8 25bb big blind');
    same(sb('plo8', 3, 12, 'tournament'), 'plo8 three-handed');
    // A league arm cannot widen the table: three-handed stays the engine's.
    same(sb('plo8', 3, 12, 'tournament'), 'plo8 three-handed arm', {
      omahaHiLoTournamentFirstIn: { maxTableSize: 3, blindVsBlindShare: 1 },
    });
    same(sb('flo8', 2, 12, 'tournament'), 'fixed-limit hi-lo');
  });

  it('a league arm may change a share: a zero small blind share leaves only the big blind rule', () => {
    const arm: HorseDecideOpts = { omahaHiLoTournamentFirstIn: { headsUpShare: 0 } };
    const off = sweep(sb('plo8', 2, 12, 'tournament'), {}, 60);
    expect(sweep(sb('plo8', 2, 12, 'tournament'), arm, 60).actions).toEqual(off.actions);
    const bbOff = sweep(bb('plo8', 12), {}, 60);
    expect(sweep(bb('plo8', 12), arm, 60).share).toBeLessThan(bbOff.share);
  });
});
