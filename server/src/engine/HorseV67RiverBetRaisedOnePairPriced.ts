/**
 * HOLD'EM V67 RIVER BET-THEN-RAISED ONE PAIR, PRICED
 * (option v67RiverBetRaisedOnePairIsPriced, 2026-11-22, Horse Switch lane; default OFF,
 * read only as === true, dark in OPTION_SWITCH_REFUSED, zero SQL migrations).
 *
 * THE BLANKET RULE IT PRICES (V67, v67RiverBetRaisedOnePair, cleanly decoupled from
 * v61RiverOnePairShade in #11713). On single-board two-card no-limit hold'em rivers,
 * when hero bet or raised the river and now faces a raise holding the bluff-catch class
 * (high card, one pair, or two pair through the board's pair), V67 currently applies
 * three categorical blanket overrides:
 *   1. Site 1 (`HorseLogic.ts` river raise stratum): switches the raiser onto a fixed
 *      10% bluff / 75% 2p+ / 22% TP / 3% weaker-pair MC stratum (`raisePolar67`) gated
 *      by a binary `exploit.callDownMod <= 1` cliff.
 *   2. Site 2 (`HorseLogic.ts` V87 river block-bet raised one-pair blanket fold):
 *      unconditionally returns `fold` whenever hero's small (<= 36% pot) river block
 *      bet is raised (`potFrac >= 0.30`, `toCall < stack`), ignoring exact pot odds,
 *      hand rank/kicker, card-removal blockers, and opponent river bluff-raise profile.
 *   3. Site 3 (`HorseLogic.ts` `v67Class` / `shade67`, committed & V38 river verdicts):
 *      subtracts a fixed raise shade (`v61RiverOnePairShade + 0.10`, capped at `0.25`)
 *      with a binary `exploit.callDownMod <= 1` cliff and routes through random V38
 *      indifference noise instead of pricing the river raise range deterministically.
 *
 * WHAT THIS MODULE DOES. Independently of `v67RiverBetRaisedOnePair`, with zero
 * `fastRandom` or `Math.random` draws and zero `opponentHud/` import coupling, it
 * deterministically prices call vs fold on single-board 2-card NLH rivers when hero's
 * river wager is raised holding the bluff-catch class:
 *   - Consumes `holdemEmpiricalPriors.ts` untouched (`estimateHoldemRiverBluffShare`,
 *     `empiricalBayesShrink`, `readHudOpponentStat`) to anchor villain's river raise
 *     bluff share on measured NLH showdown data with smooth Empirical-Bayes shrinkage.
 *   - Models river raise-range value vs bluff composition across raise size
 *     (`raisePotFrac`), multiway field count (`oppCount`), block-bet inducement,
 *     board danger (paired / double-paired / 3-flush / 4-flush / straight windows),
 *     hero hand strength within the bluff-catch class (overpair / top pair + kicker /
 *     second pair / underpair / playing-board / high card), exact Bayes card-removal
 *     blockers (nut/2nd flush, top straight, top board rank), smooth opponent river
 *     aggression / bluff-raise profile (no binary `callDownMod <= 1` cliff), true pot
 *     odds `callable / ((pot + callable) * (1 - deduction) + overlay)`, and tournament
 *     ICM risk premium.
 *   - Decides deterministically: `call` iff risk-adjusted `EV(call) > 0` (exact tie
 *     folds); never re-raises or jams with the bluff-catch class.
 *
 * SCOPE. Strictly dark & default OFF (`=== true`). Single-board 2-card NLH rivers ONLY.
 * Zero reach to flop/turn, Omaha (PLO4/5/6, Hi-Lo), Short Deck, Fixed Limit, Pot Limit,
 * multi-board, bomb pots, or All-In-or-Fold. Zero import dependency on `opponentHud/`.
 */
import type { Card } from '../types.js';
import {
  HOLDEM_EMPIRICAL_RIVER_BLUFF_CAP,
  HOLDEM_PRIOR_STRENGTH,
  empiricalBayesShrink,
  estimateHoldemRiverBluffShare,
  readHudOpponentStat,
  type HoldemHudPacketOpponent,
  type HoldemPriorSource,
} from './holdemEmpiricalPriors.js';

export const V67_RIVER_BET_RAISED_ONE_PAIR_PRICED_RECEIPTS = Object.freeze({
  callTaken: 'v67_river_bet_raised_one_pair_priced_call_taken',
  foldTaken: 'v67_river_bet_raised_one_pair_priced_fold_taken',
  blockBetCallTaken: 'v67_river_bet_raised_one_pair_priced_block_bet_call_taken',
  blockBetFoldTaken: 'v67_river_bet_raised_one_pair_priced_block_bet_fold_taken',
} as const);

/** River raise over hero's own bet is more value-heavy than a checked-to river first bet. */
export const V67_RIVER_RAISE_OVER_BET_BLUFF_SCALE = 0.78;
/** Minimum / maximum pre-blocker river raise bluff share bounds. */
export const V67_RIVER_RAISE_BLUFF_FLOOR = 0.02;
export const V67_RIVER_RAISE_BLUFF_CEIL = 0.78;
/** Maximum fraction of villain's value raise combos removed by hero's river blockers. */
export const V67_MAX_VALUE_BLOCKER_REMOVAL = 0.28;
/** Maximum tournament ICM risk premium applied to required equity. */
export const V67_MAX_ICM_RISK_PREMIUM = 0.25;
/** Pool baseline river-raise frequency (for smooth HUD `r.raise` shrinkage). */
export const V67_POOL_RIVER_RAISE_RATE = 0.09;
/** Prior strength for per-opponent HUD river-raise aggression shrinkage. */
export const V67_HUD_RAISE_PRIOR_STRENGTH = 12;

const EPS = 1e-9;

const RANK_TO_NUM: Readonly<Record<string, number>> = Object.freeze({
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
});

function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  return x < lo ? lo : x > hi ? hi : x;
}

function finiteOr(x: unknown, fallback: number): number {
  return typeof x === 'number' && Number.isFinite(x) ? x : fallback;
}

function lerp(a: number, b: number, t: number): number {
  const u = clamp(t, 0, 1);
  return a + (b - a) * u;
}

export interface V67RiverBetRaisedGateInput {
  readonly enabled: unknown;
  readonly isRiver: boolean;
  readonly raisedAfterAggr: boolean;
  readonly isOmaha: boolean;
  readonly isPotLimit: boolean;
  readonly isFixedLimit: boolean;
  readonly isShortDeck: boolean;
  readonly isHiLo: boolean;
  readonly holeCount: number;
  readonly holeCardCount: number;
  readonly boardLength: number;
  readonly multiBoard: boolean;
  readonly bombPot: boolean;
  readonly allInOrFold: boolean;
  readonly cat: number;
  readonly pairedBoard: boolean;
  readonly toCall: number;
  readonly pot: number;
  readonly heroStack: number;
}

/**
 * Strict fail-closed scope predicate for `v67RiverBetRaisedOnePairIsPriced`.
 * Single-board 2-card NLH rivers ONLY, hero bet/raised the river and faces a raise
 * holding the bluff-catch class (`cat <= 2` or board-paired two pair `cat === 3`).
 * Any non-true flag value or non-NLH/non-river/multi-board input returns `false`.
 */
export function v67RiverBetRaisedOnePairIsPricedApplies(
  input: V67RiverBetRaisedGateInput
): boolean {
  if (input.enabled !== true) return false;
  if (!input.isRiver || input.raisedAfterAggr !== true) return false;
  if (
    input.isOmaha ||
    input.isPotLimit ||
    input.isFixedLimit ||
    input.isShortDeck ||
    input.isHiLo
  ) {
    return false;
  }
  if (input.holeCount !== 2 || input.holeCardCount !== 2 || input.boardLength !== 5) {
    return false;
  }
  if (input.multiBoard || input.bombPot || input.allInOrFold) {
    return false;
  }
  if (!Number.isFinite(input.cat) || input.cat <= 0) return false;
  if (!(input.cat <= 2 || (input.cat === 3 && input.pairedBoard))) return false;
  if (!Number.isFinite(input.toCall) || !(input.toCall > 0)) return false;
  if (!Number.isFinite(input.pot) || !(input.pot > 0)) return false;
  if (!Number.isFinite(input.heroStack) || input.heroStack < 0) return false;
  return true;
}

export type V67HeroHandTier =
  | 'high_card'
  | 'playing_board'
  | 'underpair'
  | 'middle_pair'
  | 'top_pair'
  | 'overpair';

export interface V67RiverBoardAndBlockerAnalysis {
  readonly pairedBoard: boolean;
  readonly doublePairedBoard: boolean;
  readonly flushPossible: boolean;
  readonly fourFlushBoard: boolean;
  readonly flushSuit: string | null;
  readonly flushBoardCount: number;
  readonly fourToStraightBoard: boolean;
  readonly threeToStraightBoard: boolean;
  /** Public river board danger in [0, 1]. Higher = more nut/2p+ value combos possible. */
  readonly boardDanger: number;
  readonly heroFlushBlockers: number;
  readonly heroBlocksNutFlush: boolean;
  readonly heroBlocksSecondFlush: boolean;
  readonly heroBlocksTopStraight: boolean;
  readonly heroBlocksTopBoardRank: boolean;
  /** Card-removal blocker score in [0, 1]. Higher = hero removes more villain value combos. */
  readonly blockerScore: number;
  readonly heroHandTier: V67HeroHandTier;
  /** Relative hand strength inside the bluff-catch class in [0, 1]. */
  readonly heroClassStrength: number;
}

/**
 * Pure deterministic river board texture, card-removal blocker, and hero hand-strength
 * analyzer for a 2-card NLH bluff-catcher on a 5-card river board.
 */
export function analyzeV67RiverBoardAndBlockers(
  hole: readonly Card[],
  board: readonly Card[],
  cat: number
): V67RiverBoardAndBlockerAnalysis {
  const rankCounts = new Map<number, number>();
  const suitCounts = new Map<string, number>();
  const boardRankSet = new Set<number>();

  for (const c of board) {
    if (!c) continue;
    const r = RANK_TO_NUM[c.rank] ?? 0;
    if (r > 0) {
      rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
      boardRankSet.add(r);
      if (r === 14) boardRankSet.add(1);
    }
    if (c.suit) {
      suitCounts.set(c.suit, (suitCounts.get(c.suit) ?? 0) + 1);
    }
  }

  let pairCount = 0;
  let highestBoardPairRank = 0;
  let lowestBoardPairRank = 15;
  const distinctRanksDesc: number[] = [];
  for (const [rank, count] of rankCounts) {
    distinctRanksDesc.push(rank);
    if (count >= 2) {
      pairCount++;
      if (rank > highestBoardPairRank) highestBoardPairRank = rank;
      if (rank < lowestBoardPairRank) lowestBoardPairRank = rank;
    }
  }
  distinctRanksDesc.sort((a, b) => b - a);

  const pairedBoard = pairCount >= 1;
  const doublePairedBoard = pairCount >= 2;
  const topBoardRank = distinctRanksDesc[0] ?? 0;
  const secondBoardRank = distinctRanksDesc[1] ?? 0;
  const topUnpairedBoardRank =
    distinctRanksDesc.find((r) => (rankCounts.get(r) ?? 0) === 1) ?? topBoardRank;

  let flushSuit: string | null = null;
  let flushBoardCount = 0;
  for (const [suit, count] of suitCounts) {
    if (count >= 3 && count > flushBoardCount) {
      flushSuit = suit;
      flushBoardCount = count;
    }
  }
  const flushPossible = flushBoardCount >= 3;
  const fourFlushBoard = flushBoardCount >= 4;

  // Straight connectedness across all 5-rank windows [hi-4..hi] (hi = 5..14).
  let fourToStraightBoard = false;
  let threeToStraightBoard = false;
  let highestWindowFound = 0;
  const topStraightMissingRanks = new Set<number>();
  for (let hi = 14; hi >= 5; hi--) {
    let present = 0;
    const missing: number[] = [];
    for (let r = hi - 4; r <= hi; r++) {
      if (boardRankSet.has(r)) present++;
      else missing.push(r === 1 ? 14 : r);
    }
    if (present >= 4) {
      fourToStraightBoard = true;
      threeToStraightBoard = true;
      if (highestWindowFound === 0 || hi >= highestWindowFound - 1) {
        if (highestWindowFound === 0) highestWindowFound = hi;
        for (const m of missing) topStraightMissingRanks.add(m);
      }
    } else if (present === 3) {
      threeToStraightBoard = true;
      if (!fourToStraightBoard && highestWindowFound === 0) {
        highestWindowFound = hi;
        for (const m of missing) topStraightMissingRanks.add(m);
      }
    }
  }

  // Board danger score in [0, 1]: strictly increases with flush / straight / paired density.
  let boardDanger = 0;
  if (fourFlushBoard) boardDanger += 0.55;
  else if (flushPossible) boardDanger += 0.28;

  if (fourToStraightBoard) boardDanger += 0.42;
  else if (threeToStraightBoard) boardDanger += 0.16;

  if (doublePairedBoard) boardDanger += 0.38;
  else if (pairedBoard) boardDanger += 0.22;

  boardDanger = clamp(boardDanger, 0, 1);

  // Extract hole card numeric ranks.
  const holeRanks: number[] = [];
  for (const c of hole) {
    if (!c) continue;
    const r = RANK_TO_NUM[c.rank] ?? 0;
    if (r > 0) holeRanks.push(r);
  }
  holeRanks.sort((a, b) => b - a);
  const hiHole = holeRanks[0] ?? 2;
  const loHole = holeRanks[1] ?? 2;
  const isPocketPair = holeRanks.length === 2 && hiHole === loHole;

  // Card-removal blockers to villain's river value-raising range.
  let heroFlushBlockers = 0;
  let heroBlocksNutFlush = false;
  let heroBlocksSecondFlush = false;
  let blockerScore = 0;

  if (flushSuit) {
    const boardSuitRanks = new Set<number>();
    for (const c of board) {
      if (c && c.suit === flushSuit) {
        const r = RANK_TO_NUM[c.rank] ?? 0;
        if (r > 0) boardSuitRanks.add(r);
      }
    }
    const liveFlushRanks: number[] = [];
    for (let r = 14; r >= 2; r--) {
      if (!boardSuitRanks.has(r)) liveFlushRanks.push(r);
    }
    const nutFlushRank = liveFlushRanks[0] ?? 14;
    const secondFlushRank = liveFlushRanks[1] ?? 13;
    for (const c of hole) {
      if (!c || c.suit !== flushSuit) continue;
      heroFlushBlockers++;
      const r = RANK_TO_NUM[c.rank] ?? 0;
      if (r === nutFlushRank) {
        heroBlocksNutFlush = true;
        blockerScore += 0.45;
      } else if (r === secondFlushRank) {
        heroBlocksSecondFlush = true;
        blockerScore += 0.25;
      } else {
        blockerScore += 0.12;
      }
    }
  }

  let heroBlocksTopStraight = false;
  if (topStraightMissingRanks.size > 0) {
    let straightBlockerCards = 0;
    for (const r of holeRanks) {
      if (topStraightMissingRanks.has(r)) {
        heroBlocksTopStraight = true;
        straightBlockerCards++;
      }
    }
    if (straightBlockerCards > 0) {
      const straightWeight = fourToStraightBoard ? 0.22 : 0.14;
      blockerScore += Math.min(0.35, straightBlockerCards * straightWeight);
    }
  }

  let heroBlocksTopBoardRank = false;
  const topAnchorRank = pairedBoard ? topUnpairedBoardRank : topBoardRank;
  if (topAnchorRank > 0) {
    let topMatches = 0;
    for (const r of holeRanks) {
      if (r === topAnchorRank) {
        heroBlocksTopBoardRank = true;
        topMatches++;
      }
    }
    if (topMatches > 0) {
      blockerScore += Math.min(0.24, topMatches * 0.18);
    }
  }

  blockerScore = clamp(blockerScore, 0, 1);

  // Hero hand tier & relative strength inside the bluff-catch class.
  const safeCat = finiteOr(cat, 1);
  let heroHandTier: V67HeroHandTier = 'high_card';
  let heroClassStrength = 0.08;

  if (safeCat <= 1) {
    heroHandTier = 'high_card';
    // Ace-high = 0.22 down to 7-high = 0.05.
    heroClassStrength = lerp(0.05, 0.22, clamp((hiHole - 7) / 7, 0, 1));
  } else {
    // Determine whether hero actually contributes a genuine pair above/beside board pairs.
    let heroPairRank = 0;
    let heroKicker = 2;
    if (isPocketPair) {
      heroPairRank = hiHole;
      heroKicker = hiHole;
    } else {
      for (let i = 0; i < holeRanks.length; i++) {
        const r = holeRanks[i];
        if ((rankCounts.get(r) ?? 0) === 1 && r > heroPairRank) {
          heroPairRank = r;
          heroKicker = holeRanks[i === 0 ? 1 : 0] ?? 2;
        }
      }
    }

    const counterfeitedByDoublePair =
      doublePairedBoard && (heroPairRank === 0 || heroPairRank < lowestBoardPairRank);
    const playingSingleBoardPairOnly = pairedBoard && heroPairRank === 0;

    if (counterfeitedByDoublePair || playingSingleBoardPairOnly) {
      heroHandTier = 'playing_board';
      heroClassStrength = lerp(0.06, 0.22, clamp((hiHole - 7) / 7, 0, 1));
    } else if (isPocketPair && heroPairRank > topBoardRank) {
      heroHandTier = 'overpair';
      heroClassStrength = lerp(0.84, 0.98, clamp((heroPairRank - 5) / 9, 0, 1));
    } else if (heroPairRank >= topUnpairedBoardRank && heroPairRank >= secondBoardRank) {
      heroHandTier = 'top_pair';
      heroClassStrength = lerp(0.62, 0.88, clamp((heroKicker - 2) / 12, 0, 1));
    } else if (heroPairRank >= secondBoardRank && secondBoardRank > 0) {
      heroHandTier = 'middle_pair';
      heroClassStrength = lerp(0.42, 0.6, clamp((heroKicker - 2) / 12, 0, 1));
    } else {
      heroHandTier = 'underpair';
      heroClassStrength = lerp(0.24, 0.4, clamp((heroPairRank - 2) / 12, 0, 1));
    }
  }

  return {
    pairedBoard,
    doublePairedBoard,
    flushPossible,
    fourFlushBoard,
    flushSuit,
    flushBoardCount,
    fourToStraightBoard,
    threeToStraightBoard,
    boardDanger,
    heroFlushBlockers,
    heroBlocksNutFlush,
    heroBlocksSecondFlush,
    heroBlocksTopStraight,
    heroBlocksTopBoardRank,
    blockerScore,
    heroHandTier,
    heroClassStrength,
  };
}

export interface V67VillainRaiseProfile {
  /** Structural slice of OpponentHud packet (zero import coupling to `opponentHud/`). */
  readonly hudOpp?: HoldemHudPacketOpponent | null;
  /** HorseMind style showdown tallies `{ shown, strong }` for the relevant river sizing bucket. */
  readonly styleSizeShown?: { readonly shown: number; readonly strong: number } | null;
  /** Continuous exploit callDownMod (neutral = 1.0; >1 = aggressive/bluff-heavy, <1 = passive/tight). */
  readonly exploitCallDownMod?: number;
  /** Optional explicit measured river bluff-raise rate in [0, 1] with sample count (EB-shrunk). */
  readonly riverRaiseBluffRate?: number;
  readonly riverRaiseBluffSample?: number;
  /** Continuous HorseOpponentStyle aggression axis score in [-1, +1] (0 when unknown). */
  readonly styleAggressionScore?: number;
  /** Continuous HorseOpponentStyle betting-range score in [-1, +1] (+1 value-heavy, -1 bluff-heavy). */
  readonly styleBettingRangeScore?: number;
  /** Confidence cap in [0, 1] for the continuous style axes. */
  readonly styleConfidence?: number;
}

export interface V67RiverRaiseBluffShareResult {
  readonly bluffShare: number;
  readonly preBlockerBluffShare: number;
  readonly empiricalBaseBluffShare: number;
  readonly priorSource: HoldemPriorSource;
}

/**
 * Smooth, strictly deterministic Empirical-Bayes estimator of villain's bluff share
 * when raising over hero's own NLH river bet.
 *
 * Guarantees:
 *   - Non-increasing in `raisePotFrac` (smooth interpolation from medium-bet empirical
 *     showdown anchor `0.50` down to overbet anchor `1.50` — zero step cliff!).
 *   - Strictly increasing in opponent river-raise bluffing / aggression profile.
 *   - Strictly increasing in `blockerScore` (exact Bayes combo-removal update).
 *   - Strictly decreasing in `boardDanger` and `oppCount`.
 */
export function estimateV67RiverRaiseBluffShare(input: {
  readonly raisePotFrac: number;
  readonly boardDanger: number;
  readonly blockerScore: number;
  readonly oppCount: number;
  readonly wasBlockBet?: boolean;
  readonly blockBetFrac?: number;
  readonly villain?: V67VillainRaiseProfile | null;
}): V67RiverRaiseBluffShareResult {
  const raisePotFrac = Math.max(0, finiteOr(input.raisePotFrac, 0.5));
  const boardDanger = clamp(finiteOr(input.boardDanger, 0), 0, 1);
  const blockerScore = clamp(finiteOr(input.blockerScore, 0), 0, 1);
  const oppCount = Math.max(1, Math.floor(finiteOr(input.oppCount, 1)));
  const villain = input.villain ?? null;

  // Consume holdemEmpiricalPriors.ts at smooth sizing anchors (medium 0.50 -> overbet 1.50)
  // so Empirical-Bayes showdown shrinkage stays strictly continuous and monotonic in raise size.
  const medEst = estimateHoldemRiverBluffShare(0.5, villain?.hudOpp, villain?.styleSizeShown);
  const overEst = estimateHoldemRiverBluffShare(1.5, villain?.hudOpp, villain?.styleSizeShown);
  // Ensure the overbet anchor never exceeds the medium anchor even under sparse opposing HUD cells.
  const highSizeMean = Math.min(medEst.mean, overEst.mean);
  const sizeT = clamp((raisePotFrac - 0.35) / 1.15, 0, 1);
  const empiricalBaseBluffShare = lerp(medEst.mean, highSizeMean, sizeT);
  let priorSource: HoldemPriorSource = medEst.source;

  // River raise over hero's bet carries fewer bluffs than a checked-to first bet.
  let base = empiricalBaseBluffShare * V67_RIVER_RAISE_OVER_BET_BLUFF_SCALE;

  // Small river block bets (<= 36% pot) induce wider / slightly bluffier raises.
  if (input.wasBlockBet === true) {
    const bFrac = clamp(finiteOr(input.blockBetFrac, 0.25), 0.05, 0.4);
    const blockInducement = 1 + 0.22 * clamp((0.4 - bFrac) / 0.3, 0.25, 1);
    base *= blockInducement;
  }

  // Multiway pots sharply compress river bluff-raising.
  const multiwayScale = 1 / (1 + 0.45 * (oppCount - 1));
  base *= multiwayScale;

  // Danger boards (4-flush, 4-straight, paired) supply far more natural value-raise combos.
  const dangerScale = 1 - 0.3 * boardDanger;
  base *= dangerScale;

  // Smooth opponent river-raise bluff/aggression profile adjustments (zero binary cliffs).
  let profileShift = 0;

  // 1) Structural OpponentHud river-raise frequency shrinkage (when present, zero opponentHud/ import).
  const hudRiverRaise = readHudOpponentStat(villain?.hudOpp, 'r.raise');
  if (hudRiverRaise) {
    const shrunk = empiricalBayesShrink(
      hudRiverRaise.hits,
      hudRiverRaise.opportunities,
      V67_POOL_RIVER_RAISE_RATE,
      V67_HUD_RAISE_PRIOR_STRENGTH,
      'hud_context'
    );
    profileShift += clamp((shrunk.mean - V67_POOL_RIVER_RAISE_RATE) * 1.4, -0.07, 0.24);
    priorSource = 'hud_context';
  }

  // 2) Continuous exploit callDownMod (1.0 neutral; >1 aggressive/maniac; <1 passive/nit).
  if (villain?.exploitCallDownMod !== undefined && Number.isFinite(villain.exploitCallDownMod)) {
    const modDelta = villain.exploitCallDownMod - 1;
    profileShift += clamp(modDelta * 0.42, -0.07, 0.28);
  }

  // 3) Continuous HorseOpponentStyle aggression & betting-range axes weighted by confidence.
  const styleConf = clamp(finiteOr(villain?.styleConfidence, 0), 0, 1);
  if (styleConf > 0) {
    const aggr = clamp(finiteOr(villain?.styleAggressionScore, 0), -1, 1);
    const betRange = clamp(finiteOr(villain?.styleBettingRangeScore, 0), -1, 1);
    // Positive aggression & negative bettingRange (bluff-weighted) increase bluff share smoothly.
    profileShift += styleConf * (0.08 * aggr - 0.08 * betRange);
  }

  let preBlocker = clamp(
    base + profileShift,
    V67_RIVER_RAISE_BLUFF_FLOOR,
    V67_RIVER_RAISE_BLUFF_CEIL
  );

  // 4) Explicit measured river bluff-raise rate with EB shrinkage (if provided).
  const explicitSample = Math.max(0, finiteOr(villain?.riverRaiseBluffSample, 0));
  if (
    explicitSample > 0 &&
    villain?.riverRaiseBluffRate !== undefined &&
    Number.isFinite(villain.riverRaiseBluffRate)
  ) {
    const clampedRate = clamp(villain.riverRaiseBluffRate, 0, HOLDEM_EMPIRICAL_RIVER_BLUFF_CAP);
    const shrunkExplicit = empiricalBayesShrink(
      clampedRate * explicitSample,
      explicitSample,
      preBlocker,
      HOLDEM_PRIOR_STRENGTH.riverBluffShare,
      'exploit_counters'
    );
    preBlocker = clamp(
      shrunkExplicit.mean,
      V67_RIVER_RAISE_BLUFF_FLOOR,
      V67_RIVER_RAISE_BLUFF_CEIL
    );
    if (priorSource === 'pool_prior') priorSource = 'exploit_counters';
  }

  // Exact Bayes card-removal update: removing `removal` of villain's value combos shifts
  // posterior bluff share strictly upward inside (0, 1).
  const removal = V67_MAX_VALUE_BLOCKER_REMOVAL * blockerScore;
  const denom = preBlocker + (1 - preBlocker) * (1 - removal);
  const bluffShare = clamp(
    denom > EPS ? preBlocker / denom : preBlocker,
    V67_RIVER_RAISE_BLUFF_FLOOR,
    HOLDEM_EMPIRICAL_RIVER_BLUFF_CAP
  );

  return {
    bluffShare,
    preBlockerBluffShare: preBlocker,
    empiricalBaseBluffShare,
    priorSource,
  };
}

export interface V67RiverBetRaisedPricedInput {
  readonly pot: number;
  readonly toCall: number;
  readonly heroStack: number;
  readonly hole: readonly Card[];
  readonly board: readonly Card[];
  readonly cat: number;
  readonly oppCount?: number;
  /** Rake / jackpot deduction fraction on the won pot in [0, 0.25] (0 when unraked). */
  readonly callDeductionFraction?: number;
  /** Optional side-game pot overlay chips (0 when absent). */
  readonly sideGamePotOverlay?: number;
  /** Tournament ICM risk premium in [0, 0.25] (0 in cash or zero-risk tournament spots). */
  readonly icmRisk?: number;
  /** True when hero's river wager was a small block bet (<= 36% pot, Site 2). */
  readonly wasBlockBet?: boolean;
  readonly blockBetFrac?: number;
  readonly villain?: V67VillainRaiseProfile | null;
}

export interface V67RiverBetRaisedPricedVerdict {
  readonly decision: 'call' | 'fold';
  readonly callable: number;
  readonly potAfterCall: number;
  readonly netPotAfterCall: number;
  readonly potOdds: number;
  readonly icmRiskPremium: number;
  readonly requiredEquity: number;
  readonly raisePotFrac: number;
  readonly boardDanger: number;
  readonly blockerScore: number;
  readonly heroHandTier: V67HeroHandTier;
  readonly heroClassStrength: number;
  readonly bluffShare: number;
  readonly winVsValue: number;
  readonly winVsBluff: number;
  readonly posteriorEquity: number;
  readonly evCall: number;
  readonly evCallRiskAdjusted: number;
  readonly evFold: 0;
  readonly priorSource: HoldemPriorSource;
}

/**
 * Pure deterministic EV call-vs-fold verdict for single-board 2-card NLH river
 * bet-then-raised bluff-catch spots (V67 priced replacement).
 *
 * Calls if and only if `evCallRiskAdjusted > 0` (exact tie folds); never jams or re-raises.
 * All non-finite or adversarial inputs fail closed to a completely finite `'fold'` verdict.
 */
export function priceV67RiverBetRaisedOnePair(
  input: V67RiverBetRaisedPricedInput
): V67RiverBetRaisedPricedVerdict {
  const analysis = analyzeV67RiverBoardAndBlockers(
    Array.isArray(input.hole) ? input.hole : [],
    Array.isArray(input.board) ? input.board : [],
    finiteOr(input.cat, 1)
  );

  const potValid = Number.isFinite(input.pot) && input.pot > 0;
  const toCallValid = Number.isFinite(input.toCall) && input.toCall > 0;
  const stackValid = Number.isFinite(input.heroStack) && input.heroStack >= 0;

  if (!potValid || !toCallValid || !stackValid) {
    return {
      decision: 'fold',
      callable: 0,
      potAfterCall: 0,
      netPotAfterCall: 0,
      potOdds: 1,
      icmRiskPremium: 0,
      requiredEquity: 1,
      raisePotFrac: 0,
      boardDanger: analysis.boardDanger,
      blockerScore: analysis.blockerScore,
      heroHandTier: analysis.heroHandTier,
      heroClassStrength: analysis.heroClassStrength,
      bluffShare: V67_RIVER_RAISE_BLUFF_FLOOR,
      winVsValue: 0,
      winVsBluff: 0,
      posteriorEquity: 0,
      evCall: 0,
      evCallRiskAdjusted: 0,
      evFold: 0,
      priorSource: 'pool_prior',
    };
  }

  const pot = input.pot;
  const heroStack = input.heroStack;
  const callable = Math.max(0, Math.min(input.toCall, heroStack));
  const potAfterCall = pot + callable;
  const deduction = clamp(finiteOr(input.callDeductionFraction, 0), 0, 0.25);
  const sideOverlay = Math.max(0, finiteOr(input.sideGamePotOverlay, 0));
  const netPotAfterCall = potAfterCall * (1 - deduction) + sideOverlay;
  const potOdds = netPotAfterCall > EPS ? clamp(callable / netPotAfterCall, 0, 1) : 1;
  const icmRiskPremium = clamp(finiteOr(input.icmRisk, 0), 0, V67_MAX_ICM_RISK_PREMIUM);
  const requiredEquity = clamp(potOdds + icmRiskPremium, 0, 1);

  // Pot before villain's raise increment (bounded below so over-shoves stay finite).
  const potBeforeRaise = Math.max(EPS, pot - input.toCall);
  const raisePotFrac =
    pot > input.toCall + EPS ? input.toCall / potBeforeRaise : input.toCall / Math.max(EPS, pot);

  const bluffEst = estimateV67RiverRaiseBluffShare({
    raisePotFrac,
    boardDanger: analysis.boardDanger,
    blockerScore: analysis.blockerScore,
    oppCount: Math.max(1, Math.floor(finiteOr(input.oppCount, 1))),
    wasBlockBet: input.wasBlockBet,
    blockBetFrac: input.blockBetFrac,
    villain: input.villain,
  });

  // Hero's conditional win probability against villain's value-raising range:
  // tapers smoothly downward with boardDanger and raisePotFrac, and rises with hero pair tier.
  const dryThinValuePool =
    0.22 * (1 - 0.85 * analysis.boardDanger) * (1 - 0.6 * clamp((raisePotFrac - 0.3) / 1.2, 0, 1));
  const heroThinDom =
    analysis.heroHandTier === 'high_card' || analysis.heroHandTier === 'playing_board'
      ? 0
      : Math.pow(clamp((analysis.heroClassStrength - 0.22) / 0.76, 0, 1), 1.6);
  const winVsValue = clamp(dryThinValuePool * heroThinDom, 0, 0.25);

  // Hero's conditional win probability against villain's bluff-raising range.
  const winVsBluff =
    analysis.heroHandTier === 'high_card' || analysis.heroHandTier === 'playing_board'
      ? lerp(0.3, 0.82, clamp(analysis.heroClassStrength / 0.22, 0, 1))
      : clamp(0.9 + 0.08 * analysis.heroClassStrength, 0.9, 0.98);

  const posteriorEquity = clamp(
    bluffEst.bluffShare * winVsBluff + (1 - bluffEst.bluffShare) * winVsValue,
    0,
    1
  );

  const evCall = posteriorEquity * netPotAfterCall - callable;
  const evCallRiskAdjusted = (posteriorEquity - requiredEquity) * netPotAfterCall;
  const decision: 'call' | 'fold' = callable > 0 && evCallRiskAdjusted > EPS ? 'call' : 'fold';

  return {
    decision,
    callable,
    potAfterCall,
    netPotAfterCall,
    potOdds,
    icmRiskPremium,
    requiredEquity,
    raisePotFrac,
    boardDanger: analysis.boardDanger,
    blockerScore: analysis.blockerScore,
    heroHandTier: analysis.heroHandTier,
    heroClassStrength: analysis.heroClassStrength,
    bluffShare: bluffEst.bluffShare,
    winVsValue,
    winVsBluff,
    posteriorEquity,
    evCall,
    evCallRiskAdjusted,
    evFold: 0,
    priorSource: bluffEst.priorSource,
  };
}
