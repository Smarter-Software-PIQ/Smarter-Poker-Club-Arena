/**
 * THE SIX-CARD VALUE REGION AT THE SAME HAND STRENGTH (2026-11-19, HORSE
 * DECISIONS lane; used only by plo6FacingBetIsPriced, HorsePlo6FacingBetIsPriced.ts).
 *
 * The Omaha facing-bet models give the bettor's value region as a SHARE of
 * all opponent holdings (the strongest V of them on the board: the value
 * shares of HorseOmahaFacingBetEv and HorseOmahaFlopFacingBetEv). Those
 * shares were set and measured on four- and five-card holdings. Six-card
 * holdings are far stronger on the same board, so the strongest V of SIX-card
 * holdings is a much higher hand-strength bar than the bar the share was
 * measured at: on a paired or trips board the top share of six-card holdings
 * is all quads, and a full house the bettor would value-bet with is outside
 * his modelled range.
 *
 * A bettor's value bar is a hand strength on this board, not a frequency of
 * his holdings. So the six-card value region is taken at the SAME strength:
 * the strength at the top V of four-card holdings on this board (the Horse's
 * own cards, the board and known dead cards removed), and the share of
 * six-card holdings at least that strong. Holdings are drawn from the unseen
 * cards with a fixed seed taken from the cards (the brain's random stream is
 * not touched); a holding is worth its best two-card score on the board (the
 * engine's evaluator, exactly two hole cards and three board cards). The
 * translation never narrows the region (it is at least V).
 *
 * Pure: the only state is a memo of the last few answers.
 */
import type { Card } from '../types.js';
import { scoreOmahaHiPartial } from './HorseEval.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;

/** Holdings drawn per hole count (the sampling error of a share is about 0.7 points). */
export const PLO6_VALUE_SHARE_SAMPLES = 4000;
/** The hole count the value shares were set on (the four-card game). */
export const PLO6_VALUE_SHARE_REFERENCE_HOLE = 4;

function seedOf(hole: Card[], board: Card[], dead: Card[]): number {
  let h = 0x811c9dc5;
  for (const group of [hole, board, dead]) {
    for (const k of group.map(key).sort())
      for (let i = 0; i < k.length; i++) {
        h ^= k.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
    h ^= 0x7c;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0 || 1;
}

function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Strengths {
  id: string;
  four: Float64Array; // sorted, strongest first
  six: Float64Array; // sorted, strongest first
}
const MEMO: Strengths[] = [];
const MEMO_MAX = 6;

/** Test seam: forget the remembered boards. */
export function plo6ValueShareResetCache(): void {
  MEMO.length = 0;
}

function strengthsOf(hole: Card[], board: Card[], dead: Card[]): Strengths | null {
  const id = `${hole.map(key).sort().join(',')}|${board.map(key).sort().join(',')}|${dead
    .map(key)
    .sort()
    .join(',')}`;
  const hit = MEMO.find((m) => m.id === id);
  if (hit) return hit;
  const removed = new Set([...hole, ...board, ...dead].map(key));
  const unseen: Card[] = [];
  for (const suit of SUITS)
    for (const rank of RANKS) {
      const card = { rank, suit } as Card;
      if (!removed.has(key(card))) unseen.push(card);
    }
  const m = unseen.length;
  if (m < 12) return null;
  const scores = new Float64Array(m * m);
  const two: Card[] = [unseen[0], unseen[0]];
  for (let i = 0; i < m; i++) {
    two[0] = unseen[i];
    for (let j = i + 1; j < m; j++) {
      two[1] = unseen[j];
      const s = scoreOmahaHiPartial(two, board);
      scores[i * m + j] = s;
      scores[j * m + i] = s;
    }
  }
  const rnd = stream(seedOf(hole, board, dead));
  const deck = new Int16Array(m);
  const draw = (n: number): Float64Array => {
    const out = new Float64Array(PLO6_VALUE_SHARE_SAMPLES);
    for (let i = 0; i < m; i++) deck[i] = i;
    for (let p = 0; p < PLO6_VALUE_SHARE_SAMPLES; p++) {
      for (let k = 0; k < n; k++) {
        const j = k + Math.floor(rnd() * (m - k));
        const t = deck[k];
        deck[k] = deck[j];
        deck[j] = t;
      }
      let best = 0;
      for (let a = 0; a < n; a++)
        for (let b = a + 1; b < n; b++) {
          const s = scores[deck[a] * m + deck[b]];
          if (s > best) best = s;
        }
      out[p] = best;
    }
    out.sort();
    out.reverse();
    return out;
  };
  const entry: Strengths = { id, four: draw(PLO6_VALUE_SHARE_REFERENCE_HOLE), six: draw(6) };
  MEMO.unshift(entry);
  if (MEMO.length > MEMO_MAX) MEMO.length = MEMO_MAX;
  return entry;
}

/**
 * The share of six-card holdings at least as strong as the strongest `share`
 * of four-card holdings on this board, never below `share` (and at most 0.95).
 * `share` itself when the cards cannot be read.
 */
export function plo6ValueShareAtSameStrength(
  hole: Card[],
  board: Card[],
  dead: Card[],
  share: number
): number {
  const want = Math.max(0.001, Math.min(0.95, Number.isFinite(share) ? share : 0.5));
  try {
    if (!Array.isArray(hole) || hole.length !== 6 || !Array.isArray(board)) return want;
    if (board.length < 3 || board.length > 5) return want;
    const st = strengthsOf(hole, board, Array.isArray(dead) ? dead : []);
    if (!st) return want;
    const n = st.four.length;
    const bar = st.four[Math.max(0, Math.min(n - 1, Math.ceil(want * n) - 1))];
    if (!(bar > 0)) return want;
    // six is sorted strongest first: count holdings at or above the bar.
    let lo = 0;
    let hi = st.six.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (st.six[mid] >= bar) lo = mid + 1;
      else hi = mid;
    }
    return Math.max(want, Math.min(0.95, lo / st.six.length));
  } catch {
    return want;
  }
}
