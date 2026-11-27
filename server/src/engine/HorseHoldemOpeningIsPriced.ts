/**
 * holdemOpeningValueBetIsPriced / holdemOpeningBluffIsPriced (plo-lead7 2026-11-25; both default OFF, read `=== true`).
 *
 * The real-hand audit of NLH cash against people (HAND-AUDIT-NLH.md, daily nlh-cash report 2026-11-25) found the
 * Horses lose their chips by PASSIVITY on the opening side, not by folding: missed river bluffs (first to act after a
 * lead or a check-through), missed turn value bets, missed turn bluffs, turn bets sized too small. The earlier
 * chooser (#11921) priced against break-even fold rates on the facing side and lost; these two options act only
 * where the Horse is NOT facing a wager, heads-up, and only add a bet the brain did not make (or resize a turn
 * value bet). Every number is a price:
 *
 *   his fold to a bet B into pot P   f = foldRef x (B / (B + P)) / 0.337, at most 0.95             (holdemPricedFold)
 *   foldRef                         = (his folds + K x 0.337) / (his opportunities + K)       (no record: 0.337,
 *                                     where f equals the bettor's break-even price B / (B + P): equilibrium)
 *   who folds                       the weakest f of HIS range read WITHOUT the Horse's cards (he cannot see them):
 *                                   a strength cutoff; with the Horse's cards removed the share below that cutoff is
 *                                   the fold given the Horse's hand (blockers), the rest is his calling part
 *   EV(bet B)                       = f' P + (1 - f') (r eqCall (P + B + B') - B)   (B' his matched call)
 *   EV(check)                       = r eqAll P
 *   value bet                       eqCall > 1/2 at the chosen size (the hands that call lose chips to the bet)
 *   bluff                           eqCall <= 1/2, EV(bet) > EV(check), and f' > f (the Horse's cards remove more of
 *                                   his calling part than his folding part: blocker dependent) or the Horse's line
 *                                   range outscores his (range advantage)
 *   size                            the legal priced size of highest EV (never drawn)
 *
 * r: 1 on the river and in position, HOLDEM_PRICED_REALIZATION_OOP otherwise (the hvc module's constant).
 * Public information only: his range is built from his public line (HorseLogic.holdemPricedLineRead); the only hole
 * cards read are the deciding Horse's own. Draws nothing from any random stream (equities on the turn and flop use the
 * hvc module's seeded private generator, keyed on the Horse's cards, the board and the pot).
 */
import type { Card } from '../types.js';
import {
  HOLDEM_PRICED_REFERENCE_PRICE,
  holdemEquityOfShare,
  holdemPricedFold,
  type HoldemPricedRange,
} from './HorseHoldemValueAndCallsArePriced.js';
import { scoreHoldem } from './HorseEval.js';

/** The no-record fold anchor: the reference price itself, so f = B / (B + P), the bettor's break-even (MDF). */
export const HOLDEM_OPENING_FOLD_ANCHOR = HOLDEM_PRICED_REFERENCE_PRICE;
/** Pseudo-opportunities the anchor carries against his own record (his record dominates as n grows: n / (n + K)). */
export const HOLDEM_OPENING_RECORD_PSEUDO = 20;
/** The no-record anchor of his bet share when checked to (used only to shape his line range): one half. */
export const HOLDEM_OPENING_BET_SHARE_ANCHOR = 0.5;

/** His fold at the reference price, his record shrunk to the equilibrium anchor. */
export function holdemOpeningFoldReference(folds: number, opportunities: number): number {
  const n = Number.isFinite(opportunities) && opportunities > 0 ? opportunities : 0;
  const s = Number.isFinite(folds) ? Math.max(0, Math.min(n, folds)) : 0;
  const k = HOLDEM_OPENING_RECORD_PSEUDO;
  return (s + k * HOLDEM_OPENING_FOLD_ANCHOR) / (n + k);
}

/** His bet share when checked to, his record shrunk to the anchor (range shape only). */
export function holdemOpeningBetShare(bets: number, opportunities: number): number {
  const n = Number.isFinite(opportunities) && opportunities > 0 ? opportunities : 0;
  const s = Number.isFinite(bets) ? Math.max(0, Math.min(n, bets)) : 0;
  const k = HOLDEM_OPENING_RECORD_PSEUDO;
  return (s + k * HOLDEM_OPENING_BET_SHARE_ANCHOR) / (n + k);
}

/** The strength cutoff below which the weakest share `f` of `range` lies; `frac` of the weight AT the cutoff folds. */
export function holdemFoldCutoff(
  range: HoldemPricedRange,
  f: number
): { cut: number; frac: number } {
  let want = Math.max(0, Math.min(1, f)) * range.total;
  const ord = range.order;
  if (want <= 1e-12 || ord.length === 0) return { cut: -Infinity, frac: 0 };
  // weakest first; group equal strengths
  let k = ord.length - 1;
  while (k >= 0) {
    const s = range.strength[ord[k]];
    let w = 0;
    let j = k;
    while (j >= 0 && range.strength[ord[j]] === s) {
      w += range.weight[ord[j]];
      j--;
    }
    if (w >= want - 1e-12) return { cut: s, frac: w > 0 ? Math.min(1, want / w) : 1 };
    want -= w;
    k = j;
  }
  return { cut: Infinity, frac: 1 };
}

/** In `range` (the Horse's cards removed), the share that folds under the cutoff and the Horse's equity against the rest. */
export function holdemFoldAndCallEquity(
  range: HoldemPricedRange,
  cutoff: { cut: number; frac: number }
): { fold: number; callEquity: number; callWeight: number } {
  let folded = 0;
  let cw = 0;
  let ce = 0;
  for (const i of range.order) {
    const w = range.weight[i];
    const s = range.strength[i];
    const foldPart = s < cutoff.cut ? 1 : s === cutoff.cut ? cutoff.frac : 0;
    folded += w * foldPart;
    const c = w * (1 - foldPart);
    cw += c;
    ce += c * range.equity[i];
  }
  if (range.total <= 0) return { fold: 0, callEquity: 0, callWeight: 0 };
  return {
    fold: folded / range.total,
    callEquity: cw > 0 ? ce / cw : holdemEquityOfShare(range, 1).equity,
    callWeight: cw,
  };
}

/**
 * Range advantage: the probability that a combination of the Horse's line range outscores one of his, both read
 * without either player's hole cards (board dead only), by the made hand on this board (ties half).
 */
export function holdemRangeAdvantage(
  mine: HoldemPricedRange,
  his: HoldemPricedRange,
  board: readonly Card[]
): number {
  const scored = (r: HoldemPricedRange) => {
    const out: Array<[number, number]> = [];
    for (const i of r.order) {
      const w = r.weight[i];
      if (!(w > 0)) continue;
      out.push([scoreHoldem([...r.combos[i], ...board], board.length + 2, false), w]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out;
  };
  const a = scored(mine);
  const b = scored(his);
  const wb = b.reduce((x, y) => x + y[1], 0);
  const wa = a.reduce((x, y) => x + y[1], 0);
  if (!(wa > 0) || !(wb > 0)) return 0.5;
  let j = 0;
  let below = 0;
  let total = 0;
  for (const [s, w] of a) {
    while (j < b.length && b[j][0] < s) below += b[j++][1];
    let tie = 0;
    for (let t = j; t < b.length && b[t][0] === s; t++) tie += b[t][1];
    total += w * (below + tie / 2);
  }
  return total / (wa * wb);
}

export interface HoldemOpeningSpot {
  pot: number;
  heroIn: number;
  villainIn: number;
  heroStack: number;
  villainStack: number;
  /** his fold at the reference price (holdemOpeningFoldReference) */
  foldRef: number;
  /** equity realization: 1 on the river or in position */
  r: number;
}

export interface HoldemOpeningCandidate {
  to: number;
  ev: number;
  /** his fold without the Horse's cards (the price he answers) */
  foldBase: number;
  /** his fold given the Horse's cards */
  fold: number;
  callEquity: number;
  value: boolean;
}

/**
 * Prices a bet to each legal street total `targets` against his range with the Horse's cards removed (`range`,
 * equities filled) and read without them (`base`, for who folds).
 */
export function holdemOpeningPrice(
  spot: HoldemOpeningSpot,
  range: HoldemPricedRange,
  base: HoldemPricedRange,
  targets: readonly number[],
  /** his fold to a matched bet into the pot, when it is not the record-shrunk price (holdemRiverBluffIsPricedOnPeople) */
  foldOf?: (matched: number, pot: number) => number
): { check: number; equity: number; bets: HoldemOpeningCandidate[] } {
  const all = holdemEquityOfShare(range, 1).equity;
  const check = spot.r * all * spot.pot;
  const bets: HoldemOpeningCandidate[] = [];
  for (const to of targets) {
    const add = Math.max(0, Math.min(to - spot.heroIn, spot.heroStack));
    if (!(add > 0)) continue;
    const his = Math.max(0, Math.min(to - spot.villainIn, spot.villainStack));
    const matched = Math.max(0, Math.min(add, spot.villainIn + his - spot.heroIn));
    // his fold is his record's (shrunk to the anchor), never capped by the modelled weak share of his range: the
    // cap overrode a measured over-folder's record and priced his medium hands as callers (league: river value bets
    // -12.0 +- 4.1 bb/100 with the cap, -1.7 +- 4.3 without, heads-up, seed 3303)
    const fb = foldOf
      ? Math.max(0, Math.min(1, foldOf(matched, spot.pot)))
      : holdemPricedFold(spot.foldRef, matched, spot.pot);
    const cut = holdemFoldCutoff(base, fb);
    const g = holdemFoldAndCallEquity(range, cut);
    const ev =
      g.fold * spot.pot +
      (1 - g.fold) * (spot.r * g.callEquity * (spot.pot + matched + his) - matched);
    bets.push({
      to,
      ev,
      foldBase: fb,
      fold: g.fold,
      callEquity: g.callEquity,
      value: g.callEquity > 0.5,
    });
  }
  return { check, equity: all, bets };
}

/** The best candidate of a kind (value or not), or null. Ties keep the smaller size. */
export function holdemOpeningBest(
  bets: readonly HoldemOpeningCandidate[],
  value: boolean
): HoldemOpeningCandidate | null {
  let best: HoldemOpeningCandidate | null = null;
  for (const b of bets) {
    if (b.value !== value) continue;
    if (!best || b.ev > best.ev + 1e-9) best = b;
  }
  return best;
}
