/**
 * PRICED MULTI-BOARD BLUFF-TRIM MULTIPLIER REPLACEMENT FOR UNOWNED V36
 * (2026-11-22, option `multiBoardBluffTrimIsPriced`, default OFF, OPTION_SWITCH_REFUSED /
 * zero SQL migrations).
 *
 * Replaces the unowned fixed blanket multiplier in `HorseLogic.ts` (`v36_multiboard_bluff_trim`):
 *   `if (multiBoard36) { bluffScale *= nBoards36 >= 3 ? 0.35 : 0.5; }`
 * which trimmed bluff volume identically on every multi-board hand regardless of opponent fold
 * frequency, opponent count, public board-texture overlap, hero's own cross-board blockers,
 * street/pot/stack geometry, or tournament bubble factor.
 *
 * Pure, deterministic (zero `fastRandom()` draw), public-info-only (zero opponent hole cards,
 * zero `opponentHud/` import — uses `holdemEmpiricalPriors.ts` structural
 * `HoldemHudPacketOpponent` / `ExploitCounters` shrinkage).
 *
 * Pricing model:
 *   1. Single-board shrunk fold probability `F_1_i` per live opponent `i` from
 *      `holdemEmpiricalPriors.ts` + public `ExploitCounters` shrinkage, smoothly adjusted for
 *      public `street`, `potSize`, `effStack` (SPR), and `wetness`. An opponent who is already
 *      all-in (`canRespond === false`) cannot fold (`F_1_i = 0`).
 *   2. Public multi-board independence exponent `effBoards in [1, nBoards]`:
 *        - Public board correlation `boardCorrelation in [0, 1]` from pairwise shared ranks,
 *          paired-board density, and shared dominant flush suits across `allBoards`.
 *        - Hero cross-board blocker coverage `heroBlockerCoverage in [0, 1]` from hero's own
 *          cards against `allBoards` (zero opponent hole cards).
 *        - `effBoards = 1 + (nBoards - 1) * (1 - (0.45 * boardCorrelation + 0.20 * heroBlockerCoverage))`.
 *   3. All-boards fold probability:
 *        `F_all = prod_i (F_1_i ^ effBoards)`.
 *   4. Risk-adjusted break-even fold probability at reference bluff size `s = 0.65` with
 *      bubble factor `bf = max(1, heroBubbleFactor)`:
 *        `FE_be = (bf * s) / (1 + bf * s)`.
 *      Exact pure-bluff risk-adjusted EV per pot unit:
 *        `evPerPot = F_all * 1 - (1 - F_all) * bf * s = F_all * (1 + bf * s) - bf * s`
 *        (`=== (1 + bf * s) * (F_all - FE_be)`, reducing identically to `F_all * (1 + s) - s` at `bf = 1`).
 *   5. Smooth, strictly monotonic mapping into `multiplier in [0.0, 1.0]` anchored at
 *      `m(F_all === FE_be) = 0.35`:
 *        - For `F_all <= FE_be` (`evPerPot <= 0`): `m = 0.35 * (F_all / FE_be)^2.2`, dropping
 *          smoothly to `~0.0` in hopeless multiway calling-station / 3-board spots and exact `0.0`
 *          when `F_all === 0`.
 *        - For `F_all > FE_be` (`evPerPot > 0`): `u = clamp01(evPerPot)`,
 *          `m = 0.35 + 0.65 * (1 - exp(-3.2 * u)) / (1 - exp(-3.2))`, rising above legacy
 *          `0.35` / `0.50` ONLY when `F_all` genuinely clears `FE_be` against tight folders in
 *          heads-up / low-oppCount spots, and never exceeding `1.0`.
 */
import type { ExploitCounters } from './HorseOpponentExploit.js';
import {
  HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET,
  HOLDEM_PRIOR_STRENGTH,
  empiricalBayesShrink,
  estimateHoldemFlopCbetFold,
  estimateHoldemTurnBetFold,
  readHudOpponentStat,
  type HoldemFlopTexture,
  type HoldemHudPacketOpponent,
} from './holdemEmpiricalPriors.js';

/** Reference bluff bet fraction of pot (`s = 0.65`). */
export const MULTI_BOARD_BLUFF_REF_POT_FRAC = 0.65;

/** Multiplier value exactly at risk-adjusted break-even (`F_all === FE_be`, `evPerPot === 0`). */
export const MULTI_BOARD_BLUFF_BREAK_EVEN_MUL = 0.35;

/** Convex decay exponent below break-even (`evPerPot <= 0`). */
const BELOW_BE_POWER = 2.2;

/** Concave saturation rate above break-even (`evPerPot > 0`). */
const ABOVE_BE_RATE = 3.2;

const ABOVE_BE_NORM = 1 - Math.exp(-ABOVE_BE_RATE);

const RANK_ORDER: Readonly<Record<string, number>> = Object.freeze({
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
});

export type MultiBoardBluffTrimStreet = 'flop' | 'turn' | 'river';

export interface MultiBoardCardLike {
  readonly rank: string;
  readonly suit: string;
}

export interface MultiBoardBluffTrimOpponentInput {
  readonly hudOpp?: HoldemHudPacketOpponent | null;
  readonly exploitCounters?: Pick<
    ExploitCounters,
    'foldToBet' | 'foldToBetOpp' | 'riverCall' | 'riverCallOpp'
  > | null;
  /** False when this opponent is already all-in (cannot fold). Defaults to true. */
  readonly canRespond?: boolean;
}

export interface PriceMultiBoardBluffTrimInput {
  /** All public community boards (`allBoards36`, length >= 2 on multi-board hands). */
  readonly boards: readonly (readonly MultiBoardCardLike[])[];
  /** Optional explicit board count override (defaults to `boards.length`). */
  readonly nBoards?: number;
  /** Hero's own hole cards (strictly hero only — NEVER opponent hole cards). */
  readonly heroCards?: readonly MultiBoardCardLike[];
  /** Current postflop street (`flop` | `turn` | `river`). */
  readonly street: MultiBoardBluffTrimStreet;
  /** Whether hero acts in position. */
  readonly inPosition: boolean;
  /** Current pot size in chips. */
  readonly potSize: number;
  /** Effective remaining stack behind in chips (`min(heroStack, deepestRespondableOppStack)`). */
  readonly effStack: number;
  /** Continuous public board wetness score in `[0, 1]`. */
  readonly wetness: number;
  /** Number of live opponents in the pot (`>= 1`). */
  readonly oppCount: number;
  /** Optional per-opponent public HUD packet and/or HorseMind exploit counters. */
  readonly opponents?: readonly MultiBoardBluffTrimOpponentInput[];
  /** Optional public flop texture classification (derived from `boards[0]` when omitted). */
  readonly flopTexture?: HoldemFlopTexture;
  /** Hero tournament/Spin bubble factor (`>= 1`). Null/undefined/`<= 1` resolves to chip EV (`1`). */
  readonly heroBubbleFactor?: number | null;
}

export interface EffectiveBoardsBreakdown {
  readonly nBoards: number;
  readonly rankOverlap: number;
  readonly pairDensity: number;
  readonly suitOverlap: number;
  readonly boardCorrelation: number;
  readonly heroBlockerCoverage: number;
  readonly effBoards: number;
}

export interface PriceMultiBoardBluffTrimResult {
  /** Bounded `bluffScale` multiplier strictly in `[0.0, 1.0]`. */
  readonly multiplier: number;
  /** Multi-board all-boards fold probability `prod_i (F_1_i ^ effBoards)` in `[0, 1]`. */
  readonly allBoardsFoldProb: number;
  /** Risk-adjusted break-even fold probability `(bf * s) / (1 + bf * s)`. */
  readonly breakEvenFoldProb: number;
  /** Pure-bluff risk-adjusted EV per pot unit `F_all * (1 + bf * s) - bf * s`. */
  readonly evPerPot: number;
  /** Single-board shrunk fold probability `F_1_i` for each live opponent. */
  readonly perOpponentSingleBoardFold: readonly number[];
  /** Public independence exponent `effBoards in [1, nBoards]`. */
  readonly effBoards: number;
  /** Public board correlation score in `[0, 1]`. */
  readonly boardCorrelation: number;
  /** Hero cross-board blocker coverage in `[0, 1]` (hero cards + public boards only). */
  readonly heroBlockerCoverage: number;
  /** Effective bubble factor (`>= 1`). */
  readonly bubbleFactor: number;
  /** Reference bluff size (`0.65`). */
  readonly refPotFrac: number;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function clampRange(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

function sanitizePositive(x: number): number {
  return Number.isFinite(x) && x > 0 ? x : 0;
}

function resolveBubbleFactor(bf: number | null | undefined): number {
  return typeof bf === 'number' && Number.isFinite(bf) && bf > 1 ? bf : 1;
}

function rankValue(rank: string): number {
  return RANK_ORDER[rank] ?? 0;
}

/**
 * Classify public flop texture from the first three cards of the primary board.
 * Pure public-board helper: never inspects hole cards.
 */
export function classifyBluffTrimFlopTexture(
  board: readonly MultiBoardCardLike[] | undefined
): HoldemFlopTexture {
  if (!board || board.length < 3) return 'unpaired_nonmono';
  const c0 = board[0]!;
  const c1 = board[1]!;
  const c2 = board[2]!;
  if (c0.suit === c1.suit && c1.suit === c2.suit) return 'mono';
  if (c0.rank === c1.rank || c1.rank === c2.rank || c0.rank === c2.rank) return 'paired';
  return 'unpaired_nonmono';
}

function boardHasPair(board: readonly MultiBoardCardLike[]): boolean {
  const seen = new Set<string>();
  for (const c of board) {
    if (seen.has(c.rank)) return true;
    seen.add(c.rank);
  }
  return false;
}

function dominantSuits(board: readonly MultiBoardCardLike[]): Set<string> {
  const counts = new Map<string, number>();
  for (const c of board) {
    counts.set(c.suit, (counts.get(c.suit) ?? 0) + 1);
  }
  const out = new Set<string>();
  for (const [suit, n] of counts) {
    if (n >= 2) out.add(suit);
  }
  return out;
}

function heroBoardBlockerScore(
  heroCards: readonly MultiBoardCardLike[],
  board: readonly MultiBoardCardLike[]
): number {
  if (heroCards.length === 0 || board.length === 0) return 0;

  // Public board facts: highest rank, paired ranks, and 3+ card flush suits.
  let topRankVal = 0;
  const rankCounts = new Map<string, number>();
  const suitCounts = new Map<string, number>();
  for (const bc of board) {
    const rv = rankValue(bc.rank);
    if (rv > topRankVal) topRankVal = rv;
    rankCounts.set(bc.rank, (rankCounts.get(bc.rank) ?? 0) + 1);
    suitCounts.set(bc.suit, (suitCounts.get(bc.suit) ?? 0) + 1);
  }

  let hasTopOrPairedRankBlock = false;
  let hasNutFlushBlock = false;

  for (const hc of heroCards) {
    const hrv = rankValue(hc.rank);
    if (hrv > 0 && hrv === topRankVal) {
      hasTopOrPairedRankBlock = true;
    }
    if ((rankCounts.get(hc.rank) ?? 0) >= 2) {
      hasTopOrPairedRankBlock = true;
    }
    if ((suitCounts.get(hc.suit) ?? 0) >= 3 && (hc.rank === 'A' || hc.rank === 'K')) {
      hasNutFlushBlock = true;
    }
  }

  if (hasTopOrPairedRankBlock && hasNutFlushBlock) return 1.0;
  if (hasTopOrPairedRankBlock) return 0.65;
  if (hasNutFlushBlock) return 0.55;
  return 0;
}

/**
 * Compute public multi-board independence exponent `effBoards in [1, nBoards]`.
 *
 * Uses strictly public community boards (`boards`) and hero's own hole cards (`heroCards`) —
 * NEVER opponent hole cards.
 *
 * Monotonicity guarantees:
 *   - Increasing `nBoards` at fixed correlation & blockers strictly increases `effBoards`.
 *   - Increasing pairwise rank overlap, paired-board density, or shared flush-suit texture
 *     strictly increases `boardCorrelation` and strictly lowers `effBoards`.
 *   - Increasing hero's own cross-board blockers strictly lowers `effBoards`.
 *   - Always strictly bounded in `[1, nBoards]`.
 */
export function computeEffectiveBoards(
  boards: readonly (readonly MultiBoardCardLike[])[],
  heroCards?: readonly MultiBoardCardLike[],
  nBoardsOverride?: number
): EffectiveBoardsBreakdown {
  const nonEmptyBoards = boards.filter((b) => Array.isArray(b) && b.length > 0);
  const rawN =
    typeof nBoardsOverride === 'number' && Number.isFinite(nBoardsOverride)
      ? Math.floor(nBoardsOverride)
      : boards.length;
  const nBoards = Math.max(1, rawN, nonEmptyBoards.length);

  if (nBoards <= 1) {
    return {
      nBoards: 1,
      rankOverlap: 0,
      pairDensity: 0,
      suitOverlap: 0,
      boardCorrelation: 0,
      heroBlockerCoverage: 0,
      effBoards: 1,
    };
  }

  let rankOverlap = 0;
  let suitOverlap = 0;
  let pairCount = 0;

  if (nonEmptyBoards.length >= 2) {
    const rankSets = nonEmptyBoards.map((b) => new Set(b.map((c) => c.rank)));
    const domSuits = nonEmptyBoards.map(dominantSuits);
    let rankOverlapSum = 0;
    let suitOverlapSum = 0;
    for (let i = 0; i < nonEmptyBoards.length; i++) {
      for (let j = i + 1; j < nonEmptyBoards.length; j++) {
        pairCount++;
        const a = rankSets[i]!;
        const b = rankSets[j]!;
        let shared = 0;
        for (const r of a) {
          if (b.has(r)) shared++;
        }
        const denom = Math.max(1, Math.min(a.size, b.size));
        rankOverlapSum += shared / denom;

        const sa = domSuits[i]!;
        const sb = domSuits[j]!;
        let sharedSuit = false;
        for (const s of sa) {
          if (sb.has(s)) {
            sharedSuit = true;
            break;
          }
        }
        if (sharedSuit) suitOverlapSum += 1;
      }
    }
    if (pairCount > 0) {
      rankOverlap = clamp01(rankOverlapSum / pairCount);
      suitOverlap = clamp01(suitOverlapSum / pairCount);
    }
  }

  let pairedBoards = 0;
  for (const b of nonEmptyBoards) {
    if (boardHasPair(b)) pairedBoards++;
  }
  const pairDensity = nonEmptyBoards.length > 0 ? clamp01(pairedBoards / nonEmptyBoards.length) : 0;

  const boardCorrelation = clamp01(0.65 * rankOverlap + 0.2 * pairDensity + 0.15 * suitOverlap);

  let heroBlockerCoverage = 0;
  if (heroCards && heroCards.length > 0 && nonEmptyBoards.length > 0) {
    let scoreSum = 0;
    for (const b of nonEmptyBoards) {
      scoreSum += heroBoardBlockerScore(heroCards, b);
    }
    heroBlockerCoverage = clamp01(scoreSum / nonEmptyBoards.length);
  }

  // Correlation reduces extra independence by up to 45%; hero blockers by up to 20%.
  // Total reduction lives cleanly in [0, 0.65], never saturating prematurely and keeping
  // `effBoards` strictly inside `[1, nBoards]`.
  const reduction = clampRange(0.45 * boardCorrelation + 0.2 * heroBlockerCoverage, 0, 0.65);
  const effBoards = clampRange(1 + (nBoards - 1) * (1 - reduction), 1, nBoards);

  return {
    nBoards,
    rankOverlap,
    pairDensity,
    suitOverlap,
    boardCorrelation,
    heroBlockerCoverage,
    effBoards,
  };
}

/**
 * Estimate a single live opponent's shrunk single-board fold probability `F_1_i` facing a
 * reference bluff of `MULTI_BOARD_BLUFF_REF_POT_FRAC` (`0.65x` pot), using strictly public info:
 * `holdemEmpiricalPriors.ts`, public `ExploitCounters` / HUD packet, `street`, `potSize`,
 * `effStack`, and `wetness`.
 */
export function estimateSingleBoardFoldProb(
  ctx: {
    readonly street: MultiBoardBluffTrimStreet;
    readonly inPosition: boolean;
    readonly potSize: number;
    readonly effStack: number;
    readonly wetness: number;
    readonly headsUp: boolean;
    readonly flopTexture?: HoldemFlopTexture;
  },
  opp?: MultiBoardBluffTrimOpponentInput
): number {
  if (opp?.canRespond === false) return 0;

  const pot = sanitizePositive(ctx.potSize);
  const effStack = sanitizePositive(ctx.effStack);
  const spr = pot > 0 ? effStack / pot : 10;
  const s = MULTI_BOARD_BLUFF_REF_POT_FRAC;

  let baseFold: number;
  if (ctx.street === 'flop') {
    baseFold = estimateHoldemFlopCbetFold(
      {
        bettorInPosition: ctx.inPosition,
        potFraction: s,
        texture: ctx.flopTexture,
        spr,
        headsUp: ctx.headsUp,
      },
      opp?.hudOpp,
      opp?.exploitCounters
    ).mean;
  } else if (ctx.street === 'turn') {
    baseFold = estimateHoldemTurnBetFold(
      {
        bettorInPosition: ctx.inPosition,
        potFraction: s,
        headsUp: ctx.headsUp,
      },
      opp?.hudOpp,
      opp?.exploitCounters
    ).mean;
  } else {
    // Reference bluff s = 0.65 sits in the 34%-67% pot river first-bet band.
    const prior = HOLDEM_EMPIRICAL_RIVER_FOLD_TO_FIRST_BET['34_67'].rate;
    const hudRiver = readHudOpponentStat(opp?.hudOpp, 'r.fBet');
    if (hudRiver) {
      baseFold = empiricalBayesShrink(
        hudRiver.hits,
        hudRiver.opportunities,
        prior,
        HOLDEM_PRIOR_STRENGTH.turnBetFold,
        'hud_street'
      ).mean;
    } else if (opp?.exploitCounters && opp.exploitCounters.riverCallOpp > 0) {
      const riverFolds = Math.max(
        0,
        opp.exploitCounters.riverCallOpp - opp.exploitCounters.riverCall
      );
      baseFold = empiricalBayesShrink(
        riverFolds,
        opp.exploitCounters.riverCallOpp,
        prior,
        HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
        'exploit_counters'
      ).mean;
    } else if (opp?.exploitCounters && opp.exploitCounters.foldToBetOpp > 0) {
      baseFold = empiricalBayesShrink(
        opp.exploitCounters.foldToBet,
        opp.exploitCounters.foldToBetOpp,
        prior,
        HOLDEM_PRIOR_STRENGTH.exploitCountersFallback,
        'exploit_counters'
      ).mean;
    } else {
      baseFold = prior;
    }
  }

  // Smooth public-state adjustments:
  //   - Wetter boards connect with more draws / made pairs -> lower single-board fold rate.
  //   - Lower SPR (< 3) commits opponents to the pot -> lower single-board fold rate.
  const wetnessMul = 1.06 - 0.24 * clamp01(ctx.wetness);
  const sprMul = 0.72 + 0.28 * clamp01(spr / 3.0);

  return clampRange(baseFold * wetnessMul * sprMul, 0.02, 0.92);
}

/**
 * Smooth, strictly monotonic mapping from multi-board all-boards fold probability `F_all` and
 * break-even fold probability `FE_be` into a bounded `bluffScale` multiplier in `[0.0, 1.0]`.
 *
 * Properties:
 *   - `m(0) = 0.0` (e.g. an opponent is all-in and cannot fold).
 *   - `m(FE_be) = 0.35` (so `m` NEVER exceeds legacy 3-board `0.35` or 2-board `0.50` unless
 *     `F_all > FE_be`, i.e., `evPerPot > 0`).
 *   - Strictly increasing in `F_all` on `[0, 1]`, strictly decreasing in `bf >= 1` on `(0, 1)`.
 *   - Strictly bounded in `[0.0, 1.0]` (never bluffs MORE on multi-board than single-board).
 */
export function mapMultiBoardBluffEvToMultiplier(
  allBoardsFoldProb: number,
  breakEvenFoldProb: number,
  evPerPot: number
): number {
  const fAll = clamp01(allBoardsFoldProb);
  if (!(fAll > 0)) return 0;

  const feBe = clampRange(breakEvenFoldProb, 1e-6, 1 - 1e-6);
  if (evPerPot <= 0 || fAll <= feBe) {
    const ratio = clamp01(fAll / feBe);
    return clamp01(MULTI_BOARD_BLUFF_BREAK_EVEN_MUL * Math.pow(ratio, BELOW_BE_POWER));
  }

  // Above break-even, `evPerPot = F_all * (1 + bf * s) - bf * s` lives strictly in `(0, 1]`
  // (reaching `1` as `F_all -> 1` regardless of `bf` or `s`).
  const u = clamp01(evPerPot);
  const rise = (1 - Math.exp(-ABOVE_BE_RATE * u)) / ABOVE_BE_NORM;
  return clamp01(MULTI_BOARD_BLUFF_BREAK_EVEN_MUL + (1 - MULTI_BOARD_BLUFF_BREAK_EVEN_MUL) * rise);
}

/**
 * Deterministic priced multi-board `bluffScale` multiplier (`multiBoardBluffTrimIsPriced`).
 * Zero `fastRandom()`, zero opponent hole cards, zero `opponentHud/` import.
 */
export function priceMultiBoardBluffTrim(
  input: PriceMultiBoardBluffTrimInput
): PriceMultiBoardBluffTrimResult {
  const s = MULTI_BOARD_BLUFF_REF_POT_FRAC;
  const bf = resolveBubbleFactor(input.heroBubbleFactor);
  const breakEvenFoldProb = (bf * s) / (1 + bf * s);

  const effBreakdown = computeEffectiveBoards(input.boards, input.heroCards, input.nBoards);
  const opps = Math.max(1, Math.floor(Number.isFinite(input.oppCount) ? input.oppCount : 1));
  const headsUp = opps === 1;
  const flopTexture = input.flopTexture ?? classifyBluffTrimFlopTexture(input.boards[0]);

  const perOpponentSingleBoardFold: number[] = [];
  let allBoardsFoldProb = 1;
  for (let i = 0; i < opps; i++) {
    const f1 = estimateSingleBoardFoldProb(
      {
        street: input.street,
        inPosition: input.inPosition,
        potSize: input.potSize,
        effStack: input.effStack,
        wetness: input.wetness,
        headsUp,
        flopTexture,
      },
      input.opponents?.[i]
    );
    perOpponentSingleBoardFold.push(f1);
    allBoardsFoldProb *= f1 > 0 ? Math.pow(f1, effBreakdown.effBoards) : 0;
  }
  allBoardsFoldProb = clamp01(allBoardsFoldProb);

  // Exact risk-adjusted pure-bluff EV per pot unit:
  //   F_all * 1 - (1 - F_all) * bf * s === F_all * (1 + bf * s) - bf * s === (1 + bf * s) * (F_all - FE_be).
  const evPerPot = allBoardsFoldProb * (1 + bf * s) - bf * s;
  const multiplier = mapMultiBoardBluffEvToMultiplier(
    allBoardsFoldProb,
    breakEvenFoldProb,
    evPerPot
  );

  return {
    multiplier,
    allBoardsFoldProb,
    breakEvenFoldProb,
    evPerPot,
    perOpponentSingleBoardFold,
    effBoards: effBreakdown.effBoards,
    boardCorrelation: effBreakdown.boardCorrelation,
    heroBlockerCoverage: effBreakdown.heroBlockerCoverage,
    bubbleFactor: bf,
    refPotFrac: s,
  };
}
