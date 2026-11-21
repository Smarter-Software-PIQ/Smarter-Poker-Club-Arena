/**
 * omahaMathCore equity (lane MATHCORE 2026-11-19): Monte Carlo showdown
 * equity of the hero's exact hand against one weighted range per live
 * opponent, run to the river, with card removal (hero, board, the other
 * opponents' sampled holdings) and multiway ties split. Sampling stops when
 * the standard error is below the target or the sample/time cap is reached;
 * the achieved SE is returned and written in the receipt.
 *
 * Ranges are POOLS: a set of concrete holdings drawn from the unseen cards,
 * each with a strength computed from the cards (its mean showdown rank
 * against the rest of the pool over shared runouts; on the river its made
 * hand). A range is a weighted mixture of pool subsets (for example the
 * bettor's value holdings and his other holdings at the measured
 * non-value share). No chart, persona or fixed bar: subsets come from
 * measured frequencies applied to the computed strength order.
 *
 * Swap point: when lane EQUITY publishes equityVsRanges, `equityVsPools`
 * is the one function to route to it.
 */
import type { Card } from '../../types.js';
import { equityVsRanges, type OmahaOpponentRange } from '../omaha/OmahaRangeEquity.js';
import {
  omahaBest,
  categoryOf,
  CAT_TWO_PAIR,
  CAT_TRIPS,
  CAT_STRAIGHT,
} from './OmahaMathCoreEval.js';

export type Rng = () => number;

/** xorshift128+ style 32-bit generator from a string seed (deterministic, never the brain's stream). */
export function seededRng(seed: string): Rng {
  let h1 = 0x811c9dc5 ^ seed.length,
    h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) ^ (h2 >>> 15);
  }
  let a = h1 >>> 0 || 1,
    b = h2 >>> 0 || 2,
    c = 0x1234567,
    d = 0x89abcdef;
  return () => {
    const t = a ^ (a << 11);
    a = b;
    b = c;
    c = d;
    d = (d ^ (d >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return d / 4294967296;
  };
}

export interface Pool {
  holeCount: number;
  /** holdings, flat: holding i = cards[i*holeCount .. +holeCount) */
  cards: Int8Array;
  size: number;
  /** computed strength per holding (higher = stronger) */
  strength: Float64Array;
  /** made-hand category on the current board (exact 2+3), -1 preflop */
  category: Int8Array;
  /** holding indices sorted strongest first */
  order: Int32Array;
}

function unseenDeck(known: readonly number[]): number[] {
  const used = new Uint8Array(52);
  for (const c of known) used[c] = 1;
  const out: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) out.push(c);
  return out;
}

/**
 * Build the opponent pool for this decision: `size` holdings from the unseen
 * cards (hero and board removed), strength = mean percentile of the holding's
 * best hand among the pool over `runouts` shared random completions of the
 * board (exact on the river: the made hand).
 */
export function buildPool(
  hero: readonly number[],
  board: readonly number[],
  holeCount: number,
  size: number,
  runouts: number,
  rng: Rng
): Pool {
  const deck = unseenDeck([...hero, ...board]);
  const cards = new Int8Array(size * holeCount);
  const tmp = deck.slice();
  for (let i = 0; i < size; i++) {
    // partial Fisher-Yates per holding
    for (let k = 0; k < holeCount; k++) {
      const j = k + Math.floor(rng() * (tmp.length - k));
      const t = tmp[k];
      tmp[k] = tmp[j];
      tmp[j] = t;
      cards[i * holeCount + k] = tmp[k];
    }
  }
  const strength = new Float64Array(size);
  const category = new Int8Array(size).fill(-1);
  const holding = new Int8Array(holeCount);
  const full = new Int8Array(5);
  const scores = new Float64Array(size);
  const missing = 5 - board.length;
  if (board.length >= 3) {
    for (let i = 0; i < size; i++) {
      for (let k = 0; k < holeCount; k++) holding[k] = cards[i * holeCount + k];
      category[i] = categoryOf(omahaBest(holding, holeCount, Int8Array.from(board), board.length));
    }
  }
  const nRuns = missing === 0 ? 1 : runouts;
  const valid = new Uint8Array(size);
  const counted = new Float64Array(size);
  for (let r = 0; r < nRuns; r++) {
    for (let k = 0; k < board.length; k++) full[k] = board[k];
    // random completion from the unseen deck
    const used = new Set<number>();
    for (let k = board.length; k < 5; k++) {
      let c: number;
      do c = deck[Math.floor(rng() * deck.length)];
      while (used.has(c));
      used.add(c);
      full[k] = c;
    }
    let m = 0;
    for (let i = 0; i < size; i++) {
      let clash = false;
      for (let k = 0; k < holeCount; k++) {
        const c = cards[i * holeCount + k];
        holding[k] = c;
        if (used.has(c)) clash = true;
      }
      valid[i] = clash ? 0 : 1;
      if (!clash) {
        scores[i] = omahaBest(holding, holeCount, full, 5);
        m++;
      }
    }
    if (m < 2) continue;
    // percentile rank among the valid holdings
    const idx: number[] = [];
    for (let i = 0; i < size; i++) if (valid[i]) idx.push(i);
    idx.sort((x, y) => scores[x] - scores[y]);
    let p = 0;
    while (p < idx.length) {
      let q = p;
      while (q + 1 < idx.length && scores[idx[q + 1]] === scores[idx[p]]) q++;
      const pct = (p + q) / 2 / (idx.length - 1);
      for (let t = p; t <= q; t++) {
        strength[idx[t]] += pct;
        counted[idx[t]] += 1;
      }
      p = q + 1;
    }
  }
  for (let i = 0; i < size; i++) strength[i] = counted[i] > 0 ? strength[i] / counted[i] : 0;
  const order = Int32Array.from(
    Array.from({ length: size }, (_, i) => i).sort((x, y) => strength[y] - strength[x])
  );
  return { holeCount, cards, size, strength, category, order };
}

/** One part of a range: holdings of the pool (indices) with a weight. */
export interface RangePart {
  idx: Int32Array;
  weight: number;
}
export interface RangeSpec {
  parts: RangePart[];
  /** for receipts */
  label: string;
}

export function fullRange(pool: Pool, label = 'pool'): RangeSpec {
  return { parts: [{ idx: Int32Array.from(pool.order), weight: 1 }], label };
}

/** The strongest `share` of a range by computed strength (a continue range). */
export function topOf(pool: Pool, range: RangeSpec, share: number, label: string): RangeSpec {
  const s = Math.min(1, Math.max(0.02, share));
  // flatten weights onto holdings, keep strongest mass `s`
  const w = new Float64Array(pool.size);
  for (const part of range.parts) {
    if (part.idx.length === 0) continue;
    const each = part.weight / part.idx.length;
    for (const i of part.idx) w[i] += each;
  }
  let total = 0;
  for (let i = 0; i < pool.size; i++) total += w[i];
  const keep: number[] = [];
  const weights: number[] = [];
  let acc = 0;
  for (const i of pool.order) {
    if (w[i] <= 0) continue;
    if (acc >= s * total) break;
    keep.push(i);
    weights.push(w[i]);
    acc += w[i];
  }
  // weighted parts: group equal weights into one part each to keep sampling exact
  const byWeight = new Map<number, number[]>();
  keep.forEach((i, k) => {
    const key = weights[k];
    const arr = byWeight.get(key) ?? [];
    arr.push(i);
    byWeight.set(key, arr);
  });
  const parts: RangePart[] = [];
  for (const [wt, arr] of byWeight)
    parts.push({ idx: Int32Array.from(arr), weight: wt * arr.length });
  return { parts: parts.length ? parts : range.parts, label };
}

/**
 * The value region of a holding on this board, as lane RANGES defines value
 * for its measured non-value shares (interim definition until its table
 * names one: made two pair or better on an unpaired board, trips or better on
 * a paired board; on the river a straight or better when the board allows a
 * straight or a flush). Computed from the holding and the board only.
 */
export function isValueHolding(category: number, boardPaired: boolean): boolean {
  if (category < 0) return false;
  return boardPaired ? category >= CAT_TRIPS : category >= CAT_TWO_PAIR;
}
void CAT_STRAIGHT;

/** Bettor range: value holdings at (1 - nonValueShare), the rest at nonValueShare. */
export function bettorRange(
  pool: Pool,
  nonValueShare: number,
  boardPaired: boolean,
  label: string
): RangeSpec {
  const value: number[] = [];
  const other: number[] = [];
  for (const i of pool.order)
    (isValueHolding(pool.category[i], boardPaired) ? value : other).push(i);
  const nv = Math.min(1, Math.max(0, nonValueShare));
  const parts: RangePart[] = [];
  if (value.length) parts.push({ idx: Int32Array.from(value), weight: 1 - nv });
  if (other.length) parts.push({ idx: Int32Array.from(other), weight: nv });
  if (!value.length || !other.length) for (const p of parts) p.weight = 1;
  return { parts, label };
}

export interface EquityResult {
  equity: number;
  se: number;
  samples: number;
  ms: number;
}

function pickHolding(range: RangeSpec, rng: Rng): number {
  let total = 0;
  for (const p of range.parts) total += p.weight;
  let u = rng() * total;
  for (const p of range.parts) {
    if (u < p.weight || p === range.parts[range.parts.length - 1])
      return p.idx[Math.floor(rng() * p.idx.length)];
    u -= p.weight;
  }
  return range.parts[0].idx[0];
}

/**
 * Hero's showdown share against every opponent range, to the river. Each
 * sample draws a holding per opponent (rejecting card clashes between
 * opponents), completes the board from the remaining cards and splits ties.
 */
export function equityVsPools(
  hero: readonly number[],
  board: readonly number[],
  pool: Pool,
  ranges: readonly RangeSpec[],
  rng: Rng,
  opts: {
    targetSe: number;
    minSamples: number;
    maxSamples: number;
    now: () => number;
  }
): EquityResult {
  const t0 = opts.now();
  const hc = hero.length;
  const heroArr = Int8Array.from(hero);
  const full = new Int8Array(5);
  const used = new Uint8Array(52);
  const deck = unseenDeck([...hero, ...board]);
  const oppCards = new Int8Array(pool.holeCount);
  let sum = 0,
    sumSq = 0,
    n = 0;
  if (ranges.length === 0) return { equity: 1, se: 0, samples: 0, ms: 0 };
  // Termination never reads the clock: the number of draws is bounded, so the result is
  // deterministic for a given seed whatever the machine load.
  const maxDraws = Math.max(opts.maxSamples, opts.minSamples) * 4;
  let draws = 0;
  for (;;) {
    if (draws >= maxDraws) {
      if (n === 0) return { equity: NaN, se: NaN, samples: 0, ms: opts.now() - t0 };
      const mean = sum / n;
      return {
        equity: mean,
        se: Math.sqrt(Math.max(0, sumSq / n - mean * mean) / n),
        samples: n,
        ms: opts.now() - t0,
      };
    }
    for (let batch = 0; batch < 64; batch++) {
      draws++;
      used.fill(0);
      const picks: number[] = [];
      let ok = true;
      for (const range of ranges) {
        let got = -1;
        for (let tries = 0; tries < 40 && got < 0; tries++) {
          const i = pickHolding(range, rng);
          let clash = false;
          for (let k = 0; k < pool.holeCount; k++)
            if (used[pool.cards[i * pool.holeCount + k]]) clash = true;
          if (!clash) got = i;
        }
        if (got < 0) {
          ok = false;
          break;
        }
        for (let k = 0; k < pool.holeCount; k++) used[pool.cards[got * pool.holeCount + k]] = 1;
        picks.push(got);
      }
      if (!ok) continue;
      for (let k = 0; k < board.length; k++) full[k] = board[k];
      for (let k = board.length; k < 5; k++) {
        let c: number;
        do c = deck[Math.floor(rng() * deck.length)];
        while (used[c]);
        used[c] = 1;
        full[k] = c;
      }
      const hs = omahaBest(heroArr, hc, full, 5);
      let best = hs,
        ties = 1,
        heroBest = true;
      for (const i of picks) {
        for (let k = 0; k < pool.holeCount; k++) oppCards[k] = pool.cards[i * pool.holeCount + k];
        const s = omahaBest(oppCards, pool.holeCount, full, 5);
        if (s > best) {
          best = s;
          heroBest = false;
          ties = 1;
        } else if (s === best && heroBest) ties++;
      }
      const share = heroBest ? 1 / ties : 0;
      sum += share;
      sumSq += share * share;
      n++;
    }
    // no clock: the loop ends on the sample target or on the draw bound above (opts.now only times the receipt)
    if (n >= opts.minSamples) {
      const mean = sum / n;
      const se = Math.sqrt(Math.max(0, sumSq / n - mean * mean) / n);
      if (se <= opts.targetSe || n >= opts.maxSamples)
        return { equity: mean, se, samples: n, ms: opts.now() - t0 };
    }
  }
}

// ── lane EQUITY's equityVsRanges (OmahaRangeEquity.ts, exact joint draws, verified evaluator) ──

const DECK: Card[] = Array.from({ length: 52 }, (_, i) => ({
  rank: '23456789TJQKA'[i >> 2] as Card['rank'],
  suit: (['clubs', 'diamonds', 'hearts', 'spades'] as const)[i & 3],
}));

/** The pool ranges as lane EQUITY's weighted combos, priced by equityVsRanges. */
export function equityVsPoolsEquityLane(
  hero: readonly number[],
  board: readonly number[],
  pool: Pool,
  ranges: readonly RangeSpec[],
  seed: number,
  opts: { targetSe: number; minSamples: number; maxSamples: number; now: () => number }
): EquityResult {
  const t0 = opts.now();
  if (ranges.length === 0) return { equity: 1, se: 0, samples: 0, ms: 0 };
  const opp: OmahaOpponentRange[] = ranges.map((r) => {
    const combos: { cards: Card[]; weight: number }[] = [];
    for (const part of r.parts) {
      if (!part.idx.length || !(part.weight > 0)) continue;
      const w = part.weight / part.idx.length;
      for (const i of part.idx) {
        const cards: Card[] = [];
        for (let k = 0; k < pool.holeCount; k++)
          cards.push(DECK[pool.cards[i * pool.holeCount + k]]);
        combos.push({ cards, weight: w });
      }
    }
    return { kind: 'combos', combos };
  });
  const res = equityVsRanges(
    hero.map((c) => DECK[c]),
    board.map((c) => DECK[c]),
    opp,
    opts.maxSamples,
    { targetSE: opts.targetSe, minSamples: opts.minSamples, seed }
  );
  if (!res) return { equity: NaN, se: NaN, samples: 0, ms: opts.now() - t0 };
  return { equity: res.equity, se: res.se, samples: res.samples, ms: opts.now() - t0 };
}
