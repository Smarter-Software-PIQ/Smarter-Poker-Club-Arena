/**
 * omahaMathCore RANGE TRACKING and BOARD-RANGE INTERACTION (lane RANGEADV, lead session_01TLQer8,
 * Nov 19 2026; owner 8:22 PM Chicago: "when you have the range advantage, like low connected flops
 * that don't include the AAxx range, Horses never take advantage of that").
 *
 * SCOPE: PLO4 and PLO5 cash only (owner 8:27 PM: DON'T TOUCH PLO6). Every entry point returns null
 * for any other hole-card count, so the core keeps its current PLO6 path byte for byte.
 *
 * What the core lacked: postflop, every opponent's range was rebuilt from the CURRENT street's action
 * only, over a uniform pool of holdings. A 4-bettor (AA-heavy) and a limper got the same flop range, so
 * the core could never see that a low connected flop smashes the caller's range and misses the
 * 4-bettor's, nor that two pair / sets / combo draws crush an overpair-heavy range.
 *
 * This module carries each player's range through the whole hand as a weight per concrete holding:
 *   1. pool: `size` holdings drawn uniformly from the cards unseen by the hero (hero cards and board
 *      removed = card removal: holding an ace cuts the AA combos automatically).
 *   2. preflop prior: each holding's preflop strength is its mean percentile against the pool over
 *      shared random boards (pure combinatorics, no table). His public preflop line gives a band
 *      [lo, hi) of the strength order (lane PREFLOP-EV `bandOf`: measured public frequencies per node;
 *      a 4-bet/5-bet band is the top few percent = AA-heavy). Weight = P(holding's true percentile in
 *      the band) under the holding's own measured sampling error (normal approximation), so the band
 *      edge is as soft as the estimate is noisy, never a hand-picked width.
 *   3. Bayes per street: for every public postflop action he took (check / bet / call / raise, with
 *      its size), the likelihood of each holding taking it, computed on THAT street's board from his
 *      CURRENT range (weighted strength CDF), the measured frequency of the node (bet rate when checked
 *      to, fold / raise rate facing a wager, from the core's public tables / OPPMODEL, passed in) and
 *      the size (a wager of share s of the pot is value from the top and bluffs from the bottom at the
 *      break-even share s / (1 + 2s), the same composition rule the core already uses).
 *   4. The hero's own PERCEIVED range is tracked the same way from his public line.
 *
 * boardRangeProfile: on any board, each range's equity against the other (sampled holdings, runouts
 * to the river), its nut share (weight in the top decile of all unseen holdings on this board) and its
 * strength distribution: range advantage and nut advantage, computed, never a board category rule.
 *
 * Pure and deterministic for a given seed; never throws (a failure returns null and the core keeps
 * its own ranges, receipt says so). Public information only: own cards, board, public actions, sizes
 * and measured public frequencies.
 */
import {
  omahaBest,
  categoryOf,
  buildPoolFastData,
  createBoardTable,
  loadBoardTable,
  scorePoolHoldingWithBoard,
  sortIndicesDescStable,
  type PoolFastData,
} from './OmahaMathCoreEval.js';
import {
  seededRng,
  setPoolFastData,
  type Pool,
  type RangePart,
  type RangeSpec,
  type Rng,
} from './OmahaMathCoreEquity.js';
import { noteFire } from '../BrainTelemetry.js';

export const RANGE_TRACK_VERSION = 'rangeadv-track-v1';

export type PostStreet = 'flop' | 'turn' | 'river';
/** One public postflop action, in order. */
export interface PublicStreetAction {
  street: PostStreet;
  seat: number;
  action: 'check' | 'bet' | 'call' | 'raise' | 'fold';
  /** wager share of the pot: bet = added / pot before; raise = (added - to call) / (pot + to call); else 0 */
  frac: number;
  /** a wager was already in front of him when he acted */
  facing: boolean;
  /** all-in wager */
  allIn?: boolean;
  /** live players when he acted */
  players: number;
}

/** Measured public frequency of a node for a player (population / person shrunk), with its source. */
export interface NodeFreq {
  /** checked to: share of the time he wagers; facing a wager: share he raises */
  wager: number;
  /** facing a wager: share he folds (0 when checked to) */
  fold: number;
  source: string;
  /**
   * measured non-value share of such a wager (lead decision: each cell's shownNonValue); absent: the
   * break-even bluff share s / (1 + 2s)
   */
  nonValue?: number;
  /**
   * checked to: measured trap rate (lane CORE-POOLED-8, criteria 1a322479): the share of STRONG holdings
   * that check, from public showdowns, shrunk n/(n+k). A check keeps this share of the value region instead
   * of removing it. Absent: the old update, bit for bit.
   */
  trap?: number;
  /**
   * a flop RAISE after only checks, facing the hero's own wager (lane CORE-POOLED-9, criteria 7c45130b):
   * the measured check-raise cell (raw counts); likelihood() shrinks it n/(n+30) to the generic raise
   * share and non-value share. Absent: the generic cell, bit for bit.
   */
  checkRaise?: CheckRaiseCell;
}
/** Raw measured check-raise counts (public actions for the raise share, public showdowns for non-value). */
export interface CheckRaiseCell {
  /** decisions facing a flop wager after only checks, and the share that raised */
  nFace: number;
  raise: number;
  /** shown check-raises of every size / of this size bucket, and their non-value shares */
  nShownAll: number;
  nvAll: number;
  nShownBand: number;
  nvBand: number;
}
/** The measured check-raise cell for a flop raise of this size; undefined = none (generic cell). */
export type CheckRaiseFn = (
  street: PostStreet,
  players: number,
  frac: number,
  allIn: boolean
) => CheckRaiseCell | undefined;
/** Shrinkage, one mechanism (lane CORE-POOLED-9): n/(n+k) of the raw value, the rest the level above; n = 0 = the level above exactly. */
export function shrinkToward(n: number, raw: number, above: number, k = 30): number {
  if (!(n > 0) || !Number.isFinite(raw)) return above;
  return (n * raw + k * above) / (n + k);
}
/** Measured trap rate of a checked-to node (street, first to act on the street, live players); undefined = none. */
export type TrapRateFn = (
  street: PostStreet,
  first: boolean,
  players: number
) => number | undefined;
export type NodeFreqFn = (
  seat: number,
  street: PostStreet,
  facing: boolean,
  frac: number,
  allIn: boolean,
  players: number
) => NodeFreq | null;

export interface PreflopBand {
  lo: number;
  hi: number;
  source: string;
}

export interface TrackedRange {
  seat: number;
  /** weight per pool holding (sums to 1) */
  w: Float64Array;
  /** effective number of holdings (1 / sum w^2): how narrow the range is */
  effN: number;
  steps: string[];
}

export interface TrackedHand {
  version: string;
  pool: Pool;
  /** preflop percentile (0 = strongest) and its standard error per holding */
  pfPct: Float64Array;
  pfSe: Float64Array;
  ranges: Map<number, TrackedRange>;
  ms: number;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

function unseen(known: readonly number[]): number[] {
  const used = new Uint8Array(52);
  for (const c of known) used[c] = 1;
  const out: number[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) out.push(c);
  return out;
}

/**
 * Mean percentile (0 = weakest .. 1 = strongest) and its standard error for every holding of a pool on
 * a board, over `runs` shared random completions (exact on the river). Holdings clashing with a
 * completion are skipped for that run.
 */
export function strengthOn(
  cards: Int8Array,
  size: number,
  hc: number,
  board: readonly number[],
  deck: readonly number[],
  runs: number,
  rng: Rng,
  fastIn?: PoolFastData
): { mean: Float64Array; se: Float64Array; cat: Int8Array } {
  const fast = fastIn ?? buildPoolFastData(cards, size, hc);
  const maskLo = fast.maskLo;
  const maskHi = fast.maskHi;
  const sum = new Float64Array(size);
  const sq = new Float64Array(size);
  const cnt = new Float64Array(size);
  const cat = new Int8Array(size).fill(-1);
  const full = new Int8Array(5);
  const tbl = createBoardTable();
  const bLen = board.length;
  if (bLen >= 3) {
    loadBoardTable(tbl, board, bLen);
    for (let i = 0; i < size; i++) {
      cat[i] = categoryOf(scorePoolHoldingWithBoard(fast, cards, i, tbl));
    }
  }
  const missing = 5 - bLen;
  const nRuns = missing === 0 ? 1 : runs;
  const deckLen = deck.length;
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
        const i = v - Math.floor(v * invStride) * stride;
        sum[i] += pct;
        sq[i] += pct * pct;
        cnt[i] += 1;
      }
      p = q + 1;
    }
  }
  const mean = new Float64Array(size);
  const se = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    if (cnt[i] <= 0) {
      mean[i] = 0.5;
      se[i] = 0.29;
      continue;
    }
    mean[i] = sum[i] / cnt[i];
    const v = Math.max(0, sq[i] / cnt[i] - mean[i] * mean[i]);
    // the river is exact; elsewhere the sampling error of the mean (floor: one rank step of the pool)
    se[i] = nRuns === 1 ? 1 / size : Math.max(1 / size, Math.sqrt(v / cnt[i]));
  }
  return { mean, se, cat };
}

/**
 * Preflop strength of every pool holding = its equity against a random holding (mean percentile
 * against a reference set over shared random boards), in two stages: a screen of `runs` boards for
 * all holdings, then `refine` more boards only for holdings whose band membership is still uncertain
 * (P(in band) between 2% and 98% for any requested band), so the top of the order (where 3-bet / 4-bet
 * bands live) is resolved at a fraction of the cost. Returns the rank percentile (0 = strongest) and
 * its error IN RANK UNITS (half the pool share whose equity lies within one standard error).
 */
function preflopStrength(
  cards: Int8Array,
  size: number,
  hc: number,
  deck: readonly number[],
  runs: number,
  refine: number,
  bandOf: (seat: number) => PreflopBand | null,
  seats: readonly number[],
  rng: Rng,
  fast: PoolFastData
): { pct: Float64Array; se: Float64Array } {
  const refN = Math.min(size, 150);
  const maskLo = fast.maskLo;
  const maskHi = fast.maskHi;
  const sum = new Float64Array(size);
  const sq = new Float64Array(size);
  const cnt = new Float64Array(size);
  const full = new Int8Array(5);
  const deckLen = deck.length;
  const tbl = createBoardTable();
  const refScore = new Int32Array(refN);
  const refCache = new Int32Array(refN);
  const evalRuns = (who: readonly number[], nRuns: number) => {
    const whoLen = who.length;
    for (let r = 0; r < nRuns; r++) {
      let runLo = 0;
      let runHi = 0;
      for (let k = 0; k < 5; k++) {
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
      for (let i = 0; i < refN; i++) {
        if ((maskLo[i] & runLo) | (maskHi[i] & runHi)) {
          refCache[i] = -1;
          continue;
        }
        const s = scorePoolHoldingWithBoard(fast, cards, i, tbl);
        refCache[i] = s;
        refScore[m++] = s;
      }
      if (m < 10) continue;
      refScore.subarray(0, m).sort();
      for (let wIdx = 0; wIdx < whoLen; wIdx++) {
        const i = who[wIdx];
        let s: number;
        if (i < refN) {
          s = refCache[i];
          if (s < 0) continue;
        } else {
          if ((maskLo[i] & runLo) | (maskHi[i] & runHi)) continue;
          s = scorePoolHoldingWithBoard(fast, cards, i, tbl);
        }
        // share of the reference beaten (ties half)
        let lo = 0,
          hi = m;
        while (lo < hi) {
          const md = (lo + hi) >> 1;
          if (refScore[md] < s) lo = md + 1;
          else hi = md;
        }
        let eq = lo;
        while (eq < m && refScore[eq] === s) eq++;
        const p = (lo + (eq - lo) / 2) / m;
        sum[i] += p;
        sq[i] += p * p;
        cnt[i] += 1;
      }
    }
  };
  const all = Array.from({ length: size }, (_, i) => i);
  evalRuns(all, runs);
  const finish = () => {
    const mean = new Float64Array(size);
    const seE = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      mean[i] = cnt[i] > 0 ? sum[i] / cnt[i] : 0.5;
      const v = cnt[i] > 0 ? Math.max(0, sq[i] / cnt[i] - mean[i] * mean[i]) : 0.09;
      seE[i] = Math.sqrt(v / Math.max(1, cnt[i]));
    }
    const ord = sortIndicesDescStable(mean, size);
    const pct = new Float64Array(size);
    const sorted = new Float64Array(size);
    for (let k = 0; k < size; k++) {
      const i = ord[k];
      pct[i] = (k + 0.5) / size;
      sorted[k] = mean[i];
    }
    const se = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      const a = mean[i] + seE[i];
      const b = mean[i] - seE[i];
      // count of sorted (desc) values in [b, a]
      let lo = 0,
        hi = size;
      while (lo < hi) {
        const md = (lo + hi) >> 1;
        if (sorted[md] > a) lo = md + 1;
        else hi = md;
      }
      const start = lo;
      lo = start;
      hi = size;
      while (lo < hi) {
        const md = (lo + hi) >> 1;
        if (sorted[md] >= b) lo = md + 1;
        else hi = md;
      }
      se[i] = Math.max(1 / size, (lo - start) / size / 2);
    }
    return { pct, se };
  };
  let res = finish();
  if (refine > 0) {
    // refine only narrow bands (3-bet / 4-bet lines, width <= 0.25): a wide band's edge moves little weight
    const bands = seats
      .map((s) => bandOf(s))
      .filter(
        (b): b is PreflopBand =>
          !!b && b.hi > b.lo && b.hi - b.lo <= 0.25 && !(b.lo <= 0 && b.hi >= 1)
      );
    if (bands.length) {
      const unsure = all.filter((i) =>
        bands.some((b) => {
          const p = pIn(res.pct[i], res.se[i], b.lo, b.hi);
          return p > 0.02 && p < 0.98;
        })
      );
      if (unsure.length) {
        evalRuns(unsure, refine);
        res = finish();
      }
    }
  }
  return res;
}

/** Standard normal CDF (Abramowitz-Stegun 7.1.26 via erf). */
function phi(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(x * x) / 2);
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}
/** P(a holding with estimate q +- se lies in [lo, hi)). */
function pIn(q: number, se: number, lo: number, hi: number): number {
  const s = Math.max(1e-6, se);
  return Math.max(0, phi((hi - q) / s) - phi((lo - q) / s));
}

/** pIn with its own blur width at each edge (lane CORE-POOLED-10); equal widths = pIn exactly. */
export function pInEdges(q: number, lo: number, seLo: number, hi: number, seHi: number): number {
  return Math.max(0, phi((hi - q) / Math.max(1e-6, seHi)) - phi((lo - q) / Math.max(1e-6, seLo)));
}

/** The facing-a-wager edge widths (lane CORE-POOLED-10): exported for the law test. */
export function boundedEdges(
  se: number,
  vTop: number,
  bluffWidth: number
): { eV: number; eB: number } {
  return { eV: Math.min(se, vTop), eB: Math.min(se, bluffWidth) };
}

/**
 * Weighted "share stronger" of each holding inside a range on a board: F_i = weight of the range
 * strictly stronger than i plus half the weight of i (0 = his strongest, 1 = his weakest).
 */
function rangeCdfOrdered(w: Float64Array, strength: Float64Array, ord: Int32Array): Float64Array {
  const n = w.length;
  const F = new Float64Array(n);
  let acc = 0;
  let tot = 0;
  for (let i = 0; i < n; i++) tot += w[i];
  if (!(tot > 0)) return F.fill(0.5);
  let p = 0;
  while (p < n) {
    let q = p;
    let wsum = 0;
    const sp = strength[ord[p]];
    while (q < n && strength[ord[q]] === sp) wsum += w[ord[q++]];
    const v = (acc + wsum / 2) / tot;
    for (let t = p; t < q; t++) F[ord[t]] = v;
    acc += wsum;
    p = q;
  }
  return F;
}

/**
 * Likelihood of a CHECK when checked to, given the holding's chance of being in the value region (pv) and the
 * bluff region (pb), with the measured trap rate tau (lane CORE-POOLED-8): the value region keeps tau.
 * Law: with pb = 0 the result is never below tau; tau = 0 is the old 1 - pv - pb.
 */
export function checkKeep(pv: number, pb: number, tau: number): number {
  return Math.max(0, 1 - (1 - tau) * pv - pb);
}

/**
 * Likelihood of one public action for every holding, from his current range on that street's board.
 *   wager share s -> bluff share alpha = s / (1 + 2s) (break-even for the caller; public size);
 *   checked to, wager rate b: value = top (1 - alpha) b of his range, bluffs = bottom alpha b;
 *     check = the rest; facing a wager, fold f, raise r: raise = top (1 - alpha) r + bottom alpha r of
 *     what continues, call = the band between the raises and the folds.
 * Soft edges: each holding's position F carries the error of his strength estimate on this board
 * (seF = se / spread of the range), so a boundary is as sharp as the evidence.
 */
function likelihood(
  a: PublicStreetAction,
  F: Float64Array,
  seF: Float64Array,
  nf: NodeFreq
): Float64Array {
  const n = F.length;
  const L = new Float64Array(n);
  const s = Math.max(0.05, a.frac);
  // lead decision: a wager's non-value share is the cell's measured shownNonValue when the caller has it
  let alpha =
    nf.nonValue !== undefined && Number.isFinite(nf.nonValue)
      ? Math.min(0.95, Math.max(0, nf.nonValue))
      : s / (1 + 2 * s);
  if (!a.facing) {
    const b = Math.min(0.98, Math.max(0.02, nf.wager));
    const vTop = (1 - alpha) * b;
    const bluffLo = 1 - alpha * b;
    const wagered = a.action === 'bet' || a.action === 'raise';
    const tau =
      !wagered && nf.trap !== undefined && Number.isFinite(nf.trap)
        ? Math.min(1, Math.max(0, nf.trap))
        : undefined;
    for (let i = 0; i < n; i++) {
      if (tau === undefined) {
        const pw = pIn(F[i], seF[i], -1, vTop) + pIn(F[i], seF[i], bluffLo, 2);
        L[i] = wagered ? pw : 1 - pw;
      } else {
        // a check keeps the measured trap share tau of the value region (never strips it below tau)
        const pv = pIn(F[i], seF[i], -1, vTop);
        const pb = pIn(F[i], seF[i], bluffLo, 2);
        L[i] = checkKeep(pv, pb, tau);
      }
    }
    return L;
  }
  const f = Math.min(0.98, Math.max(0, nf.fold));
  let rRaw = nf.wager;
  const cr = a.action === 'raise' ? nf.checkRaise : undefined;
  if (cr) {
    // lane CORE-POOLED-9: a check-raise of the hero's own flop wager is priced with its measured cell, shrunk to the generic one
    rRaw = shrinkToward(cr.nFace, cr.raise, nf.wager);
    alpha = Math.min(
      0.95,
      Math.max(
        0,
        shrinkToward(cr.nShownBand, cr.nvBand, shrinkToward(cr.nShownAll, cr.nvAll, alpha))
      )
    );
  }
  const r = Math.min(0.98 - f, Math.max(0.01, rRaw));
  const cont = 1 - f;
  // raises: value from the top of his range, bluff-raises from the bottom of what does not fold?
  // A bluff-raise comes from holdings that would otherwise fold: bottom alpha*r of the whole range.
  const vTop = (1 - alpha) * r;
  const bluffLo = 1 - alpha * r;
  // lane CORE-POOLED-10 (criteria d851afb1): an edge is never blurred wider than the measured region it bounds
  // (value region vTop, bluff region alpha*r); a holding's strength error used to let a large weak share of his
  // range into a ~1%-wide bluff-raise region, so the Horse priced calls against raises far weaker than shown ones
  const wB = alpha * r;
  for (let i = 0; i < n; i++) {
    const { eV, eB } = boundedEdges(seF[i], vTop, wB);
    const praise = pIn(F[i], eV, -1, vTop) + pIn(F[i], eB, bluffLo, 2);
    const pfold = pInEdges(F[i], cont, seF[i], bluffLo, eB);
    const pcall = Math.max(0, 1 - praise - pfold);
    L[i] =
      a.action === 'raise'
        ? praise
        : a.action === 'call'
          ? pcall
          : a.action === 'fold'
            ? pfold
            : pcall;
  }
  return L;
}

function normalise(w: Float64Array): number {
  let t = 0;
  for (let i = 0; i < w.length; i++) t += w[i];
  if (!(t > 0)) return 0;
  let q = 0;
  for (let i = 0; i < w.length; i++) {
    w[i] /= t;
    q += w[i] * w[i];
  }
  return q > 0 ? 1 / q : 0;
}

export interface TrackInput {
  variant: 'plo4' | 'plo5' | string;
  hole: readonly number[];
  board: readonly number[];
  /** seats to track (live opponents, and the hero's seat for his perceived range) */
  seats: readonly number[];
  heroSeat: number;
  preflopBand: (seat: number) => PreflopBand | null;
  history: readonly PublicStreetAction[];
  freq: NodeFreqFn;
  /** measured trap rates (lane CORE-POOLED-8); absent: checks update as before */
  trap?: TrapRateFn;
  /** measured check-raise cell (lane CORE-POOLED-9); absent: the generic facing cell */
  checkRaise?: CheckRaiseFn;
  seed: string;
  /** pool size (default 900 PLO4 / 700 PLO5) and runs (default preflop 24 + 160 refine, flop/turn 8) */
  size?: number;
  pfRuns?: number;
  pfRefineRuns?: number;
  postRuns?: number;
  now?: () => number;
  /**
   * optional cache (lane COREWIRE, latency only): the pool, preflop strengths and per-street strengths
   * depend on the cards, board, seats and bands only, so a hand-street computes them once
   */
  cache?: Map<string, unknown>;
}

interface TrackCacheEntry {
  cards: Int8Array;
  fast: PoolFastData;
  pf: { pct: Float64Array; se: Float64Array };
  byStreet: Map<PostStreet, { mean: Float64Array; se: Float64Array; cat: Int8Array }>;
}

/** Track every requested seat's range through the hand. Null outside PLO4/PLO5 or on any failure. */
export function trackRanges(inp: TrackInput): TrackedHand | null {
  try {
    const hc = inp.hole.length;
    if (!((inp.variant === 'plo4' && hc === 4) || (inp.variant === 'plo5' && hc === 5)))
      return null;
    const now = inp.now ?? (() => Date.now());
    const t0 = now();
    const rng = seededRng(`${inp.seed}|rangeadv`);
    const size = inp.size ?? (hc === 4 ? 900 : 700);
    const deckPool = unseen([...inp.hole, ...inp.board]);
    const bandKey = inp.seats
      .map((st) => {
        const b = inp.preflopBand(st);
        return b ? `${st}:${r3(b.lo)}-${r3(b.hi)}` : `${st}:-`;
      })
      .join(',');
    const cacheKey = `${inp.variant}|${inp.seed}|${inp.hole.join('.')}|${inp.board.join('.')}|${size}|${inp.pfRuns ?? 24}|${inp.pfRefineRuns ?? 160}|${inp.postRuns ?? 8}|${bandKey}`;
    const hit = inp.cache?.get(cacheKey) as TrackCacheEntry | undefined;
    let cards: Int8Array;
    let fast: PoolFastData;
    let pf: { pct: Float64Array; se: Float64Array };
    let byStreet: Map<PostStreet, { mean: Float64Array; se: Float64Array; cat: Int8Array }>;
    if (hit) {
      ({ cards, fast, pf, byStreet } = hit);
    } else {
      cards = new Int8Array(size * hc);
      const tmp = deckPool.slice();
      for (let i = 0; i < size; i++)
        for (let k = 0; k < hc; k++) {
          const j = k + Math.floor(rng() * (tmp.length - k));
          const t = tmp[k];
          tmp[k] = tmp[j];
          tmp[j] = t;
          cards[i * hc + k] = tmp[k];
        }
      fast = buildPoolFastData(cards, size, hc);
      // preflop strength: random full boards from every card but the hero's (the board was unknown preflop)
      const deckPf = unseen(inp.hole);
      pf = preflopStrength(
        cards,
        size,
        hc,
        deckPf,
        inp.pfRuns ?? 24,
        inp.pfRefineRuns ?? 160,
        inp.preflopBand,
        inp.seats,
        rng,
        fast
      );
      byStreet = new Map();
      if (inp.cache) {
        if (inp.cache.size >= 64) inp.cache.delete(inp.cache.keys().next().value as string);
        inp.cache.set(cacheKey, { cards, fast, pf, byStreet } satisfies TrackCacheEntry);
      }
    }
    const pfPct = pf.pct;
    // per street strength on the board as it was on that street (own stream per street, so a cached
    // and an uncached call give the same result)
    const boardAt = (st: PostStreet) =>
      inp.board.slice(0, st === 'flop' ? 3 : st === 'turn' ? 4 : 5);
    const streetStrength = (st: PostStreet) => {
      let s = byStreet.get(st);
      if (!s) {
        s = strengthOn(
          cards,
          size,
          hc,
          boardAt(st),
          deckPool,
          inp.postRuns ?? 8,
          seededRng(`${inp.seed}|rangeadv|${st}`),
          fast
        );
        byStreet.set(st, s);
      }
      return s;
    };
    const ordByStreet = new Map<PostStreet, Int32Array>();
    const ranges = new Map<number, TrackedRange>();
    for (const seat of inp.seats) {
      const w = new Float64Array(size);
      const steps: string[] = [];
      const band = inp.preflopBand(seat);
      if (band && band.hi > band.lo && !(band.lo <= 0 && band.hi >= 1)) {
        for (let i = 0; i < size; i++) w[i] = pIn(pfPct[i], pf.se[i], band.lo, band.hi);
        steps.push(`preflop band ${r3(band.lo)}-${r3(band.hi)} [${band.source}]`);
      } else {
        w.fill(1);
        steps.push(band ? `preflop full range [${band.source}]` : 'preflop: no band, full range');
      }
      let eff = normalise(w);
      if (!(eff > 0)) {
        w.fill(1 / size);
        eff = size;
        steps.push('preflop band empty in pool: full range');
      }
      for (let hi = 0; hi < inp.history.length; hi++) {
        const a = inp.history[hi];
        if (a.seat !== seat || a.street === undefined) continue;
        const bl = boardAt(a.street);
        if (bl.length < 3 || bl.length > inp.board.length) continue;
        const nf0 = inp.freq(seat, a.street, a.facing, a.frac, !!a.allIn, a.players);
        let nf = nf0;
        if (nf0 && !a.facing && a.action === 'check' && inp.trap) {
          let first = true;
          for (let j = 0; j < hi; j++) if (inp.history[j].street === a.street) first = false;
          const tau = inp.trap(a.street, first, a.players);
          if (tau !== undefined)
            nf = { ...nf0, trap: tau, source: `${nf0.source}; trap ${r3(tau)}` };
        }
        if (nf && a.facing && a.action === 'raise' && a.street === 'flop' && inp.checkRaise) {
          // the spot: his only earlier flop actions are checks and the last flop wager is the hero's own
          let checked = false;
          let onlyChecks = true;
          let lastWager = -1;
          for (let j = 0; j < hi; j++) {
            const b = inp.history[j];
            if (b.street !== 'flop') continue;
            if (b.seat === seat) {
              if (b.action === 'check') checked = true;
              else onlyChecks = false;
            }
            if (b.action === 'bet' || b.action === 'raise') lastWager = b.seat;
          }
          if (checked && onlyChecks && lastWager === inp.heroSeat) {
            const cr = inp.checkRaise(a.street, a.players, a.frac, !!a.allIn);
            if (cr) nf = { ...nf, checkRaise: cr, source: `${nf.source}; check-raise cell` };
          }
        }
        if (!nf) {
          steps.push(`${a.street} ${a.action}: no measured node, no update`);
          continue;
        }
        const S = streetStrength(a.street);
        let ordDesc = ordByStreet.get(a.street);
        if (!ordDesc) {
          ordDesc = sortIndicesDescStable(S.mean, size);
          ordByStreet.set(a.street, ordDesc);
        }
        const F = rangeCdfOrdered(w, S.mean, ordDesc);
        // strength error expressed in range-share units: local density of the range around each holding
        // (one standard error of strength either side of i covers this much of his range: half of it = seF)
        const seF = new Float64Array(size);
        const sMean = S.mean;
        const sSe = S.se;
        // Skip exact zero weights (adding 0 never changes an IEEE-754 sum), preserving ascending j order
        const nzMean = new Float64Array(size);
        const nzW = new Float64Array(size);
        let nz = 0;
        for (let j = 0; j < size; j++) {
          const wj = w[j];
          if (wj !== 0) {
            nzMean[nz] = sMean[j];
            nzW[nz] = wj;
            nz++;
          }
        }
        for (let i = 0; i < size; i++) {
          let m = 0;
          const si = sMean[i];
          const e = sSe[i];
          for (let k = 0; k < nz; k++) {
            const d = nzMean[k] - si;
            if (d <= e && d >= -e) m += nzW[k];
          }
          seF[i] = Math.min(0.5, Math.max(1 / size, m / 2));
        }
        const L = likelihood(a, F, seF, nf);
        const prev = Float64Array.from(w);
        for (let i = 0; i < size; i++) w[i] *= L[i];
        const e2 = normalise(w);
        if (!(e2 > 0)) {
          w.set(prev);
          steps.push(
            `${a.street} ${a.action} ${r3(a.frac)}: likelihood empty, kept prior [${nf.source}]`
          );
          continue;
        }
        eff = e2;
        steps.push(
          `${a.street} ${a.action} ${r3(a.frac)} -> effN ${Math.round(eff)} [${nf.source}]`
        );
      }
      ranges.set(seat, { seat, w, effN: eff, steps });
    }
    // current-board pool for the core (strength / category / order on the board as it is now)
    const curStreet: PostStreet | null =
      inp.board.length >= 3
        ? inp.board.length === 3
          ? 'flop'
          : inp.board.length === 4
            ? 'turn'
            : 'river'
        : null;
    const cur = curStreet
      ? streetStrength(curStreet)
      : {
          mean: Float64Array.from(pfPct, (q) => 1 - q),
          se: pf.se,
          cat: new Int8Array(size).fill(-1),
        };
    const order =
      (curStreet ? ordByStreet.get(curStreet) : undefined) ?? sortIndicesDescStable(cur.mean, size);
    const pool: Pool = {
      holeCount: hc,
      cards,
      size,
      strength: Float64Array.from(cur.mean),
      category: Int8Array.from(cur.cat),
      order: Int32Array.from(order),
    };
    setPoolFastData(pool, fast);
    return { version: RANGE_TRACK_VERSION, pool, pfPct, pfSe: pf.se, ranges, ms: now() - t0 };
  } catch {
    // lane CORE-FIX-1 (AUDIT-A item 14): the untracked fallback prices this decision; counted on the live ledger
    noteFire('omaha_math_core_fallback_tracker_failure');
    return null;
  }
}

const SINGLE_IDX_CACHE: Int32Array[] = Array.from({ length: 2048 }, (_, i) => Int32Array.of(i));

/** A tracked range as the core's RangeSpec (holdings with negligible weight dropped, weights kept). */
export function toRangeSpec(t: TrackedRange, label: string, minShare = 1e-4): RangeSpec {
  const parts: RangePart[] = [];
  const w = t.w;
  const n = w.length;
  let max = 0;
  for (let i = 0; i < n; i++) if (w[i] > max) max = w[i];
  const cut = max * minShare;
  for (let i = 0; i < n; i++)
    if (w[i] > cut)
      parts.push({
        idx: i < SINGLE_IDX_CACHE.length ? SINGLE_IDX_CACHE[i] : Int32Array.of(i),
        weight: w[i],
      });
  return {
    parts,
    label: `${label} Tracked EffN ${Math.round(t.effN)} [${t.steps.join(' > ')}] (${RANGE_TRACK_VERSION})`,
  };
}

export interface BoardRangeProfile {
  /** equity of range A against range B on this board, to the river */
  eqA: number;
  se: number;
  /** weight of each range in the top decile of all unseen holdings on this board */
  nutA: number;
  nutB: number;
  /** weight of each range with a made two pair or better (category >= 2) */
  strongA: number;
  strongB: number;
  /** mean strength percentile of each range on this board (vs all unseen holdings) */
  meanA: number;
  meanB: number;
  rangeAdvantage: number;
  nutAdvantage: number;
  samples: number;
  source: string;
}

/**
 * Range advantage and nut advantage of A over B on the current board of a tracked hand.
 * Equity: holding pairs drawn by weight (card clashes rejected), board completed to the river.
 */
export function boardRangeProfile(
  hand: TrackedHand,
  board: readonly number[],
  a: TrackedRange,
  b: TrackedRange,
  seed: string,
  samples = 1200
): BoardRangeProfile | null {
  try {
    const { pool } = hand;
    const hc = pool.holeCount;
    const rng = seededRng(`${seed}|profile`);
    const cdf = (w: Float64Array) => {
      const c = new Float64Array(w.length);
      let s = 0;
      for (let i = 0; i < w.length; i++) c[i] = s += w[i];
      return c;
    };
    const pick = (c: Float64Array) => {
      const u = rng() * c[c.length - 1];
      let lo = 0,
        hi = c.length - 1;
      while (lo < hi) {
        const m = (lo + hi) >> 1;
        if (c[m] < u) lo = m + 1;
        else hi = m;
      }
      return lo;
    };
    const ca = cdf(a.w);
    const cb = cdf(b.w);
    const deck = unseen(board);
    const used = new Uint8Array(52);
    const full = new Int8Array(5);
    const ha = new Int8Array(hc);
    const hb = new Int8Array(hc);
    let sum = 0,
      sq = 0,
      n = 0;
    for (let t = 0; t < samples * 3 && n < samples; t++) {
      const i = pick(ca);
      const j = pick(cb);
      used.fill(0);
      let clash = false;
      for (let k = 0; k < hc; k++) {
        ha[k] = pool.cards[i * hc + k];
        used[ha[k]] = 1;
      }
      for (let k = 0; k < hc; k++) {
        hb[k] = pool.cards[j * hc + k];
        if (used[hb[k]]) clash = true;
        used[hb[k]] = 1;
      }
      if (clash) continue;
      for (let k = 0; k < board.length; k++) full[k] = board[k];
      for (let k = board.length; k < 5; k++) {
        let c: number;
        do c = deck[Math.floor(rng() * deck.length)];
        while (used[c]);
        used[c] = 1;
        full[k] = c;
      }
      const sa = omahaBest(ha, hc, full, 5);
      const sb = omahaBest(hb, hc, full, 5);
      const x = sa > sb ? 1 : sa === sb ? 0.5 : 0;
      sum += x;
      sq += x * x;
      n++;
    }
    if (n < 50) return null;
    const eqA = sum / n;
    const se = Math.sqrt(Math.max(0, sq / n - eqA * eqA) / n);
    let nutA = 0,
      nutB = 0,
      stA = 0,
      stB = 0,
      mA = 0,
      mB = 0;
    for (let i = 0; i < pool.size; i++) {
      const s = pool.strength[i];
      const top = s >= 0.9 ? 1 : 0;
      const strong = pool.category[i] >= 2 ? 1 : 0;
      nutA += a.w[i] * top;
      nutB += b.w[i] * top;
      stA += a.w[i] * strong;
      stB += b.w[i] * strong;
      mA += a.w[i] * s;
      mB += b.w[i] * s;
    }
    return {
      eqA: r3(eqA),
      se: r3(se),
      nutA: r3(nutA),
      nutB: r3(nutB),
      strongA: r3(stA),
      strongB: r3(stB),
      meanA: r3(mA),
      meanB: r3(mB),
      rangeAdvantage: r3(eqA - 0.5),
      nutAdvantage: r3(nutA - nutB),
      samples: n,
      source: `range A effN ${Math.round(a.effN)} vs B effN ${Math.round(b.effN)}, ${n} samples (${RANGE_TRACK_VERSION})`,
    };
  } catch {
    return null;
  }
}

/**
 * PLAY-BACK preflop (3a), EXPERIMENTAL (not validated for live use; the continue share is applied to his
 * whole range, not to the stronger part that continues, so it overstates stack-off value against a
 * range that folds its weak part; MC noise at 24 flops is several bb: use >= 60 flops):
 * EV of calling a raise against a tracked range with implied odds COMPUTED.
 * After the call the pot is `potAfter`, `behind` = effective stack behind. Over `flops` sampled flops:
 * the hero's flop equity e against the villain's range (to the river), and the two flop lines priced:
 *   give up            = 0 (the call is sunk)
 *   get the money in   = c (e (potAfter + 2 behind) - behind) + (1 - c) potAfter
 * where c = the villain's measured continue share against a pot-committing wager (passed in, public
 * measurement; OPPMODEL / the core's response table). EV(call) = mean over flops of the better line
 * - toCall. The free-card and smaller-bet lines are not credited, so this is a lower bound of the
 * playable value, and a dominated hand (low e on most flops) scores low exactly as the cards say.
 */
export function playbackCallEv(
  hand: TrackedHand,
  hole: readonly number[],
  villain: TrackedRange,
  potAfter: number,
  toCall: number,
  behind: number,
  continueShare: number,
  seed: string,
  flops = 24,
  perFlop = 150
): { ev: number; meanEq: number; stackOffShare: number; source: string } | null {
  try {
    const hc = hand.pool.holeCount;
    if (hole.length !== hc || !(hc === 4 || hc === 5)) return null;
    const rng = seededRng(`${seed}|playback`);
    const deck = unseen(hole);
    const c = Math.min(1, Math.max(0, continueShare));
    const cum = new Float64Array(villain.w.length);
    let s = 0;
    for (let i = 0; i < cum.length; i++) cum[i] = s += villain.w[i];
    const heroA = Int8Array.from(hole);
    const vh = new Int8Array(hc);
    const full = new Int8Array(5);
    const used = new Uint8Array(52);
    let evSum = 0,
      eqSum = 0,
      stack = 0,
      done = 0;
    for (let f = 0; f < flops; f++) {
      // a flop from the cards unseen by the hero
      const fl: number[] = [];
      while (fl.length < 3) {
        const x = deck[Math.floor(rng() * deck.length)];
        if (!fl.includes(x)) fl.push(x);
      }
      let w = 0,
        m = 0;
      for (let t = 0; t < perFlop * 3 && m < perFlop; t++) {
        const u = rng() * cum[cum.length - 1];
        let lo = 0,
          hi = cum.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] < u) lo = mid + 1;
          else hi = mid;
        }
        used.fill(0);
        for (const x of hole) used[x] = 1;
        for (const x of fl) used[x] = 1;
        let clash = false;
        for (let k = 0; k < hc; k++) {
          vh[k] = hand.pool.cards[lo * hc + k];
          if (used[vh[k]]) clash = true;
          used[vh[k]] = 1;
        }
        if (clash) continue;
        full[0] = fl[0];
        full[1] = fl[1];
        full[2] = fl[2];
        for (let k = 3; k < 5; k++) {
          let x: number;
          do x = deck[Math.floor(rng() * deck.length)];
          while (used[x]);
          used[x] = 1;
          full[k] = x;
        }
        const a = omahaBest(heroA, hc, full, 5);
        const b = omahaBest(vh, hc, full, 5);
        w += a > b ? 1 : a === b ? 0.5 : 0;
        m++;
      }
      if (m < 20) continue;
      const e = w / m;
      const commit = c * (e * (potAfter + 2 * behind) - behind) + (1 - c) * potAfter;
      const best = Math.max(0, commit);
      if (commit > 0) stack++;
      evSum += best;
      eqSum += e;
      done++;
    }
    if (done < Math.max(4, flops / 3)) return null;
    return {
      ev: evSum / done - toCall,
      meanEq: r3(eqSum / done),
      stackOffShare: r3(stack / done),
      source: `playback over ${done} flops x ${perFlop}: continue share ${r3(c)}, pot ${potAfter}, behind ${behind} (${RANGE_TRACK_VERSION})`,
    };
  } catch {
    return null;
  }
}
