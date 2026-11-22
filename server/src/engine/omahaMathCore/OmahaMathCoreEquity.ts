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
import { equityVsIntPools } from '../omaha/OmahaRangeEquity.js';
import {
  RANK_KEY,
  buildPoolFastData,
  categoryOf,
  createBoardTable,
  createFiveBoardTriples,
  getPoolPairKeys,
  loadBoardTable,
  loadFiveBoardTriples,
  scorePairKeysOnFiveBoard,
  scorePoolHoldingWithBoard,
  sortIndicesDescStable,
  CAT_TWO_PAIR,
  CAT_TRIPS,
  CAT_STRAIGHT,
  type PoolFastData,
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

const POOL_FAST_CACHE = new WeakMap<Pool, PoolFastData>();

/** Lazily builds and caches precomputed pair/mask geometry for a Pool (auto-GC'd with Pool). */
export function getPoolFastData(pool: Pool): PoolFastData {
  let f = POOL_FAST_CACHE.get(pool);
  if (!f) {
    f = buildPoolFastData(pool.cards, pool.size, pool.holeCount);
    POOL_FAST_CACHE.set(pool, f);
  }
  return f;
}

export function setPoolFastData(pool: Pool, fast: PoolFastData): void {
  POOL_FAST_CACHE.set(pool, fast);
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
  const deckLen = deck.length;
  const cards = new Int8Array(size * holeCount);
  const tmp = Int8Array.from(deck);
  for (let i = 0; i < size; i++) {
    // partial Fisher-Yates per holding
    const base = i * holeCount;
    for (let k = 0; k < holeCount; k++) {
      const j = k + Math.floor(rng() * (deckLen - k));
      const t = tmp[k];
      tmp[k] = tmp[j];
      tmp[j] = t;
      cards[base + k] = tmp[k];
    }
  }
  const fast = buildPoolFastData(cards, size, holeCount);
  const maskLo = fast.maskLo;
  const maskHi = fast.maskHi;
  const strength = new Float64Array(size);
  const category = new Int8Array(size).fill(-1);
  const full = new Int8Array(5);
  const tbl = createBoardTable();
  const bLen = board.length;
  const missing = 5 - bLen;
  if (bLen >= 3) {
    loadBoardTable(tbl, board, bLen);
    for (let i = 0; i < size; i++) {
      category[i] = categoryOf(scorePoolHoldingWithBoard(fast, cards, i, tbl));
    }
  }
  const nRuns = missing === 0 ? 1 : runouts;
  const counted = new Float64Array(size);
  const stride = size <= 4096 ? 4096 : 65536;
  const invStride = 1 / stride;
  const packed = new Float64Array(size);
  for (let k = 0; k < bLen; k++) full[k] = board[k];
  for (let r = 0; r < nRuns; r++) {
    let runLo = 0;
    let runHi = 0;
    for (let k = bLen; k < 5; k++) {
      let c: number;
      for (;;) {
        c = deck[Math.floor(rng() * deckLen)];
        if (c < 32) {
          const bit = 1 << c;
          if ((runLo & bit) === 0) {
            runLo |= bit;
            break;
          }
        } else {
          const bit = 1 << (c - 32);
          if ((runHi & bit) === 0) {
            runHi |= bit;
            break;
          }
        }
      }
      full[k] = c;
    }
    loadBoardTable(tbl, full, 5);
    let m = 0;
    for (let i = 0; i < size; i++) {
      if ((maskLo[i] & runLo) | (maskHi[i] & runHi)) continue;
      packed[m++] = scorePoolHoldingWithBoard(fast, cards, i, tbl) * stride + i;
    }
    if (m < 2) continue;
    packed.subarray(0, m).sort();
    let p = 0;
    const denom = m - 1;
    while (p < m) {
      let q = p;
      const sp = Math.floor(packed[p] * invStride);
      while (q + 1 < m && Math.floor(packed[q + 1] * invStride) === sp) q++;
      const pct = (p + q) / 2 / denom;
      for (let t = p; t <= q; t++) {
        const v = packed[t];
        const ii = v - Math.floor(v * invStride) * stride;
        strength[ii] += pct;
        counted[ii] += 1;
      }
      p = q + 1;
    }
  }
  for (let i = 0; i < size; i++) strength[i] = counted[i] > 0 ? strength[i] / counted[i] : 0;
  const order = sortIndicesDescStable(strength, size);
  const pool: Pool = { holeCount, cards, size, strength, category, order };
  setPoolFastData(pool, fast);
  return pool;
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

interface PreparedPoolRange {
  readonly parts: readonly RangePart[];
  readonly cdf: Float64Array;
  readonly total: number;
  readonly last: number;
}

function preparePoolRange(range: RangeSpec): PreparedPoolRange {
  const parts = range.parts;
  const len = parts.length;
  const cdf = new Float64Array(len);
  let total = 0;
  for (let i = 0; i < len; i++) {
    total += parts[i].weight;
    cdf[i] = total;
  }
  return { parts, cdf, total, last: len - 1 };
}

function pickHoldingFast(pr: PreparedPoolRange, rng: Rng): number {
  const u = rng() * pr.total;
  let lo = 0;
  let hi = pr.last;
  const cdf = pr.cdf;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (u < cdf[mid]) hi = mid;
    else lo = mid + 1;
  }
  const idx = pr.parts[lo].idx;
  return idx[Math.floor(rng() * idx.length)];
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
  if (ranges.length === 0) return { equity: 1, se: 0, samples: 0, ms: 0 };
  const hc = hero.length;
  const heroArr = Int8Array.from(hero);
  const nPairs = (hc * (hc - 1)) >> 1;
  const heroPairKeys = new Int32Array(nPairs);
  let hSeen = 0;
  let heroSuitMask = 0;
  for (let k = 0; k < hc; k++) {
    const sb = 1 << (heroArr[k] & 3);
    heroSuitMask |= hSeen & sb;
    hSeen |= sb;
  }
  {
    let p = 0;
    for (let a = 0; a < hc - 1; a++) {
      const ka = RANK_KEY[heroArr[a] >> 2];
      for (let b = a + 1; b < hc; b++) heroPairKeys[p++] = ka + RANK_KEY[heroArr[b] >> 2];
    }
  }
  const fast = getPoolFastData(pool);
  const pMaskLo = fast.maskLo;
  const pMaskHi = fast.maskHi;
  const pPairKeys = getPoolPairKeys(fast, pool.cards);
  const pSuitMask = fast.suitMask;
  const pPairs = fast.nPairs;
  const pHc = pool.holeCount;
  const pCards = pool.cards;
  const prep = ranges.map(preparePoolRange);
  const nRanges = prep.length;
  const picks = new Int32Array(nRanges);
  const bLen = board.length;
  const full = new Int8Array(5);
  for (let k = 0; k < bLen; k++) full[k] = board[k];
  const deck = unseenDeck([...hero, ...board]);
  const deckLen = deck.length;
  const bt = createFiveBoardTriples();
  let sum = 0,
    sumSq = 0,
    n = 0;
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
      let usedLo = 0;
      let usedHi = 0;
      let ok = true;
      for (let r = 0; r < nRanges; r++) {
        const pr = prep[r];
        let got = -1;
        for (let tries = 0; tries < 40 && got < 0; tries++) {
          const i = pickHoldingFast(pr, rng);
          if (((usedLo & pMaskLo[i]) | (usedHi & pMaskHi[i])) === 0) got = i;
        }
        if (got < 0) {
          ok = false;
          break;
        }
        usedLo |= pMaskLo[got];
        usedHi |= pMaskHi[got];
        picks[r] = got;
      }
      if (!ok) continue;
      for (let k = bLen; k < 5; k++) {
        let c: number;
        for (;;) {
          c = deck[Math.floor(rng() * deckLen)];
          if (c < 32) {
            const bit = 1 << c;
            if ((usedLo & bit) === 0) {
              usedLo |= bit;
              break;
            }
          } else {
            const bit = 1 << (c - 32);
            if ((usedHi & bit) === 0) {
              usedHi |= bit;
              break;
            }
          }
        }
        full[k] = c;
      }
      loadFiveBoardTriples(bt, full[0], full[1], full[2], full[3], full[4]);
      const hs = scorePairKeysOnFiveBoard(
        heroPairKeys,
        0,
        nPairs,
        heroArr,
        0,
        hc,
        heroSuitMask,
        bt,
        -1
      );
      let ties = 1;
      let heroBest = true;
      for (let r = 0; r < nRanges; r++) {
        const i = picks[r];
        const s = scorePairKeysOnFiveBoard(
          pPairKeys,
          i * pPairs,
          pPairs,
          pCards,
          i * pHc,
          pHc,
          pSuitMask[i],
          bt,
          hs
        );
        if (s > hs) {
          heroBest = false;
          break;
        } else if (s === hs) ties++;
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

/** The pool ranges as lane EQUITY's weighted combos, priced by equityVsIntPools (bit-identical to equityVsRanges). */
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
  const res = equityVsIntPools(
    hero,
    board,
    pool.cards,
    getPoolFastData(pool),
    ranges,
    opts.maxSamples,
    {
      targetSE: opts.targetSe,
      minSamples: opts.minSamples,
      seed,
    }
  );
  if (!res) return { equity: NaN, se: NaN, samples: 0, ms: opts.now() - t0 };
  return { equity: res.equity, se: res.se, samples: res.samples, ms: opts.now() - t0 };
}
