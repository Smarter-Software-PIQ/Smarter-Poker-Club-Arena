import type { Card } from '../../types.js';
import type { EquityOptions } from './equityWorker.js';

// Bounds follow the supported ten seats, six hole cards, five board cards
// and single 52-card deck. Project only calculator data: caller-owned state
// and arbitrary object properties must never be retained by a queued request.
const RANKS = new Set(['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']);
const SUITS = new Set(['clubs', 'diamonds', 'hearts', 'spades']);

function cards(value: Card[], maximum: number): Card[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error('Equity card input exceeds supported bounds');
  return Array.from(value, (card) => {
    if (!card || !RANKS.has(card.rank) || !SUITS.has(card.suit))
      throw new Error('Invalid equity card');
    return { rank: card.rank, suit: card.suit };
  });
}

export function snapshotEquityCards(hands: Card[][], board: Card[], deadCards: Card[] = []) {
  if (!Array.isArray(hands) || hands.length > 10) throw new Error('Equity field exceeds ten seats');
  return {
    hands: Array.from(hands, (hand) => cards(hand, 6)),
    board: cards(board, 5),
    deadCards: cards(deadCards, 52),
  };
}

export function snapshotEquityOptions(options: EquityOptions, players: number): EquityOptions {
  const result: EquityOptions = {};
  for (const key of ['shortDeck', 'omaha', 'hiLo', 'exact'] as const) {
    if (options[key] !== undefined) {
      if (typeof options[key] !== 'boolean') throw new Error('Invalid equity option');
      result[key] = options[key];
    }
  }
  if (options.pots !== undefined) {
    if (!Array.isArray(options.pots) || options.pots.length > 10)
      throw new Error('Equity pots exceed ten seats');
    result.pots = Array.from(options.pots, (pot) => {
      if (
        !pot ||
        !Number.isFinite(pot.amount) ||
        pot.amount < 0 ||
        !Array.isArray(pot.eligible) ||
        pot.eligible.length > players ||
        Array.from(pot.eligible).some(
          (seat) => !Number.isInteger(seat) || seat < 0 || seat >= players
        )
      ) {
        throw new Error('Invalid equity pot');
      }
      return { amount: pot.amount, eligible: [...pot.eligible] };
    });
  }
  return result;
}
