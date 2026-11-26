/**
 * HOLD'EM RIVER BLUFF, PRICED (option holdemRiverBluffIsPriced, 2026-11-22,
 * Horse Switch lane; default OFF, read only as === true, dark/ungraded).
 *
 * THE BLANKET RULE IT PRICES (A2, riverBluffBaseline, REVIEW-HOLDEM-OFFLIST-20261121.md §5).
 * In single-board two-card no-limit hold'em, unopened / checked-to heads-up rivers with air
 * (equity < 0.25) and a coherent betting line currently execute `riverBluffBaseline`:
 *   1. Draws a random bet fraction via `riverBluffSize({ ..., u: fastRandom() })`,
 *   2. Computes a fixed-formula frequency `riverBluffProbability(...)`, and
 *   3. Flips a coin `fastRandom() < pRbT` (still bluffing 20% into confirmed calling stations
 *      and firing random-size bluffs with pure junk or blank-river donk leads).
 *
 * WHAT THIS MODULE DOES. Independently of `riverBluffBaseline`, with zero `fastRandom` or
 * hash-unit coin flips, it evaluates every legal candidate river bluff size
 * (`0.33x`, `0.55x`, `0.75x`, `1.0x`, `1.25x` pot, capped by effective stack / all-in) by
 * expected value against checking:
 *   - Estimates villain's river fold probability using `estimateHoldemRiverFoldToBet`
 *     (measured NLH empirical river first-bet fold priors with smooth Empirical-Bayes shrinkage
 *     over `HudPacketOpponent` / `ExploitCounters` / `HorseMind` reads), calibrated for air-hand
 *     selection bias vs MDF, line coherence (`barrel`, `opponentGaveUp`, `scare`, `initiative`,
 *     `checkedThrough`, `leadDraw`, `leadBlank`), card removal (`nutBlocker`, `unblocker`,
 *     `missedDraw`, `junk`), board-scare & range advantage, polar overbet credibility, and
 *     strict calling-station discipline.
 *   - Computes Bayes-conditioned equity when called (`eqWhenCalled`) and exact EV:
 *       EV(bluff_s) = foldProb * pot * (1 - d)
 *                     + (1 - foldProb) * (eqWhenCalled * (pot + 2 * bet) * (1 - d) - bet)
 *     (identically `eqWhenCalled * (pot + bet) - (1 - eqWhenCalled) * bet` at d = 0),
 *     compared against `EV(check) = showdownEquity * pot * (1 - d)`.
 *   - Chooses the highest net-EV legal bluff size ONLY when `EV(bestBluff) > EV(check) + riskMargin`,
 *     where `riskMargin` scales with bet size (variance/trap-risk hurdle) and tournament ICM risk;
 *     otherwise checks deterministically.
 *
 * SCOPE. Strictly dark & default OFF (`=== true`). Single-board 2-card NLH heads-up unopened /
 * checked-to river air bluffs only. Never overlaps with `v87RiverBlockBetTrapIsPriced` (river nut
 * traps), `v64RiverRaiseNeedsTwoPairIsPriced` (river raises facing a bet), or Omaha (PLO4/5/6,
 * Hi-Lo), Short Deck, Fixed Limit, multi-board, bomb pot, or All-In-or-Fold. Zero import
 * dependency on `opponentHud/` (preserves `OpponentHud.law.test.ts` and
 * `TheLifetimeHudConsumerIsTheOnlyDecisionReader.law.test.ts`).
 */
import type { ExploitCounters } from './HorseOpponentExploit.js';
import type { RiverBluffLine, RiverBluffSelection } from './HorseRiverBluffRange.js';
import {
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET,
  estimateHoldemRiverFoldToBet,
  holdemEmpiricalRiverFoldToBetPrior,
  type HoldemHudPacketOpponent,
  type HoldemPriorSource,
} from './holdemEmpiricalPriors.js';

export const HOLDEM_RIVER_BLUFF_PRICED_RECEIPTS = Object.freeze({
  bet: 'holdem_river_bluff_priced_bet_seen',
  overbet: 'holdem_river_bluff_priced_overbet_seen',
  check: 'holdem_river_bluff_priced_check_seen',
  stationCheck: 'holdem_river_bluff_priced_station_check_seen',
  illegal: 'holdem_river_bluff_priced_illegal_seen',
} as const);

/** Deterministic candidate river bluff sizes as fractions of pot (capped by effective stack / all-in). */
export const HOLDEM_RIVER_BLUFF_CANDIDATE_FRACS: readonly number[] = Object.freeze([
  0.33, 0.55, 0.75, 1.0, 1.25,
]);

/**
 * Positive pool-over-MDF surplus retention factor for air bluffs.
 * `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET` is measured over all river bets (77%-94% value),
 * where hero's value holdings block villain's calling range; air hands realize a discounted share
 * of the raw surplus before card-removal and line-story conditioning are applied.
 */
export const HOLDEM_RIVER_BLUFF_SURPLUS_RETENTION = 0.48;

/** Hard fold-probability ceiling against a confirmed calling station. */
export const HOLDEM_RIVER_BLUFF_STATION_FOLD_CAP = 0.24;

/** Severe tournament ICM risk threshold above which all-in bluff shoves are withheld. */
export const HOLDEM_RIVER_BLUFF_ICM_NO_SHOVE_RISK = 0.05;

const EPS = 1e-9;

const clamp = (x: number, lo: number, hi: number): number =>
  Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;

export interface HoldemRiverBluffPricedGateInput {
  enabled: unknown;
  isOmaha: boolean;
  isPotLimit: boolean;
  isHiLo: boolean;
  isShortDeck: boolean;
  isFixedLimit: boolean;
  holeCount: number;
  holeCardCount: number;
  boardLength: number;
  isRiver: boolean;
  facingBet: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  allInOrFold: boolean;
  satelliteActive: boolean;
  barrelOutlookRiverPending: boolean;
  opponentsLive: number;
  opponentCanRespond: boolean;
  pot: number;
  heroStack: number;
  villainStack: number;
}

/**
 * Strict fail-closed structural gate for `holdemRiverBluffIsPriced`.
 * Single-board 2-card NLH heads-up unopened / checked-to river only; zero reach to PLO4/5/6,
 * Hi-Lo, Short Deck, Fixed Limit, multi-board, bomb pot, All-In-or-Fold, or multiway pots.
 */
export function holdemRiverBluffIsPricedApplies(input: HoldemRiverBluffPricedGateInput): boolean {
  return (
    input.enabled === true &&
    input.isOmaha === false &&
    input.isPotLimit === false &&
    input.isHiLo === false &&
    input.isShortDeck === false &&
    input.isFixedLimit === false &&
    input.holeCount === 2 &&
    input.holeCardCount === 2 &&
    input.isRiver === true &&
    input.boardLength === 5 &&
    input.facingBet === false &&
    !input.multiBoard &&
    !input.bombPot &&
    !input.allInOrFold &&
    !input.satelliteActive &&
    !input.barrelOutlookRiverPending &&
    input.opponentsLive === 1 &&
    input.opponentCanRespond === true &&
    Number.isFinite(input.pot) &&
    input.pot > EPS &&
    Number.isFinite(input.heroStack) &&
    input.heroStack > EPS &&
    Number.isFinite(input.villainStack) &&
    input.villainStack > EPS
  );
}

export interface HoldemRiverBluffPricedInput {
  /** Pot at the start of hero's river decision. */
  pot: number;
  /** Hero's remaining stack behind. */
  heroStack: number;
  /** Single live opponent's effective stack behind (`opp.stack + opp.bet`). */
  villainStack: number;
  /** Table big blind (minimum legal non-all-in bet floor). */
  bigBlind: number;
  /** Hero's river showdown equity in [0, 1] against the read range. */
  showdownEquity: number;
  /** Coherent river bluff line classification from `riverBluffEligibility`. */
  line: RiverBluffLine;
  /** Combo selection classification from `riverBluffEligibility`. */
  selection: Exclude<RiverBluffSelection, 'freeroll'>;
  /** Hero holds the nut blocker (top unseen flush card or top straight blocker). */
  nutBlocker: boolean;
  /** Hero holds zero cards of a two-suited board's missed flush suit (unblocks villain's folds). */
  unblocker: boolean;
  /** Hero held a flop/turn draw that bricked on the river. */
  missedDraw: boolean;
  /** River card completed a flush, straight, or paired the board. */
  scareCard: boolean;
  /** River card improved hero's range or gave hero the nut advantage. */
  riverHelpsHero: boolean;
  /** Runout or public ranges favor the opponent. */
  rangesFavorOpponent: boolean;
  /** How many earlier-street hero bets this opponent already called. */
  calledBarrels: number;
  /** Projected rake/jackpot deduction fraction on won pots in [0, 0.25]. */
  callDeductionFraction?: number;
  /** Tournament survival risk premium (0 in cash). */
  icmRisk?: number;
  /** Confirmed calling station (`isStation`, `fastCalldown.callingDown`, or `riverFoldRate < 0.35`). */
  station?: boolean;
  /** `HorseMind.riverFoldRate` (possibly updated by `fastCalldownRead`), or null when unavailable. */
  riverFoldRate?: number | null;
  /** True when `fastCalldownRead` detected recent call-down tightening. */
  fastCalldownCallingMore?: boolean;
  /** Shown light-river-caller multiplier in [0.5, 1.0] (1 when neutral). */
  lightCallerFactor?: number;
  /** `HorseMind.exploit(...).bluffMod` (1 when neutral). */
  bluffMod?: number;
  /** Tight-passive checked-to multiplier (>= 1 when tight-passive opponent checked to hero). */
  tightCheckedTo?: number;
  /** Optional structural opponent HUD slice (zero import dependency on `opponentHud/`). */
  hudOpp?: HoldemHudPacketOpponent | null;
  /** Optional HorseMind ExploitCounters (`riverCall` / `riverCallOpp`) for smooth shrinkage. */
  exploitCounters?: Pick<ExploitCounters, 'riverCall' | 'riverCallOpp'> | null;
}

export interface HoldemRiverBluffCandidateEval {
  readonly targetPotFrac: number;
  readonly actualPotFrac: number;
  readonly betAmount: number;
  readonly isAllIn: boolean;
  readonly rawEmpiricalFoldProb: number;
  readonly foldProb: number;
  readonly eqWhenCalled: number;
  readonly ev: number;
  readonly riskMargin: number;
  readonly netEdge: number;
  readonly priorSource: HoldemPriorSource;
}

export interface HoldemRiverBluffPricedVerdict {
  readonly decision: 'bet' | 'check';
  readonly betPotFrac: number | null;
  readonly betAmount: number | null;
  readonly isAllIn: boolean;
  readonly evCheck: number;
  readonly evBestBluff: number | null;
  readonly bestRiskMargin: number | null;
  readonly bestNetEdge: number | null;
  readonly candidates: readonly HoldemRiverBluffCandidateEval[];
}

function lineFoldAdjustment(
  line: RiverBluffLine,
  calledBarrels: number,
  scareCard: boolean,
  riverHelpsHero: boolean
): number {
  switch (line) {
    case 'barrel':
      return calledBarrels >= 2 && !scareCard && !riverHelpsHero ? -0.1 : 0.02;
    case 'opponentGaveUp':
      return 0.04;
    case 'scare':
      return 0.03;
    case 'initiative':
      return 0.0;
    case 'checkedThrough':
      return -0.02;
    case 'leadDraw':
      return -0.04;
    case 'leadBlank':
      return -0.18;
    default:
      return -0.25;
  }
}

function selectionFoldAdjustment(
  selection: Exclude<RiverBluffSelection, 'freeroll'>,
  scareCard: boolean
): number {
  switch (selection) {
    case 'blockerAndDraw':
      return scareCard ? 0.11 : 0.07;
    case 'blocker':
      return scareCard ? 0.09 : 0.05;
    case 'missedDraw':
      return 0.02;
    case 'junk':
    default:
      return -0.1;
  }
}

/**
 * Compute conditioned villain fold probability for a candidate river bluff of pot-fraction
 * `actualPotFrac`, combining `estimateHoldemRiverFoldToBet`, opponent reads, line coherence,
 * card removal, board scare/range polarity, and calling-station discipline.
 */
export function conditionHoldemRiverBluffFoldProb(
  actualPotFrac: number,
  input: HoldemRiverBluffPricedInput
): {
  readonly rawEmpiricalFoldProb: number;
  readonly foldProb: number;
  readonly priorSource: HoldemPriorSource;
} {
  const f = Math.max(0, Number.isFinite(actualPotFrac) ? actualPotFrac : 0);
  const foldEst = estimateHoldemRiverFoldToBet(
    { potFraction: f, headsUp: true },
    input.hudOpp,
    input.exploitCounters
  );
  let empiricalFold = foldEst.mean;

  // Apply HorseMind riverFoldRate / fastCalldownRead when ExploitCounters/HUD did not supply
  // per-opponent river counts, or when fastCalldownRead flagged a live tightening shift.
  const baseMedPrior = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
  if (
    input.riverFoldRate != null &&
    Number.isFinite(input.riverFoldRate) &&
    (foldEst.source === 'pool_prior' || input.fastCalldownCallingMore === true)
  ) {
    const rfr = clamp(input.riverFoldRate, 0.05, 0.92);
    const sizeRatio = baseMedPrior > EPS ? holdemEmpiricalRiverFoldToBetPrior(f) / baseMedPrior : 1;
    const scaledRfr = clamp(rfr * sizeRatio, 0.05, 0.92);
    empiricalFold =
      input.fastCalldownCallingMore === true ? Math.min(empiricalFold, scaledRfr) : scaledRfr;
  }

  // Smooth opponent-read scaling (light callers, bluffMod, tight-passive checked-to).
  if (input.lightCallerFactor !== undefined && Number.isFinite(input.lightCallerFactor)) {
    empiricalFold *= clamp(input.lightCallerFactor, 0.55, 1.0);
  }
  if (input.bluffMod !== undefined && Number.isFinite(input.bluffMod) && input.bluffMod > 0) {
    empiricalFold *= clamp(0.5 + 0.5 * input.bluffMod, 0.72, 1.18);
  }
  if (
    input.tightCheckedTo !== undefined &&
    Number.isFinite(input.tightCheckedTo) &&
    input.tightCheckedTo > 1
  ) {
    empiricalFold *= clamp(1 + (input.tightCheckedTo - 1) * 0.35, 1.0, 1.15);
  }
  empiricalFold = clamp(empiricalFold, 0.05, 0.92);

  // Equilibrium-anchored selection-bias adjustment: discount positive pool-over-MDF surplus
  // (measured on value-heavy pool bets) while preserving sticky / below-MDF reads in full.
  const mdf = f / (1 + f);
  const surplus = empiricalFold - mdf;
  const calibratedBase =
    surplus > 0 ? mdf + HOLDEM_RIVER_BLUFF_SURPLUS_RETENTION * surplus : empiricalFold;

  const hasNutBlocker =
    input.nutBlocker || input.selection === 'blocker' || input.selection === 'blockerAndDraw';
  const lineAdj = lineFoldAdjustment(
    input.line,
    input.calledBarrels,
    input.scareCard,
    input.riverHelpsHero
  );
  const selAdj = selectionFoldAdjustment(input.selection, input.scareCard);
  const unblockerAdj = input.unblocker ? 0.03 : 0;
  const scareUnblockedAdj = input.scareCard && !hasNutBlocker && !input.riverHelpsHero ? -0.04 : 0;
  const rangeAdj = (input.riverHelpsHero ? 0.05 : 0) + (input.rangesFavorOpponent ? -0.1 : 0);

  // Large pot bets and overbets require a credible polar range story; non-polar overbets do not
  // realize the value-heavy >1.0x pool fold rate.
  const overbetPolarOk = hasNutBlocker && (input.scareCard || input.riverHelpsHero);
  const potBetPolarOk =
    hasNutBlocker || input.riverHelpsHero || input.line === 'barrel' || input.line === 'scare';
  const sizeCredibilityPenalty =
    (f > 1.0 + EPS && !overbetPolarOk ? -0.1 : 0) + (f >= 0.95 - EPS && !potBetPolarOk ? -0.05 : 0);

  let foldProb =
    calibratedBase +
    lineAdj +
    selAdj +
    unblockerAdj +
    scareUnblockedAdj +
    rangeAdj +
    sizeCredibilityPenalty;

  if (input.station === true) {
    foldProb = Math.min(foldProb * 0.55, HOLDEM_RIVER_BLUFF_STATION_FOLD_CAP);
  }

  return {
    rawEmpiricalFoldProb: empiricalFold,
    foldProb: clamp(foldProb, 0.05, 0.88),
    priorSource: foldEst.source,
  };
}

/**
 * Deterministic EV pricing across candidate legal NLH river bluff sizes
 * (`0.33x`, `0.55x`, `0.75x`, `1.0x`, `1.25x` pot, capped by effective stack / all-in)
 * versus checking (`EV(check) = showdownEquity * pot * (1 - d)`).
 *
 * Returns `decision: 'bet'` ONLY when the highest-EV legal bluff size clears `EV(check)` by
 * its risk-calibrated margin; otherwise returns `decision: 'check'` deterministically.
 */
export function holdemRiverBluffPricedVerdict(
  input: HoldemRiverBluffPricedInput
): HoldemRiverBluffPricedVerdict {
  const pot = Math.max(0, Number.isFinite(input.pot) ? input.pot : 0);
  const heroStack = Math.max(0, Number.isFinite(input.heroStack) ? input.heroStack : 0);
  const villainStack = Math.max(0, Number.isFinite(input.villainStack) ? input.villainStack : 0);
  const effStack = Math.min(heroStack, villainStack);
  const bb = Number.isFinite(input.bigBlind) && input.bigBlind > 0 ? input.bigBlind : 1;
  const deduction = clamp(input.callDeductionFraction ?? 0, 0, 0.25);
  const showdownEquity = clamp(input.showdownEquity, 0, 1);
  const icmRisk = Math.max(0, Number.isFinite(input.icmRisk) ? (input.icmRisk as number) : 0);
  const evCheck = showdownEquity * pot * (1 - deduction);

  if (!(pot > EPS) || !(effStack > EPS) || input.line === 'none') {
    return {
      decision: 'check',
      betPotFrac: null,
      betAmount: null,
      isAllIn: false,
      evCheck,
      evBestBluff: null,
      bestRiskMargin: null,
      bestNetEdge: null,
      candidates: [],
    };
  }

  const minLegalBet = Math.min(effStack, bb);
  const uniqueSizes: Array<{ targetPotFrac: number; betAmount: number; isAllIn: boolean }> = [];
  for (const frac of HOLDEM_RIVER_BLUFF_CANDIDATE_FRACS) {
    const rawBet = pot * frac;
    const betAmount = Math.min(effStack, Math.max(minLegalBet, rawBet));
    if (!(betAmount > EPS)) continue;
    const isAllIn = betAmount >= effStack - 1e-4;
    if (uniqueSizes.some((s) => Math.abs(s.betAmount - betAmount) <= 1e-4)) continue;
    uniqueSizes.push({ targetPotFrac: frac, betAmount, isAllIn });
  }

  const candidates: HoldemRiverBluffCandidateEval[] = [];
  let best: HoldemRiverBluffCandidateEval | null = null;

  for (const cand of uniqueSizes) {
    const actualPotFrac = cand.betAmount / pot;
    const { rawEmpiricalFoldProb, foldProb, priorSource } = conditionHoldemRiverBluffFoldProb(
      actualPotFrac,
      input
    );

    // Bayes-conditioned equity against villain's calling range (the top 1 - foldProb share).
    const pCall = Math.max(EPS, 1 - foldProb);
    const eqWhenCalled = clamp((showdownEquity - foldProb) / pCall, 0, showdownEquity);

    // Exact start-of-river EV:
    //   win pot when villain folds; when called, win (pot + bet) with eqWhenCalled else lose bet
    //   => eqWhenCalled * (pot + 2 * bet) * (1 - d) - bet.
    const ev =
      foldProb * pot * (1 - deduction) +
      (1 - foldProb) *
        (eqWhenCalled * (pot + 2 * cand.betAmount) * (1 - deduction) - cand.betAmount);

    // Risk-calibrated hurdle margin: scales gently with bet size (variance / trap risk) plus ICM.
    const riskMargin =
      pot * (0.035 + 0.05 * actualPotFrac + 0.06 * actualPotFrac * actualPotFrac) +
      icmRisk * (pot + 2 * cand.betAmount) * 1.5;

    const netEdge = ev - evCheck - riskMargin;
    const entry: HoldemRiverBluffCandidateEval = {
      targetPotFrac: cand.targetPotFrac,
      actualPotFrac,
      betAmount: cand.betAmount,
      isAllIn: cand.isAllIn,
      rawEmpiricalFoldProb,
      foldProb,
      eqWhenCalled,
      ev,
      riskMargin,
      netEdge,
      priorSource,
    };
    candidates.push(entry);

    // Under severe tournament ICM pressure, withhold all-in bluff shoves.
    if (cand.isAllIn && icmRisk >= HOLDEM_RIVER_BLUFF_ICM_NO_SHOVE_RISK) continue;

    if (best === null || entry.netEdge > best.netEdge + EPS) {
      best = entry;
    }
  }

  if (best !== null && best.netEdge > EPS) {
    return {
      decision: 'bet',
      betPotFrac: best.actualPotFrac,
      betAmount: best.betAmount,
      isAllIn: best.isAllIn,
      evCheck,
      evBestBluff: best.ev,
      bestRiskMargin: best.riskMargin,
      bestNetEdge: best.netEdge,
      candidates,
    };
  }

  return {
    decision: 'check',
    betPotFrac: null,
    betAmount: null,
    isAllIn: false,
    evCheck,
    evBestBluff: best?.ev ?? null,
    bestRiskMargin: best?.riskMargin ?? null,
    bestNetEdge: best?.netEdge ?? null,
    candidates,
  };
}
