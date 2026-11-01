/**
 * ═══════════════════════════════════════════════════════════════════════════
 * V73 THE OPENER FACING A 3-BET — Hold'em continue range by seat (2026-11-01)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * V70 fixed the open, V72 the answer to the open. This is the opener's answer
 * to the 3-bet: hero opened (the first raise, nobody else in), exactly one
 * player re-raised, nobody has called the re-raise, no-limit two-card hold'em
 * with three or more dealt in. See
 * docs/changelog/2026-11-01-horse-nlh-vs-3bet-defence.md.
 *
 * THE DEFECT. The legacy branch continued on a FIXED bar - the top ~7% of all
 * hands in position, ~5% out of it (V60 cash: 10% / 8%) - whatever the
 * opener had opened. A seat that opens 15% of hands and a seat that opens 45%
 * answered a 3-bet with the same absolute top of the deck, so the wider the
 * open the more of it folded: measured on production (3 hours, horses that
 * opened and faced a 3-bet at 25bb+) the button folded 85-87%, the cutoff
 * 75%, under the gun 43-60%. The bar also read the high-card ladder, which
 * ranks offsuit broadways (that Dan's binding rule folds to a big 3-bet, see
 * HorseHoldemPremiumAggression rule 1) above the suited connectors, suited
 * aces and pairs a solver continues with: 99% of suited connectors and gappers
 * folded, half the suited broadways and suited aces folded.
 *
 * WHAT CHANGES. The continue width is a SHARE OF THE OPENER'S OWN OPEN RANGE
 * (the V70 per-seat open width), by opener seat (V70 index: dealt-in players
 * behind, SB 1 .. nine-handed UTG 8) and by whether the opener will have
 * position on the 3-bettor, then scaled by the 3-bet size, depth and the
 * ante. The hands are read on a continue ORDER blended between a reference
 * chart for a late opener and one for an early opener, mapped onto the
 * holdemPreflopScore scale by combo share (V70's scoreAtShare). The charts
 * hold the pairs, the suited hands and AKo / AQo only: every other offsuit
 * unpaired hand folds to a big 3-bet by Dan's rule, so it is never counted as
 * part of the width.
 *
 * What does NOT change: value 4-bets (top of the legacy ladder), the 4-bet
 * bluff, the 5-bet branch and Dan's deep rule above it (at 60bb+ in a
 * tournament only AA/KK stack off facing a 4-bet), the dominated-offsuit fold
 * and every premium rule in HorseHoldemPremiumAggression, the V21 deep
 * discipline (it narrows this width), the ICM premium, style tightness, the
 * hunter and re-raiser exploit reads.
 *
 * SOURCE. Standard solver-derived 100bb 6-max cash shapes (GTO Wizard NL500
 * simplified): button vs a big-blind 3-bet to ~11bb folds ~50%, continuing
 * every pair, every suited ace, suited kings to K5s, suited queens and jacks
 * to the 8, suited connectors and one-gappers; an under-the-gun opener vs a
 * button 3-bet to ~7.5bb folds ~40%. No vs-3-bet solver artifact exists in
 * this repository, so these are reference charts, not a hydrated solver read:
 * the charts supply ORDER; the widths are the tables below.
 *
 * Hold'em only. Never keyed on who the opponents are.
 */

import type { Card } from '../types.js';
import {
  HAND_CLASSES,
  OPEN_TARGET,
  OPEN_TARGET_THREE,
  holdemClass,
  parseChart,
  scoreAtShare,
} from './HorseGtoOpeningRanges.js';
import { holdemPreflopScore } from './HorseEval.js';

const COMBOS: Record<string, number> = Object.fromEntries(
  HAND_CLASSES.map((h) => [h.cls, h.combos])
);

/** Opener index (players behind) of the late anchor chart (the button). */
const LATE_ANCHOR = 2;
/** Opener index of the early anchor chart (the 6-max UTG / 9-max LJ). */
const EARLY_ANCHOR = 5;

/**
 * Continue (call or 4-bet) charts for the opener facing one 3-bet. Pairs,
 * suited hands, AKo and AQo only (see the header). Written generously at the
 * edge because they supply order; the width is V73_CONTINUE_SHARE's.
 */
export const VS3_CONTINUE_CHARTS: Readonly<{
  late: Record<string, number>;
  early: Record<string, number>;
}> = {
  // Button vs a blind 3-bet (~50% fold at 100bb in the solver).
  late: parseChart(
    '55+,44:0.85,33:0.75,22:0.7,ATs+,A2s-A5s:0.95,A6s-A9s:0.85,KTs+,K9s:0.9,K8s:0.6,K7s:0.45,' +
      'K5s-K6s:0.4,K4s:0.2,QTs+,Q9s:0.85,Q8s:0.45,Q7s:0.15,JTs,J9s:0.85,J8s:0.45,J7s:0.1,T9s:0.95,' +
      'T8s:0.7,T7s:0.25,98s:0.85,97s:0.5,96s:0.15,87s:0.8,86s:0.4,85s:0.1,76s:0.75,75s:0.3,65s:0.7,' +
      '64s:0.25,54s:0.6,53s:0.15,43s:0.1,AQo+'
  ),
  // Under-the-gun (6-max) vs a 3-bet (~40% fold in the solver).
  early: parseChart(
    '66+,55:0.85,44:0.75,33:0.65,22:0.6,AJs+,ATs:0.95,A5s:0.9,A4s:0.85,A9s:0.7,A3s:0.7,A8s:0.6,' +
      'A2s:0.55,A7s:0.5,A6s:0.45,KJs+,KTs:0.9,K9s:0.6,QJs,QTs:0.85,Q9s:0.4,JTs:0.9,J9s:0.4,T9s:0.75,' +
      '98s:0.55,87s:0.45,76s:0.4,65s:0.35,54s:0.25,AKo,AQo:0.9'
  ),
};

/**
 * Continue share of the opener's own open range (percent) at 100bb against
 * the reference 3-bet size, by opener index, in position (the 3-bettor is a
 * blind) and out of position (the 3-bettor acts after the opener postflop, or
 * the small blind against the big blind). A balanced horse at tightness 1.0.
 *
 * These sit above a solver's fold (40-55%) by the dominated-offsuit rule: an
 * opener's offsuit unpaired hands other than AKo / AQo fold to a big 3-bet by
 * Dan's binding rule, and they are ~35-55% of a late open range. The shares
 * below are what the opener continues with of the rest.
 */
export const V73_CONTINUE_SHARE: Readonly<Record<'ip' | 'oop', Readonly<Record<number, number>>>> =
  {
    ip: { 2: 46, 3: 50, 4: 54, 5: 58, 6: 60, 7: 61, 8: 62 },
    oop: { 1: 44, 3: 50, 4: 53, 5: 56, 6: 58, 7: 59, 8: 60 },
  };

/** Reference 3-bet size (raised-to over the open): blinds ~4x, in position ~3x. */
export function referenceThreeBetX(ip: boolean): number {
  return ip ? 4 : 3;
}

/** Smallest / largest 3-bet multiple (raised-to over the open) this base answers. */
export const V73_MIN_THREEBET_X = 1.8;
export const V73_MAX_THREEBET_X = 7;
/** Shallowest effective depth (big blinds): below it the jam-or-fold zones own the spot. */
export const V73_MIN_EFFECTIVE_BB = 25;

function clampIndex(k: number): number {
  return Math.max(1, Math.min(8, Math.round(k)));
}

/** Blend weight toward the early anchor for an opener index. */
function earlyWeight(openerBehind: number): number {
  return Math.max(0, Math.min(1, (openerBehind - LATE_ANCHOR) / (EARLY_ANCHOR - LATE_ANCHOR)));
}

export interface Vs3BetSpot {
  /** Dealt-in players behind the opener (V70 index; SB 1 .. 9-max UTG 8). */
  openerBehind: number;
  /** The opener will act after the 3-bettor on every later street. */
  ip: boolean;
  ante: boolean;
  /** Players dealt in (3 = three-handed opens are wider). */
  dealt: number;
  /** The 3-bet, raised-to, over the opener's raise-to. */
  threeBetX: number;
  /** Effective stack in big blinds against the 3-bettor. */
  effectiveBB: number;
  /** V21 deep discipline in force (true unless the explicit off arm). */
  deepDiscipline: boolean;
  /**
   * The horse's style tightness (1 = balanced). A tighter horse opened a
   * narrower range; the continue width is a share of the range it actually
   * opened, so every style folds the same share of its own open.
   */
  tightness?: number;
}

/** The share (0..1) whose scoreAtShare is `score`: the inverse, by bisection. */
export function shareAtScore(score: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (scoreAtShare(mid) > score) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * The open width (percent) a horse of this tightness actually opens from the
 * seat: V70's base bar multiplied by the tightness, read back as a share.
 */
export function styledOpenWidth(
  openerBehind: number,
  ante: boolean,
  dealt: number,
  tightness = 1
): number {
  const base = openWidth(openerBehind, ante, dealt);
  if (!(tightness > 0) || Math.abs(tightness - 1) < 1e-9) return base;
  const bar = Math.min(0.965, Math.max(0, scoreAtShare(base / 100) * tightness));
  return 100 * shareAtScore(bar);
}

/** The opener's base open width (percent) for the seat: V70's target. */
export function openWidth(openerBehind: number, ante: boolean, dealt: number): number {
  const key = ante ? 'ante' : 'cash';
  const k = clampIndex(openerBehind);
  if (dealt === 3 && k <= 2) return OPEN_TARGET_THREE[key][k];
  return OPEN_TARGET[key][k];
}

/** Continue share of the open range (percent) for a spot, after every scaling. */
export function continueShare(spot: Vs3BetSpot): number {
  const k = clampIndex(spot.openerBehind);
  // Out of position as the small blind (k 1); in position from the button
  // (k 2) in; a cutoff or earlier opener can be either. The button cannot be
  // out of position against a 3-bettor who acts after it preflop, and the
  // small blind cannot be in position, so each falls back to its own row.
  const row = k === 1 ? V73_CONTINUE_SHARE.oop : k === 2 ? V73_CONTINUE_SHARE.ip : null;
  const table = row ?? (spot.ip ? V73_CONTINUE_SHARE.ip : V73_CONTINUE_SHARE.oop);
  const keys = Object.keys(table).map(Number);
  const kk = Math.max(Math.min(...keys), Math.min(Math.max(...keys), k));
  let share = table[kk];
  // A bigger 3-bet is continued narrower, a smaller one wider (square root of
  // the price ratio, bounded).
  const ref = referenceThreeBetX(k === 1 ? false : k === 2 ? true : spot.ip);
  const sizeF = Math.max(0.75, Math.min(1.2, Math.sqrt(ref / Math.max(1.5, spot.threeBetX))));
  share *= sizeF;
  // Shallower than 40bb a 3-bet commits a larger share of the stack and the
  // continue widens toward jam-or-fold (up to +15% at 25bb).
  if (spot.effectiveBB < 40) {
    share *= 1 + 0.15 * Math.min(1, (40 - Math.max(V73_MIN_EFFECTIVE_BB, spot.effectiveBB)) / 15);
  }
  // V21 deep discipline: the same depth scale the legacy branch used
  // (zero at 120bb, full at 250bb), narrowing the width by up to 5%. A call
  // is not a stack-off - deep, the pairs and suited hands that call have the
  // most to win - so the narrowing stays the legacy branch's size (it added
  // half the scale, 0.025, to its bar); the stack-off discipline itself
  // lives on the 4-bet and 5-bet bars, which are unchanged.
  if (spot.deepDiscipline && spot.effectiveBB > 120) {
    const deepT = Math.min(0.05, (spot.effectiveBB - 120) / 2600);
    share *= 1 - deepT;
  }
  // An ante adds dead money to every pot: a little wider.
  if (spot.ante) share *= 1.04;
  return Math.max(10, Math.min(90, share));
}

/** Continue width (percent of all 1,326 combos) for a spot. */
export function continueWidth(spot: Vs3BetSpot): number {
  return (
    (styledOpenWidth(spot.openerBehind, spot.ante, spot.dealt, spot.tightness) *
      continueShare(spot)) /
    100
  );
}

function legacyScore(cls: string): number {
  const suited = cls[2] === 's';
  return holdemPreflopScore(
    { rank: cls[0], suit: 'spades' } as Card,
    { rank: cls[1], suit: suited ? 'spades' : 'hearts' } as Card,
    false
  );
}

const ORDER = new Map<number, string[]>();
const STRENGTH = new Map<number, Record<string, number>>();

/** The blended continue order for an opener index (a permutation of the 169 classes). */
export function vs3BetContinueOrder(openerBehind: number): string[] {
  const k = clampIndex(openerBehind);
  const hit = ORDER.get(k);
  if (hit) return hit;
  const { late, early } = VS3_CONTINUE_CHARTS;
  const w = earlyWeight(k);
  const freq = (cls: string) => (1 - w) * (late[cls] ?? 0) + w * (early[cls] ?? 0);
  const near = w <= 0.5 ? late : early;
  const far = w <= 0.5 ? early : late;
  const order = HAND_CLASSES.map((h) => h.cls).sort((x, y) => {
    const d0 = freq(y) - freq(x);
    if (Math.abs(d0) > 1e-9) return d0;
    const d1 = (near[y] ?? 0) - (near[x] ?? 0);
    if (Math.abs(d1) > 1e-9) return d1;
    const d2 = (far[y] ?? 0) - (far[x] ?? 0);
    if (Math.abs(d2) > 1e-9) return d2;
    return legacyScore(y) - legacyScore(x);
  });
  const map: Record<string, number> = {};
  let cum = 0;
  for (const cls of order) {
    map[cls] = scoreAtShare((cum + COMBOS[cls] / 2) / 1326);
    cum += COMBOS[cls];
  }
  ORDER.set(k, order);
  STRENGTH.set(k, map);
  return order;
}

export interface GtoVs3Bet {
  /** The hand on the continue order, on the holdemPreflopScore scale (no jitter). */
  continueStrength: number;
  /** Continue bar: hands at or above it call or 4-bet. */
  continueBar: number;
  /** Continue share of the open range used (percent), for the receipt. */
  share: number;
}

/** The opener's continue read for these cards in this spot. Null when not a hold'em hand. */
export function gtoVs3Bet(c1: Card, c2: Card, spot: Vs3BetSpot): GtoVs3Bet | null {
  const cls = holdemClass(c1, c2);
  if (!cls) return null;
  vs3BetContinueOrder(spot.openerBehind);
  const strength = STRENGTH.get(clampIndex(spot.openerBehind))![cls];
  if (strength === undefined) return null;
  const width = continueWidth(spot);
  return {
    continueStrength: strength,
    continueBar: scoreAtShare(width / 100),
    share: continueShare(spot),
  };
}
