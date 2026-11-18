/**
 * OMAHA FLOP DEFENCE: THE FLOP CALL PRICED AS A TWO-STREET TREE
 * (2026-11-18, WooWoo audit lane FLOP-DEFENCE; option omahaFlopDefenceIsPriced,
 * default OFF, read `=== true`). It stands alone: with omahaFlopFacingBetEv
 * off it answers ONLY the heads-up first-bet spot below and every other flop
 * decision is as with both off; with omahaFlopFacingBetEv on it replaces
 * that verdict's realization factor in the same spot.
 *
 * Owner, verbatim: "EVERY DECISION NEEDS TO BE 100% INDEPENDANT AND DATA AND
 * MATH DERRIVED AND BY RANGES, NEVER BLANKETS".
 *
 * WHY. Heads-up, Horses fold 51.6% (n 128, live baseline 2026-11-18) to a
 * person's first flop bet of about 0.75 pot against a 0.42 break-even, so a
 * bet with any two cards wins. The flop verdict (HorseOmahaFlopFacingBetEv)
 * prices the call as equity x one realization factor. Measured (archive
 * woowoo-48h-audit/repairs/FLOP-DEFENCE/ATTRIBUTION.md 1.2 and 1.4): a flop
 * call is worth what the turn decision does with it: the bettor fires the
 * turn after a called flop bet 58% heads-up (81/140) at 0.73 pot, and a
 * one-pair flop call returned about zero BECAUSE the turn barrel folds it.
 * A factor cannot see that; a tree can.
 *
 * WHAT. In the heads-up first-bet spot the verdict covers, EV(call) is the
 * value of a two-street game tree on the verdict's OWN sampled runouts
 * (OmahaFlopEvCounts.rows: per runout the Horse's wins against his value
 * region and against his other holdings):
 *
 *   EV(call) = -paid + mean over turn cards t of
 *       bT x max(0, mean_k|t R(k, Pc + 2cT, q_bet,   left - cT) - cT)   (he barrels; fold or call)
 *     + (1 - bT) x mean_k|t R(k, Pc, q_check, left)                     (he checks)
 *   R(k, X, q, left) = bR x max(0, s_bet(k) x (X + 2cR)(1 - rake) - cR)  (he bets the river; fold or call)
 *                    + (1 - bR) x s_check(k) x X x (1 - rake)            (he checks; showdown)
 *
 * with Pc the pot after the flop call, cT = min(sT x Pc, left), cR = min(sR x
 * X, left) (the stack bounds every later wager: SPR enters continuously), and
 * the Horse's share s(k) against a range mixed from the value region and the
 * other holdings by its non-value share q. Every fold in the tree is a priced
 * fold (its value is max(0, call)), never a threshold.
 *
 * THE RANGE BY STREET. The bettor's flop range is the verdict's own (value
 * region V, non-value share q moved by his read). His later betting ranges
 * keep the odds of non-value to value in the MEASURED proportion of his
 * classified bets (woowoo-analysis/VALUE-BLUFF.md section 1, his cards known
 * for all 776 postflop bets): non-value (semi-bluff + pure bluff +
 * indeterminate) 45% of flop bets (n 340), 42% of turn bets (n 227), 33% of
 * river bets (n 141). Odds ratio street to street: turn over flop 0.885,
 * river over turn 0.680 (river over flop 0.602), each applied to the range
 * he holds on the street before. His checking range is what is left, so the
 * two together are his range.
 *
 * HOW OFTEN AND HOW BIG. bT and bR are his bet rates first to act / checked
 * to on the turn and the river from the per-street read (HorseMind.
 * omahaStreetReadOf: bet.turn, bet.river), shrunk toward the measured rate of
 * his kind (HorseOmahaPricedMode.omahaPricedKindPrior: persons 0.343 / 0.319,
 * Horses 0.403 / 0.363, 5,379 hands) with the one priced shrink
 * (omahaPricedShrunk). Sizes: 0.73 pot, his measured turn barrel after a
 * called flop bet (ATTRIBUTION 1.4, n 81); the river uses the same figure
 * (stated, not measured in this lane).
 *
 * THE RAISE IS MEASURED, NOT DECIDED HERE. The flop raise already has priced
 * owners (omahaDrawRaiseIsPriced for a draw, omahaPressureIsPriced for a made
 * hand; both run after this rule and see its call), so this file does not
 * decide a raise. It reports beside the call the value of a pot raise on the
 * same runouts (raiseEv): he folds at his measured fold to a flop raise
 * (per-street read foldToRaise.flop shrunk toward his kind's measured rate:
 * persons 0.15, Horses 0.61; ATTRIBUTION 3.1 / 3.3), the folded share leaves
 * his range from its non-value side, and the raised pot is shown down. His
 * re-raise is not priced, so raiseEv is an upper bound; the receipt
 * omaha_flop_defence_raise_priced_higher counts how often it beats the call.
 *
 * LEFT OUT (each makes the call worth MORE, so the tree is conservative):
 * the Horse's own bet when checked to (float, probe, river bluff), the Horse's
 * raise, and a checking range weaker than the proportional one. Left out the
 * other way: his raise over a Horse bet (the Horse never bets in the tree)
 * and his re-raise. The model's equity knowledge is exact against the stated
 * range: the tree plays its later streets as if the range were right.
 *
 * Pure: no telemetry, no opponent memory, no random draw.
 */
import { omahaPricedKindPrior, type OmahaOpponentKind } from './HorseOmahaPricedMode.js';
import { omahaPricedShrunk } from './HorseOmahaPricedRules.js';
import type { StreetReadCounters } from './HorseOmahaStreetRead.js';

/** Columns of one runout's row (OmahaFlopEvCounts.rows; OMAHA_FLOP_RUNOUT_ROW). */
const ROW = 4;

/** Odds of non-value to value in his turn / river bets over the same odds on the flop (VALUE-BLUFF.md section 1). */
export const OMAHA_FLOP_DEFENCE_TURN_BLUFF_ODDS = 0.42 / 0.58 / (0.45 / 0.55);
export const OMAHA_FLOP_DEFENCE_RIVER_BLUFF_ODDS = 0.33 / 0.67 / (0.45 / 0.55);
/**
 * The river step from the turn (0.680): applied to the range he holds on the
 * turn, so that a flop bet, turn bet and river bet line lands on the measured
 * river composition (0.885 x 0.680 = 0.602) instead of shrinking twice.
 */
export const OMAHA_FLOP_DEFENCE_RIVER_STEP_ODDS = 0.33 / 0.67 / (0.42 / 0.58);
/** His turn barrel after a called flop bet, share of the pot (ATTRIBUTION 1.4, heads-up, n 81). */
export const OMAHA_FLOP_DEFENCE_TURN_SIZE = 0.73;
/** The river bet, share of the pot: the turn figure (stated). */
export const OMAHA_FLOP_DEFENCE_RIVER_SIZE = 0.73;

/**
 * His fold to a flop raise by kind (ATTRIBUTION 3.1: persons pooled 15%, the
 * measured player 13% [6, 24], n 54; 3.3: Horses 61-69%, the lower figure).
 */
export const OMAHA_FLOP_DEFENCE_FOLD_TO_RAISE_PRIOR: Readonly<Record<OmahaOpponentKind, number>> =
  Object.freeze({ person: 0.15, horse: 0.61 });

export interface OmahaFlopDefenceTreeInputs {
  /** his bet rate first to act / checked to on the turn and on the river */
  turnBet: number;
  riverBet: number;
  /** his wager sizes, share of the pot */
  turnSize: number;
  riverSize: number;
  /** his fold to a flop raise (measurement only: the reported raiseEv) */
  foldToRaise: number;
}

export interface OmahaFlopDefenceTreeSpot {
  /** chips the flop call puts in, and the pot it can win before that call */
  paid: number;
  winnable: number;
  /** chips behind after the call that can still be wagered: the smaller of the Horse's and the bettor's */
  left: number;
  /** marginal rake on the pot, fraction */
  rake: number;
  /** the non-value share of his flop betting range (the verdict's q) */
  bluffShare: number;
}

export interface OmahaFlopDefenceTreeResult {
  ev: number;
  /** the share of turn cards on which the tree calls his barrel */
  turnCallShare: number;
  /** his non-value share when he barrels / when he checks the turn */
  turnBetBluff: number;
  turnCheckBluff: number;
  turnCards: number;
  runouts: number;
  /**
   * Measurement only: the value of a pot raise (relative to folding now) with
   * his re-raise unpriced, or null with nothing behind to raise with.
   */
  raiseEv: number | null;
  /** his fold share and the non-value share of the range that continues against the raise */
  raiseFold: number;
  raiseContinueBluff: number;
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A non-value share moved by an odds ratio. */
export function omahaFlopDefenceShiftedShare(q: number, oddsRatio: number): number {
  const p = clamp01(q);
  if (p <= 0 || p >= 1 || !(oddsRatio > 0)) return p;
  const o = (p / (1 - p)) * oddsRatio;
  return o / (1 + o);
}

/** The non-value share of the range he checks with, given his whole range, his bet rate and his betting range. */
export function omahaFlopDefenceCheckingShare(
  q: number,
  betRate: number,
  betShare: number
): number {
  const b = clamp01(betRate);
  if (b >= 1) return clamp01(betShare);
  return clamp01((clamp01(q) - b * clamp01(betShare)) / (1 - b));
}

/** His later-street bet rates and sizes, from his kind and his per-street read (null read: his kind's rates). */
export function omahaFlopDefenceTreeInputs(
  kind: OmahaOpponentKind | null,
  counters: StreetReadCounters | null
): OmahaFlopDefenceTreeInputs {
  const prior = omahaPricedKindPrior(kind).betCheckedTo;
  return {
    turnBet: clamp01(omahaPricedShrunk(counters?.bet?.turn ?? null, prior.turn)),
    riverBet: clamp01(omahaPricedShrunk(counters?.bet?.river ?? null, prior.river)),
    turnSize: OMAHA_FLOP_DEFENCE_TURN_SIZE,
    riverSize: OMAHA_FLOP_DEFENCE_RIVER_SIZE,
    foldToRaise: clamp01(
      omahaPricedShrunk(
        counters?.foldToRaise?.flop ?? null,
        OMAHA_FLOP_DEFENCE_FOLD_TO_RAISE_PRIOR[kind === 'horse' ? 'horse' : 'person']
      )
    ),
  };
}

/**
 * EV of the flop call (chips, relative to folding now) on the sampled
 * runouts, or null when there is nothing to read.
 */
export function omahaFlopDefenceTreeEv(
  rows: ArrayLike<number> | null | undefined,
  turnOf: ArrayLike<number> | null | undefined,
  spot: OmahaFlopDefenceTreeSpot,
  inputs: OmahaFlopDefenceTreeInputs
): OmahaFlopDefenceTreeResult | null {
  if (!rows || !turnOf || turnOf.length < 1 || rows.length !== turnOf.length * ROW) return null;
  const nums = [spot.paid, spot.winnable, spot.left, spot.rake, spot.bluffShare];
  const ins = [
    inputs.turnBet,
    inputs.riverBet,
    inputs.turnSize,
    inputs.riverSize,
    inputs.foldToRaise,
  ];
  if (!nums.every(fin) || !ins.every(fin)) return null;
  if (!(spot.paid > 0) || !(spot.winnable > 0) || inputs.turnSize < 0 || inputs.riverSize < 0)
    return null;
  const q = clamp01(spot.bluffShare);
  const keep = 1 - Math.max(0, Math.min(0.2, spot.rake));
  const left = Math.max(0, spot.left);
  const bT = clamp01(inputs.turnBet);
  const bR = clamp01(inputs.riverBet);

  // Per runout: share against his value region and against his other holdings.
  const n = turnOf.length;
  let allV = 0;
  let allVn = 0;
  let allO = 0;
  let allOn = 0;
  const byTurn = new Map<number, number[]>();
  for (let k = 0; k < n; k++) {
    const vw = rows[k * ROW];
    const vn = rows[k * ROW + 1];
    const ow = rows[k * ROW + 2];
    const on = rows[k * ROW + 3];
    if (![vw, vn, ow, on].every((x) => fin(x) && x >= 0)) return null;
    allV += vw;
    allVn += vn;
    allO += ow;
    allOn += on;
    const t = turnOf[k];
    const list = byTurn.get(t);
    if (list) list.push(k);
    else byTurn.set(t, [k]);
  }
  if (!(allVn > 0) && !(allOn > 0)) return null;
  const meanV = allVn > 0 ? allV / allVn : allOn > 0 ? allO / allOn : 0;
  const meanO = allOn > 0 ? allO / allOn : meanV;
  const wv = new Float64Array(n);
  const wo = new Float64Array(n);
  for (const ks of byTurn.values()) {
    let tv = 0;
    let tvn = 0;
    let to = 0;
    let ton = 0;
    for (const k of ks) {
      tv += rows[k * ROW];
      tvn += rows[k * ROW + 1];
      to += rows[k * ROW + 2];
      ton += rows[k * ROW + 3];
    }
    // A runout that met no holding of a region reads its turn card's figure, then the whole sample's.
    const turnV = tvn > 0 ? tv / tvn : meanV;
    const turnO = ton > 0 ? to / ton : meanO;
    for (const k of ks) {
      const vn = rows[k * ROW + 1];
      const on = rows[k * ROW + 3];
      wv[k] = clamp01(vn > 0 ? rows[k * ROW] / vn : turnV);
      wo[k] = clamp01(on > 0 ? rows[k * ROW + 2] / on : turnO);
    }
  }

  const qTb = omahaFlopDefenceShiftedShare(q, OMAHA_FLOP_DEFENCE_TURN_BLUFF_ODDS);
  const qTc = omahaFlopDefenceCheckingShare(q, bT, qTb);
  const share = (k: number, qq: number): number => (1 - qq) * wv[k] + qq * wo[k];
  // The river from a pot X with `stack` behind, his whole range at non-value share qn.
  const river = (k: number, X: number, qn: number, stack: number): number => {
    const qb = omahaFlopDefenceShiftedShare(qn, OMAHA_FLOP_DEFENCE_RIVER_STEP_ODDS);
    const qc = omahaFlopDefenceCheckingShare(qn, bR, qb);
    const cR = Math.min(inputs.riverSize * X, Math.max(0, stack));
    if (!(cR > 0)) return share(k, qn) * X * keep;
    const call = share(k, qb) * (X + 2 * cR) * keep - cR;
    return bR * Math.max(0, call) + (1 - bR) * share(k, qc) * X * keep;
  };

  const Pc = spot.winnable + spot.paid;
  const cT = Math.min(inputs.turnSize * Pc, left);
  let total = 0;
  let calls = 0;
  for (const ks of byTurn.values()) {
    let bet = 0;
    let check = 0;
    for (const k of ks) {
      // With nothing behind he cannot barrel: his whole range checks.
      check += river(k, Pc, cT > 0 ? qTc : q, left);
      if (cT > 0) bet += river(k, Pc + 2 * cT, qTb, left - cT);
    }
    check /= ks.length;
    let barrel: number;
    if (cT > 0) {
      const callTurn = bet / ks.length - cT;
      if (callTurn > 0) calls += ks.length;
      barrel = Math.max(0, callTurn);
    } else {
      // Nothing behind: his barrel cannot happen; the hand checks down.
      barrel = check;
      calls += ks.length;
    }
    total += ks.length * (bT * barrel + (1 - bT) * check);
  }
  // The pot raise, measured beside the call: he folds fR from the non-value
  // side of his range; the raised pot is shown down (his re-raise unpriced).
  const fR = clamp01(inputs.foldToRaise);
  const qR = fR >= 1 ? 0 : clamp01((q - fR) / (1 - fR));
  const more = Math.min(Pc, left);
  let raiseEv: number | null = null;
  if (more > 0) {
    let s = 0;
    for (let k = 0; k < n; k++) s += share(k, qR);
    raiseEv = fR * spot.winnable + (1 - fR) * ((s / n) * (Pc + 2 * more) * keep - spot.paid - more);
  }
  return {
    raiseEv,
    raiseFold: fR,
    raiseContinueBluff: qR,
    ev: total / n - spot.paid,
    turnCallShare: calls / n,
    turnBetBluff: qTb,
    turnCheckBluff: qTc,
    turnCards: byTurn.size,
    runouts: n,
  };
}
