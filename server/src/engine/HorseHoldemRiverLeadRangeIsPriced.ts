/**
 * HOLD'EM RIVER OOP LEAD RANGE, PRICED (option holdemRiverLeadRangeIsPriced, 2026-11-22,
 * Horse Switch lane; default OFF, read only as === true, dark/ungraded).
 *
 * THE BLANKET RULE IT PRICES (A4, riverLeadRange, REVIEW-HOLDEM-OFFLIST-20261121.md §5).
 * In single-board two-card no-limit hold'em, out-of-position river leads first-to-act into the
 * turn bettor (`riverLeadSpot`: villain bet turn, hero called OOP, nobody acted on the river yet)
 * currently execute `riverLeadRange` at two fixed/random blanket sites in `HorseLogic.ts`:
 *   1. Site 1 (`riverBluffBaseline`, `leadRange`): air hands (`equity < 0.25`) classify as
 *      `leadDraw` or `leadBlank` and draw random sizes (`riverBluffSize(..., u: fastRandom())`)
 *      and random coin flips (`fastRandom() < pRbT`).
 *   2. Site 2 (V11 initiative gate, `leadValueSpot`): on draw-completing rivers only, value
 *      hands roll fixed coin flips (`equity >= 0.80 -> 0.60`, `equity >= 0.70 -> 0.30`) and
 *      fall through to generic ladder sizing; thin-value leads (equity 0.55-0.70) vs passive
 *      check-back opponents and check-call/check-raise traps vs aggressive stabbers are unpriced.
 *
 * WHAT THIS MODULE DOES. Independently of `riverLeadRange`, with zero `fastRandom` / `Math.random`
 * coin flips and zero `opponentHud/` import coupling, it prices OOP river lead sizing
 * (`0.33x`, `0.55x`, `0.75x`, `1.0x` pot, stack-capped) against `EV(check)` using exact
 * probability-conserving quantile partitions over measured NLH empirical priors from
 * `holdemEmpiricalPriors.ts`:
 *   - `EV(check)` incorporates villain's street-specific `betWhenCheckedTo` rate
 *     (`estimateHoldemBetWhenCheckedTo('river', ...)` conditioned on draw-completion and
 *     opponent aggression/passivity), villain's measured river bluff share
 *     (`estimateHoldemRiverBluffShare`), and hero's best response facing a bet:
 *     `max(EV(check-fold), EV(check-call), EV(check-raise))` (with `estimateHoldemRiverFoldToRaise`
 *     and `holdemVillainRaiseCallPrice`).
 *   - `EV(lead_s)` prices all three villain response branches at every candidate size `s`:
 *       1. Villain folds (`pFold`, smooth piecewise-linear interpolation of
 *          `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET`, n = 15,623, with Empirical-Bayes
 *          shrinkage over structural HUD / `ExploitCounters` / `riverFoldRate`, plus
 *          air-bluff MDF selection-bias calibration, blocker/unblocker/scare conditioning,
 *          and calling-station discipline),
 *       2. Villain flat-calls (`pCall = 1 - pFold - pRaise`) with exact Bayes-conditioned
 *          equity `eqWhenCalled` over villain's flat-calling interval `[rBluff + pFold, 1 - rVal]`,
 *       3. Villain raises (`pRaise`, size- and aggression-sensitive; 0 when hero leads all-in)
 *          with exact equity against villain's polarized raising range and optimal fold-or-call.
 *   - Cleanly separates thin-value block leads (when villain checks back too often and calls
 *     worse) and draw-completing value/bluff leads from check-calls and check-raises (when
 *     villain stabs aggressively when checked to).
 *
 * SCOPE. Strictly dark & default OFF (`=== true`). Single-board 2-card NLH heads-up OOP river
 * leads into the turn aggressor (`riverLeadSpot`) only. Zero overlap with:
 *   - non-lead `riverBluffBaseline` / `holdemRiverBluffIsPriced` lines (`barrel`, `initiative`,
 *     `checkedThrough`, `opponentGaveUp`, `scare`),
 *   - `v87RiverBlockBetTrap` / `v87RiverBlockBetTrapIsPriced` (`initiative !== 'opp'`),
 *   - `holdemRiverFullHouseValue` / `holdemRiverFullHouseValueIsPriced` (qualifying river boats),
 *   - Omaha (PLO4/5/6, Hi-Lo), Short Deck, Fixed Limit, multi-board, bomb pot, All-In-or-Fold,
 *     or multiway pots.
 * Zero import dependency on `opponentHud/`.
 */
import type { ExploitCounters } from './HorseOpponentExploit.js';
import type { RiverBluffSelection } from './HorseRiverBluffRange.js';
import {
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET,
  HOLDEM_PRIOR_STRENGTH,
  empiricalBayesShrink,
  estimateHoldemBetWhenCheckedTo,
  estimateHoldemRiverBluffShare,
  estimateHoldemRiverFoldToRaise,
  holdemVillainRaiseCallPrice,
  readHudOpponentStat,
  type HoldemHudPacketOpponent,
  type HoldemPriorSource,
} from './holdemEmpiricalPriors.js';

export const HOLDEM_RIVER_LEAD_RANGE_PRICED_RECEIPTS = Object.freeze({
  valueLead: 'holdem_river_lead_range_priced_value_lead_seen',
  thinValueLead: 'holdem_river_lead_range_priced_thin_value_lead_seen',
  bluffLead: 'holdem_river_lead_range_priced_bluff_lead_seen',
  check: 'holdem_river_lead_range_priced_check_seen',
  illegal: 'holdem_river_lead_range_priced_illegal_seen',
} as const);

/** Deterministic candidate OOP river lead sizes as pot fractions (capped by effective stack / all-in). */
export const HOLDEM_RIVER_LEAD_CANDIDATE_FRACS: readonly number[] = Object.freeze([
  0.33, 0.55, 0.75, 1.0,
]);

/** Equity cutoff below which an OOP river lead is classified as an air bluff lead. */
export const HOLDEM_RIVER_LEAD_AIR_EQUITY = 0.25;

/** Equity cutoff at or above which a winning value lead is classified as strong value (below: thin value). */
export const HOLDEM_RIVER_LEAD_STRONG_VALUE_EQUITY = 0.75;

/** Air-bluff surplus-over-MDF retention factor (discounting value-heavy pool fold stats). */
export const HOLDEM_RIVER_LEAD_BLUFF_SURPLUS_RETENTION = 0.48;

/** Hard fold-probability ceiling for air bluff leads against a confirmed calling station. */
export const HOLDEM_RIVER_LEAD_STATION_BLUFF_FOLD_CAP = 0.24;

/** Severe tournament ICM risk threshold above which all-in bluff lead shoves are withheld. */
export const HOLDEM_RIVER_LEAD_ICM_NO_BLUFF_SHOVE_RISK = 0.05;

/** Prior strength for river first-bet fold shrinkage (matches riverFoldToRaise = 12). */
export const HOLDEM_RIVER_LEAD_FOLD_PRIOR_STRENGTH = 12;

/** Share of villain's river raises over an OOP lead that are bluffs (remaining 82% value). */
const VILLAIN_RAISE_BLUFF_SHARE = 0.18;

const EPS = 1e-9;

const clamp = (x: number, lo: number, hi: number): number =>
  Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;

/** Mass of `[lo, hi]` strictly below hero's quantile `eq` (exact conservation helper). */
function beatenMassInInterval(eq: number, lo: number, hi: number): number {
  const span = hi - lo;
  if (!(span > EPS)) return 0;
  return clamp(eq - lo, 0, span);
}

export interface HoldemRiverLeadRangePricedGateInput {
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
  inPosition: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  allInOrFold: boolean;
  satelliteActive: boolean;
  barrelOutlookRiverPending: boolean;
  holdemRiverFullHouseOwned: boolean;
  opponentsLive: number;
  opponentCanRespond: boolean;
  pot: number;
  heroStack: number;
  villainStack: number;
}

/**
 * Strict fail-closed structural gate for `holdemRiverLeadRangeIsPriced`.
 * Single-board 2-card NLH heads-up OOP river leads first-to-act only; zero reach to PLO4/5/6,
 * Hi-Lo, Short Deck, Fixed Limit, multi-board, bomb pot, All-In-or-Fold, multiway pots,
 * in-position spots, or `holdemRiverFullHouseValue`-owned river boats.
 */
export function holdemRiverLeadRangeIsPricedApplies(
  input: HoldemRiverLeadRangePricedGateInput
): boolean {
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
    input.inPosition === false &&
    !input.multiBoard &&
    !input.bombPot &&
    !input.allInOrFold &&
    !input.satelliteActive &&
    !input.barrelOutlookRiverPending &&
    !input.holdemRiverFullHouseOwned &&
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

/**
 * Smooth piecewise-linear NLH pool prior for villain fold frequency facing a RIVER FIRST BET
 * of pot-relative size `potFraction`, interpolated across the four measured empirical cells
 * in `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET` (n = 15,623 pooled NLH rivers).
 */
export function holdemRiverLeadFoldPrior(potFraction: number): number {
  const f = Number.isFinite(potFraction) ? Math.max(0, potFraction) : 0;
  const f0 = 0.25;
  const f1 = 0.5;
  const f2 = 0.83;
  const f3 = 1.25;
  const r0 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.le_33.rate;
  const r1 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
  const r2 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['67_100'].rate;
  const r3 = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET.gt_100.rate;
  let rate: number;
  if (f <= f0) {
    rate = r0 * (0.75 + 0.25 * (f / f0));
  } else if (f <= f1) {
    rate = r0 + ((r1 - r0) * (f - f0)) / (f1 - f0);
  } else if (f <= f2) {
    rate = r1 + ((r2 - r1) * (f - f1)) / (f2 - f1);
  } else if (f <= f3) {
    rate = r2 + ((r3 - r2) * (f - f2)) / (f3 - f2);
  } else {
    rate = r3 + Math.min(0.08, (f - f3) * 0.04);
  }
  return clamp(rate, 0.1, 0.92);
}

/**
 * Empirical-Bayes estimator for opponent fold frequency facing hero's OOP river lead,
 * reading structural `HudPacketOpponent` (`r.fb.sm|bg.hu` -> `r.fBet`) and falling back to
 * `ExploitCounters` (`riverCall` / `riverCallOpp`) and the measured NLH empirical pool prior.
 */
export function estimateHoldemRiverLeadFoldToBet(
  potFraction: number,
  hudOpp?: HoldemHudPacketOpponent | null,
  exploitCounters?: Pick<ExploitCounters, 'riverCall' | 'riverCallOpp'> | null
): {
  readonly mean: number;
  readonly prior: number;
  readonly source: HoldemPriorSource;
} {
  const prior = holdemRiverLeadFoldPrior(potFraction);
  const sz = potFraction > 0.7 + EPS ? 'bg' : 'sm';
  const ctxStat = readHudOpponentStat(hudOpp, `r.fb.${sz}.hu`);
  if (ctxStat) {
    const est = empiricalBayesShrink(
      ctxStat.hits,
      ctxStat.opportunities,
      prior,
      HOLDEM_RIVER_LEAD_FOLD_PRIOR_STRENGTH,
      'hud_context'
    );
    return { mean: est.mean, prior, source: est.source };
  }

  const baseMedPrior = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
  const scaleRelativeToMedium = (
    hits: number,
    opportunities: number,
    priorStrength: number,
    source: HoldemPriorSource
  ) => {
    const shrunk = empiricalBayesShrink(hits, opportunities, baseMedPrior, priorStrength, source);
    const ratio = baseMedPrior > EPS ? shrunk.mean / baseMedPrior : 1;
    return {
      mean: clamp(prior * ratio, 0.05, 0.92),
      prior,
      source: shrunk.source,
    };
  };

  const streetStat = readHudOpponentStat(hudOpp, 'r.fBet');
  if (streetStat) {
    return scaleRelativeToMedium(
      streetStat.hits,
      streetStat.opportunities,
      HOLDEM_RIVER_LEAD_FOLD_PRIOR_STRENGTH,
      'hud_street'
    );
  }
  if (exploitCounters && exploitCounters.riverCallOpp > 0) {
    const foldHits = Math.max(0, exploitCounters.riverCallOpp - exploitCounters.riverCall);
    return scaleRelativeToMedium(
      foldHits,
      exploitCounters.riverCallOpp,
      HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
      'exploit_counters'
    );
  }
  return { mean: prior, prior, source: 'pool_prior' };
}

export type HoldemRiverLeadKind = 'value' | 'thin_value' | 'bluff' | 'check';

export interface HoldemRiverLeadRangePricedInput {
  /** Pot at the start of hero's OOP river decision. */
  pot: number;
  /** Hero's remaining stack behind. */
  heroStack: number;
  /** Single live turn-aggressor opponent's effective stack behind (`opp.stack + opp.bet`). */
  villainStack: number;
  /** Table big blind (minimum legal non-all-in bet floor). */
  bigBlind: number;
  /** Hero's river showdown equity in [0, 1] against villain's read range. */
  showdownEquity: number;
  /** Whether the river card completed a flush or straight (`riverCompletedDraw(board, false)`). */
  completedDraw: 'flush' | 'straight' | null;
  /** River card completed a flush, straight, or paired the board. */
  scareCard: boolean;
  /** River card improved hero's range or gave hero the nut advantage. */
  riverHelpsHero: boolean;
  /** Runout or public ranges favor the turn bettor. */
  rangesFavorOpponent: boolean;
  /** Hero holds the nut blocker (top unseen flush card or top straight blocker). */
  nutBlocker: boolean;
  /** Hero holds zero cards of a two-suited board's missed flush suit (unblocks villain's folds). */
  unblocker: boolean;
  /** Hero held a flop/turn draw that bricked on the river. */
  missedDraw: boolean;
  /** Optional bluff combo selection classification for air hands. */
  selection?: Exclude<RiverBluffSelection, 'freeroll'>;
  /** Projected rake/jackpot deduction fraction on won pots in [0, 0.25]. */
  callDeductionFraction?: number;
  /** Tournament survival risk premium (0 in cash). */
  icmRisk?: number;
  /** Confirmed calling station (`isStation`, `fastCalldown.callingDown`, or `riverFoldRate < 0.35`). */
  station?: boolean;
  /** Confirmed aggressive / LAG / bully turn-bettor who stabs heavily when checked to. */
  villainAggressive?: boolean;
  /** Confirmed passive / tight-passive opponent who checks back rivers too often. */
  villainPassive?: boolean;
  /** `HorseMind.riverFoldRate` (possibly updated by `fastCalldownRead`), or null when unavailable. */
  riverFoldRate?: number | null;
  /** True when `fastCalldownRead` detected recent call-down tightening. */
  fastCalldownCallingMore?: boolean;
  /** Shown light-river-caller multiplier in [0.5, 1.0] (1 when neutral). */
  lightCallerFactor?: number;
  /** `HorseMind.exploit(...).bluffMod` (1 when neutral). */
  bluffMod?: number;
  /** Optional structural opponent HUD slice (zero import dependency on `opponentHud/`). */
  hudOpp?: HoldemHudPacketOpponent | null;
  /** Optional HorseMind ExploitCounters (`riverCall`, `betCheckedTo`) for smooth shrinkage. */
  exploitCounters?: Pick<
    ExploitCounters,
    'riverCall' | 'riverCallOpp' | 'betCheckedTo' | 'betCheckedToOpp'
  > | null;
  /** Optional HorseMind `styleSizeShown` `{ shown, strong }` for river bluff-share shrinkage. */
  styleSizeShown?: { readonly shown: number; readonly strong: number } | null;
}

export interface HoldemRiverLeadCandidateEval {
  readonly targetPotFrac: number;
  readonly actualPotFrac: number;
  readonly betAmount: number;
  readonly isAllIn: boolean;
  readonly rawEmpiricalFoldProb: number;
  readonly foldProb: number;
  readonly callProb: number;
  readonly raiseProb: number;
  readonly eqWhenCalled: number;
  readonly eqVsVillainRaise: number;
  readonly evFoldBranch: number;
  readonly evCallBranch: number;
  readonly evRaiseBranch: number;
  readonly ev: number;
  readonly riskMargin: number;
  readonly netEdge: number;
  readonly priorSource: HoldemPriorSource;
}

export interface HoldemRiverLeadCheckEval {
  readonly villainBetWhenCheckedTo: number;
  readonly betWhenCheckedToSource: HoldemPriorSource;
  readonly villainBetAmount: number;
  readonly villainBluffShare: number;
  readonly eqVsCheckBack: number;
  readonly eqVsVillainBet: number;
  readonly evCheckBack: number;
  readonly evCheckFold: number;
  readonly evCheckCall: number;
  readonly evCheckRaise: number;
  readonly bestCheckResponse: 'check_fold' | 'check_call' | 'check_raise';
  readonly evCheck: number;
}

export interface HoldemRiverLeadRangePricedVerdict {
  readonly decision: 'lead' | 'check';
  readonly kind: HoldemRiverLeadKind;
  readonly betPotFrac: number | null;
  readonly betAmount: number | null;
  readonly isAllIn: boolean;
  readonly checkEval: HoldemRiverLeadCheckEval;
  readonly evCheck: number;
  readonly evBestLead: number | null;
  readonly bestRiskMargin: number | null;
  readonly bestNetEdge: number | null;
  readonly candidates: readonly HoldemRiverLeadCandidateEval[];
}

function airSelectionFoldAdjustment(
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

function resolveSelection(
  input: HoldemRiverLeadRangePricedInput
): Exclude<RiverBluffSelection, 'freeroll'> {
  if (input.selection) return input.selection;
  if (input.nutBlocker && input.missedDraw) return 'blockerAndDraw';
  if (input.nutBlocker) return 'blocker';
  if (input.missedDraw) return 'missedDraw';
  return 'junk';
}

/**
 * Estimate villain's river `betWhenCheckedTo` rate after villain bet the turn and hero checks
 * OOP on the river, anchored on `estimateHoldemBetWhenCheckedTo('river', ...)` and conditioned
 * on draw completion and opponent aggression/passivity.
 */
export function conditionHoldemRiverVillainBetWhenCheckedTo(
  input: HoldemRiverLeadRangePricedInput
): {
  readonly betWhenCheckedTo: number;
  readonly source: HoldemPriorSource;
} {
  const est = estimateHoldemBetWhenCheckedTo('river', input.hudOpp, input.exploitCounters);
  let rate = est.mean;
  // Turn aggressor has initiative: bets more often on blank rivers, checks back much more often
  // when the river completed the OOP caller's flush or straight draw.
  if (input.completedDraw !== null) {
    rate -= 0.08;
  } else {
    rate += 0.06;
  }
  if (input.rangesFavorOpponent) rate += 0.05;
  if (input.riverHelpsHero) rate -= 0.04;
  if (input.villainAggressive === true) rate += 0.14;
  if (input.villainPassive === true || input.station === true) rate -= 0.09;
  return {
    betWhenCheckedTo: clamp(rate, 0.08, 0.82),
    source: est.source,
  };
}

/**
 * Evaluate `EV(check)` when hero checks OOP to the turn bettor on the river, using an exact
 * probability-conserving quantile partition into villain's check-back range and polarized
 * betting range (value top + bluff bottom), choosing hero's optimal response facing a bet
 * (`check_fold`, `check_call`, or `check_raise`).
 */
export function evaluateHoldemRiverOopCheck(
  input: HoldemRiverLeadRangePricedInput
): HoldemRiverLeadCheckEval {
  const pot = Math.max(0, Number.isFinite(input.pot) ? input.pot : 0);
  const heroStack = Math.max(0, Number.isFinite(input.heroStack) ? input.heroStack : 0);
  const villainStack = Math.max(0, Number.isFinite(input.villainStack) ? input.villainStack : 0);
  const effStack = Math.min(heroStack, villainStack);
  const bb = Number.isFinite(input.bigBlind) && input.bigBlind > 0 ? input.bigBlind : 1;
  const deduction = clamp(input.callDeductionFraction ?? 0, 0, 0.25);
  const eq = clamp(input.showdownEquity, 0, 1);

  const { betWhenCheckedTo, source } = conditionHoldemRiverVillainBetWhenCheckedTo(input);
  const villainBetFrac = input.completedDraw !== null ? 0.58 : 0.68;
  const villainBetAmount = Math.min(
    effStack,
    Math.max(Math.min(effStack, bb), pot * villainBetFrac)
  );

  const bluffEst = estimateHoldemRiverBluffShare(
    pot > EPS ? villainBetAmount / pot : villainBetFrac,
    input.hudOpp,
    input.styleSizeShown
  );
  let villainBluffShare = bluffEst.mean;
  if (input.villainAggressive === true) villainBluffShare += 0.09;
  if (input.villainPassive === true) villainBluffShare -= 0.06;
  if (input.completedDraw !== null) villainBluffShare -= 0.03;
  villainBluffShare = clamp(villainBluffShare, 0.06, 0.48);

  // Exact probability-conserving partition of [0, 1] under villain's check-or-bet strategy:
  //   - Villain bluffs:     [0, bluffMass]
  //   - Villain checks:     [bluffMass, 1 - valueMass]  (mass = 1 - betWhenCheckedTo)
  //   - Villain value-bets: [1 - valueMass, 1]
  const bluffMass = betWhenCheckedTo * villainBluffShare;
  const valueMass = betWhenCheckedTo * (1 - villainBluffShare);
  const checkMass = Math.max(EPS, 1 - betWhenCheckedTo);

  const eqVsCheckBack = clamp(beatenMassInInterval(eq, bluffMass, 1 - valueMass) / checkMass, 0, 1);
  const eqVsVillainBet = clamp(
    (beatenMassInInterval(eq, 0, bluffMass) + beatenMassInInterval(eq, 1 - valueMass, 1)) /
      Math.max(EPS, betWhenCheckedTo),
    0,
    1
  );

  const evCheckBack = eqVsCheckBack * pot * (1 - deduction);
  const evCheckFold = 0;
  const evCheckCall =
    eqVsVillainBet * (pot + 2 * villainBetAmount) * (1 - deduction) - villainBetAmount;

  // Check-raise option when hero can legally raise above villain's bet and holds strong equity.
  let evCheckRaise = -Infinity;
  const minRaiseDelta = Math.max(bb, villainBetAmount);
  if (effStack > villainBetAmount + minRaiseDelta * 0.5 && eq >= 0.72) {
    const xrTo = Math.min(
      effStack,
      Math.max(villainBetAmount + minRaiseDelta, pot + villainBetAmount * 1.5)
    );
    const xrAllIn = xrTo >= effStack - 1e-4;
    const vCallPrice = holdemVillainRaiseCallPrice(
      pot,
      xrTo,
      0,
      villainBetAmount,
      effStack,
      effStack
    );
    const xrFoldEst = estimateHoldemRiverFoldToRaise(
      { raiseKind: xrAllIn ? 'all_in_raise' : 'non_allin_raise', villainCallPrice: vCallPrice },
      input.hudOpp
    );
    const pFoldXr = clamp(xrFoldEst.mean, 0.12, 0.78);
    // Villain calls hero's check-raise with the top (1 - pFoldXr) of villain's betting range
    // (purely value hands from the top of [1 - valueMass, 1]).
    const xrCallMass = Math.max(EPS, betWhenCheckedTo * (1 - pFoldXr));
    const eqVsXrCall = clamp(beatenMassInInterval(eq, 1 - xrCallMass, 1) / xrCallMass, 0, 1);
    const xrRiskDiscount = 0.02 * xrTo;
    evCheckRaise =
      pFoldXr * (pot + villainBetAmount) * (1 - deduction) +
      (1 - pFoldXr) * (eqVsXrCall * (pot + 2 * xrTo) * (1 - deduction) - xrTo) -
      xrRiskDiscount;
  }

  let bestCheckResponse: 'check_fold' | 'check_call' | 'check_raise' = 'check_fold';
  let evFacingVillainBet = evCheckFold;
  if (evCheckCall > evFacingVillainBet + EPS) {
    evFacingVillainBet = evCheckCall;
    bestCheckResponse = 'check_call';
  }
  if (evCheckRaise > evFacingVillainBet + EPS) {
    evFacingVillainBet = evCheckRaise;
    bestCheckResponse = 'check_raise';
  }

  const evCheck = (1 - betWhenCheckedTo) * evCheckBack + betWhenCheckedTo * evFacingVillainBet;

  return {
    villainBetWhenCheckedTo: betWhenCheckedTo,
    betWhenCheckedToSource: source,
    villainBetAmount,
    villainBluffShare,
    eqVsCheckBack,
    eqVsVillainBet,
    evCheckBack,
    evCheckFold,
    evCheckCall,
    evCheckRaise: Number.isFinite(evCheckRaise) ? evCheckRaise : evCheckFold,
    bestCheckResponse,
    evCheck,
  };
}

/**
 * Compute conditioned villain fold and raise probabilities facing hero's OOP river lead of
 * pot-fraction `actualPotFrac`, integrating measured NLH empirical first-bet fold priors,
 * opponent reads, draw completion vs blank river credibility, air-bluff MDF calibration,
 * card removal, and calling-station discipline.
 */
export function conditionHoldemRiverLeadResponse(
  actualPotFrac: number,
  isAllIn: boolean,
  input: HoldemRiverLeadRangePricedInput
): {
  readonly rawEmpiricalFoldProb: number;
  readonly foldProb: number;
  readonly raiseProb: number;
  readonly callProb: number;
  readonly priorSource: HoldemPriorSource;
} {
  const f = Math.max(0, Number.isFinite(actualPotFrac) ? actualPotFrac : 0);
  const eq = clamp(input.showdownEquity, 0, 1);
  const isAir = eq < HOLDEM_RIVER_LEAD_AIR_EQUITY;

  const foldEst = estimateHoldemRiverLeadFoldToBet(f, input.hudOpp, input.exploitCounters);
  let empiricalFold = foldEst.mean;

  const baseMedPrior = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
  if (
    input.riverFoldRate != null &&
    Number.isFinite(input.riverFoldRate) &&
    (foldEst.source === 'pool_prior' || input.fastCalldownCallingMore === true)
  ) {
    const rfr = clamp(input.riverFoldRate, 0.05, 0.92);
    const sizeRatio = baseMedPrior > EPS ? holdemRiverLeadFoldPrior(f) / baseMedPrior : 1;
    const scaledRfr = clamp(rfr * sizeRatio, 0.05, 0.92);
    empiricalFold =
      input.fastCalldownCallingMore === true ? Math.min(empiricalFold, scaledRfr) : scaledRfr;
  }

  if (input.lightCallerFactor !== undefined && Number.isFinite(input.lightCallerFactor)) {
    empiricalFold *= clamp(input.lightCallerFactor, 0.55, 1.0);
  }
  if (
    isAir &&
    input.bluffMod !== undefined &&
    Number.isFinite(input.bluffMod) &&
    input.bluffMod > 0
  ) {
    empiricalFold *= clamp(0.5 + 0.5 * input.bluffMod, 0.72, 1.18);
  }
  empiricalFold = clamp(empiricalFold, 0.05, 0.92);

  let foldProb: number;
  if (isAir) {
    // Air-bluff leads: equilibrium-anchored selection-bias calibration + blocker/scare story.
    const mdf = f / (1 + f);
    const surplus = empiricalFold - mdf;
    const calibratedBase =
      surplus > 0 ? mdf + HOLDEM_RIVER_LEAD_BLUFF_SURPLUS_RETENTION * surplus : empiricalFold;
    const selection = resolveSelection(input);
    const hasNutBlocker =
      input.nutBlocker || selection === 'blocker' || selection === 'blockerAndDraw';
    const lineAdj = input.completedDraw !== null ? -0.02 : -0.17;
    const selAdj = airSelectionFoldAdjustment(selection, input.scareCard);
    const unblockerAdj = input.unblocker ? 0.03 : 0;
    const scareUnblockedAdj =
      input.scareCard && !hasNutBlocker && !input.riverHelpsHero ? -0.04 : 0;
    const rangeAdj = (input.riverHelpsHero ? 0.05 : 0) + (input.rangesFavorOpponent ? -0.09 : 0);
    const potBetPolarOk = hasNutBlocker || input.completedDraw !== null || input.riverHelpsHero;
    const sizeCredibilityPenalty = f >= 0.95 - EPS && !potBetPolarOk ? -0.05 : 0;
    foldProb =
      calibratedBase +
      lineAdj +
      selAdj +
      unblockerAdj +
      scareUnblockedAdj +
      rangeAdj +
      sizeCredibilityPenalty;
    if (input.station === true) {
      const scaled = foldEst.source === 'pool_prior' ? foldProb * 0.55 : foldProb;
      foldProb = Math.min(scaled, HOLDEM_RIVER_LEAD_STATION_BLUFF_FOLD_CAP);
    }
  } else {
    // Value / thin-value OOP leads: draw-completing rivers get slightly more folds than blank
    // rivers; calling stations call much wider at small/medium sizes while still folding more
    // as bet size grows toward pot (preserving bet-size elasticity and avoiding double-discounting
    // when HUD or ExploitCounters already measured the low fold rate).
    const drawAdj = input.completedDraw !== null ? 0.03 : -0.06;
    const rangeAdj = (input.riverHelpsHero ? 0.03 : 0) + (input.rangesFavorOpponent ? -0.05 : 0);
    foldProb = empiricalFold + drawAdj + rangeAdj;
    if (input.station === true) {
      const stationSizeCap = clamp(0.14 + 0.38 * f, 0.2, 0.56);
      const scaled = foldEst.source === 'pool_prior' ? foldProb * 0.65 : foldProb;
      foldProb = Math.min(scaled, stationSizeCap);
    }
  }
  foldProb = clamp(foldProb, 0.05, 0.86);

  // Villain raise probability facing hero's OOP river lead (0 when hero's lead is all-in).
  let raiseProb = 0;
  if (!isAllIn) {
    let rawRaise = clamp(0.105 - 0.05 * f, 0.03, 0.105);
    if (input.completedDraw !== null) rawRaise -= 0.015;
    else rawRaise += 0.02;
    if (input.rangesFavorOpponent) rawRaise += 0.02;
    if (input.villainAggressive === true) rawRaise *= 1.45;
    if (input.villainPassive === true || input.station === true) rawRaise *= 0.65;
    const hudRaise = readHudOpponentStat(input.hudOpp, 'r.raise');
    if (hudRaise) {
      rawRaise = empiricalBayesShrink(
        hudRaise.hits,
        hudRaise.opportunities,
        rawRaise,
        HOLDEM_RIVER_LEAD_FOLD_PRIOR_STRENGTH,
        'hud_street'
      ).mean;
    }
    const maxRaise = Math.max(0, Math.min(0.24, 0.92 - foldProb));
    raiseProb = clamp(rawRaise, 0.01, maxRaise);
  }

  const callProb = Math.max(0, 1 - foldProb - raiseProb);
  return {
    rawEmpiricalFoldProb: empiricalFold,
    foldProb,
    raiseProb,
    callProb,
    priorSource: foldEst.source,
  };
}

/**
 * Deterministic EV pricing across legal candidate OOP river lead sizes
 * (`0.33x`, `0.55x`, `0.75x`, `1.0x` pot, stack-capped) versus `EV(check)`.
 *
 * Returns `decision: 'lead'` ONLY when the highest net-EV legal lead size clears
 * `EV(check) + riskMargin`; otherwise returns `decision: 'check'` deterministically.
 */
export function holdemRiverLeadRangePricedVerdict(
  input: HoldemRiverLeadRangePricedInput
): HoldemRiverLeadRangePricedVerdict {
  const pot = Math.max(0, Number.isFinite(input.pot) ? input.pot : 0);
  const heroStack = Math.max(0, Number.isFinite(input.heroStack) ? input.heroStack : 0);
  const villainStack = Math.max(0, Number.isFinite(input.villainStack) ? input.villainStack : 0);
  const effStack = Math.min(heroStack, villainStack);
  const bb = Number.isFinite(input.bigBlind) && input.bigBlind > 0 ? input.bigBlind : 1;
  const deduction = clamp(input.callDeductionFraction ?? 0, 0, 0.25);
  const eq = clamp(input.showdownEquity, 0, 1);
  const isAir = eq < HOLDEM_RIVER_LEAD_AIR_EQUITY;
  const icmRisk = Math.max(0, Number.isFinite(input.icmRisk) ? (input.icmRisk as number) : 0);

  const checkEval = evaluateHoldemRiverOopCheck(input);
  const evCheck = checkEval.evCheck;

  if (!(pot > EPS) || !(effStack > EPS)) {
    return {
      decision: 'check',
      kind: 'check',
      betPotFrac: null,
      betAmount: null,
      isAllIn: false,
      checkEval,
      evCheck,
      evBestLead: null,
      bestRiskMargin: null,
      bestNetEdge: null,
      candidates: [],
    };
  }

  const minLegalBet = Math.min(effStack, bb);
  const uniqueSizes: Array<{ targetPotFrac: number; betAmount: number; isAllIn: boolean }> = [];
  for (const frac of HOLDEM_RIVER_LEAD_CANDIDATE_FRACS) {
    const betAmount = Math.min(effStack, Math.max(minLegalBet, pot * frac));
    if (!(betAmount > EPS)) continue;
    const isAllIn = betAmount >= effStack - 1e-4;
    if (uniqueSizes.some((s) => Math.abs(s.betAmount - betAmount) <= 1e-4)) continue;
    uniqueSizes.push({ targetPotFrac: frac, betAmount, isAllIn });
  }

  const candidates: HoldemRiverLeadCandidateEval[] = [];
  let best: HoldemRiverLeadCandidateEval | null = null;

  for (const cand of uniqueSizes) {
    const actualPotFrac = cand.betAmount / pot;
    const { rawEmpiricalFoldProb, foldProb, raiseProb, callProb, priorSource } =
      conditionHoldemRiverLeadResponse(actualPotFrac, cand.isAllIn, input);

    // Exact probability-conserving partition of [0, 1] under villain's response to hero's lead:
    //   - Villain bluff-raises: [0, rBluff]
    //   - Villain folds:        [rBluff, rBluff + foldProb]
    //   - Villain flat-calls:   [rBluff + foldProb, 1 - rVal]  (mass = callProb)
    //   - Villain value-raises: [1 - rVal, 1]
    const rBluff = raiseProb * VILLAIN_RAISE_BLUFF_SHARE;
    const rVal = raiseProb * (1 - VILLAIN_RAISE_BLUFF_SHARE);

    const eqWhenCalled =
      callProb > EPS
        ? clamp(beatenMassInInterval(eq, rBluff + foldProb, 1 - rVal) / callProb, 0, 1)
        : 0;
    const eqVsVillainRaise =
      raiseProb > EPS
        ? clamp(
            (beatenMassInInterval(eq, 0, rBluff) + beatenMassInInterval(eq, 1 - rVal, 1)) /
              raiseProb,
            0,
            1
          )
        : 0;

    const evFoldBranch = pot * (1 - deduction);
    const evCallBranch =
      eqWhenCalled * (pot + 2 * cand.betAmount) * (1 - deduction) - cand.betAmount;

    let evRaiseBranch = -cand.betAmount;
    if (raiseProb > EPS) {
      const vRaiseTo = Math.min(
        effStack,
        Math.max(cand.betAmount * 2.5, cand.betAmount + Math.max(minLegalBet, pot * 0.75))
      );
      const evCallRaise = eqVsVillainRaise * (pot + 2 * vRaiseTo) * (1 - deduction) - vRaiseTo;
      evRaiseBranch = Math.max(-cand.betAmount, evCallRaise);
    }

    const ev = foldProb * evFoldBranch + callProb * evCallBranch + raiseProb * evRaiseBranch;

    const riskMargin = isAir
      ? pot * (0.03 + 0.045 * actualPotFrac + 0.05 * actualPotFrac * actualPotFrac) +
        icmRisk * (pot + 2 * cand.betAmount) * 1.5
      : pot * (0.015 + 0.02 * actualPotFrac) + icmRisk * (pot + 2 * cand.betAmount) * 0.75;

    const netEdge = ev - evCheck - riskMargin;

    const entry: HoldemRiverLeadCandidateEval = {
      targetPotFrac: cand.targetPotFrac,
      actualPotFrac,
      betAmount: cand.betAmount,
      isAllIn: cand.isAllIn,
      rawEmpiricalFoldProb,
      foldProb,
      callProb,
      raiseProb,
      eqWhenCalled,
      eqVsVillainRaise,
      evFoldBranch,
      evCallBranch,
      evRaiseBranch,
      ev,
      riskMargin,
      netEdge,
      priorSource,
    };
    candidates.push(entry);

    if (isAir && cand.isAllIn && icmRisk >= HOLDEM_RIVER_LEAD_ICM_NO_BLUFF_SHOVE_RISK) continue;

    if (best === null || entry.netEdge > best.netEdge + EPS) {
      best = entry;
    }
  }

  if (best !== null && best.netEdge > EPS) {
    const kind: HoldemRiverLeadKind = isAir
      ? 'bluff'
      : eq >= HOLDEM_RIVER_LEAD_STRONG_VALUE_EQUITY
        ? 'value'
        : 'thin_value';
    return {
      decision: 'lead',
      kind,
      betPotFrac: best.actualPotFrac,
      betAmount: best.betAmount,
      isAllIn: best.isAllIn,
      checkEval,
      evCheck,
      evBestLead: best.ev,
      bestRiskMargin: best.riskMargin,
      bestNetEdge: best.netEdge,
      candidates,
    };
  }

  return {
    decision: 'check',
    kind: 'check',
    betPotFrac: null,
    betAmount: null,
    isAllIn: false,
    checkEval,
    evCheck,
    evBestLead: best?.ev ?? null,
    bestRiskMargin: best?.riskMargin ?? null,
    bestNetEdge: best?.netEdge ?? null,
    candidates,
  };
}
