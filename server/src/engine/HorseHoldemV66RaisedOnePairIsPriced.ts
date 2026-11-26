/**
 * HOLD'EM FLOP/TURN BET-THEN-RAISED ONE PAIR, PRICED (option v66BetRaisedOnePairIsPriced, 2026-11-21, Horse Switch
 * lane; default OFF, read only as === true, dark/ungraded).
 *
 * THE BLANKET RULE IT PRICES (V66, v66BetRaisedOnePair). In single-board two-card no-limit hold'em, on the flop or
 * turn, when the Horse bet or raised this street and now faces a raise holding the bluff-catch class (one pair, high
 * card, or two pair through the board's pair) with no real draw, V66 subtracts a fixed price shade of up to 10 equity
 * points (`v66BetRaisedShade`) and withholds it on a binary `callDownMod > 1` label. Without V66, the committed branch
 * applies a fixed 0.42 equity floor and jams over the raise.
 *
 * WHAT THIS MODULE DOES. At the same flop/turn raised-one-pair spot, independently of `v66BetRaisedOnePair`, it prices
 * call vs fold directly by expected value against the raiser's combo-weighted line range (built with
 * `holdemLineRange` + `holdemFillEquities` from HorseHoldemValueAndCallsArePriced, using its private deterministic
 * PRNG so `fastRandom` is never touched):
 *
 *   potOdds         = callable / (potAfterCall * (1 - callDeduction))
 *   realization(R)  = 1 at all-in (SPR = 0), tapering smoothly with post-call SPR, street, position, and board scare
 *                     texture to capture future-street reverse implied odds
 *   EV(call)        = R * equity(hero vs raiser line range) * netPotAfterCall - callable
 *   EV(fold)        = 0
 *   decision        = call iff EV(call) > 0 (exact tie folds); never jams or re-raises as a bluff-catcher
 *
 * Pair rank, kicker, board texture, flush/straight completions, and cards to come enter natively through the
 * combo-by-combo Monte-Carlo runout equities against the raiser's narrowed range. No fixed 0.42 floor; no hardcoded
 * class fold or jam; no binary label cliff; no hidden opponent cards.
 *
 * SCOPE. Strictly dark & default OFF (`=== true`). Single-board 2-card NLH cash flop/turn only; never tournaments
 * (so the tournament ICM/survival arbiter is never bypassed), Omaha (PLO4/5/6, Hi-Lo), Short Deck, Fixed Limit,
 * multi-board, bomb pot, river, or real draws. Multiway or side-pot spots return unpriced (falling through cleanly
 * without altering existing behavior).
 */
import type { Card, CardRank } from '../types.js';
import { RANK_VALUES } from './PokerEngine.js';
import { HOLDEM_PRICED_REALIZATION_OOP } from './HorseHoldemValueAndCallsArePriced.js';

export const V66_RAISED_ONE_PAIR_PRICED_RECEIPTS = Object.freeze({
  callTaken: 'v66_bet_raised_one_pair_priced_call_taken',
  foldTaken: 'v66_bet_raised_one_pair_priced_fold_taken',
  unpriced: 'v66_bet_raised_one_pair_priced_unpriced',
} as const);

/** Minimum and maximum realization bounds facing a flop/turn raise. */
export const V66_PRICED_REALIZATION_FLOOR = 0.72;
export const V66_PRICED_REALIZATION_SPR_CAP = 4;

/** Turn raises carry fewer semi-bluffs than flop raises. */
export const V66_TURN_RAISE_BLUFF_SCALE = 0.78;
/** Bounds on the raiser's bluff share inside the narrowed raise line range. */
export const V66_RAISE_BLUFF_SHARE_MIN = 0.05;
export const V66_RAISE_BLUFF_SHARE_MAX = 0.65;

const EPS = 1e-9;

const clamp = (x: number, lo: number, hi: number): number =>
  Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;

export interface V66RaisedOnePairPricedGateInput {
  enabled: unknown;
  street: string;
  raisedAfterAggr: boolean;
  isTournament: boolean;
  isOmaha: boolean;
  isShortDeck: boolean;
  isFixedLimit: boolean;
  holeCount: number;
  playerCardCount: number;
  multiBoard: boolean;
  bombPot: boolean;
  cat: number;
  pairedBoard: boolean;
  hasRealDraw: boolean;
  toCall: number;
  pot: number;
}

/**
 * Pure structural gate for v66BetRaisedOnePairIsPriced: strictly dark & default OFF (`=== true`), single-board 2-card
 * NLH cash flop/turn bet-then-raised bluff-catch class with no real draw. Never touches tournaments (preserving the
 * tournament ICM/survival arbiter), PLO4/5/6, Hi-Lo, Short Deck, Fixed Limit, river, or draws.
 */
export function v66RaisedOnePairPricedApplies(input: V66RaisedOnePairPricedGateInput): boolean {
  return (
    input.enabled === true &&
    (input.street === 'flop' || input.street === 'turn') &&
    input.raisedAfterAggr === true &&
    !input.isTournament &&
    !input.isOmaha &&
    !input.isShortDeck &&
    !input.isFixedLimit &&
    input.holeCount === 2 &&
    input.playerCardCount === 2 &&
    !input.multiBoard &&
    !input.bombPot &&
    input.cat > 0 &&
    (input.cat <= 2 || (input.cat === 3 && input.pairedBoard)) &&
    !input.hasRealDraw &&
    input.toCall > 0 &&
    input.pot > 0
  );
}

/**
 * Public board texture / scare score in [0, 1]. Higher values indicate monotone, paired, or heavily connected boards
 * where a one-pair bluff-catcher facing a flop/turn raise suffers greater reverse implied odds on future streets.
 */
export function v66BoardScareTexture(board: readonly Card[]): number {
  if (!Array.isArray(board) || board.length < 3) return 0;
  const suitCounts = new Map<string, number>();
  const rankCounts = new Map<number, number>();
  const uniqueRanks: number[] = [];
  for (const c of board) {
    suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
    const rv = RANK_VALUES[c.rank as CardRank] ?? 0;
    if (rv > 0) {
      if (!rankCounts.has(rv)) uniqueRanks.push(rv);
      rankCounts.set(rv, (rankCounts.get(rv) ?? 0) + 1);
    }
  }
  let maxSuit = 0;
  for (const n of suitCounts.values()) if (n > maxSuit) maxSuit = n;
  let maxRank = 0;
  let pairCount = 0;
  for (const n of rankCounts.values()) {
    if (n > maxRank) maxRank = n;
    if (n >= 2) pairCount++;
  }
  let score = 0;
  if (maxSuit >= 4) score += 0.65;
  else if (maxSuit === 3) score += 0.35;

  if (maxRank >= 3) score += 0.35;
  else if (pairCount >= 2) score += 0.35;
  else if (pairCount === 1) score += 0.2;

  // Straight connectedness: count maximum distinct ranks inside any 5-rank window (including wheel Ace = 1).
  const ranksWithWheel = uniqueRanks.includes(14) ? [...uniqueRanks, 1] : [...uniqueRanks];
  ranksWithWheel.sort((a, b) => a - b);
  let maxInFive = 1;
  for (let i = 0; i < ranksWithWheel.length; i++) {
    let count = 1;
    for (let j = i + 1; j < ranksWithWheel.length; j++) {
      if (ranksWithWheel[j] - ranksWithWheel[i] <= 4) count++;
    }
    if (count > maxInFive) maxInFive = count;
  }
  if (maxInFive >= 4) score += 0.45;
  else if (maxInFive === 3) score += 0.22;

  return clamp(score, 0, 1);
}

export interface V66RaiseLineKeepInput {
  street: 'flop' | 'turn';
  betShare: number;
  posteriorBluffShare: number;
  raisePotFrac: number;
  scareTexture: number;
  /** Optional measured postflop raise aggression shift in [-0.12, +0.16] (0 when unread). */
  raiseAggressionShift?: number;
}

export interface V66RaiseLineKeep {
  top: number;
  bottom: number;
  bluffShare: number;
  keepScale: number;
}

/**
 * Narrowing shares `{ top, bottom }` for a flop/turn raise over the Horse's bet inside `holdemLineRange`.
 * Larger raises narrow villain's raising range further toward nutted value + polarized bluffs; turn raises carry a
 * smaller semi-bluff share than flop raises; scare textures modestly trim pure-air raises; measured opponent raise
 * aggression shifts the bluff share smoothly without binary label cliffs.
 */
export function v66RaiseLineKeep(input: V66RaiseLineKeepInput): V66RaiseLineKeep {
  const baseBet = clamp(input.betShare, 0.08, 0.95);
  const frac = Math.max(0, Number.isFinite(input.raisePotFrac) ? input.raisePotFrac : 0);
  // Larger raises narrow villain's range monotonically (from 0.52 at small raises down to 0.24 at big over-raises).
  const keepScale = clamp(0.52 - 0.16 * Math.max(0, frac - 0.4), 0.24, 0.55);
  const streetScale = input.street === 'turn' ? V66_TURN_RAISE_BLUFF_SCALE : 1;
  const scareScale = 1 - 0.18 * clamp(input.scareTexture, 0, 1);
  const shift = clamp(input.raiseAggressionShift ?? 0, -0.12, 0.16);
  // Empirical raise continuation: a raise over a bet is significantly more value-heavy than a checked-to first bet.
  const baseBeta = clamp(input.posteriorBluffShare, 0.05, 0.75) * 0.72 * streetScale * scareScale;
  const bluffShare = clamp(baseBeta + shift, V66_RAISE_BLUFF_SHARE_MIN, V66_RAISE_BLUFF_SHARE_MAX);
  const totalKeep = clamp(baseBet * keepScale, 0.04, 0.55);
  return {
    top: totalKeep * (1 - bluffShare),
    bottom: totalKeep * bluffShare,
    bluffShare,
    keepScale,
  };
}

export interface V66RealizationInput {
  street: 'flop' | 'turn';
  inPosition: boolean;
  postCallSpr: number;
  scareTexture: number;
}

/**
 * Smooth equity realization factor facing a flop/turn raise:
 * - 1.0 when calling puts either player all-in (SPR = 0: full runout realized with zero future betting);
 * - tapers smoothly with post-call SPR up to `V66_PRICED_REALIZATION_SPR_CAP` by street, position (matching
 *   `HOLDEM_PRICED_REALIZATION_OOP` = 0.88 on OOP turn), and board scare texture (reverse implied odds).
 */
export function v66RaisedOnePairRealization(input: V66RealizationInput): number {
  const spr = Math.max(0, Number.isFinite(input.postCallSpr) ? input.postCallSpr : 0);
  if (spr <= EPS) return 1;
  const sprDepth = clamp(spr / V66_PRICED_REALIZATION_SPR_CAP, 0, 1);
  const oopTurnDiscount = 1 - HOLDEM_PRICED_REALIZATION_OOP; // 0.12
  const baseDiscount = input.inPosition
    ? input.street === 'turn'
      ? 0.04
      : 0.08
    : input.street === 'turn'
      ? oopTurnDiscount
      : oopTurnDiscount + 0.04;
  const scareDiscount = 0.06 * clamp(input.scareTexture, 0, 1);
  return clamp(1 - sprDepth * (baseDiscount + scareDiscount), V66_PRICED_REALIZATION_FLOOR, 1);
}

export interface V66RaisedOnePairPricedInput {
  street: 'flop' | 'turn';
  inPosition: boolean;
  pot: number;
  toCall: number;
  heroStack: number;
  villainStack: number;
  /** Raw combo-weighted Monte-Carlo equity against the raiser's line range in [0, 1]. */
  rawEquity: number;
  /** Board scare / texture score in [0, 1]. */
  scareTexture: number;
  /** Projected rake / jackpot deduction fraction on the won pot (0 when unraked). */
  callDeductionFraction?: number;
}

export interface V66RaisedOnePairPricedVerdict {
  decision: 'call' | 'fold';
  callable: number;
  potAfterCall: number;
  potOdds: number;
  postCallSpr: number;
  realization: number;
  rawEquity: number;
  realizedEquity: number;
  evCall: number;
  evFold: 0;
}

/**
 * Pure EV call-vs-fold verdict facing a flop/turn raise over the Horse's bet:
 * calls if and only if EV(call) > EV(fold) = 0 (exact tie folds). No fixed 0.42 floor, no hardcoded class fold or jam.
 */
export function v66RaisedOnePairPricedVerdict(
  input: V66RaisedOnePairPricedInput
): V66RaisedOnePairPricedVerdict {
  const pot = Math.max(0, Number.isFinite(input.pot) ? input.pot : 0);
  const heroStack = Math.max(0, Number.isFinite(input.heroStack) ? input.heroStack : 0);
  const villainStack = Math.max(0, Number.isFinite(input.villainStack) ? input.villainStack : 0);
  const rawToCall = Math.max(0, Number.isFinite(input.toCall) ? input.toCall : 0);
  const callable = Math.min(rawToCall, heroStack);
  const unmatchedExcess = Math.max(0, rawToCall - callable);
  const potAfterCall = Math.max(0, pot - unmatchedExcess) + callable;
  const deduction = clamp(input.callDeductionFraction ?? 0, 0, 0.25);
  const netPotAfterCall = potAfterCall * (1 - deduction);
  const potOdds = netPotAfterCall > EPS ? callable / netPotAfterCall : 1;
  const postCallEffStack = Math.max(0, Math.min(Math.max(0, heroStack - callable), villainStack));
  const postCallSpr = potAfterCall > EPS ? postCallEffStack / potAfterCall : 0;
  const realization = v66RaisedOnePairRealization({
    street: input.street,
    inPosition: input.inPosition,
    postCallSpr,
    scareTexture: input.scareTexture,
  });
  const rawEquity = clamp(input.rawEquity, 0, 1);
  const realizedEquity = realization * rawEquity;
  const evCall = realizedEquity * netPotAfterCall - callable;
  return {
    decision: evCall > EPS ? 'call' : 'fold',
    callable,
    potAfterCall,
    potOdds,
    postCallSpr,
    realization,
    rawEquity,
    realizedEquity,
    evCall,
    evFold: 0,
  };
}
