/**
 * LAW: THE FAST OUT-OF-POSITION 3-BET PRICE COMPUTES THE SAME NUMBERS (PLO-OWNER lead-7, 2026-11-26).
 *
 * omahaOopReraiseRangeHoldsVsReraise re-decided in 60-90 ms where it applied in live shadow (build d07cd7d7,
 * 2026-11-26 01:07-01:35Z) and its shadow-stage breaker tripped (3 re-decisions over 50 ms in 20). The cost was the
 * rejection sampler behind its equities and behind the call it re-asks. The faster paths must change no number:
 *
 *   1. omahaPreflopScore (rewritten without maps or sorted copies) equals the implementation it replaced, frozen
 *      below, bit for bit, for 4, 5 and 6 cards, high and hi-lo;
 *   2. omahaPreflopScoreOfIds equals omahaPreflopScore on the same cards;
 *   3. scoreOmahaHiOfIdsOnRun equals scoreOmahaHi on the same cards (and with a stop score, says the same about
 *      beating it);
 *   4. omahaReraisedEquity (no deck copy per try) equals the implementation it replaced, frozen below;
 *   5. omahaReraisedEquityInPercentileBand equals omahaReraisedEquity against the same percentile band.
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import {
  omahaCardId,
  omahaPreflopPercentile,
  omahaPreflopScore,
  omahaPreflopScoreOfIds,
  omahaRunTriples,
  scoreOmahaHi,
  scoreOmahaHiOfIdsOnRun,
} from './HorseEval.js';
import {
  omahaReraisedEquity,
  omahaReraisedEquityInPercentileBand,
} from './HorseOmahaReraisedPot.js';
import { RANK_VALUES } from './PokerEngine.js';

const SU = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const RK = '23456789TJQKA'.split('');
const DECK: Card[] = [];
for (const s of SU) for (const r of RK) DECK.push({ rank: r, suit: s } as Card);
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

/** omahaPreflopScore as it was before 2026-11-26 (frozen). */
function frozenPreflopScore(cards: Card[], isHiLo: boolean): number {
  const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
  const ranks = cards.map((c) => RANK_VALUES[c.rank]).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  let pts = 0;
  const rankCounts = new Map<number, number>();
  for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  for (const [r, count] of rankCounts) {
    if (count === 2) {
      if (r === 14) pts += 8;
      else if (r >= 12) pts += 6;
      else if (r >= 10) pts += 4;
      else pts += 2;
    } else if (count >= 3) {
      pts -= 2;
    }
  }
  const suitCounts = new Map<string, number>();
  for (let i = 0; i < cards.length; i++) {
    const s = suits[i]!;
    suitCounts.set(s, (suitCounts.get(s) || 0) + 1);
  }
  let suitedGroups = 0;
  for (const [s, count] of suitCounts) {
    if (count >= 2) {
      suitedGroups++;
      const hasAce = cards.some((c) => c.suit === s && c.rank === 'A');
      pts += hasAce ? 4 : 2;
      if (count >= 4) pts -= 2;
    }
  }
  if (suitedGroups >= 2) pts += 2;
  const unique = [...new Set(ranks)].sort((a, b) => b - a);
  for (let i = 1; i < unique.length; i++) {
    const g = unique[i - 1]! - unique[i]!;
    if (g === 1) pts += 2.5;
    else if (g === 2) pts += 1.2;
    else if (g === 3) pts += 0.5;
  }
  for (const r of ranks) {
    if (r === 14) pts += 1.5;
    else if (r >= 12) pts += 1;
    else if (r >= 10) pts += 0.5;
  }
  if (isHiLo) {
    const hasA = ranks.includes(14);
    const has2 = ranks.includes(2);
    const has3 = ranks.includes(3);
    if (hasA && has2) pts += has3 ? 7.5 : 6;
    else if (hasA && has3) pts += 4;
    else if (has2 && has3) pts += 2;
    const lowCount = ranks.filter((r) => r <= 8 || r === 14).length;
    if (lowCount >= 3) pts += 1.5;
  }
  const holeShift = cards.length >= 6 ? 8.8 : cards.length === 5 ? 4.7 : 0;
  return clamp01((pts - holeShift) / 30);
}

/** omahaReraisedEquity as it was before 2026-11-26 (frozen, with its private seed, generator and deck). */
const F_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const F_SUITS = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
const fKey = (c: Card): string => `${c.rank}:${c.suit}`;
function fSeed(cards: readonly Card[]): number {
  let h = 2166136261;
  for (const c of cards)
    for (const ch of fKey(c)) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 16777619);
    }
  return h >>> 0 || 1;
}
function fGenerator(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function frozenReraisedEquity(
  hole: readonly Card[],
  board: readonly Card[],
  dead: readonly Card[],
  inRange: (h: readonly Card[], board: readonly Card[]) => boolean,
  samples: number
): number | null {
  const seen = new Set([...hole, ...board, ...dead].map(fKey));
  const deck: Card[] = [];
  for (const rank of F_RANKS)
    for (const suit of F_SUITS) {
      const c = { rank, suit } as Card;
      if (!seen.has(fKey(c))) deck.push(c);
    }
  const size = hole.length;
  const need = 5 - board.length;
  if (deck.length < size + need) return null;
  const rnd = fGenerator(fSeed([...hole, ...board]));
  const pick = (n: number, from: Card[]): Card[] => {
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rnd() * (from.length - i));
      const t = from[i]!;
      from[i] = from[j]!;
      from[j] = t;
    }
    return from.slice(0, n);
  };
  let won = 0;
  let got = 0;
  const budget = samples * 200;
  for (let tries = 0; got < samples && tries < budget; tries++) {
    const d = deck.slice();
    const opp = pick(size, d);
    if (!inRange(opp, board)) continue;
    const rest = d.slice(size);
    const run = [...board, ...pick(need, rest)];
    const a = scoreOmahaHi([...hole], run);
    const b = scoreOmahaHi(opp, run);
    won += a > b ? 1 : a === b ? 0.5 : 0;
    got++;
  }
  return got >= samples / 2 ? won / got : null;
}

describe('LAW: the fast out-of-position 3-bet price computes the same numbers', () => {
  it('omahaPreflopScore is the frozen implementation, and omahaPreflopScoreOfIds is omahaPreflopScore', () => {
    const rnd = stream(0x51ed);
    const ids = new Int32Array(6);
    let n = 0;
    for (const holeCount of [4, 5, 6])
      for (let t = 0; t < 40_000; t++) {
        const h = draw(rnd, holeCount);
        for (let i = 0; i < holeCount; i++) ids[i] = omahaCardId(h[i]!);
        for (const hiLo of [false, true]) {
          const want = frozenPreflopScore(h, hiLo);
          const got = omahaPreflopScore(h, hiLo);
          const fromIds = omahaPreflopScoreOfIds(ids, 0, holeCount, hiLo);
          if (!Object.is(got, want) || !Object.is(fromIds, want))
            expect({ h, hiLo, got, fromIds }).toEqual({ h, hiLo, got: want, fromIds: want });
          n++;
        }
      }
    expect(n).toBe(240_000);
  });

  it('scoreOmahaHiOfIdsOnRun is scoreOmahaHi, and its stop score keeps the comparison', () => {
    const rnd = stream(0xb0a7);
    const ids = new Int32Array(6);
    const run = new Int32Array(5);
    for (const holeCount of [4, 5, 6])
      for (let t = 0; t < 20_000; t++) {
        const all = draw(rnd, holeCount * 2 + 5);
        const h = all.slice(0, holeCount);
        const o = all.slice(holeCount, 2 * holeCount);
        const board = all.slice(2 * holeCount);
        for (let i = 0; i < 5; i++) run[i] = omahaCardId(board[i]!);
        omahaRunTriples(run, 0);
        for (let i = 0; i < holeCount; i++) ids[i] = omahaCardId(h[i]!);
        const want = scoreOmahaHi(h, board);
        expect(scoreOmahaHiOfIdsOnRun(ids, 0, holeCount, Infinity)).toBe(want);
        const stop = scoreOmahaHi(o, board);
        const early = scoreOmahaHiOfIdsOnRun(ids, 0, holeCount, stop);
        expect(early > stop).toBe(want > stop);
        if (!(want > stop)) expect(early).toBe(want);
      }
  });

  it('omahaReraisedEquity and omahaReraisedEquityInPercentileBand are the frozen sampler', () => {
    const rnd = stream(0xe9a1);
    let priced = 0;
    for (let t = 0; t < 90; t++) {
      const holeCount = [4, 5, 6][t % 3]!;
      const cards = draw(rnd, holeCount + 3);
      const hole = cards.slice(0, holeCount);
      const dead = t % 4 === 0 ? cards.slice(holeCount, holeCount + 1 + (t % 3)) : [];
      const width = [0.01, 0.04, 0.12, 0.35, 0.7][t % 5]!;
      const lo = rnd() * (1 - width);
      const hi = t % 7 === 0 ? 1 : lo + width;
      const samples = [400, 150, 60][t % 3]!;
      const inBand = (h: readonly Card[]): boolean => {
        const p = omahaPreflopPercentile([...h], false);
        return p >= lo && p <= hi;
      };
      const want = frozenReraisedEquity(hole, [], dead, inBand, samples);
      expect(Object.is(omahaReraisedEquity(hole, [], dead, inBand, samples), want)).toBe(true);
      expect(
        Object.is(omahaReraisedEquityInPercentileBand(hole, dead, lo, hi, samples), want),
        `case ${t}`
      ).toBe(true);
      if (want !== null) priced++;
      // a board in play (the generic sampler only): the run-out is the rest of the board
      if (t % 10 === 0) {
        const more = draw(rnd, 52).filter((c) => !cards.some((k) => fKey(k) === fKey(c)));
        const board = more.slice(0, 3);
        const anyHand = (): boolean => true;
        expect(
          Object.is(
            omahaReraisedEquity(hole, board, [], anyHand, 80),
            frozenReraisedEquity(hole, board, [], anyHand, 80)
          )
        ).toBe(true);
      }
    }
    expect(priced).toBeGreaterThan(60);
  }, 120_000);
});
