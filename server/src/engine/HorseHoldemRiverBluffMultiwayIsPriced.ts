/**
 * HOLD'EM MULTIWAY RIVER BLUFF, PRICED (option holdemRiverBluffMultiwayIsPriced, 2026-11-22,
 * Horse Switch lane; default OFF, read only as === true, dark/ungraded).
 *
 * THE BLANKET RULE IT PRICES (A5, riverBluffMultiway, REVIEW-HOLDEM-OFFLIST-20261121.md §5).
 * In single-board two-card no-limit hold'em, unopened / checked-to multiway rivers
 * (`opponents >= 2`) with air (`equity < 0.5 / (N + 1)`, no hole pair), a nut blocker, and a
 * coherent capped-field story currently execute `riverBluffMultiway`:
 *   1. Hard-caps evaluation at 2 or 3 opponents (`n > 3` skipped as `too_many`),
 *   2. Draws a random bet fraction via `multiwayRiverBluffSize({ ..., u: fastRandom() })`,
 *   3. Computes a fixed-formula decay probability `multiwayRiverBluffProbability(...)`, and
 *   4. Flips a coin `fastRandom() < pMw` (still firing non-zero bluffs at 5% into confirmed
 *      calling stations and betting non-scare / barrel spots without pricing exact multiway
 *      fold equity against `EV(check)`).
 *
 * WHAT THIS MODULE DOES. Independently of `riverBluffMultiway`, with zero `fastRandom` or
 * `Math.random` coin flips and zero `opponentHud/` import coupling, it deterministically prices
 * every legal candidate multiway river bluff size (`0.50x`, `0.75x`, `1.00x`, `1.25x` pot,
 * stack-capped) against checking (`EV(check) = showdownEquity * pot * (1 - d)`):
 *   - Estimates each opponent `i`'s individual fold-to-bet probability `pFold_i` from the
 *     measured NLH empirical river first-bet fold curve
 *     (`HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET`, n = 15,623 pooled NLH rivers in
 *     `holdemEmpiricalPriors.ts`), with multiway bet-credibility context, equilibrium-anchored
 *     selection-bias surplus retention around the 3-way Nash per-opponent MDF
 *     `sqrt(f / (1 + f))`, and per-opponent Empirical-Bayes shrinkage against each opponent's
 *     observed calling tendency (`HudPacketOpponent` `r.fb.sm|bg.mw` / `r.fBet`,
 *     `ExploitCounters` `riverCall / riverCallOpp`, `HorseMind.riverFoldRate` /
 *     `fastCalldownRead`, and `lightCallerFactor`).
 *   - Compounds exact multiway fold equity across all `k >= 2` active opponents:
 *       pFoldAll = prod_{i=1..k} pFold_i
 *     naturally driving bluff profitability sharply down as active opponent count grows
 *     (`2 -> 3 -> 4+` opponents) without arbitrary hard cutoffs.
 *   - Conditions called-range equity `eqWhenCalled` on at least one of `k` opponents holding the
 *     top `1 - pFold_i` of their range and accounts for expected multi-caller pot geometry.
 *   - Enforces a strict calling-station veto: if ANY active opponent is a confirmed river
 *     calling station (`station`, `fastCalldown.callingDown`, or `riverFoldRate < 0.35`), that
 *     opponent's fold probability collapses (capped at 0.22) and the module deterministically
 *     returns `check`.
 *   - Chooses the highest net-EV legal bluff size ONLY when `EV(bestBluff) > EV(check) + riskMargin`,
 *     where `riskMargin` scales with bet size (variance / trap-risk hurdle) and tournament ICM
 *     protection (withholding all-in bluff shoves under severe ICM risk); otherwise checks
 *     deterministically.
 *
 * SCOPE. Strictly dark & default OFF (`=== true`). Single-board 2-card NLH unopened / checked-to
 * multiway rivers (`opponentsLive >= 2`) only. Zero overlap with:
 *   - HU river bluffs (`holdemRiverBluffIsPriced`, `opponentsLive === 1`),
 *   - HU OOP river leads (`holdemRiverLeadRangeIsPriced`),
 *   - HU river nut traps (`v87RiverBlockBetTrapIsPriced`),
 *   - facing-bet river raises (`v64RiverRaiseNeedsTwoPairIsPriced` / `v51RiverFlatIsPriced`),
 *   - river value hands (pairs / made hands / showdown equity >= air bar),
 *   - Omaha (PLO4/5/6, Hi-Lo), Short Deck, Fixed Limit, multi-board, bomb pot, or All-In-or-Fold.
 * Zero import dependency on `opponentHud/` (preserves `OpponentHud.law.test.ts` and
 * `TheLifetimeHudConsumerIsTheOnlyDecisionReader.law.test.ts`).
 */
import type {
  MultiwayRiverBluffLine,
  MultiwayRiverBluffSelection,
} from './HorseMultiwayRiverBluff.js';
import type { ExploitCounters } from './HorseOpponentExploit.js';
import {
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET,
  HOLDEM_PRIOR_STRENGTH,
  empiricalBayesShrink,
  readHudOpponentStat,
  type HoldemHudPacketOpponent,
  type HoldemPriorSource,
} from './holdemEmpiricalPriors.js';

export const HOLDEM_RIVER_BLUFF_MULTIWAY_PRICED_RECEIPTS = Object.freeze({
  bet: 'holdem_river_bluff_multiway_priced_bet_seen',
  overbet: 'holdem_river_bluff_multiway_priced_overbet_seen',
  check: 'holdem_river_bluff_multiway_priced_check_seen',
  stationCheck: 'holdem_river_bluff_multiway_priced_station_check_seen',
  illegal: 'holdem_river_bluff_multiway_priced_illegal_seen',
} as const);

/** Deterministic candidate multiway river bluff sizes as fractions of pot (stack-capped). */
export const HOLDEM_RIVER_BLUFF_MULTIWAY_CANDIDATE_FRACS: readonly number[] = Object.freeze([
  0.5, 0.75, 1.0, 1.25,
]);

/**
 * Positive pool-over-MDF surplus retention factor for multiway air bluffs.
 * `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET` is measured over all river bets (heavily
 * value-weighted), where value holdings block villains' calling ranges; multiway air bluffs
 * retain a discounted share of raw surplus above the 3-way Nash per-opponent MDF while sticky /
 * below-anchor reads are preserved in full.
 */
export const HOLDEM_RIVER_BLUFF_MULTIWAY_SURPLUS_RETENTION = 0.48;

/**
 * Per-opponent fold-probability credibility lift for betting into a multiway field (`k >= 2`).
 * Betting into 2+ live opponents represents a tighter value-weighted range than a HU river stab,
 * lifting each opponent's baseline fold tendency moderately while keeping `pFoldAll = prod_i pFold_i`
 * strictly exponentially decreasing in opponent count `k`.
 */
export const HOLDEM_RIVER_BLUFF_MULTIWAY_CREDIBILITY_LIFT = 0.04;

/** Hard single-opponent fold-probability ceiling when that opponent is a confirmed river station. */
export const HOLDEM_RIVER_BLUFF_MULTIWAY_STATION_FOLD_CAP = 0.22;

/** Measured river fold rate below which an opponent is treated as a confirmed river calling station. */
export const HOLDEM_RIVER_BLUFF_MULTIWAY_STATION_RFR_CUTOFF = 0.35;

/** Prior strength for per-opponent river first-bet fold Empirical-Bayes shrinkage. */
export const HOLDEM_RIVER_BLUFF_MULTIWAY_FOLD_PRIOR_STRENGTH = 12;

/** Severe tournament ICM risk threshold above which all-in multiway bluff shoves are withheld. */
export const HOLDEM_RIVER_BLUFF_MULTIWAY_ICM_NO_SHOVE_RISK = 0.05;

const EPS = 1e-9;

const clamp = (x: number, lo: number, hi: number): number =>
  Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;

export interface HoldemRiverBluffMultiwayPricedGateInput {
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
  allOpponentsCanRespond: boolean;
  pot: number;
  heroStack: number;
  effectiveVillainStack: number;
}

/**
 * Strict fail-closed structural gate for `holdemRiverBluffMultiwayIsPriced`.
 * Single-board 2-card NLH multiway (`opponentsLive >= 2`) unopened / checked-to river only;
 * zero reach to HU (`opponentsLive < 2`), PLO4/5/6, Hi-Lo, Short Deck, Fixed Limit, multi-board,
 * bomb pot, All-In-or-Fold, or facing-bet spots.
 */
export function holdemRiverBluffMultiwayIsPricedApplies(
  input: HoldemRiverBluffMultiwayPricedGateInput
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
    !input.multiBoard &&
    !input.bombPot &&
    !input.allInOrFold &&
    !input.satelliteActive &&
    !input.barrelOutlookRiverPending &&
    input.opponentsLive >= 2 &&
    input.allOpponentsCanRespond === true &&
    Number.isFinite(input.pot) &&
    input.pot > EPS &&
    Number.isFinite(input.heroStack) &&
    input.heroStack > EPS &&
    Number.isFinite(input.effectiveVillainStack) &&
    input.effectiveVillainStack > EPS
  );
}

/** Per-opponent read & HUD profile for multiway river bluff fold-equity compounding. */
export interface HoldemMultiwayOpponentProfile {
  /** Confirmed calling station (`isStation`, low fold-to-bet engagement, or `fastCalldown.callingDown`). */
  station?: boolean;
  /** `HorseMind.riverFoldRate` (possibly updated by `fastCalldownRead`), or null without sample. */
  riverFoldRate?: number | null;
  /** True when `fastCalldownRead` detected recent call-down tightening. */
  fastCalldownCallingMore?: boolean;
  /** True when `fastCalldownRead` classified this opponent as actively calling down. */
  fastCalldownCallingDown?: boolean;
  /** Shown light-river-caller multiplier in [0.55, 1.0] (1 when neutral). */
  lightCallerFactor?: number;
  /** Optional structural opponent HUD slice (zero import dependency on `opponentHud/`). */
  hudOpp?: HoldemHudPacketOpponent | null;
  /** Optional HorseMind ExploitCounters (`riverCall` / `riverCallOpp`) for smooth EB shrinkage. */
  exploitCounters?: Pick<ExploitCounters, 'riverCall' | 'riverCallOpp'> | null;
}

export interface HoldemRiverBluffMultiwayPricedInput {
  /** Pot at the start of hero's multiway river decision. */
  pot: number;
  /** Hero's remaining stack behind. */
  heroStack: number;
  /** Deepest live opponent's effective stack behind (`max(opp.stack + opp.bet)`). */
  effectiveVillainStack: number;
  /** Table big blind (minimum legal non-all-in bet floor). */
  bigBlind: number;
  /** Hero's river showdown equity in [0, 1] against the live multiway field. */
  showdownEquity: number;
  /** Coherent multiway river bluff line classification from `multiwayRiverBluffLine`. */
  line: MultiwayRiverBluffLine;
  /** Card-removal / missed-draw classification (`blocker`, `blockerAndDraw`, or `none`). */
  selection: MultiwayRiverBluffSelection;
  /** Hero holds the nut blocker (top unseen flush card or top straight blocker). */
  nutBlocker: boolean;
  /** Hero holds zero cards of a two-suited board's missed flush suit (unblocks folds). */
  unblocker: boolean;
  /** Hero acts last on the river. */
  inPosition: boolean;
  /** River card completed a flush, straight, or paired the board. */
  scareCard: boolean;
  /** River card improved hero's range or gave hero the nut advantage. */
  riverHelpsHero: boolean;
  /** Runout or public ranges favor the opponents. */
  rangesFavorOpponent: boolean;
  /** Per-opponent profiles for every live opponent in the pot (length >= 2). */
  opponents: readonly HoldemMultiwayOpponentProfile[];
  /** Projected rake/jackpot deduction fraction on won pots in [0, 0.25]. */
  callDeductionFraction?: number;
  /** Tournament survival risk premium (0 in cash). */
  icmRisk?: number;
  /** `HorseMind.exploit(...).bluffMod` (1 when neutral). */
  bluffMod?: number;
}

export interface HoldemMultiwayOpponentFoldEval {
  readonly rawEmpiricalFoldProb: number;
  readonly foldProb: number;
  readonly isStation: boolean;
  readonly priorSource: HoldemPriorSource;
}

export interface HoldemRiverBluffMultiwayCandidateEval {
  readonly targetPotFrac: number;
  readonly actualPotFrac: number;
  readonly betAmount: number;
  readonly isAllIn: boolean;
  readonly perOpponent: readonly HoldemMultiwayOpponentFoldEval[];
  /** Exact multiway compounding product `prod_{i=1..k} pFold_i`. */
  readonly pFoldAll: number;
  /** Expected number of callers given at least one opponent calls (`>= 1`). */
  readonly expectedCallers: number;
  /** Multiway Bayes-conditioned equity when called by at least one opponent. */
  readonly eqWhenCalled: number;
  readonly ev: number;
  readonly riskMargin: number;
  readonly netEdge: number;
}

export interface HoldemRiverBluffMultiwayPricedVerdict {
  readonly decision: 'bet' | 'check';
  readonly betPotFrac: number | null;
  readonly betAmount: number | null;
  readonly isAllIn: boolean;
  readonly stationVetoed: boolean;
  readonly opponentCount: number;
  readonly evCheck: number;
  readonly evBestBluff: number | null;
  readonly bestPFoldAll: number | null;
  readonly bestRiskMargin: number | null;
  readonly bestNetEdge: number | null;
  readonly candidates: readonly HoldemRiverBluffMultiwayCandidateEval[];
}

/**
 * Smooth piecewise-linear NLH pool prior for single-opponent fold frequency facing a RIVER FIRST BET
 * of pot-relative size `potFraction`, interpolated across the four measured empirical cells in
 * `HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET` (n = 15,623 pooled NLH rivers).
 */
export function holdemRiverMultiwaySmoothFoldPrior(potFraction: number): number {
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

/** True when an individual opponent is a confirmed river calling station. */
export function isHoldemMultiwayOpponentStation(opp: HoldemMultiwayOpponentProfile): boolean {
  if (opp.station === true || opp.fastCalldownCallingDown === true) return true;
  if (
    opp.riverFoldRate != null &&
    Number.isFinite(opp.riverFoldRate) &&
    opp.riverFoldRate < HOLDEM_RIVER_BLUFF_MULTIWAY_STATION_RFR_CUTOFF
  ) {
    return true;
  }
  return false;
}

/**
 * Per-opponent Empirical-Bayes estimator for river fold frequency facing hero's multiway river bet.
 * Preference order:
 *   1. Structural `HudPacketOpponent` multiway river stat (`r.fb.sm|bg.mw`, k = 12),
 *   2. Structural `HudPacketOpponent` street river stat (`r.fBet`, scaled to size curve, k = 12),
 *   3. `HorseMind` `ExploitCounters` (`riverCall` / `riverCallOpp`, scaled to size curve, k = 6),
 *   4. Smooth NLH empirical pool prior (`HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET`).
 * Subsequently integrates `HorseMind.riverFoldRate` / `fastCalldownRead` and `lightCallerFactor`.
 */
export function estimateHoldemMultiwayOpponentRiverFold(
  potFraction: number,
  opp: HoldemMultiwayOpponentProfile
): {
  readonly mean: number;
  readonly prior: number;
  readonly source: HoldemPriorSource;
} {
  const f = Math.max(0, Number.isFinite(potFraction) ? potFraction : 0);
  const prior = holdemRiverMultiwaySmoothFoldPrior(f);
  const sz = f > 0.7 + EPS ? 'bg' : 'sm';

  let mean = prior;
  let source: HoldemPriorSource = 'pool_prior';

  const ctxStat = readHudOpponentStat(opp.hudOpp, `r.fb.${sz}.mw`);
  if (ctxStat) {
    const est = empiricalBayesShrink(
      ctxStat.hits,
      ctxStat.opportunities,
      prior,
      HOLDEM_RIVER_BLUFF_MULTIWAY_FOLD_PRIOR_STRENGTH,
      'hud_context'
    );
    mean = est.mean;
    source = est.source;
  } else {
    const baseMedPrior = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
    const scaleRelativeToMedium = (
      hits: number,
      opportunities: number,
      priorStrength: number,
      src: HoldemPriorSource
    ) => {
      const shrunk = empiricalBayesShrink(hits, opportunities, baseMedPrior, priorStrength, src);
      const ratio = baseMedPrior > EPS ? shrunk.mean / baseMedPrior : 1;
      return {
        mean: clamp(prior * ratio, 0.05, 0.92),
        source: shrunk.source,
      };
    };

    const streetStat = readHudOpponentStat(opp.hudOpp, 'r.fBet');
    if (streetStat) {
      const res = scaleRelativeToMedium(
        streetStat.hits,
        streetStat.opportunities,
        HOLDEM_RIVER_BLUFF_MULTIWAY_FOLD_PRIOR_STRENGTH,
        'hud_street'
      );
      mean = res.mean;
      source = res.source;
    } else if (opp.exploitCounters && opp.exploitCounters.riverCallOpp > 0) {
      const foldHits = Math.max(
        0,
        opp.exploitCounters.riverCallOpp - opp.exploitCounters.riverCall
      );
      const res = scaleRelativeToMedium(
        foldHits,
        opp.exploitCounters.riverCallOpp,
        HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
        'exploit_counters'
      );
      mean = res.mean;
      source = res.source;
    }
  }

  const baseMedPrior = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
  if (
    opp.riverFoldRate != null &&
    Number.isFinite(opp.riverFoldRate) &&
    (source === 'pool_prior' || opp.fastCalldownCallingMore === true)
  ) {
    const rfr = clamp(opp.riverFoldRate, 0.05, 0.92);
    const sizeRatio = baseMedPrior > EPS ? prior / baseMedPrior : 1;
    const scaledRfr = clamp(rfr * sizeRatio, 0.05, 0.92);
    mean = opp.fastCalldownCallingMore === true ? Math.min(mean, scaledRfr) : scaledRfr;
  }

  if (opp.lightCallerFactor !== undefined && Number.isFinite(opp.lightCallerFactor)) {
    mean *= clamp(opp.lightCallerFactor, 0.55, 1.0);
  }

  return {
    mean: clamp(mean, 0.05, 0.92),
    prior,
    source,
  };
}

function multiwayLineFoldAdjustment(
  line: MultiwayRiverBluffLine,
  scareCard: boolean,
  riverHelpsHero: boolean
): number {
  switch (line) {
    case 'checkedThrough':
      return 0.03;
    case 'initiative':
      return 0.03;
    case 'scare':
      return 0.02;
    case 'opponentGaveUp':
      return -0.01;
    case 'barrel':
      return scareCard || riverHelpsHero ? 0.01 : -0.02;
    case 'none':
    default:
      return -0.25;
  }
}

function multiwaySelectionFoldAdjustment(
  selection: MultiwayRiverBluffSelection,
  nutBlocker: boolean,
  scareCard: boolean
): number {
  if (!nutBlocker && selection === 'none') return -0.12;
  switch (selection) {
    case 'blockerAndDraw':
      return scareCard ? 0.07 : 0.04;
    case 'blocker':
      return scareCard ? 0.06 : 0.03;
    case 'none':
    default:
      return nutBlocker ? (scareCard ? 0.06 : 0.03) : -0.12;
  }
}

/**
 * Condition one individual opponent's fold probability facing hero's multiway river bet of
 * pot-fraction `actualPotFrac`, applying multiway context, selection-bias surplus retention
 * anchored at the 3-way Nash per-opponent MDF `sqrt(f / (1 + f))`, line/blocker/range/position
 * conditioning, overbet polarity, and strict calling-station capping.
 */
export function conditionHoldemMultiwayOpponentFoldProb(
  actualPotFrac: number,
  opp: HoldemMultiwayOpponentProfile,
  input: Pick<
    HoldemRiverBluffMultiwayPricedInput,
    | 'line'
    | 'selection'
    | 'nutBlocker'
    | 'unblocker'
    | 'inPosition'
    | 'scareCard'
    | 'riverHelpsHero'
    | 'rangesFavorOpponent'
    | 'bluffMod'
  >
): HoldemMultiwayOpponentFoldEval {
  const f = Math.max(0, Number.isFinite(actualPotFrac) ? actualPotFrac : 0);
  const est = estimateHoldemMultiwayOpponentRiverFold(f, opp);
  const station = isHoldemMultiwayOpponentStation(opp);

  let empiricalFold = est.mean + (station ? 0 : HOLDEM_RIVER_BLUFF_MULTIWAY_CREDIBILITY_LIFT);
  if (input.bluffMod !== undefined && Number.isFinite(input.bluffMod) && input.bluffMod > 0) {
    empiricalFold *= clamp(0.5 + 0.5 * input.bluffMod, 0.72, 1.18);
  }
  empiricalFold = clamp(empiricalFold, 0.05, 0.92);

  // Equilibrium-anchored selection-bias surplus retention around the 3-way Nash per-opponent MDF:
  // positive surplus above sqrt(f / (1 + f)) is discounted for air selection bias while sticky /
  // below-anchor reads are preserved in full.
  const perOppMdfAnchor = Math.sqrt(f / (1 + f));
  const surplus = empiricalFold - perOppMdfAnchor;
  const calibratedBase =
    surplus > 0
      ? perOppMdfAnchor + HOLDEM_RIVER_BLUFF_MULTIWAY_SURPLUS_RETENTION * surplus
      : empiricalFold;

  const hasNutBlocker =
    input.nutBlocker || input.selection === 'blocker' || input.selection === 'blockerAndDraw';
  const lineAdj = multiwayLineFoldAdjustment(input.line, input.scareCard, input.riverHelpsHero);
  const selAdj = multiwaySelectionFoldAdjustment(input.selection, hasNutBlocker, input.scareCard);
  const unblockerAdj = input.unblocker ? 0.02 : 0;
  const rangeAdj = (input.riverHelpsHero ? 0.03 : 0) + (input.rangesFavorOpponent ? -0.07 : 0);
  const posAdj = input.inPosition ? 0 : -0.03;

  const overbetPolarOk = hasNutBlocker && (input.scareCard || input.riverHelpsHero);
  const sizeCredibilityPenalty =
    (f > 1.0 + EPS && !overbetPolarOk ? -0.08 : 0) +
    (f >= 0.95 - EPS && !hasNutBlocker ? -0.05 : 0);

  let foldProb =
    calibratedBase + lineAdj + selAdj + unblockerAdj + rangeAdj + posAdj + sizeCredibilityPenalty;

  if (station) {
    foldProb = Math.min(foldProb * 0.5, HOLDEM_RIVER_BLUFF_MULTIWAY_STATION_FOLD_CAP);
  }

  return {
    rawEmpiricalFoldProb: empiricalFold,
    foldProb: clamp(foldProb, 0.04, 0.88),
    isStation: station,
    priorSource: est.source,
  };
}

/**
 * Multiway Bayes-conditioned equity when hero's river bluff is called by at least one of `k`
 * opponents (who each call with the top `1 - pFold_i` of their range).
 *
 * The joint fold mass `pFoldAll = prod_i pFold_i` occupies the weakest slice of the joint field
 * range where hero's showdown wins are concentrated; remaining showdown equity in the called
 * region is bounded by `max(0, showdownEquity - pFoldAll) / (1 - pFoldAll)` and further
 * attenuated by `1 / sqrt(expectedCallers)` when multiple opponents are expected to call
 * simultaneously. Always satisfies `0 <= eqWhenCalled <= showdownEquity`.
 */
export function computeHoldemMultiwayEqWhenCalled(
  showdownEquity: number,
  pFoldAll: number,
  expectedCallers: number
): number {
  const eq = clamp(showdownEquity, 0, 1);
  const fAll = clamp(pFoldAll, 0, 1 - EPS);
  const pCalled = Math.max(EPS, 1 - fAll);
  const base = clamp((eq - fAll) / pCalled, 0, eq);
  const callers = Math.max(1, Number.isFinite(expectedCallers) ? expectedCallers : 1);
  return clamp(base / Math.sqrt(callers), 0, eq);
}

/**
 * Deterministic EV pricing across candidate legal multiway NLH river bluff sizes
 * (`0.50x`, `0.75x`, `1.00x`, `1.25x` pot, stack-capped) versus checking
 * (`EV(check) = showdownEquity * pot * (1 - d)`).
 *
 * Uses exact multiway compounding `pFoldAll = prod_{i=1..k} pFold_i`, multiway called-range
 * equity, strict calling-station veto (if ANY opponent is a confirmed river station), and
 * risk-calibrated + ICM-protected margins. Returns `decision: 'bet'` ONLY when no station veto
 * applies and the highest net-EV legal bluff size clears `EV(check) + riskMargin`; otherwise
 * returns `decision: 'check'` deterministically.
 */
export function holdemRiverBluffMultiwayPricedVerdict(
  input: HoldemRiverBluffMultiwayPricedInput
): HoldemRiverBluffMultiwayPricedVerdict {
  const pot = Math.max(0, Number.isFinite(input.pot) ? input.pot : 0);
  const heroStack = Math.max(0, Number.isFinite(input.heroStack) ? input.heroStack : 0);
  const villainStack = Math.max(
    0,
    Number.isFinite(input.effectiveVillainStack) ? input.effectiveVillainStack : 0
  );
  const effStack = Math.min(heroStack, villainStack);
  const bb = Number.isFinite(input.bigBlind) && input.bigBlind > 0 ? input.bigBlind : 1;
  const deduction = clamp(input.callDeductionFraction ?? 0, 0, 0.25);
  const showdownEquity = clamp(input.showdownEquity, 0, 1);
  const icmRisk = Math.max(0, Number.isFinite(input.icmRisk) ? (input.icmRisk as number) : 0);
  const evCheck = showdownEquity * pot * (1 - deduction);
  const opponentCount = input.opponents.length;
  const stationVetoed = input.opponents.some(isHoldemMultiwayOpponentStation);

  if (!(pot > EPS) || !(effStack > EPS) || input.line === 'none' || opponentCount < 2) {
    return {
      decision: 'check',
      betPotFrac: null,
      betAmount: null,
      isAllIn: false,
      stationVetoed,
      opponentCount,
      evCheck,
      evBestBluff: null,
      bestPFoldAll: null,
      bestRiskMargin: null,
      bestNetEdge: null,
      candidates: [],
    };
  }

  const minLegalBet = Math.min(effStack, bb);
  const uniqueSizes: Array<{ targetPotFrac: number; betAmount: number; isAllIn: boolean }> = [];
  for (const frac of HOLDEM_RIVER_BLUFF_MULTIWAY_CANDIDATE_FRACS) {
    const rawBet = pot * frac;
    const betAmount = Math.min(effStack, Math.max(minLegalBet, rawBet));
    if (!(betAmount > EPS)) continue;
    const isAllIn = betAmount >= effStack - 1e-4;
    if (uniqueSizes.some((s) => Math.abs(s.betAmount - betAmount) <= 1e-4)) continue;
    uniqueSizes.push({ targetPotFrac: frac, betAmount, isAllIn });
  }

  const candidates: HoldemRiverBluffMultiwayCandidateEval[] = [];
  let best: HoldemRiverBluffMultiwayCandidateEval | null = null;

  for (const cand of uniqueSizes) {
    const actualPotFrac = cand.betAmount / pot;
    const perOpponent: HoldemMultiwayOpponentFoldEval[] = [];
    let pFoldAll = 1;
    let sumCallProbs = 0;

    for (const opp of input.opponents) {
      const evalOpp = conditionHoldemMultiwayOpponentFoldProb(actualPotFrac, opp, input);
      perOpponent.push(evalOpp);
      pFoldAll *= evalOpp.foldProb;
      sumCallProbs += 1 - evalOpp.foldProb;
    }

    const pCalled = Math.max(EPS, 1 - pFoldAll);
    const expectedCallers = Math.max(1, sumCallProbs / pCalled);
    const eqWhenCalled = computeHoldemMultiwayEqWhenCalled(
      showdownEquity,
      pFoldAll,
      expectedCallers
    );

    // Exact multiway river EV:
    //   all fold => win pot * (1 - d);
    //   at least one calls => win (pot + (1 + expectedCallers) * bet) * (1 - d) - bet with eqWhenCalled,
    //                         else lose bet.
    const ev =
      pFoldAll * pot * (1 - deduction) +
      (1 - pFoldAll) *
        (eqWhenCalled * (pot + (1 + expectedCallers) * cand.betAmount) * (1 - deduction) -
          cand.betAmount);

    // Risk-calibrated hurdle margin: scales with bet size (variance / trap risk) + tournament ICM.
    const riskMargin =
      pot * (0.04 + 0.055 * actualPotFrac + 0.065 * actualPotFrac * actualPotFrac) +
      icmRisk * (pot + 2 * cand.betAmount) * 1.5;

    const netEdge = ev - evCheck - riskMargin;
    const entry: HoldemRiverBluffMultiwayCandidateEval = {
      targetPotFrac: cand.targetPotFrac,
      actualPotFrac,
      betAmount: cand.betAmount,
      isAllIn: cand.isAllIn,
      perOpponent,
      pFoldAll,
      expectedCallers,
      eqWhenCalled,
      ev,
      riskMargin,
      netEdge,
    };
    candidates.push(entry);

    // Strict calling-station veto: never bluff into any confirmed river calling station.
    if (stationVetoed) continue;

    // Under severe tournament ICM pressure, withhold all-in multiway bluff shoves.
    if (cand.isAllIn && icmRisk >= HOLDEM_RIVER_BLUFF_MULTIWAY_ICM_NO_SHOVE_RISK) continue;

    if (netEdge > EPS && (best === null || netEdge > best.netEdge + EPS)) {
      best = entry;
    }
  }

  if (best !== null) {
    return {
      decision: 'bet',
      betPotFrac: best.actualPotFrac,
      betAmount: best.betAmount,
      isAllIn: best.isAllIn,
      stationVetoed: false,
      opponentCount,
      evCheck,
      evBestBluff: best.ev,
      bestPFoldAll: best.pFoldAll,
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
    stationVetoed,
    opponentCount,
    evCheck,
    evBestBluff: null,
    bestPFoldAll: null,
    bestRiskMargin: null,
    bestNetEdge: null,
    candidates,
  };
}
