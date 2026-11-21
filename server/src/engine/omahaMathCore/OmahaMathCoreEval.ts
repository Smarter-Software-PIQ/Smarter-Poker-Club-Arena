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
 * Table-driven eval5 (lane CORE-POOLED-2 latency step 2, Nov 21): five distinct ranks are scored from two 8,192-entry
 * tables built once from eval5Reference (flush / no flush, by rank mask); a paired hand is scored by its rank
 * multiset (product of rank primes) from a memo filled by eval5Reference. Same score as eval5Reference for every
 * one of the 2,598,960 five-card hands (exhaustive law test OmahaMathCoreEvalTable.law.test.ts).
 */
const RANK_PRIME = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41];
const POP5 = new Uint8Array(8192);
const UNIQUE5 = new Int32Array(8192);
const FLUSH5 = new Int32Array(8192);
const PAIRED = new Map<number, number>();
for (let m = 0; m < 8192; m++) {
  let p = 0;
  for (let x = m; x; x &= x - 1) p++;
  POP5[m] = p;
}
{
  // the reference scorer on representative cards: no flush = mixed suits, flush = one suit
  const ranks: number[] = [];
  for (let m = 0; m < 8192; m++) {
    if (POP5[m] !== 5) continue;
    ranks.length = 0;
    for (let r = 0; r < 13; r++) if (m & (1 << r)) ranks.push(r);
    UNIQUE5[m] = eval5Reference(
      ranks[0] * 4,
      ranks[1] * 4 + 1,
      ranks[2] * 4 + 2,
      ranks[3] * 4 + 3,
      ranks[4] * 4
    );
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
const PAIR_KEYS = new Int32Array(15);
const SUIT_COUNT = new Int8Array(4);
const SUITED_HOLE = new Int32Array(6);
const SUITED_BOARD = new Int32Array(5);

export function eval5(a: number, b: number, c: number, d: number, e: number): number {
  const ra = a >> 2,
    rb = b >> 2,
    rc = c >> 2,
    rd = d >> 2,
    re = e >> 2;
  const mask = (1 << ra) | (1 << rb) | (1 << rc) | (1 << rd) | (1 << re);
  if (POP5[mask] === 5) {
    const flush =
      (a & 3) === (b & 3) && (a & 3) === (c & 3) && (a & 3) === (d & 3) && (a & 3) === (e & 3);
    return flush ? FLUSH5[mask] : UNIQUE5[mask];
  }
  // a paired hand can never be a flush: the score depends on the rank multiset only
  const key = RANK_PRIME[ra] * RANK_PRIME[rb] * RANK_PRIME[rc] * RANK_PRIME[rd] * RANK_PRIME[re];
  let v = PAIRED.get(key);
  if (v === undefined) {
    v = eval5Reference(a, b, c, d, e);
    PAIRED.set(key, v);
  }
  return v;
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
