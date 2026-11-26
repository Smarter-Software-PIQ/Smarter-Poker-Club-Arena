/**
 * LAW: THE FAST RE-RAISED-POT PRICE COMPUTES THE SAME NUMBERS (PLO-OWNER lead-7, 2026-11-26).
 *
 * omahaReraisedPotCallIsPriced / omahaReraisedPotReraiseIsPriced price a re-raised-pot call on one joint sample set
 * (reraisedPotVerdict). Their multiway sampler and the preflop defence equity now run on card ids. They must change
 * no number:
 *   1. omahaReraisedEquityAgainstPercentileFloors equals omahaReraisedEquityAgainst over the same percentile-floor
 *      ranges (reraisedPotRangeOf), and equals the implementation it stands in for, frozen below: the same equity
 *      and the same onSample scores, sample by sample;
 *   2. omahaPreflopDefenceEquity equals the formulation it replaced (omahaReraisedEquity against the same floor).
 */
import { describe, expect, it } from 'vitest';
import type { Card } from '../types.js';
import { omahaPreflopPercentile, scoreOmahaHi } from './HorseEval.js';
import {
  omahaReraisedEquity,
  omahaReraisedEquityAgainst,
  omahaReraisedEquityAgainstPercentileFloors,
} from './HorseOmahaReraisedPot.js';
import { reraisedPotFloorOf, reraisedPotRangeOf } from './HorseOmahaReraisedPotPriced.js';
import {
  PREFLOP_DEFENCE_EQUITY_SAMPLES,
  omahaPreflopDefenceEquity,
} from './HorseOmahaPreflopReraiseDefence.js';

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

/** omahaReraisedEquityAgainst as it was before 2026-11-26 (frozen, with its private seed, generator and deck). */
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
function frozenAgainst(
  hole: readonly Card[],
  dead: readonly Card[],
  ranges: readonly ((h: readonly Card[]) => boolean)[],
  samples: number,
  onSample?: (heroScore: number, oppScores: readonly number[]) => void
): number | null {
  const size = hole.length;
  const seen = new Set([...hole, ...dead].map(fKey));
  const deck: Card[] = [];
  for (const rank of F_RANKS)
    for (const suit of F_SUITS) {
      const c = { rank, suit } as Card;
      if (!seen.has(fKey(c))) deck.push(c);
    }
  if (ranges.length === 0 || deck.length < size * ranges.length + 5) return null;
  const rnd = fGenerator(fSeed([...hole]) ^ (0x9e3779b9 * ranges.length));
  const take = (n: number, from: Card[]): Card[] => {
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(rnd() * (from.length - i));
      const t = from[i]!;
      from[i] = from[j]!;
      from[j] = t;
    }
    return from.splice(0, n);
  };
  let won = 0;
  let got = 0;
  const budget = samples * 200 * ranges.length;
  let tries = 0;
  while (got < samples && tries < budget) {
    const d = deck.slice();
    const opps: Card[][] = [];
    for (const inRange of ranges) {
      let found: Card[] | null = null;
      for (let k = 0; k < 200 && tries < budget && found === null; k++) {
        tries++;
        const probe = d.slice();
        const h = take(size, probe);
        if (inRange(h)) {
          found = h;
          d.length = 0;
          d.push(...probe);
        }
      }
      if (found === null) break;
      opps.push(found);
    }
    if (opps.length !== ranges.length) continue;
    const run = take(5, d);
    const mine = scoreOmahaHi([...hole], run);
    let best = mine;
    let tied = 1;
    const scores: number[] = [];
    for (const o of opps) {
      const s = scoreOmahaHi(o, run);
      scores.push(s);
      if (s > best) {
        best = s;
        tied = 1;
      } else if (s === best) tied++;
    }
    if (mine === best) won += 1 / tied;
    got++;
    if (onSample) onSample(mine, scores);
  }
  return got >= samples / 2 ? won / got : null;
}

describe('LAW: the fast re-raised-pot price computes the same numbers', () => {
  it('the floor sampler is omahaReraisedEquityAgainst and the frozen sampler, sample by sample', () => {
    const rnd = stream(0x4e15);
    let priced = 0;
    for (let t = 0; t < 60; t++) {
      const holeCount = [4, 5][t % 2]!;
      const cards = draw(rnd, holeCount + 2);
      const hole = cards.slice(0, holeCount);
      const dead = t % 3 === 0 ? cards.slice(holeCount, holeCount + 2) : [];
      const widths = Array.from(
        { length: 1 + (t % 4) },
        (_, k) => [1, 0.5, 0.2, 0.05, 0.02, 0.35][(t + k) % 6]!
      );
      const samples = [240, 90][t % 2]!;
      const seqF: number[] = [];
      const seqL: number[] = [];
      const seqZ: number[] = [];
      const f = omahaReraisedEquityAgainstPercentileFloors(
        hole,
        dead,
        widths.map(reraisedPotFloorOf),
        samples,
        (m, o) => seqF.push(m, ...o)
      );
      const live = omahaReraisedEquityAgainst(
        hole,
        dead,
        widths.map(reraisedPotRangeOf),
        samples,
        (m, o) => seqL.push(m, ...o)
      );
      const frozen = frozenAgainst(hole, dead, widths.map(reraisedPotRangeOf), samples, (m, o) =>
        seqZ.push(m, ...o)
      );
      expect(Object.is(f, frozen), `case ${t}`).toBe(true);
      expect(Object.is(live, frozen), `case ${t}`).toBe(true);
      expect(seqF).toEqual(seqZ);
      expect(seqL).toEqual(seqZ);
      if (frozen !== null) priced++;
    }
    expect(priced).toBeGreaterThan(40);
  }, 120_000);

  it('omahaPreflopDefenceEquity is the Card sampler against the same floor', () => {
    const rnd = stream(0xdef1);
    for (let t = 0; t < 30; t++) {
      const holeCount = [4, 5][t % 2]!;
      const cards = draw(rnd, holeCount + 2);
      const hole = cards.slice(0, holeCount);
      const dead = t % 3 === 0 ? cards.slice(holeCount, holeCount + 1) : [];
      const width = [1, 0.6, 0.25, 0.08, 0.02][t % 5]!;
      const lo = 1 - Math.max(0.02, Math.min(1, width));
      const want = omahaReraisedEquity(
        hole,
        [],
        dead,
        lo <= 1e-9 ? () => true : (h) => omahaPreflopPercentile([...h], false) >= lo,
        PREFLOP_DEFENCE_EQUITY_SAMPLES
      );
      expect(Object.is(omahaPreflopDefenceEquity(hole, dead, width), want), `case ${t}`).toBe(true);
    }
  }, 120_000);
});
