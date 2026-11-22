/**
 * Lane CORE-POOLED-2 latency law (Nov 21): the table-driven eval5 (OmahaMathCoreEval.ts) gives the same score as the
 * original rank-by-rank scorer (eval5Reference) for every one of the 2,598,960 five-card hands, in every card order
 * the core can pass (checked on all hands in one order and on a seeded sample of permutations).
 */
import { describe, expect, it } from 'vitest';
import { eval5, eval5Reference } from './OmahaMathCoreEval.js';

describe('table-driven eval5 equals the reference scorer', () => {
  it('on all 2,598,960 five-card hands', () => {
    let n = 0;
    let bad = 0;
    for (let a = 0; a < 48; a++)
      for (let b = a + 1; b < 49; b++)
        for (let c = b + 1; c < 50; c++)
          for (let d = c + 1; d < 51; d++)
            for (let e = d + 1; e < 52; e++) {
              if (eval5(a, b, c, d, e) !== eval5Reference(a, b, c, d, e)) bad++;
              n++;
            }
    expect(n).toBe(2_598_960);
    expect(bad).toBe(0);
  }, 300_000);
  it('in any card order (200,000 seeded permutations)', () => {
    let s = 77;
    const rng = () => {
      s = (s * 1103515245 + 12345) >>> 0;
      return s / 4294967296;
    };
    for (let i = 0; i < 200_000; i++) {
      const used = new Set<number>();
      const cs: number[] = [];
      while (cs.length < 5) {
        const c = Math.floor(rng() * 52);
        if (!used.has(c)) {
          used.add(c);
          cs.push(c);
        }
      }
      const [a, b, c, d, e] = cs;
      expect(eval5(a, b, c, d, e)).toBe(eval5Reference(a, b, c, d, e));
    }
  }, 300_000);
});
