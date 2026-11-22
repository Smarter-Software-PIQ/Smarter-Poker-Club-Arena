/**
 * omahaMathCore component (lane PLAYBOOK, lead session 01TLQer8, Nov 19 2026): BLOCKERS.
 *
 * The core builds every opponent pool from the cards the hero cannot see, so card removal already
 * moves the hero's EQUITY. It does not move the opponent's FOLD SHARE or the BETTOR'S VALUE SHARE:
 * topOf(range, 1 - f) keeps a share 1 - f of the blocked pool, so a hero who holds the nut-flush card
 * still sees the measured population fold rate f, and a bettor's value region is "the top N holdings"
 * of the blocked pool, which removal cannot shrink.
 *
 * Here the opponent's strategy is defined where it was measured: without knowledge of the hero's cards.
 * A REFERENCE pool is drawn from every card not on the board (hero's cards included). The opponent's
 * range is a band of that pool's strength order, his continue region is the strongest (1 - f) of it and
 * his folding region the rest (likewise a bettor's value and bluff segments). Conditioning on the
 * hero's cards removes every reference holding that contains one of them; the share that survives in
 * each segment is exact card arithmetic, so
 *   f'     = sF f / (sF f + sC (1 - f))          (blocker-conditioned fold share)
 *   alpha' = sB a / (sB a + sV (1 - a))          (blocker-conditioned bluff share of a bet)
 * with sC, sF, sV, sB the surviving shares of the continue / fold / value / bluff segments.
 * Inputs are public (the board) plus the hero's own cards; no opponent hole card is read.
 *
 * Pure, deterministic for a seed, never throws: any failure or a segment too thin to measure returns
 * the input unchanged with the reason in `source`. Postflop only (board of 3-5 cards).
 */
import { buildPool, getPoolFastData, seededRng, type Pool } from './OmahaMathCoreEquity.js';

export const PLAYBOOK_BLOCKERS_VERSION = 'playbook-blockers-v1';

/** A slice of the reference range's strength order: shares, 0 = strongest. */
export interface Segment {
  lo: number;
  hi: number;
}

export interface BlockerOpts {
  /** reference holdings drawn (default 1500) */
  size?: number;
  /** runouts used to rank holdings before the river (default flop 4, turn 6) */
  runouts?: number;
  /** fewest reference holdings a segment needs before its survival is used (default 25) */
  minSegment?: number;
}

export interface SurvivalResult {
  /** surviving share of each segment (null = too thin to measure) */
  survival: (number | null)[];
  /** reference holdings in each segment */
  counts: number[];
  source: string;
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const r3 = (x: number) => Math.round(x * 1000) / 1000;

const POOL_CACHE = new Map<string, Pool>();
const CACHE_MAX = 32;
/** Per-pool alive prefix sums along pool.order, keyed by (heroLo, heroHi), auto-GC'd with Pool. */
const ALIVE_PREFIX_CACHE = new WeakMap<Pool, Map<string, Uint16Array>>();

function alivePrefixOf(pool: Pool, heroLo: number, heroHi: number): Uint16Array {
  let byHero = ALIVE_PREFIX_CACHE.get(pool);
  if (!byHero) {
    byHero = new Map();
    ALIVE_PREFIX_CACHE.set(pool, byHero);
  }
  const hk = `${heroLo}:${heroHi}`;
  let pref = byHero.get(hk);
  if (!pref) {
    const fast = getPoolFastData(pool);
    const maskLo = fast.maskLo;
    const maskHi = fast.maskHi;
    const order = pool.order;
    const n = pool.size;
    pref = new Uint16Array(n + 1);
    let acc = 0;
    for (let t = 0; t < n; t++) {
      const i = order[t];
      if (((maskLo[i] & heroLo) | (maskHi[i] & heroHi)) === 0) acc++;
      pref[t + 1] = acc;
    }
    if (byHero.size >= 16) byHero.clear();
    byHero.set(hk, pref);
  }
  return pref;
}

function referencePool(
  board: readonly number[],
  holeCount: number,
  seed: string,
  opts: BlockerOpts
): Pool {
  const size = opts.size ?? 1500;
  const runouts = board.length >= 5 ? 1 : (opts.runouts ?? (board.length === 3 ? 4 : 6));
  const key = `${holeCount}|${board.join('.')}|${size}|${runouts}|${seed}`;
  const hit = POOL_CACHE.get(key);
  if (hit) return hit;
  // hero = []: the opponent's strategy does not know the hero's cards
  const pool = buildPool(
    [],
    board,
    holeCount,
    size,
    runouts,
    seededRng(`${seed}|playbook-blockers`)
  );
  if (POOL_CACHE.size >= CACHE_MAX) POOL_CACHE.delete(POOL_CACHE.keys().next().value as string);
  POOL_CACHE.set(key, pool);
  return pool;
}

/** Surviving share (holdings with none of the hero's cards) of each segment of a band of the reference order. */
export function segmentSurvival(
  hero: readonly number[],
  board: readonly number[],
  holeCount: number,
  band: Segment,
  segments: readonly Segment[],
  seed: string,
  opts: BlockerOpts = {}
): SurvivalResult {
  const empty = (why: string): SurvivalResult => ({
    survival: segments.map(() => null),
    counts: segments.map(() => 0),
    source: why,
  });
  try {
    if (board.length < 3 || board.length > 5)
      return empty('preflop or bad board: no blocker conditioning');
    if (!(holeCount >= 4 && holeCount <= 6)) return empty('hole count out of range');
    const pool = referencePool(board, holeCount, seed, opts);
    let heroLo = 0;
    let heroHi = 0;
    for (let k = 0; k < hero.length; k++) {
      const c = hero[k];
      if (c < 32) heroLo |= 1 << c;
      else heroHi |= 1 << (c - 32);
    }
    const a = Math.floor(clamp01(band.lo) * pool.size);
    const b = Math.min(pool.size, Math.max(a + 1, Math.round(clamp01(band.hi) * pool.size)));
    const bandLen = b - a;
    const minSeg = opts.minSegment ?? 25;
    const pref = alivePrefixOf(pool, heroLo, heroHi);
    const survival: (number | null)[] = [];
    const counts: number[] = [];
    for (const s of segments) {
      const x = Math.floor(clamp01(s.lo) * bandLen);
      const y = Math.min(bandLen, Math.max(x, Math.round(clamp01(s.hi) * bandLen)));
      const n = y - x;
      const alive = pref[a + y] - pref[a + x];
      counts.push(n);
      survival.push(n >= minSeg ? alive / n : null);
    }
    return {
      survival,
      counts,
      source: `reference pool ${pool.size} (board ${board.length}, ${PLAYBOOK_BLOCKERS_VERSION})`,
    };
  } catch (e) {
    return empty(`blocker error (${(e as Error).message}): unchanged`);
  }
}

/**
 * Blocker-conditioned fold share of an opponent whose range is `band` of the reference order and who
 * folds a measured share `pFold` (the weakest part of his band) facing the hero's wager.
 */
export function blockerAdjustedFold(
  hero: readonly number[],
  board: readonly number[],
  holeCount: number,
  band: Segment,
  pFold: number,
  seed: string,
  opts: BlockerOpts = {}
): { p: number; source: string } {
  const f = clamp01(pFold);
  if (f <= 0 || f >= 1) return { p: f, source: 'fold share 0 or 1: unchanged' };
  const s = segmentSurvival(
    hero,
    board,
    holeCount,
    band,
    [
      { lo: 0, hi: 1 - f },
      { lo: 1 - f, hi: 1 },
    ],
    seed,
    opts
  );
  const [sC, sF] = s.survival;
  if (sC == null || sF == null || sC + sF <= 0)
    return { p: f, source: `${s.source}; segment too thin: unchanged` };
  const den = sF * f + sC * (1 - f);
  if (!(den > 0)) return { p: f, source: `${s.source}; every holding blocked: unchanged` };
  const p = (sF * f) / den;
  return {
    p,
    source: `blockers: fold ${r3(f)} -> ${r3(p)} (survival continue ${r3(sC)} n=${s.counts[0]}, fold ${r3(sF)} n=${s.counts[1]}; ${s.source})`,
  };
}

/**
 * Blocker-conditioned bluff share of a bettor whose value segment and bluff segment (shares of his
 * band) were set without knowledge of the hero's cards; alpha = bluff share before conditioning.
 */
export function blockerAdjustedBluffShare(
  hero: readonly number[],
  board: readonly number[],
  holeCount: number,
  band: Segment,
  value: Segment,
  bluff: Segment,
  alpha: number,
  seed: string,
  opts: BlockerOpts = {}
): { alpha: number; source: string } {
  const a = clamp01(alpha);
  if (a <= 0 || a >= 1) return { alpha: a, source: 'bluff share 0 or 1: unchanged' };
  const s = segmentSurvival(hero, board, holeCount, band, [value, bluff], seed, opts);
  const [sV, sB] = s.survival;
  if (sV == null || sB == null)
    return { alpha: a, source: `${s.source}; segment too thin: unchanged` };
  const den = sB * a + sV * (1 - a);
  if (!(den > 0)) return { alpha: a, source: `${s.source}; every holding blocked: unchanged` };
  const out = (sB * a) / den;
  return {
    alpha: out,
    source: `blockers: bluff share ${r3(a)} -> ${r3(out)} (survival value ${r3(sV)} n=${s.counts[0]}, bluff ${r3(sB)} n=${s.counts[1]}; ${s.source})`,
  };
}

/** Test hook: drop cached reference pools. */
export function clearPlaybookBlockerCache(): void {
  POOL_CACHE.clear();
}
