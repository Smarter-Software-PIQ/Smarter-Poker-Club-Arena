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
 * position on the 3-bettor: the price of THIS 3-bet into THIS pot (its
 * minimum defence frequency, so size, blinds and ante are one arithmetic)
 * times a per-seat multiplier for range strength and realisation, then
 * depth (see "WHERE THE WIDTH COMES FROM" below). The hands are read on a continue ORDER blended between a reference
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
 * the charts supply ORDER; the width is the price arithmetic below. Nothing
 * here changes a bet size: the 4-bet and every other wager keep their
 * existing sizes, so no size reveals the hand.
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
 * edge because they supply order; the width comes from vs3BetMdf x V73_EQUITY_MULTIPLIER.
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
 * WHERE THE WIDTH COMES FROM (reasoning, not a fold-percentage target).
 *
 * 1. The price. A 3-bet that adds R chips to win a pot of P (the open, the
 *    blinds, any ante) is a bet of alpha = R / (R + P). The opener must
 *    continue at least the minimum defence frequency MDF = P / (R + P) of
 *    its range, or every 3-bet shows a profit with any two cards. At the
 *    reference geometry (a 2.5bb open, blinds 1.5bb):
 *      a blind 3-bets to 10bb  (R 9,   P 4): MDF 30.8%  (opener in position)
 *      a seat 3-bets to 7.5bb  (R 7.5, P 4): MDF 34.8%  (opener out of position)
 *      the big blind 3-bets a 3bb small-blind open to 9bb (R 8, P 4): 33.3%
 *    `vs3BetMdf` computes it from the real pot and 3-bet, so the size, the
 *    ante and the blinds are all priced by the same arithmetic.
 *
 * 2. The multiplier over MDF (V73_EQUITY_MULTIPLIER). MDF treats a call as
 *    worth nothing; preflop it is worth the equity the hand keeps against the
 *    3-bettor's range and how much of it the opener realises. Two things set
 *    it, and the table follows both:
 *     - opener seat (range strength): an under-the-gun open is the top
 *       11-16% of hands, nearly all of which keep 35-45% against a 3-betting
 *       range; a button open is 40%+ of hands, a large part of which keeps
 *       far less, so the earlier the opener the larger the multiplier;
 *     - position on the 3-bettor (realisation): the opener with position on
 *       every later street realises more of its equity than the same hand out
 *       of position, so the in-position row sits above the out-of-position
 *       row at every seat; the small blind, out of position to the big blind
 *       with the widest range, is lowest.
 *    The values are the reference solver shapes (100bb 6-max cash: a button
 *    opener against a big-blind 3-bet to ~11bb continues roughly 45-50% of
 *    its open, an under-the-gun opener against a 3-bet ~60%) divided by the
 *    reference MDF, then held to the hands the charts admit: an opener's
 *    offsuit unpaired hands other than AKo / AQo fold to a big 3-bet by Dan's
 *    binding rule (HorseHoldemPremiumAggression rule 1), so they are never
 *    counted inside the width.
 *
 *    Away from the reference geometry the width follows the MDF ratio with
 *    the elasticity V73_PRICE_ELASTICITY.
 *
 * 3. Depth. Shallower than 40bb a call or 4-bet leaves a stack-to-pot ratio
 *    near or under one, so the continuing hand realises nearly all of its
 *    equity: the multiplier rises, up to +15% at 25bb (below 25bb the
 *    jam-or-fold zones own the spot and V73 does not apply). Deeper than
 *    120bb the V21 deep scale narrows it by up to 5% (the stack-off
 *    discipline itself is on the 4-bet and 5-bet bars, unchanged).
 */
export const V73_EQUITY_MULTIPLIER: Readonly<
  Record<'ip' | 'oop', Readonly<Record<number, number>>>
> = {
  ip: { 2: 1.5, 3: 1.62, 4: 1.75, 5: 1.88, 6: 1.95, 7: 1.98, 8: 2.01 },
  oop: { 1: 1.32, 3: 1.44, 4: 1.52, 5: 1.61, 6: 1.67, 7: 1.7, 8: 1.72 },
};

/**
 * The minimum defence frequency (0..1) against a 3-bet that ADDS `riskBB` to
 * a pot of `potBeforeBB` (the open, the blinds and any ante, before the
 * 3-bet's own new chips).
 */
export function vs3BetMdf(potBeforeBB: number, riskBB: number): number {
  const p = Math.max(0, potBeforeBB);
  const r = Math.max(0, riskBB);
  return p + r > 0 ? p / (p + r) : 1;
}

/**
 * How the width answers a price other than the reference (exponent on the
 * MDF ratio). Less than one, deliberately: MDF is the floor that stops a
 * zero-equity bluff profiting, and the multiplier above it is the equity the
 * continuing hands keep, which does not shrink or grow with the price. A
 * cheaper 3-bet admits the next hands down; it does not double the range.
 * At 0.5 a 5x blind 3-bet (MDF 25.8% against 30.8%) continues 8% less of the
 * open and a 3x one (38.1%) 11% more, and a 1bb big-blind ante (MDF up by
 * about a sixth) about 8% more.
 */
export const V73_PRICE_ELASTICITY = 0.5;

/** Reference geometry for the reference rows: the MDF each row was written at. */
export function referenceMdf(openerBehind: number, ip: boolean): number {
  if (clampIndex(openerBehind) === 1) return vs3BetMdf(4, 8);
  return ip ? vs3BetMdf(4, 9) : vs3BetMdf(4, 7.5);
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
  /** The 3-bet, raised-to, over the opener's raise-to (scope bounds only). */
  threeBetX: number;
  /** The pot before the 3-bet's new chips: the open, the blinds, any ante (big blinds). */
  potBeforeBB: number;
  /** Chips the 3-bettor added with the 3-bet (its raise-to minus any blind it had posted). */
  reRaiseRiskBB: number;
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
  // The small blind is always out of position to the big blind and the
  // button always in position to a blind, so each reads its own row; a
  // cutoff or earlier opener can be either.
  const ip = k === 1 ? false : k === 2 ? true : spot.ip;
  const table = ip ? V73_EQUITY_MULTIPLIER.ip : V73_EQUITY_MULTIPLIER.oop;
  const keys = Object.keys(table).map(Number);
  const kk = Math.max(Math.min(...keys), Math.min(Math.max(...keys), k));
  // The price: MDF of this 3-bet into this pot (size, blinds and ante)
  // against the row's reference MDF, held within 0.7-1.4 so a malformed read
  // cannot swing the width beyond what the reference shapes describe, and
  // applied with elasticity V73_PRICE_ELASTICITY (see its note).
  const ref = referenceMdf(k, ip);
  const ratio = Math.max(0.7, Math.min(1.4, vs3BetMdf(spot.potBeforeBB, spot.reRaiseRiskBB) / ref));
  let share = 100 * ref * table[kk] * Math.pow(ratio, V73_PRICE_ELASTICITY);
  // Shallow: a stack-to-pot ratio near one realises nearly all equity.
  if (spot.effectiveBB < 40) {
    share *= 1 + 0.15 * Math.min(1, (40 - Math.max(V73_MIN_EFFECTIVE_BB, spot.effectiveBB)) / 15);
  }
  // V21 deep scale (zero at 120bb, full at 250bb): up to 5% narrower.
  if (spot.deepDiscipline && spot.effectiveBB > 120) {
    const deepT = Math.min(0.05, (spot.effectiveBB - 120) / 2600);
    share *= 1 - deepT;
  }
  return Math.max(10, Math.min(85, share));
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
