/**
 * omahaMathCore (lane MATHCORE 2026-11-19): exact Omaha high hand evaluation
 * on integer cards (card = rank * 4 + suit, rank 0 = deuce .. 12 = ace).
 * Exactly two hole cards and three board cards (every 2+3 combination); the
 * score is one integer, larger is better (category * 16^5 + kickers).
 * Pure, allocation-free in the hot loop.
 */
import type { Card } from '../../types.js';

const RANK_INDEX: Record<string, number> = {
  '2': 0,
  '3': 1,
  '4': 2,
  '5': 3,
  '6': 4,
  '7': 5,
  '8': 6,
  '9': 7,
  T: 8,
  '10': 8,
  J: 9,
  Q: 10,
  K: 11,
  A: 12,
};
const SUIT_INDEX: Record<string, number> = {
  clubs: 0,
  c: 0,
  diamonds: 1,
  d: 1,
  hearts: 2,
  h: 2,
  spades: 3,
  s: 3,
};

export function cardToInt(card: Card | { rank: string; suit: string }): number {
  const r = RANK_INDEX[String(card.rank)];
  const s = SUIT_INDEX[String(card.suit).toLowerCase()];
  if (r === undefined || s === undefined) throw new Error('omahaMathCore: bad card');
  return r * 4 + s;
}

/** "Jh8s2s" -> ints (dataset / replay notation). */
export function parseCardString(text: string): number[] {
  const out: number[] = [];
  const t = text.replace(/[\s,]/g, '');
  for (let i = 0; i + 1 < t.length; i += 2) {
    const r = RANK_INDEX[t[i].toUpperCase()];
    const s = SUIT_INDEX[t[i + 1].toLowerCase()];
    if (r === undefined || s === undefined) throw new Error('omahaMathCore: bad card text');
    out.push(r * 4 + s);
  }
  return out;
}

export const CAT_HIGH = 0;
export const CAT_PAIR = 1;
export const CAT_TWO_PAIR = 2;
export const CAT_TRIPS = 3;
export const CAT_STRAIGHT = 4;
export const CAT_FLUSH = 5;
export const CAT_FULL_HOUSE = 6;
export const CAT_QUADS = 7;
export const CAT_STRAIGHT_FLUSH = 8;
const CAT_SHIFT = 1048576; // 16^5

/** Highest rank of a straight in a 13-bit rank mask, -1 if none (wheel = 3). */
function straightHigh(mask: number): number {
  for (let hi = 12; hi >= 4; hi--) {
    const m = 0x1f << (hi - 4);
    if ((mask & m) === m) return hi;
  }
  if ((mask & 0x100f) === 0x100f) return 3; // A2345
  return -1;
}

const counts = new Int8Array(13);

/**
 * Table-driven eval5 (lane CORE-POOLED-2 latency step 2, Nov 21): five distinct ranks are scored from FLUSH5
 * (8,192-entry table built once from eval5Reference by rank mask) and all non-flush hands from NO_FLUSH5.
 * Same score as eval5Reference for every one of the 2,598,960 five-card hands (OmahaMathCoreEvalTable.law.test.ts).
 */
const POP5 = new Uint8Array(8192);
const FLUSH5 = new Int32Array(8192);
for (let m = 0; m < 8192; m++) {
  let p = 0;
  for (let x = m; x; x &= x - 1) p++;
  POP5[m] = p;
}
{
  const ranks: number[] = [];
  for (let m = 0; m < 8192; m++) {
    if (POP5[m] !== 5) continue;
    ranks.length = 0;
    for (let r = 0; r < 13; r++) if (m & (1 << r)) ranks.push(r);
    FLUSH5[m] = eval5Reference(
      ranks[0] * 4,
      ranks[1] * 4,
      ranks[2] * 4,
      ranks[3] * 4,
      ranks[4] * 4
    );
  }
}

/**
 * 2+3 tables, lane CORE-POOLED-3 latency (Nov 21; VERIFIER V60). A five-card hand that is not a flush scores by
 * its rank multiset alone. RANK_KEY gives every multiset of five ranks (at most four of one rank) its own sum
 * (6,175 distinct sums, greatest 360,918), so the no-flush score of two hole cards and three board cards is one
 * table read at (pair sum + triple sum). NO_FLUSH5 is filled at load from the original scorer (eval5Reference).
 * Law: OmahaMathCoreEvalTwoPlusThree.law.test.ts.
 */
const RANK_KEY = [0, 1, 5, 22, 94, 312, 992, 2422, 5624, 12522, 19998, 43258, 79415];
const NO_FLUSH5 = new Int32Array(4 * RANK_KEY[12] + RANK_KEY[11] + 1);
for (let r0 = 0; r0 < 13; r0++)
  for (let r1 = r0; r1 < 13; r1++)
    for (let r2 = r1; r2 < 13; r2++)
      for (let r3 = r2; r3 < 13; r3++)
        for (let r4 = r3; r4 < 13; r4++) {
          if (r0 === r4) continue; // five of one rank does not exist
          // suits 0,1,2,3,0 in rank order: equal ranks sit next to each other, so no card repeats and no flush
          NO_FLUSH5[RANK_KEY[r0] + RANK_KEY[r1] + RANK_KEY[r2] + RANK_KEY[r3] + RANK_KEY[r4]] =
            eval5Reference(r0 * 4, r1 * 4 + 1, r2 * 4 + 2, r3 * 4 + 3, r4 * 4);
        }
export { RANK_KEY, NO_FLUSH5, FLUSH5 };
const PAIR_KEYS = new Int32Array(15);
const SUIT_COUNT = new Int8Array(4);
const SUITED_HOLE = new Int32Array(6);
const SUITED_BOARD = new Int32Array(5);

export function eval5(a: number, b: number, c: number, d: number, e: number): number {
  const s = a & 3;
  if (s === (b & 3) && s === (c & 3) && s === (d & 3) && s === (e & 3)) {
    return FLUSH5[
      (1 << (a >> 2)) | (1 << (b >> 2)) | (1 << (c >> 2)) | (1 << (d >> 2)) | (1 << (e >> 2))
    ];
  }
  return NO_FLUSH5[
    RANK_KEY[a >> 2] + RANK_KEY[b >> 2] + RANK_KEY[c >> 2] + RANK_KEY[d >> 2] + RANK_KEY[e >> 2]
  ];
}

// ── Precomputed pool & board-table batch evaluators (100% bit-identical to omahaBest) ──

/** Precomputed per-holding pair indices, lazy RANK_KEY pair sums, 52-bit card masks and suit masks for a flat pool. */
export interface PoolFastData {
  readonly holeCount: number;
  readonly nPairs: number;
  readonly size: number;
  /** 52-bit card mask split into low (0..31) and high (32..51) 32-bit lanes */
  readonly maskLo: Int32Array;
  readonly maskHi: Int32Array;
  /** unordered rank-pair index rLo * 13 + rHi (0..168), flat [size * nPairs] */
  readonly pairIdx: Uint8Array;
  /** lazily built RANK_KEY[rLo] + RANK_KEY[rHi], flat [size * nPairs] */
  pairKeys: Int32Array | null;
  /** 4-bit mask: bit s is set iff holding i has >= 2 cards of suit s */
  readonly suitMask: Uint8Array;
}

export function buildPoolFastData(cards: Int8Array, size: number, hc: number): PoolFastData {
  const nPairs = (hc * (hc - 1)) >> 1;
  const maskLo = new Int32Array(size);
  const maskHi = new Int32Array(size);
  const pairIdx = new Uint8Array(size * nPairs);
  const suitMask = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const cBase = i * hc;
    const pBase = i * nPairs;
    let lo = 0;
    let hi = 0;
    let seenSuits = 0;
    let dupSuits = 0;
    for (let k = 0; k < hc; k++) {
      const c = cards[cBase + k];
      if (c < 32) lo |= 1 << c;
      else hi |= 1 << (c - 32);
      const sb = 1 << (c & 3);
      dupSuits |= seenSuits & sb;
      seenSuits |= sb;
    }
    maskLo[i] = lo;
    maskHi[i] = hi;
    suitMask[i] = dupSuits;
    let p = 0;
    for (let a = 0; a < hc - 1; a++) {
      const ra = cards[cBase + a] >> 2;
      for (let b = a + 1; b < hc; b++) {
        const rb = cards[cBase + b] >> 2;
        pairIdx[pBase + p] = ra <= rb ? ra * 13 + rb : rb * 13 + ra;
        p++;
      }
    }
  }
  return { holeCount: hc, nPairs, size, maskLo, maskHi, pairIdx, pairKeys: null, suitMask };
}

/** Lazily builds RANK_KEY pair sums for a PoolFastData (skipped by pools never passed to Monte Carlo equity). */
export function getPoolPairKeys(fast: PoolFastData, cards: Int8Array): Int32Array {
  if (fast.pairKeys) return fast.pairKeys;
  const size = fast.size;
  const hc = fast.holeCount;
  const nPairs = fast.nPairs;
  const pairKeys = new Int32Array(size * nPairs);
  for (let i = 0; i < size; i++) {
    const cBase = i * hc;
    const pBase = i * nPairs;
    let p = 0;
    for (let a = 0; a < hc - 1; a++) {
      const ka = RANK_KEY[cards[cBase + a] >> 2];
      for (let b = a + 1; b < hc; b++) {
        pairKeys[pBase + p] = ka + RANK_KEY[cards[cBase + b] >> 2];
        p++;
      }
    }
  }
  fast.pairKeys = pairKeys;
  return pairKeys;
}

/**
 * Stable descending index sort (highest `values[i]` first, ties by ascending index `i` — identical to
 * `Array.from({ length: n }, (_, i) => i).sort((x, y) => values[y] - values[x])` in ES2019+), using an
 * allocation-minimal bottom-up merge sort on Int32Array with zero JS comparator callbacks.
 */
export function sortIndicesDescStable(values: Float64Array, n: number): Int32Array {
  let src = new Int32Array(n);
  for (let i = 0; i < n; i++) src[i] = i;
  if (n <= 1) return src;
  let dst = new Int32Array(n);
  // Insertion sort on runs of length 16
  for (let start = 0; start < n; start += 16) {
    const end = start + 16 < n ? start + 16 : n;
    for (let i = start + 1; i < end; i++) {
      const idx = src[i];
      const val = values[idx];
      let j = i - 1;
      while (j >= start && values[src[j]] < val) {
        src[j + 1] = src[j];
        j--;
      }
      src[j + 1] = idx;
    }
  }
  for (let width = 16; width < n; width <<= 1) {
    for (let left = 0; left < n; left += width << 1) {
      const mid = left + width < n ? left + width : n;
      const right = left + (width << 1) < n ? left + (width << 1) : n;
      let i = left;
      let j = mid;
      let k = left;
      while (i < mid && j < right) {
        // Stable descending: equal values preserve left-before-right order
        if (values[src[i]] >= values[src[j]]) dst[k++] = src[i++];
        else dst[k++] = src[j++];
      }
      while (i < mid) dst[k++] = src[i++];
      while (j < right) dst[k++] = src[j++];
    }
    const tmp = src;
    src = dst;
    dst = tmp;
  }
  return src;
}

/**
 * Reusable L1-resident board lookup table (676 bytes): precomputes the exact max non-flush score for every
 * unordered hole rank pair (rLo <= rHi) against all C(boardLen, 3) board triples once per board, plus suited
 * board triple masks when a flush is possible. Scoring any PLO4/PLO5 holding on that board is then 6/10 L1 reads.
 */
export interface OmahaBoardTable {
  pairBest: Int32Array;
  flushSuit: number;
  flushTripleCount: number;
  flushTriples: Int32Array;
}

export function createBoardTable(): OmahaBoardTable {
  return {
    pairBest: new Int32Array(169),
    flushSuit: -1,
    flushTripleCount: 0,
    flushTriples: new Int32Array(10),
  };
}

const BOARD_RC = new Int8Array(13);

export function loadBoardTable(
  tbl: OmahaBoardTable,
  board: ArrayLike<number>,
  boardLen: number
): void {
  const pb = tbl.pairBest;
  BOARD_RC.fill(0);
  let sc0 = 0,
    sc1 = 0,
    sc2 = 0,
    sc3 = 0;
  for (let x = 0; x < boardLen; x++) {
    const c = board[x];
    BOARD_RC[c >> 2]++;
    const s = c & 3;
    if (s === 0) sc0++;
    else if (s === 1) sc1++;
    else if (s === 2) sc2++;
    else sc3++;
  }
  if (boardLen === 5) {
    const k0 = RANK_KEY[board[0] >> 2];
    const k1 = RANK_KEY[board[1] >> 2];
    const k2 = RANK_KEY[board[2] >> 2];
    const k3 = RANK_KEY[board[3] >> 2];
    const k4 = RANK_KEY[board[4] >> 2];
    const t0 = k0 + k1 + k2;
    const t1 = k0 + k1 + k3;
    const t2 = k0 + k1 + k4;
    const t3 = k0 + k2 + k3;
    const t4 = k0 + k2 + k4;
    const t5 = k0 + k3 + k4;
    const t6 = k1 + k2 + k3;
    const t7 = k1 + k2 + k4;
    const t8 = k1 + k3 + k4;
    const t9 = k2 + k3 + k4;
    for (let r1 = 0; r1 < 13; r1++) {
      const rk1 = RANK_KEY[r1];
      const row = r1 * 13;
      const start2 = BOARD_RC[r1] >= 3 ? r1 + 1 : r1;
      if (start2 > r1) pb[row + r1] = -1;
      for (let r2 = start2; r2 < 13; r2++) {
        const pk = rk1 + RANK_KEY[r2];
        let b = NO_FLUSH5[t0 + pk];
        let v = NO_FLUSH5[t1 + pk];
        if (v > b) b = v;
        v = NO_FLUSH5[t2 + pk];
        if (v > b) b = v;
        v = NO_FLUSH5[t3 + pk];
        if (v > b) b = v;
        v = NO_FLUSH5[t4 + pk];
        if (v > b) b = v;
        v = NO_FLUSH5[t5 + pk];
        if (v > b) b = v;
        v = NO_FLUSH5[t6 + pk];
        if (v > b) b = v;
        v = NO_FLUSH5[t7 + pk];
        if (v > b) b = v;
        v = NO_FLUSH5[t8 + pk];
        if (v > b) b = v;
        v = NO_FLUSH5[t9 + pk];
        if (v > b) b = v;
        pb[row + r2] = b;
      }
    }
  } else if (boardLen === 3) {
    const t0 = RANK_KEY[board[0] >> 2] + RANK_KEY[board[1] >> 2] + RANK_KEY[board[2] >> 2];
    for (let r1 = 0; r1 < 13; r1++) {
      const rk1 = RANK_KEY[r1];
      const row = r1 * 13;
      const start2 = BOARD_RC[r1] >= 3 ? r1 + 1 : r1;
      if (start2 > r1) pb[row + r1] = -1;
      for (let r2 = start2; r2 < 13; r2++) {
        pb[row + r2] = NO_FLUSH5[t0 + rk1 + RANK_KEY[r2]];
      }
    }
  } else if (boardLen === 4) {
    const k0 = RANK_KEY[board[0] >> 2];
    const k1 = RANK_KEY[board[1] >> 2];
    const k2 = RANK_KEY[board[2] >> 2];
    const k3 = RANK_KEY[board[3] >> 2];
    const t0 = k0 + k1 + k2;
    const t1 = k0 + k1 + k3;
    const t2 = k0 + k2 + k3;
    const t3 = k1 + k2 + k3;
    for (let r1 = 0; r1 < 13; r1++) {
      const rk1 = RANK_KEY[r1];
      const row = r1 * 13;
      const start2 = BOARD_RC[r1] >= 3 ? r1 + 1 : r1;
      if (start2 > r1) pb[row + r1] = -1;
      for (let r2 = start2; r2 < 13; r2++) {
        const pk = rk1 + RANK_KEY[r2];
        let b = NO_FLUSH5[t0 + pk];
        let v = NO_FLUSH5[t1 + pk];
        if (v > b) b = v;
        v = NO_FLUSH5[t2 + pk];
        if (v > b) b = v;
        v = NO_FLUSH5[t3 + pk];
        if (v > b) b = v;
        pb[row + r2] = b;
      }
    }
  }
  const fSuit = sc0 >= 3 ? 0 : sc1 >= 3 ? 1 : sc2 >= 3 ? 2 : sc3 >= 3 ? 3 : -1;
  tbl.flushSuit = fSuit;
  if (fSuit < 0) {
    tbl.flushTripleCount = 0;
    return;
  }
  let nb = 0;
  for (let x = 0; x < boardLen; x++) {
    if ((board[x] & 3) === fSuit) SUITED_BOARD[nb++] = 1 << (board[x] >> 2);
  }
  const ft = tbl.flushTriples;
  let nt = 0;
  for (let x = 0; x < nb - 2; x++) {
    const bx = SUITED_BOARD[x];
    for (let y = x + 1; y < nb - 1; y++) {
      const bxy = bx | SUITED_BOARD[y];
      for (let z = y + 1; z < nb; z++) ft[nt++] = bxy | SUITED_BOARD[z];
    }
  }
  tbl.flushTripleCount = nt;
}

/** Score pool holding `i` against a loaded OmahaBoardTable (bit-identical to omahaBest). */
export function scorePoolHoldingWithBoard(
  fast: PoolFastData,
  cards: Int8Array,
  i: number,
  tbl: OmahaBoardTable
): number {
  const pb = tbl.pairBest;
  const pi = fast.pairIdx;
  let best: number;
  if (fast.holeCount === 5) {
    const b = i * 10;
    best = pb[pi[b]];
    let v = pb[pi[b + 1]];
    if (v > best) best = v;
    v = pb[pi[b + 2]];
    if (v > best) best = v;
    v = pb[pi[b + 3]];
    if (v > best) best = v;
    v = pb[pi[b + 4]];
    if (v > best) best = v;
    v = pb[pi[b + 5]];
    if (v > best) best = v;
    v = pb[pi[b + 6]];
    if (v > best) best = v;
    v = pb[pi[b + 7]];
    if (v > best) best = v;
    v = pb[pi[b + 8]];
    if (v > best) best = v;
    v = pb[pi[b + 9]];
    if (v > best) best = v;
  } else if (fast.holeCount === 4) {
    const b = i * 6;
    best = pb[pi[b]];
    let v = pb[pi[b + 1]];
    if (v > best) best = v;
    v = pb[pi[b + 2]];
    if (v > best) best = v;
    v = pb[pi[b + 3]];
    if (v > best) best = v;
    v = pb[pi[b + 4]];
    if (v > best) best = v;
    v = pb[pi[b + 5]];
    if (v > best) best = v;
  } else {
    const b = i * fast.nPairs;
    best = -1;
    for (let p = 0; p < fast.nPairs; p++) {
      const v = pb[pi[b + p]];
      if (v > best) best = v;
    }
  }
  const fSuit = tbl.flushSuit;
  if (fSuit >= 0 && (fast.suitMask[i] & (1 << fSuit)) !== 0) {
    const hc = fast.holeCount;
    const cBase = i * hc;
    let nh = 0;
    for (let k = 0; k < hc; k++) {
      const c = cards[cBase + k];
      if ((c & 3) === fSuit) SUITED_HOLE[nh++] = 1 << (c >> 2);
    }
    const ft = tbl.flushTriples;
    const nt = tbl.flushTripleCount;
    for (let a = 0; a < nh - 1; a++) {
      const ha = SUITED_HOLE[a];
      for (let b = a + 1; b < nh; b++) {
        const hm = ha | SUITED_HOLE[b];
        for (let t = 0; t < nt; t++) {
          const s = FLUSH5[hm | ft[t]];
          if (s > best) best = s;
        }
      }
    }
  }
  return best;
}

/** Score a single holding against a loaded OmahaBoardTable (bit-identical to omahaBest). */
export function scoreHandWithBoard(
  hole: ArrayLike<number>,
  holeLen: number,
  tbl: OmahaBoardTable
): number {
  const pb = tbl.pairBest;
  let best = -1;
  for (let a = 0; a < holeLen - 1; a++) {
    const ra = hole[a] >> 2;
    for (let b = a + 1; b < holeLen; b++) {
      const rb = hole[b] >> 2;
      const v = pb[ra <= rb ? ra * 13 + rb : rb * 13 + ra];
      if (v > best) best = v;
    }
  }
  const fSuit = tbl.flushSuit;
  if (fSuit >= 0) {
    let nh = 0;
    for (let k = 0; k < holeLen; k++) {
      const c = hole[k];
      if ((c & 3) === fSuit) SUITED_HOLE[nh++] = 1 << (c >> 2);
    }
    if (nh >= 2) {
      const ft = tbl.flushTriples;
      const nt = tbl.flushTripleCount;
      for (let a = 0; a < nh - 1; a++) {
        const ha = SUITED_HOLE[a];
        for (let b = a + 1; b < nh; b++) {
          const hm = ha | SUITED_HOLE[b];
          for (let t = 0; t < nt; t++) {
            const s = FLUSH5[hm | ft[t]];
            if (s > best) best = s;
          }
        }
      }
    }
  }
  return best;
}

/**
 * Compact 5-card board triple representation for 2..5 player Monte Carlo showdown samples (where building
 * a 91-entry table per sample would do more work than scoring 2..4 hands directly). Supports early-out as
 * soon as an opponent beats the hero's score.
 */
export interface OmahaFiveBoardTriples {
  t0: number;
  t1: number;
  t2: number;
  t3: number;
  t4: number;
  t5: number;
  t6: number;
  t7: number;
  t8: number;
  t9: number;
  flushSuit: number;
  flushTripleCount: number;
  flushTriples: Int32Array;
}

export function createFiveBoardTriples(): OmahaFiveBoardTriples {
  return {
    t0: 0,
    t1: 0,
    t2: 0,
    t3: 0,
    t4: 0,
    t5: 0,
    t6: 0,
    t7: 0,
    t8: 0,
    t9: 0,
    flushSuit: -1,
    flushTripleCount: 0,
    flushTriples: new Int32Array(10),
  };
}

export function loadFiveBoardTriples(
  bt: OmahaFiveBoardTriples,
  b0: number,
  b1: number,
  b2: number,
  b3: number,
  b4: number
): void {
  const k0 = RANK_KEY[b0 >> 2];
  const k1 = RANK_KEY[b1 >> 2];
  const k2 = RANK_KEY[b2 >> 2];
  const k3 = RANK_KEY[b3 >> 2];
  const k4 = RANK_KEY[b4 >> 2];
  const k01 = k0 + k1;
  const k02 = k0 + k2;
  const k12 = k1 + k2;
  bt.t0 = k01 + k2;
  bt.t1 = k01 + k3;
  bt.t2 = k01 + k4;
  bt.t3 = k02 + k3;
  bt.t4 = k02 + k4;
  bt.t5 = k0 + k3 + k4;
  bt.t6 = k12 + k3;
  bt.t7 = k12 + k4;
  bt.t8 = k1 + k3 + k4;
  bt.t9 = k2 + k3 + k4;
  const s0 = b0 & 3;
  const s1 = b1 & 3;
  const s2 = b2 & 3;
  const s3 = b3 & 3;
  const s4 = b4 & 3;
  // Count suits using bit-packing (3 bits per suit: 0, 3, 6, 9) — zero branches or array clears
  const sc =
    (1 << (s0 * 3)) + (1 << (s1 * 3)) + (1 << (s2 * 3)) + (1 << (s3 * 3)) + (1 << (s4 * 3));
  let fSuit = -1;
  if ((sc & 7) >= 3) fSuit = 0;
  else if (((sc >> 3) & 7) >= 3) fSuit = 1;
  else if (((sc >> 6) & 7) >= 3) fSuit = 2;
  else if (((sc >> 9) & 7) >= 3) fSuit = 3;
  bt.flushSuit = fSuit;
  if (fSuit < 0) {
    bt.flushTripleCount = 0;
    return;
  }
  let nb = 0;
  if (s0 === fSuit) SUITED_BOARD[nb++] = 1 << (b0 >> 2);
  if (s1 === fSuit) SUITED_BOARD[nb++] = 1 << (b1 >> 2);
  if (s2 === fSuit) SUITED_BOARD[nb++] = 1 << (b2 >> 2);
  if (s3 === fSuit) SUITED_BOARD[nb++] = 1 << (b3 >> 2);
  if (s4 === fSuit) SUITED_BOARD[nb++] = 1 << (b4 >> 2);
  const ft = bt.flushTriples;
  if (nb === 3) {
    ft[0] = SUITED_BOARD[0] | SUITED_BOARD[1] | SUITED_BOARD[2];
    bt.flushTripleCount = 1;
  } else {
    let nt = 0;
    for (let x = 0; x < nb - 2; x++) {
      const bx = SUITED_BOARD[x];
      for (let y = x + 1; y < nb - 1; y++) {
        const bxy = bx | SUITED_BOARD[y];
        for (let z = y + 1; z < nb; z++) ft[nt++] = bxy | SUITED_BOARD[z];
      }
    }
    bt.flushTripleCount = nt;
  }
}

/**
 * Score a hand given its precomputed RANK_KEY pair sums against a loaded 5-card board.
 * When `stopAbove >= 0`, returns immediately upon finding any score strictly greater than `stopAbove`
 * (the exact maximum is guaranteed > stopAbove; when <= stopAbove the exact maximum is returned).
 */
export function scorePairKeysOnFiveBoard(
  pairKeys: Int32Array,
  pkOffset: number,
  nPairs: number,
  cards: ArrayLike<number>,
  cardOffset: number,
  hc: number,
  suitMask: number,
  bt: OmahaFiveBoardTriples,
  stopAbove = -1
): number {
  const t0 = bt.t0,
    t1 = bt.t1,
    t2 = bt.t2,
    t3 = bt.t3,
    t4 = bt.t4,
    t5 = bt.t5,
    t6 = bt.t6,
    t7 = bt.t7,
    t8 = bt.t8,
    t9 = bt.t9;
  let best = -1;
  if (stopAbove >= 0) {
    for (let p = 0; p < nPairs; p++) {
      const pk = pairKeys[pkOffset + p];
      let v = NO_FLUSH5[t0 + pk];
      if (v > best) {
        best = v;
        if (best > stopAbove) return best;
      }
      v = NO_FLUSH5[t1 + pk];
      if (v > best) {
        best = v;
        if (best > stopAbove) return best;
      }
      v = NO_FLUSH5[t2 + pk];
      if (v > best) {
        best = v;
        if (best > stopAbove) return best;
      }
      v = NO_FLUSH5[t3 + pk];
      if (v > best) {
        best = v;
        if (best > stopAbove) return best;
      }
      v = NO_FLUSH5[t4 + pk];
      if (v > best) {
        best = v;
        if (best > stopAbove) return best;
      }
      v = NO_FLUSH5[t5 + pk];
      if (v > best) {
        best = v;
        if (best > stopAbove) return best;
      }
      v = NO_FLUSH5[t6 + pk];
      if (v > best) {
        best = v;
        if (best > stopAbove) return best;
      }
      v = NO_FLUSH5[t7 + pk];
      if (v > best) {
        best = v;
        if (best > stopAbove) return best;
      }
      v = NO_FLUSH5[t8 + pk];
      if (v > best) {
        best = v;
        if (best > stopAbove) return best;
      }
      v = NO_FLUSH5[t9 + pk];
      if (v > best) {
        best = v;
        if (best > stopAbove) return best;
      }
    }
  } else {
    for (let p = 0; p < nPairs; p++) {
      const pk = pairKeys[pkOffset + p];
      let v = NO_FLUSH5[t0 + pk];
      if (v > best) best = v;
      v = NO_FLUSH5[t1 + pk];
      if (v > best) best = v;
      v = NO_FLUSH5[t2 + pk];
      if (v > best) best = v;
      v = NO_FLUSH5[t3 + pk];
      if (v > best) best = v;
      v = NO_FLUSH5[t4 + pk];
      if (v > best) best = v;
      v = NO_FLUSH5[t5 + pk];
      if (v > best) best = v;
      v = NO_FLUSH5[t6 + pk];
      if (v > best) best = v;
      v = NO_FLUSH5[t7 + pk];
      if (v > best) best = v;
      v = NO_FLUSH5[t8 + pk];
      if (v > best) best = v;
      v = NO_FLUSH5[t9 + pk];
      if (v > best) best = v;
    }
  }
  const fSuit = bt.flushSuit;
  if (fSuit >= 0 && (suitMask & (1 << fSuit)) !== 0) {
    let nh = 0;
    for (let k = 0; k < hc; k++) {
      const c = cards[cardOffset + k];
      if ((c & 3) === fSuit) SUITED_HOLE[nh++] = 1 << (c >> 2);
    }
    const ft = bt.flushTriples;
    const nt = bt.flushTripleCount;
    for (let a = 0; a < nh - 1; a++) {
      const ha = SUITED_HOLE[a];
      for (let b = a + 1; b < nh; b++) {
        const hm = ha | SUITED_HOLE[b];
        for (let t = 0; t < nt; t++) {
          const s = FLUSH5[hm | ft[t]];
          if (s > best) {
            best = s;
            if (stopAbove >= 0 && best > stopAbove) return best;
          }
        }
      }
    }
  }
  return best;
}

/** The original rank-by-rank scorer: the reference the tables are built from and tested against. */
export function eval5Reference(a: number, b: number, c: number, d: number, e: number): number {
  const ra = a >> 2,
    rb = b >> 2,
    rc = c >> 2,
    rd = d >> 2,
    re = e >> 2;
  const flush =
    (a & 3) === (b & 3) && (a & 3) === (c & 3) && (a & 3) === (d & 3) && (a & 3) === (e & 3);
  const mask = (1 << ra) | (1 << rb) | (1 << rc) | (1 << rd) | (1 << re);
  let distinct = 0;
  for (let m = mask; m; m &= m - 1) distinct++;
  if (distinct === 5) {
    const sh = straightHigh(mask);
    if (flush)
      return sh >= 0 ? CAT_STRAIGHT_FLUSH * CAT_SHIFT + sh : CAT_FLUSH * CAT_SHIFT + kick(mask);
    if (sh >= 0) return CAT_STRAIGHT * CAT_SHIFT + sh;
    return CAT_HIGH * CAT_SHIFT + kick(mask);
  }
  counts[ra]++;
  counts[rb]++;
  counts[rc]++;
  counts[rd]++;
  counts[re]++;
  let quad = -1,
    trip = -1,
    pairHi = -1,
    pairLo = -1,
    single = 0,
    singles = 0;
  for (let r = 12; r >= 0; r--) {
    const n = counts[r];
    if (n === 0) continue;
    counts[r] = 0;
    if (n === 4) quad = r;
    else if (n === 3) trip = r;
    else if (n === 2) {
      if (pairHi < 0) pairHi = r;
      else pairLo = r;
    } else {
      single = single * 16 + r;
      singles++;
    }
  }
  if (quad >= 0) return CAT_QUADS * CAT_SHIFT + quad * 16 + single;
  if (trip >= 0 && pairHi >= 0) return CAT_FULL_HOUSE * CAT_SHIFT + trip * 16 + pairHi;
  if (trip >= 0) return CAT_TRIPS * CAT_SHIFT + trip * 256 + single;
  if (pairLo >= 0) return CAT_TWO_PAIR * CAT_SHIFT + pairHi * 256 + pairLo * 16 + single;
  void singles;
  return CAT_PAIR * CAT_SHIFT + pairHi * 4096 + single;
}

function kick(mask: number): number {
  let v = 0;
  for (let r = 12; r >= 0; r--) if (mask & (1 << r)) v = v * 16 + r;
  return v;
}

export function categoryOf(score: number): number {
  return Math.floor(score / CAT_SHIFT);
}

/**
 * Memo of omahaBest on complete (5-card) boards, lane CORE-POOLED-2 latency (Nov 21; VERIFIER V60): the 2+3
 * evaluator dominated the core's flop cost (100 five-card evaluations per PLO5 hand per runout), and one decision
 * evaluates the same holding on the same runout many times (the equity samplers, range tracking and the plan
 * draw from ~1,000 distinct turn/river runouts). omahaBest is a pure function of its inputs, so a memo returns
 * exactly the value a fresh evaluation returns: every equity, receipt and decision is unchanged (law test
 * OmahaMathCoreEvalMemo.law.test.ts). The core clears it at the start of every decision; a size cap clears it
 * earlier. Key: the hole cards in the given order (base 52) and the five board cards in the given order.
 */
const BEST_MEMO = new Map<number, Map<number, number>>();
let bestMemoSize = 0;
let bestMemoOn = true;
const BEST_MEMO_CAP = 1_500_000;
/** clears the memo (called by the core at the start of each decision) */
export function resetOmahaBestMemo(): void {
  BEST_MEMO.clear();
  bestMemoSize = 0;
}
/** test hook: turn the memo off to prove that results are identical with and without it */
export function setOmahaBestMemoForTests(on: boolean): void {
  bestMemoOn = on;
  resetOmahaBestMemo();
}

/** Best Omaha high score: exactly 2 of `hole` (4..6 cards) and 3 of `board` (3..5 cards). */
export function omahaBest(
  hole: ArrayLike<number>,
  holeLen: number,
  board: ArrayLike<number>,
  boardLen: number
): number {
  if (bestMemoOn && boardLen === 5 && holeLen >= 2 && holeLen <= 6) {
    let hk = 0;
    for (let i = 0; i < holeLen; i++) hk = hk * 52 + hole[i];
    hk = hk * 8 + holeLen;
    const bk = (((board[0] * 52 + board[1]) * 52 + board[2]) * 52 + board[3]) * 52 + board[4];
    let m = BEST_MEMO.get(hk);
    if (m !== undefined) {
      const v = m.get(bk);
      if (v !== undefined) return v;
    } else {
      m = new Map<number, number>();
      BEST_MEMO.set(hk, m);
    }
    const v = omahaBestRaw(hole, holeLen, board, boardLen);
    if (bestMemoSize >= BEST_MEMO_CAP) {
      resetOmahaBestMemo();
      return v;
    }
    m.set(bk, v);
    bestMemoSize++;
    return v;
  }
  return omahaBestRaw(hole, holeLen, board, boardLen);
}

function omahaBestRaw(
  hole: ArrayLike<number>,
  holeLen: number,
  board: ArrayLike<number>,
  boardLen: number
): number {
  let best = -1;
  let pairs = 0;
  for (let i = 0; i < holeLen - 1; i++) {
    const k1 = RANK_KEY[hole[i] >> 2];
    for (let j = i + 1; j < holeLen; j++) PAIR_KEYS[pairs++] = k1 + RANK_KEY[hole[j] >> 2];
  }
  for (let x = 0; x < boardLen - 2; x++) {
    const kx = RANK_KEY[board[x] >> 2];
    for (let y = x + 1; y < boardLen - 1; y++) {
      const kxy = kx + RANK_KEY[board[y] >> 2];
      for (let z = y + 1; z < boardLen; z++) {
        const triple = kxy + RANK_KEY[board[z] >> 2];
        for (let p = 0; p < pairs; p++) {
          const s = NO_FLUSH5[triple + PAIR_KEYS[p]];
          if (s > best) best = s;
        }
      }
    }
  }
  // a flush needs three board cards of one suit (at most one such suit on five cards) and two hole cards of it
  SUIT_COUNT[0] = SUIT_COUNT[1] = SUIT_COUNT[2] = SUIT_COUNT[3] = 0;
  for (let x = 0; x < boardLen; x++) SUIT_COUNT[board[x] & 3]++;
  const suit =
    SUIT_COUNT[0] >= 3
      ? 0
      : SUIT_COUNT[1] >= 3
        ? 1
        : SUIT_COUNT[2] >= 3
          ? 2
          : SUIT_COUNT[3] >= 3
            ? 3
            : -1;
  if (suit < 0) return best;
  let nh = 0;
  for (let i = 0; i < holeLen; i++)
    if ((hole[i] & 3) === suit) SUITED_HOLE[nh++] = 1 << (hole[i] >> 2);
  if (nh < 2) return best;
  let nb = 0;
  for (let x = 0; x < boardLen; x++)
    if ((board[x] & 3) === suit) SUITED_BOARD[nb++] = 1 << (board[x] >> 2);
  for (let i = 0; i < nh - 1; i++)
    for (let j = i + 1; j < nh; j++) {
      const hm = SUITED_HOLE[i] | SUITED_HOLE[j];
      for (let x = 0; x < nb - 2; x++)
        for (let y = x + 1; y < nb - 1; y++)
          for (let z = y + 1; z < nb; z++) {
            const s = FLUSH5[hm | SUITED_BOARD[x] | SUITED_BOARD[y] | SUITED_BOARD[z]];
            if (s > best) best = s;
          }
    }
  return best;
}

/** The original 2+3 loop over eval5: the reference the table version is tested against. */
export function omahaBestReference(
  hole: ArrayLike<number>,
  holeLen: number,
  board: ArrayLike<number>,
  boardLen: number
): number {
  let best = -1;
  for (let i = 0; i < holeLen - 1; i++) {
    const h1 = hole[i];
    for (let j = i + 1; j < holeLen; j++) {
      const h2 = hole[j];
      for (let x = 0; x < boardLen - 2; x++) {
        const b1 = board[x];
        for (let y = x + 1; y < boardLen - 1; y++) {
          const b2 = board[y];
          for (let z = y + 1; z < boardLen; z++) {
            const s = eval5(h1, h2, b1, b2, board[z]);
            if (s > best) best = s;
          }
        }
      }
    }
  }
  return best;
}
