/**
 * A FAST OMAHA HIGH SCORE ON INTEGER CARDS (PLO-OWNER lead-6 2026-11-24; omahaFlopRealizationIsPriced only).
 *
 * The flop call tree scores tens of thousands of (holding, board) pairs per decision. This is the same poker order
 * as HorseEval.scoreOmahaHiPartial (exactly two hole cards and three board cards; every five-card hand ranked by the
 * standard categories and kickers; the wheel is a five-high straight) on integer cards, with the board's three-card
 * subsets precomputed once per board and a river score built from the turn score plus the six subsets that hold the
 * river card. The numbers are not HorseEval's; only their ORDER is the same (equal hands score equal), which is all
 * the tree uses: it compares scores of hands on the same board. `anOmahaFastScoreOrdersAsHorseEval.test.ts` checks
 * the order against HorseEval on random PLO4 and PLO5 hands on flops, turns and rivers.
 *
 * Card integer: rank * 4 + suit, rank 2..14 (ace 14), suit 0..3.
 */
import type { Card } from '../types.js';

const RANK: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};
const SUIT: Record<string, number> = {
  clubs: 0,
  diamonds: 1,
  hearts: 2,
  spades: 3,
  c: 0,
  d: 1,
  h: 2,
  s: 3,
};

/** The integer of a card, or -1 when it is not a card. */
export function omahaFastCard(c: Card): number {
  const r = RANK[String(c?.rank)];
  const s = SUIT[String(c?.suit)];
  return r === undefined || s === undefined ? -1 : r * 4 + s;
}

const WHEEL = (1 << 14) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5);

/** The five-card score (higher is better; equal hands equal). */
export function omahaFastScore5(a: number, b: number, c: number, d: number, e: number): number {
  let r0 = a >> 2;
  let r1 = b >> 2;
  let r2 = c >> 2;
  let r3 = d >> 2;
  let r4 = e >> 2;
  const flush =
    (a & 3) === (b & 3) && (a & 3) === (c & 3) && (a & 3) === (d & 3) && (a & 3) === (e & 3);
  // sort descending (a five-input network)
  let t: number;
  if (r0 < r1) {
    t = r0;
    r0 = r1;
    r1 = t;
  }
  if (r3 < r4) {
    t = r3;
    r3 = r4;
    r4 = t;
  }
  if (r2 < r4) {
    t = r2;
    r2 = r4;
    r4 = t;
  }
  if (r2 < r3) {
    t = r2;
    r2 = r3;
    r3 = t;
  }
  if (r1 < r4) {
    t = r1;
    r1 = r4;
    r4 = t;
  }
  if (r0 < r3) {
    t = r0;
    r0 = r3;
    r3 = t;
  }
  if (r0 < r2) {
    t = r0;
    r0 = r2;
    r2 = t;
  }
  if (r1 < r3) {
    t = r1;
    r1 = r3;
    r3 = t;
  }
  if (r1 < r2) {
    t = r1;
    r1 = r2;
    r2 = t;
  }
  const distinct = r0 !== r1 && r1 !== r2 && r2 !== r3 && r3 !== r4;
  if (distinct) {
    const mask = (1 << r0) | (1 << r1) | (1 << r2) | (1 << r3) | (1 << r4);
    let top = 0;
    if (r0 - r4 === 4) top = r0;
    else if (mask === WHEEL) top = 5;
    if (top > 0) return ((flush ? 8 : 4) << 20) | (top << 16);
    const k = (r0 << 16) | (r1 << 12) | (r2 << 8) | (r3 << 4) | r4;
    return ((flush ? 5 : 0) << 20) | k;
  }
  // paired hands: group by count (a flush is impossible with a pair in one deck)
  if (r0 === r3) return (7 << 20) | (r0 << 16) | (r4 << 12); // quads high
  if (r1 === r4) return (7 << 20) | (r1 << 16) | (r0 << 12); // quads low
  if (r0 === r2 && r3 === r4) return (6 << 20) | (r0 << 16) | (r3 << 12);
  if (r0 === r1 && r2 === r4) return (6 << 20) | (r2 << 16) | (r0 << 12);
  if (r0 === r2) return (3 << 20) | (r0 << 16) | (r3 << 12) | (r4 << 8);
  if (r1 === r3) return (3 << 20) | (r1 << 16) | (r0 << 12) | (r4 << 8);
  if (r2 === r4) return (3 << 20) | (r2 << 16) | (r0 << 12) | (r1 << 8);
  // pairs
  if (r0 === r1) {
    if (r2 === r3) return (2 << 20) | (r0 << 16) | (r2 << 12) | (r4 << 8);
    if (r3 === r4) return (2 << 20) | (r0 << 16) | (r3 << 12) | (r2 << 8);
    return (1 << 20) | (r0 << 16) | (r2 << 12) | (r3 << 8) | (r4 << 4);
  }
  if (r1 === r2) {
    if (r3 === r4) return (2 << 20) | (r1 << 16) | (r3 << 12) | (r0 << 8);
    return (1 << 20) | (r1 << 16) | (r0 << 12) | (r3 << 8) | (r4 << 4);
  }
  if (r2 === r3) return (1 << 20) | (r2 << 16) | (r0 << 12) | (r1 << 8) | (r4 << 4);
  return (1 << 20) | (r3 << 16) | (r0 << 12) | (r1 << 8) | (r2 << 4);
}

/** The board's three-card subsets, flattened (three integers each); `withLast` keeps only those holding the last card. */
export function omahaFastTriples(board: readonly number[], withLast = false): Int32Array {
  const n = board.length;
  const out: number[] = [];
  for (let x = 0; x < n; x++)
    for (let y = x + 1; y < n; y++)
      for (let z = y + 1; z < n; z++) {
        if (withLast && z !== n - 1) continue;
        out.push(board[x], board[y], board[z]);
      }
  return Int32Array.from(out);
}

/** The best score of a holding (integers, length 4 or 5) over the given triples, starting from `floor`. */
export function omahaFastBest(
  hole: ArrayLike<number>,
  holeLen: number,
  triples: Int32Array,
  floor = 0
): number {
  let best = floor;
  for (let i = 0; i < holeLen; i++)
    for (let j = i + 1; j < holeLen; j++) {
      const p = hole[i];
      const q = hole[j];
      for (let k = 0; k < triples.length; k += 3) {
        const s = omahaFastScore5(p, q, triples[k], triples[k + 1], triples[k + 2]);
        if (s > best) best = s;
      }
    }
  return best;
}

/** omahaFastBest for the holding stored at `offset` of a flat card array. */
export function omahaFastBestAt(
  cards: ArrayLike<number>,
  offset: number,
  holeLen: number,
  triples: Int32Array,
  floor = 0
): number {
  let best = floor;
  for (let i = 0; i < holeLen; i++)
    for (let j = i + 1; j < holeLen; j++) {
      const p = cards[offset + i];
      const q = cards[offset + j];
      for (let k = 0; k < triples.length; k += 3) {
        const s = omahaFastScore5(p, q, triples[k], triples[k + 1], triples[k + 2]);
        if (s > best) best = s;
      }
    }
  return best;
}

/**
 * Precomputed form (the hot path of the flop call tree): a holding's two-card pairs as [high rank, low rank, suit
 * when suited else -1] and a board's triples as [r0 >= r1 >= r2, suit when one suit else -1]. The score is the same
 * as omahaFastScore5 on the five cards.
 */
export const OMAHA_FAST_PAIR_STRIDE = 3;
export const OMAHA_FAST_TRIPLE_STRIDE = 4;

/** Writes the pairs of the holding at `offset` (holeLen cards) into `out` at `outOffset`; returns the pair count. */
export function omahaFastPairsInto(
  cards: ArrayLike<number>,
  offset: number,
  holeLen: number,
  out: Int32Array,
  outOffset: number
): number {
  let w = outOffset;
  for (let i = 0; i < holeLen; i++)
    for (let j = i + 1; j < holeLen; j++) {
      const a = cards[offset + i];
      const b = cards[offset + j];
      const ra = a >> 2;
      const rb = b >> 2;
      out[w] = ra >= rb ? ra : rb;
      out[w + 1] = ra >= rb ? rb : ra;
      out[w + 2] = (a & 3) === (b & 3) ? a & 3 : -1;
      w += OMAHA_FAST_PAIR_STRIDE;
    }
  return (w - outOffset) / OMAHA_FAST_PAIR_STRIDE;
}

/** The board's triples in the precomputed form (`withLast`: only those holding the last card). */
export function omahaFastTriplesPre(board: readonly number[], withLast = false): Int32Array {
  const flat = omahaFastTriples(board, withLast);
  const out = new Int32Array((flat.length / 3) * OMAHA_FAST_TRIPLE_STRIDE);
  for (let k = 0, w = 0; k < flat.length; k += 3, w += OMAHA_FAST_TRIPLE_STRIDE) {
    let x = flat[k] >> 2;
    let y = flat[k + 1] >> 2;
    let z = flat[k + 2] >> 2;
    let t: number;
    if (x < y) {
      t = x;
      x = y;
      y = t;
    }
    if (y < z) {
      t = y;
      y = z;
      z = t;
    }
    if (x < y) {
      t = x;
      x = y;
      y = t;
    }
    out[w] = x;
    out[w + 1] = y;
    out[w + 2] = z;
    const s = flat[k] & 3;
    out[w + 3] = (flat[k + 1] & 3) === s && (flat[k + 2] & 3) === s ? s : -1;
  }
  return out;
}

/** Five sorted ranks (r0 >= ... >= r4) and a flush flag: the score of omahaFastScore5. */
function scoreSorted(
  r0: number,
  r1: number,
  r2: number,
  r3: number,
  r4: number,
  flush: boolean
): number {
  if (r0 !== r1 && r1 !== r2 && r2 !== r3 && r3 !== r4) {
    let top = 0;
    if (r0 - r4 === 4) top = r0;
    else if (r0 === 14 && r1 === 5) top = 5; // A-5-4-3-2 (distinct, so r1..r4 = 5,4,3,2)
    if (top > 0) return ((flush ? 8 : 4) << 20) | (top << 16);
    return ((flush ? 5 : 0) << 20) | (r0 << 16) | (r1 << 12) | (r2 << 8) | (r3 << 4) | r4;
  }
  if (r0 === r3) return (7 << 20) | (r0 << 16) | (r4 << 12);
  if (r1 === r4) return (7 << 20) | (r1 << 16) | (r0 << 12);
  if (r0 === r2 && r3 === r4) return (6 << 20) | (r0 << 16) | (r3 << 12);
  if (r0 === r1 && r2 === r4) return (6 << 20) | (r2 << 16) | (r0 << 12);
  if (r0 === r2) return (3 << 20) | (r0 << 16) | (r3 << 12) | (r4 << 8);
  if (r1 === r3) return (3 << 20) | (r1 << 16) | (r0 << 12) | (r4 << 8);
  if (r2 === r4) return (3 << 20) | (r2 << 16) | (r0 << 12) | (r1 << 8);
  if (r0 === r1) {
    if (r2 === r3) return (2 << 20) | (r0 << 16) | (r2 << 12) | (r4 << 8);
    if (r3 === r4) return (2 << 20) | (r0 << 16) | (r3 << 12) | (r2 << 8);
    return (1 << 20) | (r0 << 16) | (r2 << 12) | (r3 << 8) | (r4 << 4);
  }
  if (r1 === r2) {
    if (r3 === r4) return (2 << 20) | (r1 << 16) | (r3 << 12) | (r0 << 8);
    return (1 << 20) | (r1 << 16) | (r0 << 12) | (r3 << 8) | (r4 << 4);
  }
  if (r2 === r3) return (1 << 20) | (r2 << 16) | (r0 << 12) | (r1 << 8) | (r4 << 4);
  return (1 << 20) | (r3 << 16) | (r0 << 12) | (r1 << 8) | (r2 << 4);
}

/** The best score over `pairCount` precomputed pairs at `pairOffset` and the precomputed triples, from `floor`. */
export function omahaFastBestPre(
  pairs: Int32Array,
  pairOffset: number,
  pairCount: number,
  triples: Int32Array,
  floor = 0
): number {
  let best = floor;
  const end = pairOffset + pairCount * OMAHA_FAST_PAIR_STRIDE;
  for (let w = pairOffset; w < end; w += OMAHA_FAST_PAIR_STRIDE) {
    const p0 = pairs[w];
    const p1 = pairs[w + 1];
    const ps = pairs[w + 2];
    for (let k = 0; k < triples.length; k += OMAHA_FAST_TRIPLE_STRIDE) {
      const t0 = triples[k];
      const t1 = triples[k + 1];
      const t2 = triples[k + 2];
      const flush = ps >= 0 && ps === triples[k + 3];
      // merge p0 >= p1 with t0 >= t1 >= t2
      let s: number;
      if (p0 >= t0) {
        if (p1 >= t0) s = scoreSorted(p0, p1, t0, t1, t2, flush);
        else if (p1 >= t1) s = scoreSorted(p0, t0, p1, t1, t2, flush);
        else if (p1 >= t2) s = scoreSorted(p0, t0, t1, p1, t2, flush);
        else s = scoreSorted(p0, t0, t1, t2, p1, flush);
      } else if (p0 >= t1) {
        if (p1 >= t1) s = scoreSorted(t0, p0, p1, t1, t2, flush);
        else if (p1 >= t2) s = scoreSorted(t0, p0, t1, p1, t2, flush);
        else s = scoreSorted(t0, p0, t1, t2, p1, flush);
      } else if (p0 >= t2) {
        if (p1 >= t2) s = scoreSorted(t0, t1, p0, p1, t2, flush);
        else s = scoreSorted(t0, t1, p0, t2, p1, flush);
      } else s = scoreSorted(t0, t1, t2, p0, p1, flush);
      if (s > best) best = s;
    }
  }
  return best;
}

/** Precomputed triples with every suit flag cleared: each five-card hand scored as if unsuited (ranks only). */
export function omahaFastRankOnly(triples: Int32Array): Int32Array {
  const out = Int32Array.from(triples);
  for (let k = 3; k < out.length; k += OMAHA_FAST_TRIPLE_STRIDE) out[k] = -1;
  return out;
}

/** Only the precomputed triples of one suit (the triples a flush can use). */
export function omahaFastOneSuit(triples: Int32Array): Int32Array {
  let c = 0;
  for (let k = 3; k < triples.length; k += OMAHA_FAST_TRIPLE_STRIDE) if (triples[k] >= 0) c++;
  const out = new Int32Array(c * OMAHA_FAST_TRIPLE_STRIDE);
  let w = 0;
  for (let k = 0; k < triples.length; k += OMAHA_FAST_TRIPLE_STRIDE)
    if (triples[k + 3] >= 0) {
      out[w] = triples[k];
      out[w + 1] = triples[k + 1];
      out[w + 2] = triples[k + 2];
      out[w + 3] = triples[k + 3];
      w += OMAHA_FAST_TRIPLE_STRIDE;
    }
  return out;
}
