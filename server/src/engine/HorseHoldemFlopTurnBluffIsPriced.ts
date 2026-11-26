/**
 * HOLD'EM FLOP & TURN BLUFF, PRICED (option holdemFlopTurnBluffIsPriced, 2026-11-22,
 * Horse Switch lane; default OFF, read only as === true, dark/ungraded).
 *
 * THE BLANKET RULE IT PRICES (A3, flopTurnBluffBaseline, REVIEW-HOLDEM-OFFLIST-20261121.md §5).
 * In single-board two-card no-limit hold'em, unopened / checked-to flop and turn spots with
 * qualified bluff / semi-bluff candidates (`strongDraw`, `pairDraw`, `weakDraw`, `backdoor`,
 * `overcards`, `blocker`) on a coherent betting line (`cbet`, `barrel`, `delayed`, `probe`,
 * `stab`) currently execute `flopTurnBluffBaseline`:
 *   1. Draws a random bet fraction via `flopTurnBluffSize({ ..., u: fastRandom() })`,
 *   2. Computes a fixed-formula frequency `flopTurnBluffProbability(...)`, and
 *   3. Flips a coin `fastRandom() < pFtUse` (still bluffing 25%-55% into confirmed calling
 *      stations and firing random-size bluffs/barrels without pricing fold equity vs check EV).
 *
 * WHAT THIS MODULE DOES. Independently of `flopTurnBluffBaseline`, with zero `fastRandom` or
 * `Math.random` coin flips, it evaluates every legal candidate flop/turn bet size
 * (`0.33x`, `0.55x`, `0.75x`, `1.0x` pot, capped by effective stack / all-in) by expected value
 * against checking:
 *   - Estimates single-villain fold probability using smooth piecewise-linear interpolation over
 *     the measured NLH empirical tables in `holdemEmpiricalPriors.ts`
 *     (`HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET`, n = 10,707; `HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET`,
 *     n = 6,807; flop texture & low-SPR multipliers), combined with Empirical-Bayes shrinkage
 *     (`estimateHoldemFlopCbetFold` / `estimateHoldemTurnBetFold`) over structural
 *     `HoldemHudPacketOpponent` / `ExploitCounters` and `HorseMind` reads.
 *   - Applies equilibrium-anchored selection-bias surplus retention (`surplus > 0` discounted
 *     while sticky / below-MDF reads are preserved in full), line & board-story conditioning,
 *     calling-station discipline, and multiway compounding discount (`n = 2, 3` live opponents).
 *   - Models draw vs air equity realization when called (`eqWhenCalled` discounted by villain
 *     calling-range truncation per hand class, multiway strength, and future-street pressure)
 *     and realistic check-back / OOP-check equity realization (`EV(check) = realizedCheckEquity * pot * (1 - d)`).
 *   - Computes exact candidate EV:
 *       EV(bet_s) = foldProb * pot * (1 - d)
 *                   + (1 - foldProb) * (eqWhenCalled * (pot + 2 * bet) * (1 - d) - bet)
 *     and chooses the highest net-EV legal size ONLY when `EV(bestBet) > EV(check) + riskMargin`,
 *     where `riskMargin` scales with bet size (variance / raise-off-equity hurdle) and tournament
 *     ICM risk; otherwise checks deterministically.
 *
 * SCOPE. Strictly dark & default OFF (`=== true`). Single-board 2-card NLH unopened / checked-to
 * flop and turn spots owned by `flopTurnBluffBaseline` only. Never overlaps with
 * `holdemRiverBluffIsPriced` (river), `v87RiverBlockBetTrapIsPriced` (river), facing-bet
 * semi-bluff raises / `v78`, `H4`, `v36`, `v86`, or Omaha (PLO4/5/6, Hi-Lo), Short Deck,
 * Fixed Limit, multi-board, bomb pot, or All-In-or-Fold. Zero import dependency on `opponentHud/`
 * (preserves `OpponentHud.law.test.ts` and `TheLifetimeHudConsumerIsTheOnlyDecisionReader.law.test.ts`).
 */
import type { Card } from '../types.js';
import type { FlopTurnBluffLine, FlopTurnBluffSelection } from './HorseFlopTurnBluffRange.js';
import type { ExploitCounters } from './HorseOpponentExploit.js';
import {
  HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET,
  HOLDEM_EMPIRICAL_FLOP_SMALL_SPR_MULT,
  HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT,
  HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET,
  estimateHoldemFlopCbetFold,
  estimateHoldemTurnBetFold,
  holdemSprBand,
  type HoldemFlopTexture,
  type HoldemHudPacketOpponent,
  type HoldemPriorSource,
} from './holdemEmpiricalPriors.js';

export const HOLDEM_FLOP_TURN_BLUFF_PRICED_RECEIPTS = Object.freeze({
  bet: 'holdem_flop_turn_bluff_priced_bet_seen',
  semibluff: 'holdem_flop_turn_bluff_priced_semibluff_seen',
  air: 'holdem_flop_turn_bluff_priced_air_seen',
  check: 'holdem_flop_turn_bluff_priced_check_seen',
  stationCheck: 'holdem_flop_turn_bluff_priced_station_check_seen',
  illegal: 'holdem_flop_turn_bluff_priced_illegal_seen',
} as const);

/** Deterministic candidate flop/turn bluff & semi-bluff sizes as fractions of pot (stack-capped). */
export const HOLDEM_FLOP_TURN_BLUFF_CANDIDATE_FRACS: readonly number[] = Object.freeze([
  0.33, 0.55, 0.75, 1.0,
]);

/**
 * Positive pool-over-MDF surplus retention factor for bluff / semi-bluff candidates.
 * `HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET` and `HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET` are measured
 * over all pool bets (heavily value-weighted), where value holdings block villain's calling
 * range; bluff/semi-bluff candidates retain a discounted share of raw positive surplus while
 * sticky / below-MDF reads are preserved in full.
 */
export const HOLDEM_FLOP_TURN_BLUFF_SURPLUS_RETENTION = 0.46;

/** Hard single-villain fold-probability ceiling against a confirmed calling station. */
export const HOLDEM_FLOP_TURN_BLUFF_STATION_FOLD_CAP = 0.24;

/** Severe tournament ICM risk threshold above which non-draw all-in bluff shoves are withheld. */
export const HOLDEM_FLOP_TURN_BLUFF_ICM_NO_SHOVE_RISK = 0.05;

const EPS = 1e-9;

const clamp = (x: number, lo: number, hi: number): number =>
  Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : lo;

export type HoldemFlopTurnPricedSelection = Exclude<FlopTurnBluffSelection, 'junk'>;

export function isHoldemFlopTurnDrawSelection(
  selection: FlopTurnBluffSelection
): selection is 'strongDraw' | 'pairDraw' | 'weakDraw' {
  return selection === 'strongDraw' || selection === 'pairDraw' || selection === 'weakDraw';
}

/**
 * Classify a 3-card flop (or 4-card turn's flop/board structure) into the empirical
 * texture categories used by `HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT`.
 */
export function classifyHoldemFlopTexture(board: readonly Card[]): HoldemFlopTexture {
  if (board.length < 3) return 'unpaired_nonmono';
  const flop = board.slice(0, 3);
  if (flop[0].suit === flop[1].suit && flop[1].suit === flop[2].suit) {
    return 'mono';
  }
  const ranks = new Set(board.map((c) => c.rank));
  if (ranks.size < board.length) {
    return 'paired';
  }
  return 'unpaired_nonmono';
}

/** True when 3 or more cards on the public board share a suit (flush possible / monotone). */
export function isHoldemBoardThreeFlush(board: readonly Card[]): boolean {
  const counts: Record<string, number> = {};
  for (const c of board) {
    counts[c.suit] = (counts[c.suit] ?? 0) + 1;
    if (counts[c.suit] >= 3) return true;
  }
  return false;
}

export interface HoldemFlopTurnBluffPricedGateInput {
  enabled: unknown;
  isOmaha: boolean;
  isPotLimit: boolean;
  isHiLo: boolean;
  isShortDeck: boolean;
  isFixedLimit: boolean;
  holeCount: number;
  holeCardCount: number;
  street: string;
  boardLength: number;
  facingBet: boolean;
  multiBoard: boolean;
  bombPot: boolean;
  allInOrFold: boolean;
  satelliteActive: boolean;
  opponentsLive: number;
  opponentsCanRespond: boolean;
  pot: number;
  heroStack: number;
  effectiveVillainStack: number;
}

/**
 * Strict fail-closed structural gate for `holdemFlopTurnBluffIsPriced`.
 * Single-board 2-card NLH unopened / checked-to flop or turn only (1..3 live opponents);
 * zero reach to PLO4/5/6, Hi-Lo, Short Deck, Fixed Limit, multi-board, bomb pot, All-In-or-Fold,
 * river, or facing-bet spots.
 */
export function holdemFlopTurnBluffIsPricedApplies(
  input: HoldemFlopTurnBluffPricedGateInput
): boolean {
  const streetOk =
    (input.street === 'flop' && input.boardLength === 3) ||
    (input.street === 'turn' && input.boardLength === 4);
  return (
    input.enabled === true &&
    input.isOmaha === false &&
    input.isPotLimit === false &&
    input.isHiLo === false &&
    input.isShortDeck === false &&
    input.isFixedLimit === false &&
    input.holeCount === 2 &&
    input.holeCardCount === 2 &&
    streetOk &&
    input.facingBet === false &&
    !input.multiBoard &&
    !input.bombPot &&
    !input.allInOrFold &&
    !input.satelliteActive &&
    input.opponentsLive >= 1 &&
    input.opponentsLive <= 3 &&
    input.opponentsCanRespond === true &&
    Number.isFinite(input.pot) &&
    input.pot > EPS &&
    Number.isFinite(input.heroStack) &&
    input.heroStack > EPS &&
    Number.isFinite(input.effectiveVillainStack) &&
    input.effectiveVillainStack > EPS
  );
}

export interface HoldemFlopTurnBluffPricedInput {
  /** Current street (`flop` or `turn`). */
  street: 'flop' | 'turn';
  /** Pot at the start of hero's flop/turn decision. */
  pot: number;
  /** Hero's remaining stack behind. */
  heroStack: number;
  /** Deepest live opponent's effective stack behind (`max(opp.stack + opp.bet)`). */
  effectiveVillainStack: number;
  /** Table big blind (minimum legal non-all-in bet floor). */
  bigBlind: number;
  /** Hero's raw equity in [0, 1] against the read range. */
  equity: number;
  /** Coherent flop/turn bluff line from `flopTurnBluffEligibility`. */
  line: FlopTurnBluffLine;
  /** Qualified combo class from `flopTurnBluffEligibility`. */
  selection: HoldemFlopTurnPricedSelection;
  /** Number of live (non-folded) opponents in the pot (1..3). */
  opponents: number;
  /** Hero acts last on this street. */
  inPosition: boolean;
  /** Board texture for empirical flop fold-rate conditioning. */
  flopTexture: HoldemFlopTexture;
  /** True when the public board carries a pair. */
  pairedBoard: boolean;
  /** True when the public board has 3+ cards of one suit. */
  threeFlushBoard: boolean;
  /** Hero holds the nut flush draw (top unseen suit card + 4-card flush draw). */
  nutFlushDraw: boolean;
  /** Hero's public range has the advantage on this board (`boardFavorsAggressor`). */
  rangeAdvantage: boolean;
  /** Runout or public ranges favor the opponent. */
  rangesFavorOpponent: boolean;
  /** Turn completed a flush or straight hero neither blocks nor draws to (`dangered`). */
  scareUnblocked: boolean;
  /** Projected rake/jackpot deduction fraction on won pots in [0, 0.25]. */
  callDeductionFraction?: number;
  /** Tournament survival risk premium (0 in cash). */
  icmRisk?: number;
  /** Confirmed calling station (`isStation`, or any live opponent flagged as station). */
  station?: boolean;
  /** `HorseMind.foldToCbetOf` for heads-up c-bet / barrel, or null when unavailable. */
  foldToCbet?: number | null;
  /** `HorseMind.exploit(...).bluffMod` (1 when neutral). */
  bluffMod?: number;
  /** Optional structural opponent HUD slice (zero import dependency on `opponentHud/`). */
  hudOpp?: HoldemHudPacketOpponent | null;
  /** Optional HorseMind ExploitCounters (`foldToBet` / `foldToBetOpp`) for smooth shrinkage. */
  exploitCounters?: Pick<ExploitCounters, 'foldToBet' | 'foldToBetOpp'> | null;
}

export interface HoldemFlopTurnBluffCandidateEval {
  readonly targetPotFrac: number;
  readonly actualPotFrac: number;
  readonly betAmount: number;
  readonly isAllIn: boolean;
  readonly rawEmpiricalFoldProb: number;
  readonly singleVillainFoldProb: number;
  readonly foldProb: number;
  readonly eqWhenCalled: number;
  readonly ev: number;
  readonly riskMargin: number;
  readonly netEdge: number;
  readonly priorSource: HoldemPriorSource;
}

export interface HoldemFlopTurnBluffPricedVerdict {
  readonly decision: 'bet' | 'check';
  readonly isDraw: boolean;
  readonly betPotFrac: number | null;
  readonly betAmount: number | null;
  readonly isAllIn: boolean;
  readonly realizedCheckEquity: number;
  readonly evCheck: number;
  readonly evBestBet: number | null;
  readonly bestRiskMargin: number | null;
  readonly bestNetEdge: number | null;
  readonly candidates: readonly HoldemFlopTurnBluffCandidateEval[];
}

/**
 * Smooth piecewise-linear NLH pool prior for single-villain fold frequency facing a flop or turn
 * first bet of pot-relative size `potFraction`, interpolated across the three measured empirical
 * anchors (`small` at 0.33, `medium` at 0.55, `large` at 0.85) in `holdemEmpiricalPriors.ts`.
 */
export function holdemEmpiricalFlopTurnSmoothFoldPrior(ctx: {
  readonly street: 'flop' | 'turn';
  readonly bettorInPosition: boolean;
  readonly potFraction: number;
  readonly texture?: HoldemFlopTexture;
  readonly spr?: number;
}): number {
  const f = Number.isFinite(ctx.potFraction) ? Math.max(0, ctx.potFraction) : 0;
  const pos = ctx.bettorInPosition ? 'ip' : 'oop';
  const table =
    ctx.street === 'flop'
      ? HOLDEM_EMPIRICAL_FLOP_FOLD_TO_CBET[pos]
      : HOLDEM_EMPIRICAL_TURN_FOLD_TO_BET[pos];
  const r0 = table.small.rate;
  const r1 = table.medium.rate;
  const r2 = table.large.rate;

  const f0 = 0.33;
  const f1 = 0.55;
  const f2 = 0.85;

  let rate: number;
  if (f <= f0) {
    rate = r0 * (0.72 + 0.28 * (f / f0));
  } else if (f <= f1) {
    rate = r0 + ((r1 - r0) * (f - f0)) / (f1 - f0);
  } else if (f <= f2) {
    rate = r1 + ((r2 - r1) * (f - f1)) / (f2 - f1);
  } else {
    rate = r2 + Math.min(0.06, (f - f2) * 0.25);
  }

  if (ctx.street === 'flop') {
    if (ctx.texture) {
      rate *= HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT[ctx.texture].mult;
    }
    if (ctx.bettorInPosition && ctx.spr !== undefined && f <= 0.45) {
      // Smoothly blend the measured small-IP SPR multiplier across f in [0.33, 0.45].
      const sprMult = HOLDEM_EMPIRICAL_FLOP_SMALL_SPR_MULT[holdemSprBand(ctx.spr)].mult;
      const blend = f <= 0.33 ? 1 : clamp((0.45 - f) / (0.45 - 0.33), 0, 1);
      rate *= 1 + (sprMult - 1) * blend;
    }
  }

  return clamp(rate, 0.08, 0.9);
}

function lineFoldAdjustment(line: FlopTurnBluffLine, street: 'flop' | 'turn'): number {
  switch (line) {
    case 'cbet':
      return 0.03;
    case 'barrel':
      return 0.02;
    case 'delayed':
      return 0.01;
    case 'probe':
      return street === 'turn' ? 0.0 : -0.02;
    case 'stab':
      return 0.02;
    default:
      return -0.25;
  }
}

function selectionFoldAdjustment(
  selection: HoldemFlopTurnPricedSelection,
  nutFlushDraw: boolean,
  threeFlushBoard: boolean
): number {
  switch (selection) {
    case 'strongDraw':
      return nutFlushDraw ? 0.03 : 0.01;
    case 'pairDraw':
      return nutFlushDraw ? 0.02 : 0.0;
    case 'weakDraw':
      return -0.01;
    case 'backdoor':
      return -0.01;
    case 'overcards':
      return -0.02;
    case 'blocker':
      return threeFlushBoard ? 0.04 : 0.02;
  }
}

function checkRealizationFactor(
  street: 'flop' | 'turn',
  inPosition: boolean,
  selection: HoldemFlopTurnPricedSelection,
  opponents: number
): number {
  let base: number;
  if (street === 'flop') {
    if (inPosition) {
      switch (selection) {
        case 'strongDraw':
        case 'pairDraw':
          base = 0.9;
          break;
        case 'weakDraw':
          base = 0.8;
          break;
        case 'backdoor':
        case 'overcards':
          base = 0.68;
          break;
        case 'blocker':
          base = 0.55;
          break;
      }
    } else {
      switch (selection) {
        case 'strongDraw':
        case 'pairDraw':
          base = 0.76;
          break;
        case 'weakDraw':
          base = 0.64;
          break;
        case 'backdoor':
        case 'overcards':
          base = 0.52;
          break;
        case 'blocker':
          base = 0.42;
          break;
      }
    }
  } else if (inPosition) {
    switch (selection) {
      case 'strongDraw':
      case 'pairDraw':
        base = 0.95;
        break;
      case 'weakDraw':
        base = 0.88;
        break;
      case 'backdoor':
      case 'overcards':
        base = 0.78;
        break;
      case 'blocker':
        base = 0.65;
        break;
    }
  } else {
    switch (selection) {
      case 'strongDraw':
      case 'pairDraw':
        base = 0.82;
        break;
      case 'weakDraw':
        base = 0.72;
        break;
      case 'backdoor':
      case 'overcards':
        base = 0.6;
        break;
      case 'blocker':
        base = 0.48;
        break;
    }
  }
  const mwMul = opponents <= 1 ? 1.0 : opponents === 2 ? 0.9 : 0.82;
  return clamp(base * mwMul, 0.25, 0.98);
}

/**
 * Compute equity realized when hero's flop/turn bet is called, accounting for:
 *  1. Villain calling-range truncation (strong draws retain ~80-92% of raw equity against a
 *     calling range because their outs stay live against pairs, whereas air loses much more),
 *  2. Nut-flush-draw cleanliness bonus,
 *  3. Multiway calling-range strengthening, and
 *  4. Future-street equity realization & check-raise/commitment pressure (1.0 when all-in).
 */
export function computeHoldemFlopTurnEqWhenCalled(
  rawEquity: number,
  singleVillainFoldProb: number,
  actualPotFrac: number,
  isAllIn: boolean,
  input: Pick<
    HoldemFlopTurnBluffPricedInput,
    'street' | 'inPosition' | 'selection' | 'nutFlushDraw' | 'opponents'
  >
): number {
  const eq = clamp(rawEquity, 0, 1);
  const fProb = clamp(singleVillainFoldProb, 0, 0.95);

  let truncSlope: number;
  switch (input.selection) {
    case 'strongDraw':
      truncSlope = 0.2;
      break;
    case 'pairDraw':
      truncSlope = 0.18;
      break;
    case 'weakDraw':
      truncSlope = 0.38;
      break;
    case 'backdoor':
      truncSlope = 0.55;
      break;
    case 'overcards':
      truncSlope = 0.65;
      break;
    case 'blocker':
      truncSlope = 0.8;
      break;
  }

  let truncFactor = 1 - truncSlope * fProb;
  if (input.nutFlushDraw) {
    truncFactor = Math.min(0.98, truncFactor + 0.04);
  }
  const mwTrunc = input.opponents <= 1 ? 1.0 : input.opponents === 2 ? 0.9 : 0.82;
  truncFactor = clamp(truncFactor * mwTrunc, 0.12, 0.98);

  let realizeWhenCalled = 1.0;
  if (!isAllIn) {
    if (input.street === 'flop') {
      if (input.inPosition) {
        realizeWhenCalled =
          input.selection === 'strongDraw' || input.selection === 'pairDraw'
            ? 0.92
            : input.selection === 'weakDraw'
              ? 0.8
              : input.selection === 'blocker'
                ? 0.62
                : 0.7;
      } else {
        realizeWhenCalled =
          input.selection === 'strongDraw' || input.selection === 'pairDraw'
            ? 0.82
            : input.selection === 'weakDraw'
              ? 0.7
              : input.selection === 'blocker'
                ? 0.52
                : 0.6;
      }
    } else if (input.inPosition) {
      realizeWhenCalled =
        input.selection === 'strongDraw' || input.selection === 'pairDraw'
          ? 0.96
          : input.selection === 'weakDraw'
            ? 0.86
            : input.selection === 'blocker'
              ? 0.62
              : 0.74;
    } else {
      realizeWhenCalled =
        input.selection === 'strongDraw' || input.selection === 'pairDraw'
          ? 0.88
          : input.selection === 'weakDraw'
            ? 0.78
            : input.selection === 'blocker'
              ? 0.56
              : 0.66;
    }
    // Larger non-all-in bets face slightly more check-raise / future-SPR commitment pressure.
    realizeWhenCalled *= 1 - 0.06 * Math.min(1.2, Math.max(0, actualPotFrac));
  }

  return clamp(eq * truncFactor * realizeWhenCalled, 0, eq);
}

/**
 * Compute conditioned villain fold probability (both single-villain and all-opponents multiway)
 * for a candidate flop/turn bet of pot-fraction `actualPotFrac`.
 */
export function conditionHoldemFlopTurnBluffFoldProb(
  actualPotFrac: number,
  input: HoldemFlopTurnBluffPricedInput
): {
  readonly rawEmpiricalFoldProb: number;
  readonly singleVillainFoldProb: number;
  readonly foldProb: number;
  readonly priorSource: HoldemPriorSource;
} {
  const f = Math.max(0, Number.isFinite(actualPotFrac) ? actualPotFrac : 0);
  const effStack = Math.min(
    Math.max(0, Number.isFinite(input.heroStack) ? input.heroStack : 0),
    Math.max(0, Number.isFinite(input.effectiveVillainStack) ? input.effectiveVillainStack : 0)
  );
  const spr = input.pot > EPS ? effStack / input.pot : 10;
  const headsUp = input.opponents <= 1;

  const est =
    input.street === 'flop'
      ? estimateHoldemFlopCbetFold(
          {
            bettorInPosition: input.inPosition,
            potFraction: f,
            texture: input.flopTexture,
            spr,
            headsUp,
          },
          input.hudOpp,
          input.exploitCounters
        )
      : estimateHoldemTurnBetFold(
          {
            bettorInPosition: input.inPosition,
            potFraction: f,
            headsUp,
          },
          input.hudOpp,
          input.exploitCounters
        );

  const smoothPrior = holdemEmpiricalFlopTurnSmoothFoldPrior({
    street: input.street,
    bettorInPosition: input.inPosition,
    potFraction: f,
    texture: input.flopTexture,
    spr,
  });

  // Preserve Empirical-Bayes opponent shrinkage ratio on top of the smooth size curve.
  const shrinkRatio = est.prior > EPS ? est.mean / est.prior : 1;
  let empiricalFold = clamp(smoothPrior * shrinkRatio, 0.05, 0.9);

  // When neither OpponentHud nor ExploitCounters supplied opponent fold counts, apply
  // HorseMind.foldToCbetOf on heads-up c-bet / barrel lines scaled by the smooth size curve.
  if (
    headsUp &&
    est.source === 'pool_prior' &&
    input.foldToCbet != null &&
    Number.isFinite(input.foldToCbet) &&
    (input.line === 'cbet' || input.line === 'barrel')
  ) {
    const baseRef = holdemEmpiricalFlopTurnSmoothFoldPrior({
      street: input.street,
      bettorInPosition: input.inPosition,
      potFraction: 0.55,
      texture: input.flopTexture,
      spr,
    });
    const ftc = clamp(input.foldToCbet, 0.08, 0.88);
    const sizeRatio = baseRef > EPS ? smoothPrior / baseRef : 1;
    empiricalFold = clamp(ftc * sizeRatio, 0.05, 0.9);
  }

  // Smooth HorseMind exploit bluffMod scaling (1 = neutral).
  if (input.bluffMod !== undefined && Number.isFinite(input.bluffMod) && input.bluffMod > 0) {
    empiricalFold = clamp(empiricalFold * clamp(0.5 + 0.5 * input.bluffMod, 0.72, 1.18), 0.05, 0.9);
  }

  // Equilibrium-anchored selection-bias surplus retention: discount positive pool-over-MDF surplus
  // while preserving sticky / below-MDF reads in full.
  const mdf = f / (1 + f);
  const surplus = empiricalFold - mdf;
  const calibratedBase =
    surplus > 0 ? mdf + HOLDEM_FLOP_TURN_BLUFF_SURPLUS_RETENTION * surplus : empiricalFold;

  const isDraw = isHoldemFlopTurnDrawSelection(input.selection);
  const lineAdj = lineFoldAdjustment(input.line, input.street);
  const selAdj = selectionFoldAdjustment(
    input.selection,
    input.nutFlushDraw,
    input.threeFlushBoard
  );
  const rangeAdj =
    (input.rangeAdvantage && !input.rangesFavorOpponent
      ? input.line === 'cbet'
        ? 0.04
        : 0.02
      : 0) + (input.rangesFavorOpponent ? (isDraw ? -0.05 : -0.09) : 0);
  const scareAdj = input.scareUnblocked && !isDraw ? -0.08 : 0;
  // Turn texture conditioning (flop already carries HOLDEM_EMPIRICAL_FLOP_TEXTURE_MULT).
  const turnBoardAdj =
    input.street === 'turn'
      ? (input.threeFlushBoard && !isDraw && input.selection !== 'blocker' ? -0.05 : 0) +
        (input.pairedBoard && input.selection !== 'pairDraw' ? -0.03 : 0)
      : 0;
  // Shallow stack commitment resistance for pure air (< 1.2 pots behind).
  const shallowAirPenalty = spr < 1.2 && !isDraw ? -0.08 : 0;

  // Non-polar large bets with air / weak candidates do not realize the value-heavy large-bet fold rate.
  const polarLargeOk =
    isDraw ||
    input.selection === 'blocker' ||
    (input.street === 'turn' && input.line === 'barrel' && input.rangeAdvantage);
  const sizeCredibilityPenalty =
    (f >= 0.95 - EPS && !polarLargeOk ? -0.07 : 0) +
    (f >= 0.7 - EPS && !isDraw && input.street === 'flop' ? -0.04 : 0);

  let singleFold =
    calibratedBase +
    lineAdj +
    selAdj +
    rangeAdj +
    scareAdj +
    turnBoardAdj +
    shallowAirPenalty +
    sizeCredibilityPenalty;

  if (input.station === true) {
    singleFold = Math.min(singleFold * 0.55, HOLDEM_FLOP_TURN_BLUFF_STATION_FOLD_CAP);
  }
  singleFold = clamp(singleFold, 0.05, 0.86);

  // Multiway compounding discount: every live opponent must fold to win immediately.
  const nOpp = Math.max(1, Math.min(3, Math.floor(input.opponents)));
  const foldAll =
    nOpp === 1 ? singleFold : nOpp === 2 ? Math.pow(singleFold, 1.75) : Math.pow(singleFold, 2.45);

  return {
    rawEmpiricalFoldProb: empiricalFold,
    singleVillainFoldProb: singleFold,
    foldProb: clamp(foldAll, 0.02, 0.86),
    priorSource: est.source,
  };
}

/**
 * Deterministic EV pricing across candidate legal NLH flop/turn bluff & semi-bluff bet sizes
 * (`0.33x`, `0.55x`, `0.75x`, `1.0x` pot, capped by effective stack / all-in) versus checking
 * (`EV(check) = realizedCheckEquity * pot * (1 - d)`).
 *
 * Returns `decision: 'bet'` ONLY when the highest-EV legal size clears `EV(check)` by its
 * risk-calibrated margin; otherwise returns `decision: 'check'` deterministically.
 */
export function holdemFlopTurnBluffPricedVerdict(
  input: HoldemFlopTurnBluffPricedInput
): HoldemFlopTurnBluffPricedVerdict {
  const pot = Math.max(0, Number.isFinite(input.pot) ? input.pot : 0);
  const heroStack = Math.max(0, Number.isFinite(input.heroStack) ? input.heroStack : 0);
  const villainStack = Math.max(
    0,
    Number.isFinite(input.effectiveVillainStack) ? input.effectiveVillainStack : 0
  );
  const effStack = Math.min(heroStack, villainStack);
  const bb = Number.isFinite(input.bigBlind) && input.bigBlind > 0 ? input.bigBlind : 1;
  const deduction = clamp(input.callDeductionFraction ?? 0, 0, 0.25);
  const rawEquity = clamp(input.equity, 0, 1);
  const icmRisk = Math.max(0, Number.isFinite(input.icmRisk) ? (input.icmRisk as number) : 0);
  const isDraw = isHoldemFlopTurnDrawSelection(input.selection);

  const checkRealize = checkRealizationFactor(
    input.street,
    input.inPosition,
    input.selection,
    input.opponents
  );
  const realizedCheckEquity = clamp(rawEquity * checkRealize, 0, rawEquity);
  const evCheck = realizedCheckEquity * pot * (1 - deduction);

  if (!(pot > EPS) || !(effStack > EPS) || input.line === 'none' || input.opponents < 1) {
    return {
      decision: 'check',
      isDraw,
      betPotFrac: null,
      betAmount: null,
      isAllIn: false,
      realizedCheckEquity,
      evCheck,
      evBestBet: null,
      bestRiskMargin: null,
      bestNetEdge: null,
      candidates: [],
    };
  }

  const minLegalBet = Math.min(effStack, bb);
  const uniqueSizes: Array<{ targetPotFrac: number; betAmount: number; isAllIn: boolean }> = [];
  for (const frac of HOLDEM_FLOP_TURN_BLUFF_CANDIDATE_FRACS) {
    const rawBet = pot * frac;
    const betAmount = Math.min(effStack, Math.max(minLegalBet, rawBet));
    if (!(betAmount > EPS)) continue;
    const isAllIn = betAmount >= effStack - 1e-4;
    if (uniqueSizes.some((s) => Math.abs(s.betAmount - betAmount) <= 1e-4)) continue;
    uniqueSizes.push({ targetPotFrac: frac, betAmount, isAllIn });
  }

  const candidates: HoldemFlopTurnBluffCandidateEval[] = [];
  let best: HoldemFlopTurnBluffCandidateEval | null = null;
  const drawVarianceRelief = isDraw ? 0.85 : 1.0;

  for (const cand of uniqueSizes) {
    const actualPotFrac = cand.betAmount / pot;
    const { rawEmpiricalFoldProb, singleVillainFoldProb, foldProb, priorSource } =
      conditionHoldemFlopTurnBluffFoldProb(actualPotFrac, input);

    const eqWhenCalled = computeHoldemFlopTurnEqWhenCalled(
      rawEquity,
      singleVillainFoldProb,
      actualPotFrac,
      cand.isAllIn,
      input
    );

    // Exact current-street EV:
    //   win pot when all opponents fold; when called, win (pot + bet) with eqWhenCalled else lose bet
    //   => eqWhenCalled * (pot + 2 * bet) * (1 - d) - bet.
    const ev =
      foldProb * pot * (1 - deduction) +
      (1 - foldProb) *
        (eqWhenCalled * (pot + 2 * cand.betAmount) * (1 - deduction) - cand.betAmount);

    // Risk-calibrated hurdle margin: scales with bet size (variance / check-raise risk) + ICM.
    const riskMargin =
      pot *
        drawVarianceRelief *
        (0.025 + 0.045 * actualPotFrac + 0.055 * actualPotFrac * actualPotFrac) +
      icmRisk * (pot + 2 * cand.betAmount) * 1.4;

    const netEdge = ev - evCheck - riskMargin;
    const entry: HoldemFlopTurnBluffCandidateEval = {
      targetPotFrac: cand.targetPotFrac,
      actualPotFrac,
      betAmount: cand.betAmount,
      isAllIn: cand.isAllIn,
      rawEmpiricalFoldProb,
      singleVillainFoldProb,
      foldProb,
      eqWhenCalled,
      ev,
      riskMargin,
      netEdge,
      priorSource,
    };
    candidates.push(entry);

    // Under severe tournament ICM pressure, withhold non-draw all-in bluff shoves.
    if (cand.isAllIn && !isDraw && icmRisk >= HOLDEM_FLOP_TURN_BLUFF_ICM_NO_SHOVE_RISK) continue;

    if (best === null || entry.netEdge > best.netEdge + EPS) {
      best = entry;
    }
  }

  if (best !== null && best.netEdge > EPS) {
    return {
      decision: 'bet',
      isDraw,
      betPotFrac: best.actualPotFrac,
      betAmount: best.betAmount,
      isAllIn: best.isAllIn,
      realizedCheckEquity,
      evCheck,
      evBestBet: best.ev,
      bestRiskMargin: best.riskMargin,
      bestNetEdge: best.netEdge,
      candidates,
    };
  }

  return {
    decision: 'check',
    isDraw,
    betPotFrac: null,
    betAmount: null,
    isAllIn: false,
    realizedCheckEquity,
    evCheck,
    evBestBet: best?.ev ?? null,
    bestRiskMargin: best?.riskMargin ?? null,
    bestNetEdge: best?.netEdge ?? null,
    candidates,
  };
}
