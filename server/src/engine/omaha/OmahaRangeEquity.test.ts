import { describe, expect, it } from 'vitest';
import type { Card } from '../../types.js';
import { compareHands, evaluateOmahaHand } from '../PokerEngine.js';
import { scoreOmahaHi, scoreOmahaHiPartial } from '../HorseEval.js';
import { omahaSamplerScoring } from './OmahaVariantSampler.js';
import { equityVsRanges, exactEquityVsHands, type OmahaOpponentRange } from './OmahaRangeEquity.js';

/**
 * EMERG lane EQUITY law tests. No hand from production appears here: every
 * deal is generated from a fixed seed.
 *
 * FULL=1 (OMAHA_EQUITY_FULL=1) runs the lane's declared verification sizes:
 * 2,000 river spots and 300 flop/turn spots by exact enumeration. The default
 * run keeps 2,000 river spots and 40 flop/turn spots.
 */
const FULL = process.env.OMAHA_EQUITY_FULL === '1';
const RIVER_SPOTS = 2000;
const STREET_SPOTS = FULL ? 300 : 40;

const RANKS = '23456789TJQKA';
const SUITS: Card['suit'][] = ['clubs', 'diamonds', 'hearts', 'spades'];
const DECK: Card[] = SUITS.flatMap((suit) =>
  RANKS.split('').map((rank) => ({ rank: rank as Card['rank'], suit }))
);
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}
function deal(random: () => number, count: number): Card[] {
  const deck = DECK.slice();
  const out: Card[] = [];
  for (let i = 0; i < count; i++) out.push(deck.splice(Math.floor(random() * deck.length), 1)[0]);
  return out;
}

// ── Independent brute-force evaluator (written from the rules, shares nothing) ──
const rv = (c: Card) => RANKS.indexOf(c.rank) + 2;
/** Category 0 high card .. 8 straight flush, then tie-break ranks, as one number. */
function brute5(cards: Card[]): number {
  const ranks = cards.map(rv);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq.join() === '14,5,4,3,2') straightHigh = 5;
  }
  let cat: number;
  let tie: number[];
  if (straightHigh && flush) [cat, tie] = [8, [straightHigh]];
  else if (groups[0][1] === 4) [cat, tie] = [7, [groups[0][0], groups[1][0]]];
  else if (groups[0][1] === 3 && groups[1][1] === 2) [cat, tie] = [6, [groups[0][0], groups[1][0]]];
  else if (flush) [cat, tie] = [5, uniq];
  else if (straightHigh) [cat, tie] = [4, [straightHigh]];
  else if (groups[0][1] === 3) [cat, tie] = [3, groups.map((g) => g[0])];
  else if (groups[0][1] === 2 && groups[1][1] === 2) [cat, tie] = [2, groups.map((g) => g[0])];
  else if (groups[0][1] === 2) [cat, tie] = [1, groups.map((g) => g[0])];
  else [cat, tie] = [0, uniq];
  let v = cat;
  for (let i = 0; i < 5; i++) v = v * 15 + (tie[i] ?? 0);
  return v;
}
function choose<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  const out: T[][] = [];
  xs.forEach((x, i) => {
    for (const rest of choose(xs.slice(i + 1), k - 1)) out.push([x, ...rest]);
  });
  return out;
}
/** Omaha: exactly two hole cards and three board cards. */
function bruteOmaha(hole: Card[], board: Card[]): number {
  let best = -1;
  for (const h of choose(hole, 2))
    for (const b of choose(board, 3)) best = Math.max(best, brute5([...h, ...b]));
  return best;
}
/** Hold'em-style best of any five: used only to prove the spots can tell the rules apart. */
function bruteAnyFive(hole: Card[], board: Card[]): number {
  let best = -1;
  for (const five of choose([...hole, ...board], 5)) best = Math.max(best, brute5(five));
  return best;
}
const bruteCat = (v: number) => Math.floor(v / 15 ** 5);
const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const fastScore = (hole: Card[], board: Card[]) => {
  const { codeOf, newTriples, loadTriples, omahaHiFast } = omahaSamplerScoring;
  const tri = newTriples();
  loadTriples(tri, board.map(codeOf), board.length);
  return omahaHiFast(hole.map(codeOf), tri);
};
function bruteExact(hero: Card[], board: Card[], opps: Card[][]): number {
  const known = new Set([...hero, ...board, ...opps.flat()].map((c) => c.rank + c.suit));
  const rest = DECK.filter((c) => !known.has(c.rank + c.suit));
  let total = 0;
  let n = 0;
  for (const add of choose(rest, 5 - board.length)) {
    const b = [...board, ...add];
    const h = bruteOmaha(hero, b);
    const o = opps.map((x) => bruteOmaha(x, b));
    const best = Math.max(h, ...o);
    total += h === best ? 1 / (1 + o.filter((v) => v === best).length) : 0;
    n++;
  }
  return total / n;
}

describe('Omaha hand ranking is exactly two hole plus three board (PLO4, PLO5)', () => {
  it(`${RIVER_SPOTS} river spots: every engine evaluator agrees with the brute force`, () => {
    const random = rng(0x0e0a17);
    let discriminating = 0;
    const engineCat = new Map<number, string>();
    for (let spot = 0; spot < RIVER_SPOTS; spot++) {
      const holes = spot % 2 ? 5 : 4;
      const players = 2 + (spot % 3);
      const cards = deal(random, 5 + holes * players);
      const board = cards.slice(0, 5);
      const hands = Array.from({ length: players }, (_, p) =>
        cards.slice(5 + p * holes, 5 + (p + 1) * holes)
      );
      const brute = hands.map((h) => bruteOmaha(h, board));
      const evaluated = hands.map((h) => evaluateOmahaHand(h, board));
      const score = hands.map((h) => scoreOmahaHi(h, board));
      const fast = hands.map((h) => fastScore(h, board));
      if (hands.some((h, i) => bruteAnyFive(h, board) !== brute[i])) discriminating++;
      for (let i = 0; i < players; i++) {
        const c = bruteCat(brute[i]);
        // scoreOmahaHi category: 1 high card .. 9 straight flush, 10 royal
        const royal = c === 8 && brute[i] % 15 ** 5 === 14 * 15 ** 4;
        expect(Math.floor(score[i] / 0x100000)).toBe(royal ? 10 : c + 1);
        expect(fast[i]).toBe(score[i]);
        const name = engineCat.get(c);
        const seen = royal ? 'Straight Flush' : evaluated[i].name;
        if (!royal) {
          if (name === undefined) engineCat.set(c, seen);
          else expect(seen).toBe(name);
        }
        for (let j = 0; j < players; j++) {
          const want = sign(brute[i] - brute[j]);
          expect(sign(compareHands(evaluated[i], evaluated[j]))).toBe(want);
          expect(sign(score[i] - score[j])).toBe(want);
          expect(sign(fast[i] - fast[j])).toBe(want);
        }
      }
    }
    // The spots have power: a large share would rank differently under any-five rules.
    expect(discriminating).toBeGreaterThan(RIVER_SPOTS * 0.5);
  });

  it(`${STREET_SPOTS} flop and turn spots: exact equity equals the brute-force enumeration`, () => {
    const random = rng(0x5eed42);
    for (let spot = 0; spot < STREET_SPOTS; spot++) {
      const holes = spot % 2 ? 5 : 4;
      const boardSize = spot % 3 === 0 ? 3 : 4;
      const opps = boardSize === 4 && spot % 4 === 1 ? 2 : 1;
      const cards = deal(random, boardSize + holes * (1 + opps));
      const board = cards.slice(0, boardSize);
      const hero = cards.slice(boardSize, boardSize + holes);
      const others = Array.from({ length: opps }, (_, p) =>
        cards.slice(boardSize + holes * (p + 1), boardSize + holes * (p + 2))
      );
      const exact = exactEquityVsHands(hero, board, others)!;
      expect(exact.equity).toBeCloseTo(bruteExact(hero, board, others), 12);
    }
  }, 600_000);
});

describe('equityVsRanges', () => {
  it('against a single known hand matches exact enumeration within 4 standard errors', () => {
    const random = rng(0xabc);
    for (let spot = 0; spot < 24; spot++) {
      const holes = spot % 2 ? 5 : 4;
      const boardSize = [3, 4, 5][spot % 3];
      const cards = deal(random, boardSize + holes * 2);
      const board = cards.slice(0, boardSize);
      const hero = cards.slice(boardSize, boardSize + holes);
      const villain = cards.slice(boardSize + holes);
      const exact = exactEquityVsHands(hero, board, [villain])!.equity;
      const mc = equityVsRanges(
        hero,
        board,
        [{ kind: 'combos', combos: [{ cards: villain, weight: 1 }] }],
        4000,
        {
          seed: spot + 1,
        }
      )!;
      expect(Math.abs(mc.equity - exact)).toBeLessThanOrEqual(4 * mc.se + 1e-9);
    }
  });

  it('a weighted range equals the weighted mean of exact equities (card removal included)', () => {
    const random = rng(0x77);
    for (let spot = 0; spot < 6; spot++) {
      const holes = spot % 2 ? 5 : 4;
      const cards = deal(random, 4 + holes * 4);
      const board = cards.slice(0, 4);
      const hero = cards.slice(4, 4 + holes);
      const combos = [0, 1, 2].map((i) => ({
        cards: cards.slice(4 + holes * (i + 1), 4 + holes * (i + 2)),
        weight: i + 1,
      }));
      // one combo that collides with the hero must carry no weight
      combos.push({ cards: [hero[0], ...combos[0].cards.slice(1)], weight: 50 });
      const truth =
        combos
          .slice(0, 3)
          .reduce((s, c) => s + c.weight * exactEquityVsHands(hero, board, [c.cards])!.equity, 0) /
        6;
      const mc = equityVsRanges(hero, board, [{ kind: 'combos', combos }], 20000, {
        seed: 9 + spot,
      })!;
      expect(Math.abs(mc.equity - truth)).toBeLessThanOrEqual(4 * mc.se + 1e-9);
    }
  });

  it('three-way: two fixed hands, exact vs Monte Carlo; a random seat equals a weightFn of 1', () => {
    const random = rng(0x3333);
    for (let spot = 0; spot < 6; spot++) {
      const holes = spot % 2 ? 5 : 4;
      const cards = deal(random, 3 + holes * 3);
      const board = cards.slice(0, 3);
      const hero = cards.slice(3, 3 + holes);
      const a = cards.slice(3 + holes, 3 + 2 * holes);
      const b = cards.slice(3 + 2 * holes);
      const exact = exactEquityVsHands(hero, board, [a, b])!.equity;
      const fixed = (c: Card[]): OmahaOpponentRange => ({
        kind: 'combos',
        combos: [{ cards: c, weight: 1 }],
      });
      const mc = equityVsRanges(hero, board, [fixed(a), fixed(b)], 5000, { seed: spot + 3 })!;
      expect(Math.abs(mc.equity - exact)).toBeLessThanOrEqual(4 * mc.se + 1e-9);
      const r1 = equityVsRanges(hero, board, [{ kind: 'random' }, { kind: 'random' }], 6000, {
        seed: 1,
      })!;
      const r2 = equityVsRanges(
        hero,
        board,
        [{ kind: 'weightFn', weight: () => 1 }, { kind: 'random' }],
        6000,
        {
          seed: 2,
        }
      )!;
      expect(Math.abs(r1.equity - r2.equity)).toBeLessThanOrEqual(4 * Math.hypot(r1.se, r2.se));
    }
  });

  it('weightFn ctx.publicHigh is the exact public-board score', () => {
    const random = rng(0x99);
    for (let spot = 0; spot < 30; spot++) {
      const holes = spot % 2 ? 5 : 4;
      const boardSize = [3, 4, 5][spot % 3];
      const cards = deal(random, boardSize + holes);
      const board = cards.slice(0, boardSize);
      const hero = cards.slice(boardSize);
      let checked = 0;
      equityVsRanges(
        hero,
        board,
        [
          {
            kind: 'weightFn',
            weight: (c, ctx) => {
              expect(ctx.publicHigh).toBe(
                boardSize === 5 ? scoreOmahaHi([...c], board) : scoreOmahaHiPartial([...c], board)
              );
              checked++;
              return 1;
            },
          },
        ],
        20,
        { seed: spot + 1 }
      );
      expect(checked).toBe(20);
    }
  });

  it('stops on the target standard error and reports it', () => {
    const cards = deal(rng(5), 13);
    const r = equityVsRanges(
      cards.slice(0, 5),
      cards.slice(5, 8),
      [{ kind: 'random' }, { kind: 'random' }],
      50000,
      {
        targetSE: 0.01,
        seed: 4,
      }
    )!;
    expect(r.stoppedOnTargetSE).toBe(true);
    expect(r.se).toBeLessThanOrEqual(0.01);
    expect(r.samples).toBeLessThan(50000);
  });

  it('never throws; impossible input returns null', () => {
    const cards = deal(rng(6), 12);
    const hero = cards.slice(0, 4);
    expect(equityVsRanges(hero, cards.slice(4, 6), [{ kind: 'random' }], 100)).toBeNull(); // 2-card board
    expect(equityVsRanges(hero, cards.slice(4, 7), [], 100)).toBeNull();
    expect(
      equityVsRanges(
        hero,
        cards.slice(4, 7),
        [{ kind: 'combos', combos: [{ cards: hero, weight: 1 }] }],
        100
      )
    ).toBeNull();
    expect(
      equityVsRanges(
        hero,
        cards.slice(4, 7),
        [
          {
            kind: 'weightFn',
            weight: () => {
              throw new Error('x');
            },
          },
        ],
        100
      )
    ).toBeNull();
    expect(
      equityVsRanges([...hero, hero[0]], cards.slice(4, 7), [{ kind: 'random' }], 100)
    ).toBeNull();
  });
});
