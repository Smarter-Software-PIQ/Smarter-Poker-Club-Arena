/**
 * Lane CORE-AUDIT law (Nov 21): the math core's five-card scorer is RIGHT, not only equal to its own reference.
 * OmahaMathCoreEvalTable / EvalTwoPlusThree prove the tables equal eval5Reference; nothing proved eval5Reference
 * itself. This law checks eval5 against an independent textbook evaluator written here, on all 2,598,960 hands:
 * the published category frequencies, the 7,462 distinct hand classes, and the same strict order of classes.
 */
import { describe, expect, it } from 'vitest';
import { categoryOf, eval5 } from './OmahaMathCoreEval.js';

/** textbook key: category, then ranks by (count desc, rank desc); the wheel A-2-3-4-5 is five-high */
function textbookKey(cards: number[]): number {
  const ranks = cards.map((c) => c >> 2);
  const flush = cards.every((c) => (c & 3) === (cards[0] & 3));
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0] - x[0]);
  const distinct = groups.map((g) => g[0]);
  let straightHigh = -1;
  if (groups.length === 5) {
    const s = [...distinct].sort((x, y) => y - x);
    if (s[0] - s[4] === 4) straightHigh = s[0];
    else if (s[0] === 12 && s[1] === 3 && s[4] === 0) straightHigh = 3;
  }
  const shape = groups.map((g) => g[1]).join('');
  let cat: number;
  let tuple: number[];
  if (straightHigh >= 0 && flush) [cat, tuple] = [8, [straightHigh]];
  else if (shape === '41') [cat, tuple] = [7, distinct];
  else if (shape === '32') [cat, tuple] = [6, distinct];
  else if (flush) [cat, tuple] = [5, distinct];
  else if (straightHigh >= 0) [cat, tuple] = [4, [straightHigh]];
  else if (shape === '311') [cat, tuple] = [3, distinct];
  else if (shape === '221') [cat, tuple] = [2, distinct];
  else if (shape === '2111') [cat, tuple] = [1, distinct];
  else [cat, tuple] = [0, distinct];
  let key = cat;
  for (let i = 0; i < 5; i++) key = key * 13 + (tuple[i] ?? 0);
  return key;
}

describe('eval5 agrees with an independent textbook evaluator', () => {
  it('on all 2,598,960 hands: category counts, 7,462 classes, the same strict order', () => {
    const PUBLISHED = [1302540, 1098240, 123552, 54912, 10200, 5108, 3744, 624, 40];
    const byCat = new Array(9).fill(0);
    const keyOfScore = new Map<number, number>();
    const scoreOfKey = new Map<number, number>();
    let clashes = 0;
    let catMismatch = 0;
    for (let a = 0; a < 48; a++)
      for (let b = a + 1; b < 49; b++)
        for (let c = b + 1; c < 50; c++)
          for (let d = c + 1; d < 51; d++)
            for (let e = d + 1; e < 52; e++) {
              const s = eval5(a, b, c, d, e);
              const k = textbookKey([a, b, c, d, e]);
              const cat = categoryOf(s);
              byCat[cat]++;
              if (cat !== Math.floor(k / 13 ** 5)) catMismatch++;
              const ks = keyOfScore.get(s);
              const sk = scoreOfKey.get(k);
              if ((ks !== undefined && ks !== k) || (sk !== undefined && sk !== s)) clashes++;
              keyOfScore.set(s, k);
              scoreOfKey.set(k, s);
            }
    expect(byCat).toEqual(PUBLISHED);
    expect(catMismatch).toBe(0);
    expect(clashes).toBe(0);
    expect(scoreOfKey.size).toBe(7462);
    const keys = [...scoreOfKey.keys()].sort((x, y) => x - y);
    let outOfOrder = 0;
    for (let i = 1; i < keys.length; i++)
      if (!(scoreOfKey.get(keys[i])! > scoreOfKey.get(keys[i - 1])!)) outOfOrder++;
    expect(outOfOrder).toBe(0);
  }, 300_000);
});
