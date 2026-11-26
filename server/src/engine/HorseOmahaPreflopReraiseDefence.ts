/**
 * OMAHA PREFLOP RE-RAISE DEFENCE, PRICED (PLO Strategy lane 2026-11-17; option
 * omahaPreflopReraiseDefencePriced, default OFF, read `=== true`).
 *
 * Owner, 2026-11-17: the size of the bet must not make or break a decision,
 * and no blanket rule may decide one; a decision comes from the math, the
 * Horse's hand, the opponent's perceived range, equity and expected value.
 *
 * WHAT IT DECIDES. PLO4/PLO5 cash, high only, one board, no bomb pot, not
 * all-in-or-fold, preflop, the Horse facing a 3-bet or more (two or more
 * raises so far, the last one not its own) with a fold available. The answer
 * of everything before it (the reference brain, the re-raise range rules, the
 * out-of-position strong-range rule, the cold 4-bet rule) is read only to
 * know whether a re-raise was proposed. The decision is the largest of
 *
 *   EV(fold)     = 0
 *   EV(call)     = R x equity x (pot after the call - rake) - call
 *   EV(re-raise) = f x pot + (1 - f) x (R2 x equity2 x (pot2 - rake2) - risk)
 *                  (only when a re-raise was proposed; its size is the
 *                  proposal's)
 *
 * measured in chips relative to folding now. Nothing else decides: no hand
 * class, position or size is a gate on its own.
 *
 *  - EQUITY: the Horse's exact cards against the re-raiser's range, sampled
 *    with the deterministic generator of HorseOmahaReraisedPot (a seed from
 *    the cards; no draw from the brain's random stream). Opponent hands that
 *    share a card with the Horse are never dealt (card removal).
 *  - THE RE-RAISER'S RANGE is the top `width` of hands by the engine's
 *    preflop percentile. The width comes from ONE read interface
 *    (OmahaPreflopReraiserRead): the posterior mean of his measured re-raise
 *    rate, which is the population mean with no evidence and moves to his
 *    own rate continuously as his decayed opportunity count grows (the pooled
 *    read of today, HorseMind.omahaReadConditionalOf; a per-street read can
 *    be handed to the same interface later). A rate is not a range: players
 *    re-raise a wider and weaker set of hands than the top slice of that
 *    size, so the width is mapped by RANGE_WIDTH_MAX / RANGE_WIDTH_SCALE,
 *    fitted to recorded re-raising hands (the evidence file of the option).
 *    A 4-bet or more narrows it by the engine's line rule (reRaiseLineWidth).
 *  - REALIZATION R: the share of its equity a call gets back, measured on
 *    recorded calls (all-in adjusted, after rake): it falls as the
 *    stack-to-pot ratio after the call grows, far more out of position than
 *    in position; with every other player already in for the price; out of
 *    position with every player still to act behind the call; and it moves a
 *    little with the hand's shape (nut suits, connection, pair quality, dead
 *    cards). At a ratio of zero (the call is all in) it is 1. A player still
 *    to act, a raiser of this hand included, is not a player in the pot: in
 *    position the recorded calls show no cost for him (-0.005, SE 0.124), out
 *    of position 0.14 (SE 0.146).
 *  - RAKE: the table's rake on the pot after the call (percentage and cap).
 *  - RE-RAISE: f is the re-raiser's measured fold rate to a re-raise (same
 *    interface); when he continues, his range is the top (1 - f) of it and
 *    the pot and the ratio are those of the re-raised pot.
 *
 * This module prices every spot it is asked about the same way, the
 * out-of-position 4-bet call with a paired hand that is not aces included
 * (the 4-bettor's measured width sets the equity; position, ratio and hand
 * shape set the realization). WHETHER it is asked is HorseLogic's: a call the
 * re-raised-pot call cell of HorseOmahaOopReraisedPot judges belongs to that
 * cell (one owner per cell) and never reaches this module's rule.
 *
 * Pure: no state, no telemetry, no draw from the brain's random stream.
 */
import type { Card } from '../types.js';
import { reRaiseLineWidth } from './HorseOpponentExploit.js';
import {
  omahaReraisedEquity,
  omahaReraisedEquityInPercentileBand,
} from './HorseOmahaReraisedPot.js';

export const OMAHA_PREFLOP_DEFENCE_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/** Opponent holdings sampled for one equity estimate. */
export const PREFLOP_DEFENCE_EQUITY_SAMPLES = 400;

/**
 * A re-raise rate is not a range. The top slice a rate would imply is
 * stronger than the hands players actually re-raise with, and the gap closes
 * as the rate grows: width = MAX x (1 - exp(-rate / SCALE)). Fitted to
 * recorded 3-bet holdings (the width at which the sampled equity is unbiased
 * against them): rate 0.046 -> 0.21 (Horses, 282 hands), 0.117 -> 0.40
 * (PLO4 people, 576), 0.224 -> 0.55 (PLO5 people, 414), 0.396 -> 0.49 (one
 * PLO5 player, 1,286); the curve gives 0.22, 0.40, 0.50, 0.54. A 4-bet or
 * more then narrows by reRaiseLineWidth.
 */
export const RANGE_WIDTH_MAX = 0.55;
export const RANGE_WIDTH_SCALE = 0.09;

/**
 * Realization: R = 1 - DEPTH_COST x spr / (spr + DEPTH_HALF) - the player
 * terms + the shape term, spr the stack-to-pot ratio after the call. One least
 * squares fit on 2,023 recorded calls of a person's 3-bet or 4-bet (30 days to
 * 2026-11-17, all-in adjusted, after rake, the engine's own equity; evidence
 * preflop-01BNteGZ/step1/fit1.py, 300 bootstrap resamples): depth in position
 * 0.15 (SE 0.37), out of position 0.71 (SE 0.54); the halves are set, not
 * fitted.
 */
export const REALIZATION_DEPTH_COST: Readonly<Record<'ip' | 'oop', number>> = {
  ip: 0.15,
  oop: 0.7,
};
export const REALIZATION_DEPTH_HALF: Readonly<Record<'ip' | 'oop', number>> = { ip: 2, oop: 5 };
/**
 * Taken off R for the first other player ALREADY IN for the price faced (he
 * has called the re-raise or is all in), and for a second one. The fit with
 * the two apart (same 2,023 calls, depth x equity term in; step1-fit3 in the
 * 013U37 evidence): first 0.275 (SE 0.178), second 0.246 (SE 0.258). The
 * second cannot be told from zero (|z| < 1) and is shrunk to it by the same
 * positive-part James-Stein factor as the equity slope. The recorded calls
 * agree: in position R pooled 0.91 with none in (n 811), 0.67 with one
 * (n 228), 0.60 with two (n 40, +11.7 bb SE 12.7 against folding); a linear
 * 0.29 per player put the last at 0.35 and folded calls closing the action
 * at a 0.19 price (#59726623 seat 2, audited wrong as a fold, F-13).
 */
export const REALIZATION_OTHER_IN_COST = 0.275;
export const REALIZATION_SECOND_IN_COST = 0;
/**
 * Taken off R for every player STILL TO ACT behind the call (live, not in
 * for the price; the opener a cold caller leaves behind is one), at most two
 * counted. The same fit measures them apart from the players already in: in
 * position -0.005 (SE 0.124), no cost; out of position 0.14 (SE 0.146). The
 * recorded calls made in position with a player still to act earned +3 to +12
 * bb each relative to folding in every depth band (n 148 to 185): a player
 * who may still fold is not a player in the pot. (Until 2026-11-18 a raiser
 * still to act was charged the already-in cost, 0.35 then: cold callers in
 * position folded 95% where the recorded calls made +11.7 bb, SE 6.6, n 144.)
 */
export const REALIZATION_BEHIND_COST: Readonly<Record<'ip' | 'oop', number>> = { ip: 0, oop: 0.14 };
/**
 * Depth costs less the stronger the call is against the range it faces: the
 * depth term is REALIZATION_DEPTH_COST - REALIZATION_DEPTH_EQUITY_SLOPE x
 * (equity - REALIZATION_EQUITY_CENTRE). The same least-squares fit with a
 * depth x equity term per side, centred on the calls' mean equity 0.52
 * (2,023 calls, 300 bootstrap resamples; preflop-01BNteGZ/step1/fitdata.json,
 * fit3.py in the 013U37 evidence): out of position 8.42 (SE 6.23), in
 * position 1.14 (SE 5.19). Each is shrunk toward zero by the positive-part
 * James-Stein factor max(0, 1 - SE^2/coef^2): out of position 8.42 x 0.45 =
 * 3.8, in position 0 (|z| < 1). The recorded out-of-position calls at a
 * ratio of 3 or more show it: equity 0.58 or more realized 1.14 of it (n 78,
 * +14.4 bb SE 8.8 against folding), equity 0.45 to 0.58 0.38 (n 386). Without
 * it the depth cost of an average call folded aces double-suited out of
 * position to a 3-bet (#59801362 seat 4: equity 0.64 at a 0.39 price, R 0.46).
 */
export const REALIZATION_DEPTH_EQUITY_SLOPE: Readonly<Record<'ip' | 'oop', number>> = {
  ip: 0,
  oop: 3.8,
};
export const REALIZATION_EQUITY_CENTRE = 0.52;
/**
 * The hand-shape term is omahaPreflopDefenceShape times this weight. The fit
 * gives 0.47 with a standard error of 5.2: the recorded calls cannot measure
 * it, so the term is small by construction (at most 0.03 either way).
 */
export const REALIZATION_SHAPE_WEIGHT = 0.5;
/** The bounds of the hand-shape term and of R itself. */
export const REALIZATION_SHAPE_MIN = -0.08;
export const REALIZATION_SHAPE_MAX = 0.06;
export const REALIZATION_MIN = 0.3;
export const REALIZATION_MAX = 1.05;

/** The rake when the table hands no configuration (the engine's default: 10% to 2.5 big blinds, at least 3 chips). */
export const DEFAULT_RAKE_RATE = 0.1;
export const DEFAULT_RAKE_CAP_BIG_BLINDS = 2.5;
export const DEFAULT_RAKE_CAP_MIN_CHIPS = 3;

/**
 * THE READ INTERFACE. What the decision needs to know about the player who
 * re-raised, whoever supplies it. `rate` is the posterior mean of the share
 * of single raises he re-raises (the population mean when nothing is known of
 * him), `opportunities` the decayed count behind it (0 when unknown),
 * `foldToReraise` the posterior mean of how often he folds when re-raised.
 */
export interface OmahaPreflopReraiserRead {
  rate: number;
  opportunities: number;
  foldToReraise: number;
}

export interface OmahaPreflopDefenceSpot {
  variant: string;
  /** preflop raises so far (open = 1); 2 = facing a 3-bet */
  preflopRaises: number;
  /** chips the call puts in (never more than the stack) */
  call: number;
  /** the pot before the call, every wager on the table included */
  pot: number;
  /** the Horse's stack before the call */
  stack: number;
  /** what the re-raiser has behind */
  raiserBehind: number;
  /** the Horse acts after the re-raiser on every later street */
  inPosition: boolean;
  /** other players already in for the current bet (called it, or all in), the re-raiser apart */
  othersIn: number;
  /** live players still to act behind the call (not in for the price, not all in); 0 when absent */
  playersBehind?: number;
  bigBlind: number;
  /** rake taken on a pot of the given size, in chips */
  rake: (pot: number) => number;
}

export interface OmahaPreflopDefenceRaise {
  /** chips the proposed re-raise adds to what the Horse has in */
  risk: number;
}

export interface OmahaPreflopDefenceVerdict {
  action: 'fold' | 'call' | 'raise';
  /** EV of the call and of the proposed re-raise, in chips relative to folding (null: not a candidate) */
  evCall: number;
  evRaise: number | null;
  equity: number;
  /** the range width the equity was taken against */
  width: number;
  realization: number;
  price: number;
  sprAfter: number;
}

const RANK_VALUE: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** The width of the range a re-raise at `preflopRaises` (2 = 3-bet) is taken against. */
export function omahaPreflopDefenceRangeWidth(rate: number, preflopRaises: number): number {
  const r = Number.isFinite(rate) ? clamp(rate, 0, 1) : 0;
  let width = clamp(RANGE_WIDTH_MAX * (1 - Math.exp(-r / RANGE_WIDTH_SCALE)), 0.02, 1);
  for (let depth = 3; depth <= Math.min(preflopRaises, 6); depth++)
    width = reRaiseLineWidth(width, depth);
  return width;
}

/**
 * The hand-shape term of the realization: how much of its equity this hand
 * gets back compared with an average hand of the same equity. Continuous and
 * bounded; no class decides anything.
 *  - nut potential: an ace with one or two more cards of its suit;
 *  - suitedness: any other clean two-card suit, less; four or more of a suit
 *    is dead weight;
 *  - connection: the most ranks inside a span of five, beyond two;
 *  - pair quality: aces realize, a low pair makes under-sets, a second card
 *    of a made pair beyond two is a dead card;
 *  - danglers: a card more than four ranks from every other card.
 */
export function omahaPreflopDefenceShape(hole: readonly Card[]): number {
  const n = hole.length;
  if (n < 4) return 0;
  let term = 0;
  const bySuit = new Map<string, Card[]>();
  for (const c of hole) bySuit.set(c.suit, [...(bySuit.get(c.suit) ?? []), c]);
  let suitTerm = 0;
  for (const cards of bySuit.values()) {
    if (cards.length < 2) continue;
    if (cards.length >= 4) {
      suitTerm -= 0.02;
      continue;
    }
    const blocked = cards.length === 3 ? 0.5 : 1;
    const top = Math.max(...cards.map((c) => RANK_VALUE[c.rank] ?? 0));
    suitTerm += blocked * (top === 14 ? 0.025 : top === 13 ? 0.012 : 0.006);
  }
  term += Math.min(0.04, suitTerm);
  const ranks = hole.map((c) => RANK_VALUE[c.rank] ?? 0);
  const distinct = [...new Set(ranks)];
  // connection: the ace plays high and low
  const spanBest = (xs: number[]): number => {
    let best = 0;
    for (const lo of xs) best = Math.max(best, xs.filter((r) => r >= lo && r <= lo + 4).length);
    return best;
  };
  const connected = Math.max(spanBest(distinct), spanBest(distinct.map((r) => (r === 14 ? 1 : r))));
  term += 0.012 * Math.max(0, Math.min(connected, n) - 2);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  for (const [rank, count] of counts) {
    if (count >= 3) term -= 0.03 * (count - 2);
    if (count >= 2) term += rank === 14 ? 0.02 : rank === 13 ? 0.005 : rank <= 8 ? -0.012 : 0;
  }
  for (const r of distinct) {
    const low = r === 14 ? 1 : r;
    const near = distinct.some(
      (o) => o !== r && (Math.abs(o - r) <= 4 || Math.abs((o === 14 ? 1 : o) - low) <= 4)
    );
    if (!near && (counts.get(r) ?? 0) === 1) term -= 0.012;
  }
  return clamp(term, REALIZATION_SHAPE_MIN, REALIZATION_SHAPE_MAX);
}

/**
 * The realization of a call: position, depth after the call (costing less the
 * stronger the call against the range it faces), players in and players still
 * to act, hand shape. `equity` absent: the calls' mean equity.
 */
export function omahaPreflopDefenceRealization(
  inPosition: boolean,
  sprAfter: number,
  othersIn: number,
  shape: number,
  playersBehind = 0,
  equity: number = REALIZATION_EQUITY_CENTRE
): number {
  const spr = Number.isFinite(sprAfter) ? Math.max(0, sprAfter) : 0;
  if (spr <= 1e-9) return 1;
  const side = inPosition ? 'ip' : 'oop';
  const depth = spr / (spr + REALIZATION_DEPTH_HALF[side]);
  // The player and shape terms fade with the depth as well: a call that is nearly all in has nothing left to be played off.
  const fade = Math.min(1, spr);
  const eq = Number.isFinite(equity) ? clamp(equity, 0, 1) : REALIZATION_EQUITY_CENTRE;
  const r =
    1 -
    (REALIZATION_DEPTH_COST[side] -
      REALIZATION_DEPTH_EQUITY_SLOPE[side] * (eq - REALIZATION_EQUITY_CENTRE)) *
      depth -
    fade *
      (REALIZATION_OTHER_IN_COST * Math.min(1, Math.max(0, othersIn)) +
        REALIZATION_SECOND_IN_COST * Math.min(1, Math.max(0, othersIn - 1))) -
    fade * REALIZATION_BEHIND_COST[side] * Math.min(2, Math.max(0, playersBehind)) +
    fade * REALIZATION_SHAPE_WEIGHT * shape;
  return clamp(r, REALIZATION_MIN, REALIZATION_MAX);
}

/** The table's rake on a pot, in chips: percentage to a cap; none on timed collection. */
export function omahaPreflopDefenceRake(
  pot: number,
  bigBlind: number,
  config:
    | {
        percent: number;
        cap: number;
        playerCountCaps?: { players: number; cap: number }[];
        timedRake?: unknown;
      }
    | null
    | undefined,
  playerCount: number | undefined
): number {
  if (!(pot > 0)) return 0;
  if (config) {
    if (config.timedRake) return 0;
    const rate = Math.max(0, config.percent) / 100;
    let cap = Math.max(0, config.cap);
    if (config.playerCountCaps?.length && playerCount !== undefined) {
      const tier = [...config.playerCountCaps]
        .sort((a, b) => b.players - a.players)
        .find((candidate) => playerCount >= candidate.players);
      if (tier) cap = Math.max(0, tier.cap);
    }
    return Math.min(pot * rate, cap);
  }
  const cap = Math.max(
    (bigBlind > 0 ? bigBlind : 2) * DEFAULT_RAKE_CAP_BIG_BLINDS,
    DEFAULT_RAKE_CAP_MIN_CHIPS
  );
  return Math.min(pot * DEFAULT_RAKE_RATE, cap);
}

/** Equity of the Horse's cards against the top `width` of hands; null when it cannot be sampled. */
export function omahaPreflopDefenceEquity(
  hole: readonly Card[],
  dead: readonly Card[],
  width: number
): number | null {
  const lo = 1 - clamp(width, 0.02, 1);
  // a range narrower than all hands: the same equity bit for bit on card ids (percentile in [lo, 1]; 2026-11-26)
  return lo <= 1e-9
    ? omahaReraisedEquity(hole, [], dead, () => true, PREFLOP_DEFENCE_EQUITY_SAMPLES)
    : omahaReraisedEquityInPercentileBand(hole, dead, lo, 1, PREFLOP_DEFENCE_EQUITY_SAMPLES);
}

/**
 * The priced decision, or null when it cannot be made (outside the game, a
 * hand that is not four or five cards, nothing to call, no equity estimate).
 * `raise` is the re-raise the earlier rules proposed, when they proposed one.
 */
export function omahaPreflopDefenceVerdict(
  spot: OmahaPreflopDefenceSpot,
  hole: readonly Card[],
  dead: readonly Card[],
  read: OmahaPreflopReraiserRead,
  raise: OmahaPreflopDefenceRaise | null
): OmahaPreflopDefenceVerdict | null {
  if (!OMAHA_PREFLOP_DEFENCE_VARIANTS.has(String(spot.variant).toLowerCase())) return null;
  if (hole.length !== 4 && hole.length !== 5) return null;
  if (spot.preflopRaises < 2) return null;
  if (!(spot.call > 0.005) || !(spot.pot > 0) || !(spot.stack > 0)) return null;
  const call = Math.min(spot.call, spot.stack);
  const potAfter = spot.pot + call;
  const price = call / potAfter;
  const behindAfter = Math.max(0, Math.min(spot.stack - call, Math.max(0, spot.raiserBehind)));
  const sprAfter = behindAfter / potAfter;
  const width = omahaPreflopDefenceRangeWidth(read.rate, spot.preflopRaises);
  const equity = omahaPreflopDefenceEquity(hole, dead, width);
  if (equity === null) return null;
  const shape = omahaPreflopDefenceShape(hole);
  const realization = omahaPreflopDefenceRealization(
    spot.inPosition,
    sprAfter,
    spot.othersIn,
    shape,
    spot.playersBehind ?? 0,
    equity
  );
  const evCall = realization * equity * Math.max(0, potAfter - spot.rake(potAfter)) - call;

  let evRaise: number | null = null;
  if (raise !== null && raise.risk > call + 0.005) {
    const risk = Math.min(raise.risk, spot.stack);
    // What the re-raiser must add to continue, capped by what he has behind.
    const hisCall = Math.max(0, Math.min(risk - call, Math.max(0, spot.raiserBehind)));
    const effRisk = call + hisCall;
    const pot2 = spot.pot + effRisk + hisCall;
    const fold = clamp(Number.isFinite(read.foldToReraise) ? read.foldToReraise : 0, 0, 0.95);
    const width2 = clamp(width * (1 - fold), 0.02, 1);
    const equity2 = fold > 1e-9 ? omahaPreflopDefenceEquity(hole, dead, width2) : equity;
    if (equity2 !== null) {
      const spr2 =
        Math.max(0, Math.min(spot.stack - effRisk, Math.max(0, spot.raiserBehind) - hisCall)) /
        pot2;
      const r2 = omahaPreflopDefenceRealization(
        spot.inPosition,
        spr2,
        spot.othersIn,
        shape,
        spot.playersBehind ?? 0,
        equity2
      );
      evRaise =
        fold * spot.pot +
        (1 - fold) * (r2 * equity2 * Math.max(0, pot2 - spot.rake(pot2)) - effRisk);
    }
  }
  const action: OmahaPreflopDefenceVerdict['action'] =
    evRaise !== null && evRaise > 0 && evRaise >= evCall ? 'raise' : evCall > 0 ? 'call' : 'fold';
  return { action, evCall, evRaise, equity, width, realization, price, sprAfter };
}
