import { expect, it } from 'vitest';
import type { Card } from '../types.js';
import { computeEquity } from './equity/equityWorker.js';
import { RANKS, SUITS, evaluateHand, evaluateOmahaHand, compareHands } from './PokerEngine.js';

it('matches independent settlement across deterministic multiway flop, turn and river deals', () => {
  let seed = 914237;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (const holeCount of [2, 4, 5, 6]) {
    const omaha = holeCount > 2;
    for (const street of [3, 4, 5]) {
      for (let trial = 0; trial < (street === 3 ? 2 : 30); trial++) {
        const deck: Card[] = RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
        for (let i = deck.length - 1; i > 0; i--) {
          const j = random() % (i + 1);
          [deck[i], deck[j]] = [deck[j], deck[i]];
        }
        const hands = [
          deck.splice(0, holeCount),
          deck.splice(0, holeCount),
          deck.splice(0, holeCount),
        ];
        const board = deck.splice(0, street);
        const totals = [0, 0, 0];
        let count = 0;
        const settle = (full: Card[]) => {
          const scores = hands.map((h) =>
            omaha ? evaluateOmahaHand(h, full) : evaluateHand(h, full)
          );
          let best = scores[0];
          for (const s of scores) if (compareHands(s, best) > 0) best = s;
          const winners = scores.map((s) => compareHands(s, best) === 0);
          const n = winners.filter(Boolean).length;
          winners.forEach((w, i) => {
            if (w) totals[i] += 1 / n;
          });
          count++;
        };
        if (street === 5) settle(board);
        if (street === 4) for (const river of deck) settle([...board, river]);
        if (street === 3)
          for (let a = 0; a < deck.length; a++)
            for (let b = a + 1; b < deck.length; b++) settle([...board, deck[a], deck[b]]);
        const actual = computeEquity(hands, board, [], 1, { exact: true, omaha });
        actual.forEach((value, i) =>
          expect(value, JSON.stringify({ holeCount, street, trial, hands, board })).toBeCloseTo(
            totals[i] / count,
            12
          )
        );
      }
    }
  }
}, 60_000);

it('turns the one backdoor royal chance into exactly zero when the turn misses', () => {
  const c = (rank: string, suit: Card['suit']): Card => ({ rank, suit }) as Card;
  const hands = [
    [c('A', 'hearts'), c('K', 'hearts')],
    [c('2', 'clubs'), c('2', 'spades')],
  ];
  const flop = [c('2', 'hearts'), c('2', 'diamonds'), c('T', 'hearts')];
  expect(computeEquity(hands, flop, [], 1, { exact: true })[0]).toBeCloseTo(1 / 990, 12);
  const turn = [...flop, c('3', 'clubs')];
  expect(computeEquity(hands, turn, [], 1, { exact: true })).toEqual([0, 1]);
  expect(computeEquity(hands, [...turn, c('Q', 'hearts')], [], 1, { exact: true })).toEqual([0, 1]);
});
