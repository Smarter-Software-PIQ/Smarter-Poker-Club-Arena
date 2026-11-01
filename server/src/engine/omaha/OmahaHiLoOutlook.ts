/**
 * OMAHA HI-LO 8-OR-BETTER (PLO8 / FLO8) RUNOUT & SETTLEMENT OUTLOOK
 *
 * Domain-specific before/after low-hand qualification, exact two-hole and
 * three-board witness indices, nut-low / tie / counterfeit transitions, and
 * high/low scoop/quarter settlement.
 *
 * Keeps high-hand category outlook (omahaCardFacts / nextCardOutlook) and
 * 8-or-better low qualification / split-pot settlement explicitly separate,
 * enforcing the exact Omaha two-hole + three-board rule across all 6xC(b,3)
 * combinations without mutating existing high-only hashes.
 */

import type { Card, CardRank, Pot, SeatPlayer, Winner, PerPotAward } from '../../types.js';
import {
  RANK_VALUES,
  compareHands,
  compareLowHands,
  determineWinners,
  evaluateOmahaHand,
  evaluateOmahaLowHand,
} from '../PokerEngine.js';

export type LowRankTuple = readonly [number, number, number, number, number];

export interface OmahaLowWitness {
  /** Desc-sorted Ace-as-1 low ranks (e.g. [8, 4, 3, 2, 1] for 8-4-3-2-A). */
  readonly lowRanks: LowRankTuple;
  /** Exact 0-based indices of the 2 hole cards used (i < j). */
  readonly holeIndices: readonly [number, number];
  /** Exact 0-based indices of the 3 board cards used (i < j < k). */
  readonly boardIndices: readonly [number, number, number];
  /** Formatted low description matching PokerEngine ("Low: 8-4-3-2-1"). */
  readonly description: string;
}

export interface OmahaBoardLowSurface {
  /** Whether the board has at least 3 distinct ranks <= 8 (Ace counts as 1). */
  readonly lowPossible: boolean;
  /** Best possible 5-card low rank tuple achievable on this board by any 2 unseen hole cards, or null if no low is possible. */
  readonly nutLowRanks: LowRankTuple | null;
}

export type HiLoLowTransitionKind =
  | 'no_low_possible'
  | 'no_hero_low'
  | 'made_low_from_none'
  | 'improved_low'
  | 'retained_nut_low'
  | 'retained_non_nut_low'
  | 'counterfeited_lose_nut'
  | 'counterfeited_worsened';

export interface OmahaHiLoRunoutFact {
  readonly nextCard: Card;
  readonly beforeLow: OmahaLowWitness | null;
  readonly afterLow: OmahaLowWitness | null;
  readonly beforeBoardSurface: OmahaBoardLowSurface;
  readonly afterBoardSurface: OmahaBoardLowSurface;
  readonly heroHasNutLowBefore: boolean;
  readonly heroHasNutLowAfter: boolean;
  /** True when one of hero's prior low-witness hole cards was duplicated on the new board card. */
  readonly witnessCardDuplicatedOnBoard: boolean;
  readonly transition: HiLoLowTransitionKind;
  /** If an opponent holds `opponentHole`, compares hero vs opponent after `nextCard` on both high and low halves. */
  readonly headToHeadAfter?: {
    readonly opponentLow: OmahaLowWitness | null;
    readonly highOutcome: 'hero' | 'opponent' | 'tie';
    readonly lowOutcome: 'hero' | 'opponent' | 'tie' | 'no_low';
    readonly potShareHero: number;
    readonly potShareOpponent: number;
    readonly settlementClass:
      | 'hero_scoop'
      | 'opponent_scoop'
      | 'split_half'
      | 'hero_three_quarters'
      | 'opponent_three_quarters'
      | 'chopped_no_low';
  };
}

function lowRankValue(rank: CardRank): number {
  return rank === 'A' ? 1 : RANK_VALUES[rank];
}

function cardKey(card: Card): string {
  return `${card.rank}:${card.suit}`;
}

export function assertDisjointPhysicalCards(groups: ReadonlyArray<ReadonlyArray<Card>>): void {
  const seen = new Set<string>();
  for (const group of groups) {
    for (const card of group) {
      if (!card || !card.rank || !card.suit) {
        throw new Error('Invalid physical card in Hi-Lo outlook');
      }
      const key = cardKey(card);
      if (seen.has(key)) {
        throw new Error(`Duplicate physical card refused: ${key}`);
      }
      seen.add(key);
    }
  }
}

/**
 * Enumerates all C(hole.length, 2) x C(board.length, 3) combinations and returns
 * the best qualifying 8-or-better low hand together with its exact (holeIndices, boardIndices)
 * witness. Ties in low rank preserve the lexicographically earliest index pair/triple.
 */
export function evaluateOmahaLowWithWitness(
  holeCards: readonly Card[],
  communityCards: readonly Card[]
): OmahaLowWitness | null {
  if (holeCards.length < 2 || communityCards.length < 3) return null;
  assertDisjointPhysicalCards([holeCards, communityCards]);

  let bestRanks: LowRankTuple | null = null;
  let bestHoleIndices: readonly [number, number] | null = null;
  let bestBoardIndices: readonly [number, number, number] | null = null;

  for (let h1 = 0; h1 < holeCards.length - 1; h1++) {
    for (let h2 = h1 + 1; h2 < holeCards.length; h2++) {
      const rH1 = lowRankValue(holeCards[h1].rank);
      const rH2 = lowRankValue(holeCards[h2].rank);
      if (rH1 > 8 || rH2 > 8 || rH1 === rH2) continue;

      for (let b1 = 0; b1 < communityCards.length - 2; b1++) {
        const rB1 = lowRankValue(communityCards[b1].rank);
        if (rB1 > 8 || rB1 === rH1 || rB1 === rH2) continue;

        for (let b2 = b1 + 1; b2 < communityCards.length - 1; b2++) {
          const rB2 = lowRankValue(communityCards[b2].rank);
          if (rB2 > 8 || rB2 === rH1 || rB2 === rH2 || rB2 === rB1) continue;

          for (let b3 = b2 + 1; b3 < communityCards.length; b3++) {
            const rB3 = lowRankValue(communityCards[b3].rank);
            if (rB3 > 8 || rB3 === rH1 || rB3 === rH2 || rB3 === rB1 || rB3 === rB2) {
              continue;
            }
            const sorted = [rH1, rH2, rB1, rB2, rB3].sort(
              (a, b) => b - a
            ) as unknown as LowRankTuple;
            if (
              !bestRanks ||
              compareLowHands(sorted as unknown as number[], bestRanks as unknown as number[]) < 0
            ) {
              bestRanks = sorted;
              bestHoleIndices = [h1, h2];
              bestBoardIndices = [b1, b2, b3];
            }
          }
        }
      }
    }
  }

  if (!bestRanks || !bestHoleIndices || !bestBoardIndices) return null;
  return {
    lowRanks: bestRanks,
    holeIndices: bestHoleIndices,
    boardIndices: bestBoardIndices,
    description: `Low: ${bestRanks.join('-')}`,
  };
}

/**
 * Computes whether a qualifying low is possible on `communityCards` and the best
 * (nut) 5-card low rank tuple achievable by any two low hole ranks not paired with
 * the chosen 3 board low ranks.
 */
export function evaluateBoardLowSurface(communityCards: readonly Card[]): OmahaBoardLowSurface {
  if (communityCards.length < 3) {
    return { lowPossible: false, nutLowRanks: null };
  }
  assertDisjointPhysicalCards([communityCards]);

  let nutLowRanks: LowRankTuple | null = null;
  for (let b1 = 0; b1 < communityCards.length - 2; b1++) {
    const rB1 = lowRankValue(communityCards[b1].rank);
    if (rB1 > 8) continue;
    for (let b2 = b1 + 1; b2 < communityCards.length - 1; b2++) {
      const rB2 = lowRankValue(communityCards[b2].rank);
      if (rB2 > 8 || rB2 === rB1) continue;
      for (let b3 = b2 + 1; b3 < communityCards.length; b3++) {
        const rB3 = lowRankValue(communityCards[b3].rank);
        if (rB3 > 8 || rB3 === rB1 || rB3 === rB2) continue;

        const pickedHole: number[] = [];
        for (let r = 1; r <= 8 && pickedHole.length < 2; r++) {
          if (r !== rB1 && r !== rB2 && r !== rB3) {
            pickedHole.push(r);
          }
        }
        if (pickedHole.length < 2) continue;
        const candidate = [rB1, rB2, rB3, pickedHole[0], pickedHole[1]].sort(
          (a, b) => b - a
        ) as unknown as LowRankTuple;
        if (
          !nutLowRanks ||
          compareLowHands(candidate as unknown as number[], nutLowRanks as unknown as number[]) < 0
        ) {
          nutLowRanks = candidate;
        }
      }
    }
  }

  return {
    lowPossible: nutLowRanks !== null,
    nutLowRanks,
  };
}

/**
 * Evaluates a single turn/river runout card in PLO8/FLO8, reporting before/after
 * low rank tuples, exact 2-hole/3-board witness indices, nut/counterfeit status,
 * and optional head-to-head high/low scoop/quarter settlement through `determineWinners`.
 */
export function evaluateOmahaHiLoRunout(
  heroHole: readonly Card[],
  boardBefore: readonly Card[],
  nextCard: Card,
  opponentHole?: readonly Card[],
  potAmount = 100
): OmahaHiLoRunoutFact {
  if (heroHole.length < 4) {
    throw new Error('Omaha Hi-Lo runout requires at least 4 hero hole cards');
  }
  if (boardBefore.length < 3 || boardBefore.length > 4) {
    throw new Error('Omaha Hi-Lo runout requires a 3-card flop or 4-card turn board');
  }
  if (opponentHole) {
    if (opponentHole.length < 4) {
      throw new Error('Omaha Hi-Lo opponent requires at least 4 hole cards');
    }
    assertDisjointPhysicalCards([heroHole, boardBefore, [nextCard], opponentHole]);
  } else {
    assertDisjointPhysicalCards([heroHole, boardBefore, [nextCard]]);
  }

  const boardAfter = [...boardBefore, nextCard];
  const beforeLow = evaluateOmahaLowWithWitness(heroHole, boardBefore);
  const afterLow = evaluateOmahaLowWithWitness(heroHole, boardAfter);
  const beforeBoardSurface = evaluateBoardLowSurface(boardBefore);
  const afterBoardSurface = evaluateBoardLowSurface(boardAfter);

  const heroHasNutLowBefore = Boolean(
    beforeLow &&
    beforeBoardSurface.nutLowRanks &&
    compareLowHands(
      beforeLow.lowRanks as unknown as number[],
      beforeBoardSurface.nutLowRanks as unknown as number[]
    ) === 0
  );
  const heroHasNutLowAfter = Boolean(
    afterLow &&
    afterBoardSurface.nutLowRanks &&
    compareLowHands(
      afterLow.lowRanks as unknown as number[],
      afterBoardSurface.nutLowRanks as unknown as number[]
    ) === 0
  );

  const nextLowVal = lowRankValue(nextCard.rank);
  const witnessCardDuplicatedOnBoard = Boolean(
    beforeLow &&
    (lowRankValue(heroHole[beforeLow.holeIndices[0]].rank) === nextLowVal ||
      lowRankValue(heroHole[beforeLow.holeIndices[1]].rank) === nextLowVal)
  );

  let transition: HiLoLowTransitionKind;
  if (!afterBoardSurface.lowPossible) {
    transition = 'no_low_possible';
  } else if (!afterLow) {
    transition = 'no_hero_low';
  } else if (!beforeLow) {
    transition = 'made_low_from_none';
  } else {
    const cmp = compareLowHands(
      afterLow.lowRanks as unknown as number[],
      beforeLow.lowRanks as unknown as number[]
    );
    if (cmp < 0) {
      transition = 'improved_low';
    } else if (cmp > 0) {
      transition = 'counterfeited_worsened';
    } else if (heroHasNutLowBefore && !heroHasNutLowAfter) {
      transition = 'counterfeited_lose_nut';
    } else if (heroHasNutLowAfter) {
      transition = 'retained_nut_low';
    } else {
      transition = 'retained_non_nut_low';
    }
  }

  if (!opponentHole) {
    return {
      nextCard,
      beforeLow,
      afterLow,
      beforeBoardSurface,
      afterBoardSurface,
      heroHasNutLowBefore,
      heroHasNutLowAfter,
      witnessCardDuplicatedOnBoard,
      transition,
    };
  }

  const opponentLow = evaluateOmahaLowWithWitness(opponentHole, boardAfter);
  const heroHigh = evaluateOmahaHand([...heroHole], boardAfter);
  const oppHigh = evaluateOmahaHand([...opponentHole], boardAfter);
  const hiCmp = compareHands(heroHigh, oppHigh);
  const highOutcome: 'hero' | 'opponent' | 'tie' =
    hiCmp > 0 ? 'hero' : hiCmp < 0 ? 'opponent' : 'tie';

  let lowOutcome: 'hero' | 'opponent' | 'tie' | 'no_low' = 'no_low';
  const engineHeroLow = evaluateOmahaLowHand([...heroHole], boardAfter);
  const engineOppLow = evaluateOmahaLowHand([...opponentHole], boardAfter);
  if (engineHeroLow && engineOppLow) {
    const loCmp = compareLowHands(engineHeroLow.kickers, engineOppLow.kickers);
    lowOutcome = loCmp < 0 ? 'hero' : loCmp > 0 ? 'opponent' : 'tie';
  } else if (engineHeroLow) {
    lowOutcome = 'hero';
  } else if (engineOppLow) {
    lowOutcome = 'opponent';
  }

  const players: SeatPlayer[] = [
    {
      seat: 1,
      user_id: 'hero',
      username: 'Hero',
      stack: 0,
      bet: potAmount / 2,
      totalInvested: potAmount / 2,
      cards: [...heroHole],
      is_folded: false,
      is_all_in: true,
      is_sitting_out: false,
    },
    {
      seat: 2,
      user_id: 'opponent',
      username: 'Opponent',
      stack: 0,
      bet: potAmount / 2,
      totalInvested: potAmount / 2,
      cards: [...opponentHole],
      is_folded: false,
      is_all_in: true,
      is_sitting_out: false,
    },
  ];
  const pots: Pot[] = [{ amount: potAmount, eligiblePlayers: ['hero', 'opponent'] }];
  const perPotOut: PerPotAward[] = [];
  const winners: Winner[] = determineWinners(
    players,
    boardAfter,
    pots,
    'plo8',
    1,
    perPotOut,
    undefined,
    0.01
  );

  const heroAward = winners.find((w) => w.userId === 'hero')?.amount ?? 0;
  const oppAward = winners.find((w) => w.userId === 'opponent')?.amount ?? 0;
  const potShareHero = Math.round((heroAward / potAmount) * 10000) / 10000;
  const potShareOpponent = Math.round((oppAward / potAmount) * 10000) / 10000;

  let settlementClass: NonNullable<OmahaHiLoRunoutFact['headToHeadAfter']>['settlementClass'];
  if (Math.abs(potShareHero - 1) < 1e-4) {
    settlementClass = 'hero_scoop';
  } else if (Math.abs(potShareOpponent - 1) < 1e-4) {
    settlementClass = 'opponent_scoop';
  } else if (Math.abs(potShareHero - 0.75) < 1e-4) {
    settlementClass = 'hero_three_quarters';
  } else if (Math.abs(potShareOpponent - 0.75) < 1e-4) {
    settlementClass = 'opponent_three_quarters';
  } else if (lowOutcome === 'no_low') {
    settlementClass = 'chopped_no_low';
  } else {
    settlementClass = 'split_half';
  }

  return {
    nextCard,
    beforeLow,
    afterLow,
    beforeBoardSurface,
    afterBoardSurface,
    heroHasNutLowBefore,
    heroHasNutLowAfter,
    witnessCardDuplicatedOnBoard,
    transition,
    headToHeadAfter: {
      opponentLow,
      highOutcome,
      lowOutcome,
      potShareHero,
      potShareOpponent,
      settlementClass,
    },
  };
}
