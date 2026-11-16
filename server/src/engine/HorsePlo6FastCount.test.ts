/**
 * The six-card exact holdings count (HorsePlo6FastCount) is the same integer
 * as the four/five-card walk of HorseOmahaFacingBetEv, and the six-card TURN
 * of the facing-bet EV rule stays closed (PLO6_FACING_BET_EV_TURN false).
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import {
  PLO6_FACING_BET_EV_TURN,
  PairSet,
  countHoldingsWithout,
  omahaEvHandCounts,
  omahaEvHandCountsResetCache,
  omahaEvHandCountsSixCardTurn,
  omahaEvSixCardFastCount,
} from './HorseOmahaFacingBetEv.js';
import { plo6CountHoldingsAmong } from './HorsePlo6FastCount.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'];
const DECK: Card[] = [];
for (const suit of SUITS) for (const rank of RANKS) DECK.push({ rank, suit } as Card);

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Seeded deal: board, hole and dead cards off one shuffled deck. */
function deal(seed: number, boardN: number, holeN: number, deadN = 0) {
  const rnd = mulberry(seed);
  const d = DECK.slice();
  const need = boardN + holeN + deadN;
  for (let i = 0; i < need; i++) {
    const j = i + Math.floor(rnd() * (d.length - i));
    const t = d[i];
    d[i] = d[j];
    d[j] = t;
  }
  return {
    board: d.slice(0, boardN),
    hole: d.slice(boardN, boardN + holeN),
    dead: d.slice(boardN + holeN, need),
  };
}

afterEach(() => {
  omahaEvSixCardFastCount(true);
  omahaEvHandCountsResetCache();
});

/** Brute force: n-subsets of the masked cards with no barred pair. */
function brute(m: number, n: number, pairs: Set<string>, allowed: boolean[]): number {
  const cards: number[] = [];
  for (let i = 0; i < m; i++) if (allowed[i]) cards.push(i);
  let count = 0;
  const pick: number[] = [];
  const walk = (from: number): void => {
    if (pick.length === n) {
      count++;
      return;
    }
    for (let x = from; x < cards.length; x++) {
      const c = cards[x];
      if (pick.some((p) => pairs.has(`${p}:${c}`))) continue;
      pick.push(c);
      walk(x + 1);
      pick.pop();
    }
  };
  walk(0);
  return count;
}

describe('plo6CountHoldingsAmong: the same integer as a brute count', () => {
  it('random barred-pair graphs, every holding size up to six, with and without a mask', () => {
    const rnd = mulberry(20261116);
    let cases = 0;
    for (let g = 0; g < 60; g++) {
      const m = g % 3 === 0 ? 36 : 10 + Math.floor(rnd() * 9);
      const density = [0.03, 0.1, 0.25, 0.5, 0.8][g % 5];
      const bar = new PairSet(m);
      const pairs = new Set<string>();
      for (let i = 0; i < m; i++)
        for (let j = i + 1; j < m; j++)
          if (rnd() < density) {
            bar.add(i, j);
            pairs.add(`${i}:${j}`);
          }
      const allowed = Array.from({ length: m }, () => g % 2 === 0 || rnd() < 0.8);
      let lo = 0;
      let hi = 0;
      for (let i = 0; i < m; i++)
        if (allowed[i]) {
          if (i < 32) lo |= 1 << i;
          else hi |= 1 << (i - 32);
        }
      const maxN = m === 36 ? 3 : 6;
      for (let n = 0; n <= maxN; n++) {
        expect(plo6CountHoldingsAmong(n, bar.lo, bar.hi, lo, hi), `g${g} n${n}`).toBe(
          brute(m, n, pairs, allowed)
        );
        cases++;
      }
    }
    expect(cases).toBeGreaterThan(300);
  });

  it('the structures a board makes: cliques (a flush suit), triangles (a rank), no pairs at all', () => {
    const m = 42;
    const none = new PairSet(m);
    // C(42, 6)
    expect(plo6CountHoldingsAmong(6, none.lo, none.hi, -1, (1 << 10) - 1)).toBe(5245786);
    // nine cards all barred from each other: holdings with at most one of them
    const clique = new PairSet(m);
    for (let i = 0; i < 9; i++) for (let j = i + 1; j < 9; j++) clique.add(i, j);
    const c = (n: number, k: number): number => {
      let o = 1;
      for (let i = 1; i <= k; i++) o = (o * (n - k + i)) / i;
      return Math.round(o);
    };
    expect(plo6CountHoldingsAmong(6, clique.lo, clique.hi, -1, (1 << 10) - 1)).toBe(
      c(33, 6) + 9 * c(33, 5)
    );
    // ten triangles (three cards of a rank), reaching past card 32
    const tri = new PairSet(m);
    for (let r = 0; r < 10; r++) {
      const a = 12 + r * 3;
      tri.add(a, a + 1);
      tri.add(a, a + 2);
      tri.add(a + 1, a + 2);
    }
    let want = 0;
    for (let k = 0; k <= 6; k++) want += c(10, k) * 3 ** k * c(12, 6 - k);
    expect(plo6CountHoldingsAmong(6, tri.lo, tri.hi, -1, (1 << 10) - 1)).toBe(want);
  });
});

const sig = (c: NonNullable<ReturnType<typeof omahaEvHandCounts>>): string =>
  JSON.stringify([
    c.holdings,
    c.all,
    c.value,
    c.other,
    c.valueShare,
    c.top(0.5),
    c.top(0.35),
    c.top(0.25),
    c.counts,
  ]);

describe('six cards: the fast count and the four/five-card walk give the same shares, bit for bit', () => {
  it('240 seeded six-card TURN hands (some with dead cards)', () => {
    const shares = [0.35, 0.25, 0.18, 0.12, 0.45];
    let seen = 0;
    for (let s = 0; s < 240; s++) {
      const { hole, board, dead } = deal(0x60600000 + s * 7919, 4, 6, s % 6 === 5 ? 3 : 0);
      omahaEvHandCountsResetCache();
      omahaEvSixCardFastCount(true);
      const fast = omahaEvHandCountsSixCardTurn(hole, board, dead, shares[s % 5]);
      const fastSig = fast ? sig(fast) : 'null';
      omahaEvHandCountsResetCache();
      omahaEvSixCardFastCount(false);
      const slow = omahaEvHandCountsSixCardTurn(hole, board, dead, shares[s % 5]);
      expect(fastSig, `turn spot ${s}`).toBe(slow ? sig(slow) : 'null');
      if (fast) {
        seen++;
        expect(fast.street).toBe('turn');
        expect(fast.holeCount).toBe(6);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(200);
  }, 120_000);

  it('80 seeded six-card RIVER hands (the path the rule uses today)', () => {
    let seen = 0;
    for (let s = 0; s < 80; s++) {
      const { hole, board, dead } = deal(0x60610000 + s * 104729, 5, 6, s % 4 === 3 ? 2 : 0);
      omahaEvHandCountsResetCache();
      omahaEvSixCardFastCount(true);
      const fast = omahaEvHandCounts(hole, board, dead, 0.3);
      const fastSig = fast ? sig(fast) : 'null';
      omahaEvHandCountsResetCache();
      omahaEvSixCardFastCount(false);
      const slow = omahaEvHandCounts(hole, board, dead, 0.3);
      expect(fastSig, `river spot ${s}`).toBe(slow ? sig(slow) : 'null');
      if (fast) seen++;
    }
    expect(seen).toBeGreaterThanOrEqual(70);
  }, 60_000);
});

describe('four and five cards never take the six-card count', () => {
  it('PLO4 and PLO5 turn and river counts are the same with the seam on and off, and equal the public walk', () => {
    for (let s = 0; s < 24; s++) {
      const n = s % 2 === 0 ? 4 : 5;
      const { hole, board } = deal(0x45450000 + s * 31337, s % 4 < 2 ? 4 : 5, n);
      omahaEvHandCountsResetCache();
      omahaEvSixCardFastCount(true);
      const a = sig(omahaEvHandCounts(hole, board, [], 0.3)!);
      omahaEvHandCountsResetCache();
      omahaEvSixCardFastCount(false);
      const b = sig(omahaEvHandCounts(hole, board, [], 0.3)!);
      expect(a, `spot ${s}`).toBe(b);
    }
    // the exported walk itself is not switched by a finished six-card count
    omahaEvSixCardFastCount(true);
    const six = deal(0x60620000, 5, 6);
    expect(omahaEvHandCounts(six.hole, six.board, [], 0.3)).not.toBeNull();
    const bar = new PairSet(12);
    bar.add(0, 1);
    bar.add(2, 3);
    bar.add(1, 2);
    // 12 cards, 4-card holdings without the pairs 0-1, 2-3, 1-2 (brute)
    const pairs = new Set(['0:1', '2:3', '1:2']);
    expect(countHoldingsWithout(12, 4, bar)).toBe(
      brute(
        12,
        4,
        pairs,
        Array.from({ length: 12 }, () => true)
      )
    );
  });
});

describe('the six-card TURN of the facing-bet EV rule stays closed', () => {
  it('PLO6_FACING_BET_EV_TURN is false and the public count refuses a six-card turn', () => {
    expect(PLO6_FACING_BET_EV_TURN).toBe(false);
    const { hole, board } = deal(0x60630000, 4, 6);
    expect(omahaEvHandCounts(hole, board, [], 0.3)).toBeNull();
    // the seam (no rule calls it) counts it: C(42, 6) holdings
    const c = omahaEvHandCountsSixCardTurn(hole, board, [], 0.3)!;
    expect(c.holdings).toBe(5245786);
    expect(c.street).toBe('turn');
    // a five-card turn is answered as before
    const five = deal(0x60640000, 4, 5);
    expect(omahaEvHandCounts(five.hole, five.board, [], 0.3)).not.toBeNull();
  });
});
