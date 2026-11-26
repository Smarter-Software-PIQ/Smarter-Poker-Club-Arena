/**
 * LAW: THE FAST BIG-DRAW SAMPLER COMPUTES THE SAME NUMBERS (PLO-OWNER lead-7, 2026-11-26).
 *
 * omahaBigDrawEquities (700 samples x 3 run-outs) is read by omahaBigDrawAggression on live decisions and by the
 * priced raise of omahaOpponentLifetimeHudDecides, omahaBigDrawBetIsPriced and the target-priced bluff. It now draws
 * on card ids and scores showdowns on precomputed triples. It must change no number: the equities and the counts
 * equal the implementation it replaced, frozen below, for PLO4 and PLO5 on the flop and the turn, with and without
 * dead cards, at full and reduced sample counts.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import {
  OMAHA_BIG_DRAW_SAMPLES,
  omahaBigDrawEquities,
  type OmahaBigDrawCounts,
} from './HorseOmahaBigDrawAggression.js';
import { frozenBigDrawEquities } from './anOmahaBigDraw.test-support.js';

const DECK: Card[] = [];
for (const s of ['clubs', 'diamonds', 'hearts', 'spades'])
  for (const r of '23456789TJQKA'.split('')) DECK.push({ rank: r, suit: s } as Card);
function stream(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
function draw(rnd: () => number, n: number): Card[] {
  const d = DECK.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rnd() * (d.length - i));
    [d[i], d[j]] = [d[j]!, d[i]!];
  }
  return d.slice(0, n);
}

describe('LAW: the fast big-draw sampler computes the same numbers', () => {
  it('omahaBigDrawEquities equals the frozen sampler, equities and counts', () => {
    const rnd = stream(0xb1d7);
    for (let t = 0; t < 48; t++) {
      const holeCount = [4, 5][t % 2]!;
      const boardCount = [3, 4][(t >> 1) % 2]!;
      const cards = draw(rnd, holeCount + boardCount + 2);
      const hole = cards.slice(0, holeCount);
      const board = cards.slice(holeCount, holeCount + boardCount);
      const dead = t % 3 === 0 ? cards.slice(holeCount + boardCount) : [];
      const samples = [OMAHA_BIG_DRAW_SAMPLES, 150][t % 2]!;
      const cf: OmahaBigDrawCounts = { got: [], won: [] };
      const cn: OmahaBigDrawCounts = { got: [], won: [] };
      const want = frozenBigDrawEquities(hole, board, dead, samples, cf);
      const got = omahaBigDrawEquities(hole, board, dead, samples, cn);
      expect(got, `case ${t}`).toEqual(want);
      if (want) {
        expect(Object.is(got!.all, want.all) && Object.is(got!.bet, want.bet)).toBe(true);
        expect(Object.is(got!.raise, want.raise)).toBe(true);
      }
      expect(cn).toEqual(cf);
    }
  }, 120_000);
});
