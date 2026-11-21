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

export function eval5(a: number, b: number, c: number, d: number, e: number): number {
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
