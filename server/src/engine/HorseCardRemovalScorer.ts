/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HORSE COMBINATORIAL CARD-REMOVAL SCORER (Wave 2 Enhancement #2)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Zero-allocation combinatorial card-removal (blocker & unblocker) scorer
 * across NLH, PLO4, PLO5, and PLO6.
 *
 * Why card removal changes EV in both directions:
 *   1. POSITIVE BLOCKER VALUE (`valueBlockerScore`):
 *      - Holding the Nut Flush blocker (`A` of a 3+ flush suit on an unpaired
 *        board in NLH, or `omahaFlushBlocker.blocksNutFlush` in PLO4/5/6 —
 *        remembering an Omaha player needs a SECOND card of that suit to make
 *        the flush, so holding a bare `As` blocks 100% of nut flushes!).
 *      - Holding top-rank / paired-board rank blockers that remove villain's
 *        top full houses (`AA`, top boat) and quads on paired boards.
 *      - Holding key straight-completing rank blockers (`nutStraightBlockers`)
 *        on 3-to-a-straight / 4-to-a-straight runouts without holding the made
 *        straight itself.
 *   2. NEGATIVE BLOCKER PENALTY / UNBLOCKER BONUS (`foldBlockerPenalty`, `unblockerBonus`):
 *      - On a river where a front-door flush draw MISSED (two cards of suit S
 *        on flop/turn, brick river), holding cards of suit S blocks villain's
 *        busted flush draws (the exact hands that FOLD to a river bluff!).
 *      - Conversely, holding clean cards OUTSIDE missed front-door draw suits
 *        and busted low-wrap ranks UNBLOCKS villain's auto-fold range!
 */

import type { Card } from '../types.js';
import type { VariantInfo } from './HorseEval.js';
import { RANK_VALUES } from './PokerEngine.js';
import { omahaFlushBlocker } from './OmahaFlushBlocker.js';

const SUIT_INDEX_MAP: Record<string, number> = {
  hearts: 0,
  diamonds: 1,
  clubs: 2,
  spades: 3,
};

function rankVal(rank: string): number {
  return RANK_VALUES[rank as Card['rank']] ?? 0;
}

function suitIdx(suit: string): number {
  return SUIT_INDEX_MAP[suit] ?? 0;
}

export interface CardRemovalScore {
  /** `[0 .. 1]` score for removing villain's nut/continue combinations. */
  valueBlockerScore: number;
  /** `[0 .. 1]` penalty for blocking villain's missed-draw / fold combinations on bricked rivers. */
  foldBlockerPenalty: number;
  /** `[0 .. 1]` bonus for unblocking missed front-door draws while blocking top continues. */
  unblockerBonus: number;
  /** Signed additive fold-equity adjustment (`-0.08 .. +0.12`) for `HorseEvEngine` & bluff gates. */
  netFoldEquityDelta: number;
  /** True when hero holds a genuine nut-flush, top-boat, or nut-straight key blocker without blocking folds. */
  certifiedNutBluffBlocker: boolean;
  blocksNutFlush: boolean;
  blocksTopBoatOrQuads: boolean;
  blocksNutStraight: boolean;
}

const NEUTRAL_SCORE: CardRemovalScore = {
  valueBlockerScore: 0,
  foldBlockerPenalty: 0,
  unblockerBonus: 0,
  netFoldEquityDelta: 0,
  certifiedNutBluffBlocker: false,
  blocksNutFlush: false,
  blocksTopBoatOrQuads: false,
  blocksNutStraight: false,
};

/**
 * Score combinatorial blockers and unblockers for `hole` on `board` under `vi`.
 * Pure arithmetic + bitmasks — zero heap allocations on hot path beyond the small return object.
 */
export function scoreCardRemoval(
  hole: readonly Card[],
  board: readonly Card[],
  vi: VariantInfo
): CardRemovalScore {
  if (board.length < 3 || hole.length === 0) return NEUTRAL_SCORE;

  const isOmaha = vi.isOmaha;
  const isShortDeck = vi.isShortDeck === true;
  const minDeckRank = isShortDeck ? 6 : 2;
  const wheelAceRank = isShortDeck ? 5 : 1;
  const holeCount = hole.length;
  // In 5/6-card Omaha, random blockers are more diluted than in 2-card NLH / 4-card PLO4,
  // EXCEPT a bare Ace of the flush suit (which still removes 100% of nut flushes!).
  const cardDilution = !isOmaha ? 1.0 : holeCount <= 4 ? 0.9 : holeCount === 5 ? 0.78 : 0.68;

  let bSuit0 = 0;
  let bSuit1 = 0;
  let bSuit2 = 0;
  let bSuit3 = 0;
  let boardRankMask = 0;
  let boardPairMask = 0;
  let topBoardRank = 0;
  let topPairBoardRank = 0;
  const boardRankCounts = new Uint8Array(15);

  // Track flop/turn 2-suit front-door draw suits for river unblocker math:
  let ftSuit0 = 0;
  let ftSuit1 = 0;
  let ftSuit2 = 0;
  let ftSuit3 = 0;

  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    const r = rankVal(c.rank);
    boardRankCounts[r]++;
    if (r > topBoardRank) topBoardRank = r;
    const bit = 1 << r;
    if ((boardRankMask & bit) !== 0) {
      boardPairMask |= bit;
      if (r > topPairBoardRank) topPairBoardRank = r;
    }
    boardRankMask |= bit;
    if (r === 14) boardRankMask |= 1 << wheelAceRank;

    const s = suitIdx(c.suit);
    if (s === 0) bSuit0++;
    else if (s === 1) bSuit1++;
    else if (s === 2) bSuit2++;
    else bSuit3++;

    if (i < 4) {
      if (s === 0) ftSuit0++;
      else if (s === 1) ftSuit1++;
      else if (s === 2) ftSuit2++;
      else ftSuit3++;
    }
  }

  const pairedBoard = boardPairMask !== 0;
  const maxBoardSuitCount = Math.max(bSuit0, bSuit1, bSuit2, bSuit3);
  let flushSuit = -1;
  if (maxBoardSuitCount >= 3) {
    if (bSuit0 === maxBoardSuitCount) flushSuit = 0;
    else if (bSuit1 === maxBoardSuitCount) flushSuit = 1;
    else if (bSuit2 === maxBoardSuitCount) flushSuit = 2;
    else flushSuit = 3;
  }

  // 1. Nut-flush blocker check:
  let blocksNutFlush = false;
  let valueBlockerScore = 0;

  if (flushSuit >= 0 && !pairedBoard) {
    if (isOmaha) {
      const ofb = omahaFlushBlocker(hole, board, hole.length);
      if (ofb.blocksNutFlush && !ofb.madeFlush) {
        blocksNutFlush = true;
        // Bare nut-flush blocker removes 100% of villain's nut flushes even in PLO5/PLO6!
        valueBlockerScore += ofb.nutRank === 'A' ? 0.62 : 0.48;
      }
    } else {
      // Hold'em / Short Deck: find highest missing card of `flushSuit` not already on board
      let boardFlushRankMask = 0;
      for (let i = 0; i < board.length; i++) {
        if (suitIdx(board[i].suit) === flushSuit) {
          boardFlushRankMask |= 1 << rankVal(board[i].rank);
        }
      }
      let targetRank = 14;
      while (targetRank > minDeckRank && (boardFlushRankMask & (1 << targetRank)) !== 0) {
        targetRank--;
      }
      let heroSuitCount = 0;
      let holdsTarget = false;
      for (let i = 0; i < hole.length; i++) {
        if (suitIdx(hole[i].suit) === flushSuit) {
          heroSuitCount++;
          if (rankVal(hole[i].rank) === targetRank) holdsTarget = true;
        }
      }
      // On a 3-flush board, hero with 1 card of suit (`targetRank`) doesn't have a flush yet; blocks nut flush!
      // On a 4-flush board, hero with `targetRank` actually HAS the nut flush (value, not bluff blocker).
      if (holdsTarget && maxBoardSuitCount === 3 && heroSuitCount === 1) {
        blocksNutFlush = true;
        valueBlockerScore += 0.6;
      }
    }
  }

  // 2. Top-boat / Quads blocker check on paired boards (excluding hero already making trips/boat/quads):
  let blocksTopBoatOrQuads = false;
  if (pairedBoard) {
    let topRankBlockers = 0;
    let pairedRankBlockers = 0;
    const holeRankCounts = new Uint8Array(15);
    for (let i = 0; i < hole.length; i++) {
      const r = rankVal(hole[i].rank);
      holeRankCounts[r]++;
      if (r === topBoardRank) topRankBlockers++;
      if (r === topPairBoardRank) pairedRankBlockers++;
    }
    let heroMakesTripsOrBetter = false;
    for (let r = minDeckRank; r <= 14; r++) {
      const usableHole = isOmaha ? Math.min(2, holeRankCounts[r]) : holeRankCounts[r];
      if (usableHole > 0 && usableHole + boardRankCounts[r] >= 3) {
        heroMakesTripsOrBetter = true;
        break;
      }
    }
    if (!heroMakesTripsOrBetter) {
      // In Omaha, holding two of `topBoardRank` (when `topBoardRank !== topPairBoardRank`) removes almost all top boats!
      if (topBoardRank !== topPairBoardRank && topRankBlockers >= (isOmaha ? 2 : 1)) {
        blocksTopBoatOrQuads = true;
        valueBlockerScore += (topRankBlockers >= 2 ? 0.46 : 0.3) * cardDilution;
      } else if (pairedRankBlockers >= 1 && topRankBlockers >= 1) {
        blocksTopBoatOrQuads = true;
        valueBlockerScore += 0.38 * cardDilution;
      }
    }
  }

  // 3. Nut-straight key rank blocker on unpaired, non-flush boards:
  let blocksNutStraight = false;
  if (!pairedBoard && flushSuit < 0) {
    // Find highest 5-rank straight window with >= 3 board ranks present (min high = 9 in 6+, 5 in 52-card):
    let bestHigh = 0;
    let missingMask = 0;
    const minStraightHigh = isShortDeck ? 9 : 5;
    for (let high = 14; high >= minStraightHigh; high--) {
      const low = high - 4;
      let bCnt = 0;
      let mMask = 0;
      for (let k = 0; k < 5; k++) {
        const rk = low + k;
        const bit = 1 << (rk === wheelAceRank ? 14 : rk);
        if ((boardRankMask & bit) !== 0) bCnt++;
        else mMask |= bit;
      }
      if (bCnt >= 3) {
        bestHigh = high;
        missingMask = mMask;
        break;
      }
    }
    if (bestHigh > 0 && missingMask !== 0) {
      let heroBlockerHits = 0;
      let heroDistinctMask = 0;
      for (let i = 0; i < hole.length; i++) {
        const r = rankVal(hole[i].rank);
        const bit = 1 << r;
        if ((missingMask & bit) !== 0) {
          heroBlockerHits++;
          heroDistinctMask |= bit;
        }
      }
      // If hero holds ALL missing ranks (and <= 2 missing ranks), hero actually HAS the nut straight (not a bluff blocker).
      let missingDistinctCount = 0;
      for (let r = minDeckRank; r <= 14; r++) {
        if ((missingMask & (1 << r)) !== 0) missingDistinctCount++;
      }
      const heroMakesNutStraight = missingDistinctCount <= 2 && heroDistinctMask === missingMask;
      if (!heroMakesNutStraight && heroBlockerHits >= (isOmaha ? 2 : 1)) {
        blocksNutStraight = true;
        const baseStraightBlocker =
          !isOmaha && missingDistinctCount === 2 && heroBlockerHits === 1 ? 0.18 : 0.22;
        valueBlockerScore += Math.min(
          0.42,
          (baseStraightBlocker + 0.1 * heroBlockerHits) * cardDilution
        );
      }
    }
  }

  // 4. Missed-draw fold-blocker penalty & unblocker bonus (especially on River!):
  let foldBlockerPenalty = 0;
  let unblockerBonus = 0;

  if (board.length === 5) {
    // Check every suit that had a 2-card front-door flush draw on flop/turn (`ftSuit >= 2`) and MISSED (`bSuit === 2`):
    const bSuits = [bSuit0, bSuit1, bSuit2, bSuit3];
    const ftSuits = [ftSuit0, ftSuit1, ftSuit2, ftSuit3];
    let missedFlushSuits = 0;
    let heroMissedFlushCards = 0;

    for (let s = 0; s < 4; s++) {
      if (ftSuits[s] >= 2 && bSuits[s] === 2) {
        missedFlushSuits++;
        for (let i = 0; i < hole.length; i++) {
          if (suitIdx(hole[i].suit) === s) heroMissedFlushCards++;
        }
      }
    }

    if (missedFlushSuits > 0) {
      if (heroMissedFlushCards >= 2) {
        // Hero holds 2+ cards of the missed flush draw — strongly blocks villain's busted flush draws!
        foldBlockerPenalty += Math.min(
          0.48,
          (0.24 + 0.08 * (heroMissedFlushCards - 2)) * cardDilution
        );
      } else if (heroMissedFlushCards === 1) {
        foldBlockerPenalty += isOmaha ? 0.07 * cardDilution : 0.14;
      } else if (heroMissedFlushCards === 0) {
        // Zero cards in the missed front-door flush suit = clean unblocker of villain's auto-folds!
        unblockerBonus += 0.22;
      }
    } else if (flushSuit >= 0 && blocksNutFlush) {
      // On a 3-flush river where hero holds ONLY the nut blocker (1 card of `flushSuit`), hero leaves maximum non-nut flush / air folds unblocked:
      let heroFlushSuitCards = 0;
      for (let i = 0; i < hole.length; i++) {
        if (suitIdx(hole[i].suit) === flushSuit) heroFlushSuitCards++;
      }
      if (heroFlushSuitCards === 1) unblockerBonus += 0.14;
    }
  }

  valueBlockerScore = Math.min(1, valueBlockerScore);
  foldBlockerPenalty = Math.min(1, foldBlockerPenalty);
  unblockerBonus = Math.min(1, unblockerBonus);

  const rawDelta = valueBlockerScore * 0.14 + unblockerBonus * 0.08 - foldBlockerPenalty * 0.14;
  const netFoldEquityDelta = Math.max(-0.08, Math.min(0.12, rawDelta));

  const certifiedNutBluffBlocker =
    (blocksNutFlush || blocksTopBoatOrQuads || blocksNutStraight) &&
    valueBlockerScore >= 0.34 &&
    foldBlockerPenalty < valueBlockerScore * 0.65 &&
    netFoldEquityDelta >= 0.03;

  return {
    valueBlockerScore,
    foldBlockerPenalty,
    unblockerBonus,
    netFoldEquityDelta,
    certifiedNutBluffBlocker,
    blocksNutFlush,
    blocksTopBoatOrQuads,
    blocksNutStraight,
  };
}
