/**
 * LAW (PLO-OWNER lead-5, Turn 5b, 2026-11-22): the one-entry memo of omahaBigDrawEquities changes no result.
 *
 * omahaBigDrawEquities is a shared helper: omahaBigDrawAggression, the priced draw rules and the river bluff
 * price all call it, with every option on or off. Turn 5 gave it a memo of the last sampled spot. The sample
 * is seeded from the cards alone, so a memo hit must return exactly what dealing the sample again returns.
 * This law proves it on 2,100 seeded random inputs (PLO4, PLO5 and PLO6 hands, flop and turn boards, with and
 * without dead cards, two sample sizes, with and without the counts object):
 *  - the answer from the memo (a second call on the same input) deep-equals the answer dealt fresh (memo
 *    cleared first), the three shares and the `got` / `won` counts bit for bit;
 *  - the same after another spot was sampled in between (the memo holds one entry: the first spot is dealt
 *    again and must still give the same answer);
 *  - a memo hit deals nothing (omahaBigDrawSampledRuns does not move) and hands out copies: mutating a
 *    returned answer or its counts does not change the next answer.
 */
import { describe, expect, it } from 'vitest';
import type { Card, CardRank, CardSuit } from '../types.js';
import {
  omahaBigDrawEquities,
  omahaBigDrawEquitiesMemoClear,
  omahaBigDrawSampledRuns,
  type OmahaBigDrawCounts,
} from './HorseOmahaBigDrawAggression.js';

const RANKS: CardRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS: CardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
const lcg = (seed: number) => {
  let x = (seed * 2654435761) >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0x100000000;
  };
};
interface Input {
  hole: Card[];
  board: Card[];
  dead: Card[];
  samples: number;
}
const inputOf = (seed: number): Input => {
  const rnd = lcg(seed);
  const deck: Card[] = [];
  for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const size = 4 + (seed % 3); // PLO4, PLO5, PLO6
  const boardLen = 3 + (Math.floor(seed / 3) % 2); // flop, turn
  const deadLen = Math.floor(seed / 6) % 3; // 0, 1 or 2 known dead cards
  const samples = Math.floor(seed / 18) % 2 === 0 ? 30 : 50;
  return {
    hole: deck.slice(0, size),
    board: deck.slice(size, size + boardLen),
    dead: deck.slice(size + boardLen, size + boardLen + deadLen),
    samples,
  };
};
const ask = (i: Input, withCounts: boolean) => {
  const counts: OmahaBigDrawCounts | undefined = withCounts ? { got: [], won: [] } : undefined;
  const equities = omahaBigDrawEquities(i.hole, i.board, i.dead, i.samples, counts);
  return { equities, counts };
};

describe('LAW: the omahaBigDrawEquities memo returns exactly what a fresh sample returns', () => {
  it('2,100 random inputs: memo hit === fresh deal, shares and counts, also after another spot evicted it', () => {
    const N = 2100;
    let compared = 0;
    let nonNull = 0;
    for (let seed = 1; seed <= N; seed++) {
      const input = inputOf(seed);
      const withCounts = seed % 2 === 0;

      omahaBigDrawEquitiesMemoClear();
      const before = omahaBigDrawSampledRuns();
      const fresh = ask(input, withCounts);
      const dealt = omahaBigDrawSampledRuns() - before;
      // a cleared memo deals (unless the deck cannot fill a sample, which returns before any deal)
      expect(dealt).toBeLessThanOrEqual(1);

      const runsBeforeHit = omahaBigDrawSampledRuns();
      const hit = ask(input, withCounts);
      expect(omahaBigDrawSampledRuns()).toBe(runsBeforeHit); // the memo answered
      expect(hit).toEqual(fresh);
      // the other shape of the call (counts wanted or not) reads the same memo: same shares
      const other = ask(input, !withCounts);
      expect(other.equities).toEqual(fresh.equities);
      if (!withCounts && other.counts && fresh.equities !== null) {
        omahaBigDrawEquitiesMemoClear();
        expect(ask(input, true).counts).toEqual(other.counts);
      }

      // copies, not the memo's own objects
      if (hit.equities) hit.equities.all = -1;
      if (hit.counts) {
        hit.counts.got[0] = -1;
        hit.counts.won[0] = -1;
      }
      expect(ask(input, withCounts)).toEqual(fresh);

      // another spot evicts the one entry; the first spot dealt again gives the same answer
      ask(inputOf(seed + N), false);
      expect(ask(input, withCounts)).toEqual(fresh);

      compared++;
      if (fresh.equities !== null) nonNull++;
    }
    expect(compared).toBe(N);
    expect(nonNull).toBeGreaterThanOrEqual(2000);
  });
});
