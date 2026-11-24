/**
 * THE JOINT SAMPLE OF A FACING-BET SPOT ON MEASURED RANGES (PLO4 / PLO5; PLO-OWNER lead-6 2026-11-24). Pure: no
 * telemetry, no opponent memory, no draw from the brain's random stream (the seed is the cards).
 *
 * The Horse's pot share at showdown against one holding of the bettor, drawn from his MEASURED strength histogram
 * (HorseOmahaMeasuredBettorRange), and one holding for every other player in the hand on the same disjoint cards:
 * each caller and each earlier all-in from the measured calling range, each player still to act present with his
 * measured continue rate. On the flop over two-card runouts (every unseen card the turn card of the same number of
 * runouts), on the turn over every river card, on the river once. It is the flop verdict's joint pricing
 * (HorseOmahaFlopFacingBetEv.omahaFlopEvCounts) with measured ranges in place of stated shares, extended to the turn
 * and the river (multiway item M1).
 *
 * NUT SHARE (multiway item M2, `nutShare`): a caller's holding inside its strength bin holds a flush draw at the
 * measured share of callers of that bin (two board cards of a suit, a card to come), not at the share random
 * holdings of that bin do; and the sample reports how often a hand that beats the bettor loses to a player of the
 * field holding a better hand of the SAME category (the reverse-implied cost of a non-nut hand multiway).
 *
 * Strength scale: a holding's rank among a card-seeded pool of holdings drawn uniformly from the unseen cards,
 * ranked on the current board (the scale of the measured tables: the share of holdings that beat it).
 */
import type { Card } from '../types.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import {
  OMAHA_MEASURED_BIN_EDGES,
  OMAHA_MEASURED_BINS,
  OMAHA_MEASURED_WEAK_EDGE,
  omahaMeasuredBinOf,
} from './HorseOmahaMeasuredBettorRange.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;
const WALK = 0.6180339887498949;

export const OMAHA_PRICED_JOINT_POOL = 1024;
/** Runouts per turn card on the flop (heads-up / with a field), bettor holdings per river card on the turn, on the river. */
export const OMAHA_PRICED_JOINT_FLOP_RIVERS: readonly [number, number] = [8, 5];
export const OMAHA_PRICED_JOINT_TURN_SETS = 8;
export const OMAHA_PRICED_JOINT_RIVER_SETS = 360;
export const OMAHA_PRICED_JOINT_FIELD_MAX = 5;
/** Score categories (HorseEval scores carry the category in units of 0x100000). */
const CATEGORY = 0x100000;

export interface OmahaPricedJointField {
  /** strength histograms of the players already in (callers, earlier all-ins) */
  always: ReadonlyArray<readonly number[]>;
  /** players still to act, the share of them that continues, and the range one who continues holds */
  behind: number;
  continueRate: number;
  behindHist: readonly number[] | null;
  /** M2: the measured flush-draw share of callers by strength bin (null: uniform inside the bin) */
  flushDrawByBin?: ReadonlyArray<number | null> | null;
}

export interface OmahaPricedJointRows {
  /** per runout: [value-side pot share sum, value-side count, weak-side sum, weak-side count] (the tree's row shape) */
  rows: Float64Array;
  turnOf: Int16Array;
  runouts: number;
  samples: number;
  /** the Horse's mean pot share against the value side and the weak side of the bettor's range, with the field */
  value: number;
  weak: number;
  /** the pot share's standard deviation per sample (for the sampling error) */
  sd: number;
  /** M2 measurement: of the samples where the Horse beat the bettor, the share lost to a same-category field hand */
  nutShareLoss: number;
  /** players behind who continue, on average */
  behindIn: number;
}

function stream(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(hole: Card[], board: Card[], dead: Card[], salt: number): number {
  let h = 0x811c9dc5 ^ (salt >>> 0);
  for (const g of [hole, board, dead]) {
    for (const k of g.map(key).sort())
      for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 124, 0x01000193);
  }
  return h >>> 0 || 1;
}

const isWeakBin = (b: number): boolean =>
  OMAHA_MEASURED_BIN_EDGES[b] >= OMAHA_MEASURED_WEAK_EDGE - 1e-12;

/**
 * The joint rows for one hand, or null when the cards do not form a four or five card Omaha hand on a flop, turn
 * or river, the histogram is empty, or the field is larger than OMAHA_PRICED_JOINT_FIELD_MAX.
 */
export function omahaPricedJointRows(
  hole: Card[],
  board: Card[],
  dead: Card[],
  bettorHist: readonly number[],
  field: OmahaPricedJointField,
  salt = 0
): OmahaPricedJointRows | null {
  if (!Array.isArray(hole) || (hole.length !== 4 && hole.length !== 5)) return null;
  if (!Array.isArray(board) || board.length < 3 || board.length > 5) return null;
  if (!Array.isArray(bettorHist) || bettorHist.length !== OMAHA_MEASURED_BINS) return null;
  const A = field.always.length;
  const B = Math.max(0, Math.floor(field.behind));
  if (A + B > OMAHA_PRICED_JOINT_FIELD_MAX) return null;
  const known = [...hole, ...board, ...(dead ?? [])];
  if (known.some((c) => !c || !RANKS.includes(c.rank as never) || !SUITS.includes(c.suit as never)))
    return null;
  if (new Set([...hole, ...board].map(key)).size !== hole.length + board.length) return null;
  const removed = new Set(known.map(key));
  const unseen: Card[] = [];
  for (const s of SUITS)
    for (const r of RANKS) {
      const c = { rank: r, suit: s } as Card;
      if (!removed.has(key(c))) unseen.push(c);
    }
  const m = unseen.length;
  const n = hole.length;
  if (m < n * (2 + A + B) + 2) return null;
  const rnd = stream(seedOf(hole, board, dead ?? [], salt));

  // The pool, ranked on the current board; strength = rank / P (0 strongest).
  const P = OMAHA_PRICED_JOINT_POOL;
  const cards = new Int8Array(P * n);
  const score = new Float64Array(P);
  const deck = new Int8Array(m);
  const tmp: Card[] = new Array<Card>(n);
  for (let p = 0; p < P; p++) {
    for (let i = 0; i < m; i++) deck[i] = i;
    for (let k = 0; k < n; k++) {
      const j = k + Math.floor(rnd() * (m - k));
      const t = deck[k];
      deck[k] = deck[j];
      deck[j] = t;
      cards[p * n + k] = deck[k];
      tmp[k] = unseen[deck[k]];
    }
    score[p] = scoreOmahaHiPartial(tmp, board);
  }
  const order = Array.from({ length: P }, (_, p) => p).sort((a, b) => score[b] - score[a] || a - b);
  // Ties share the rank of the strongest of them (the share of holdings that BEAT it).
  const binOfPool = new Int8Array(P);
  {
    let k = 0;
    while (k < P) {
      let e = k;
      while (e + 1 < P && score[order[e + 1]] === score[order[k]]) e++;
      const b = omahaMeasuredBinOf(k / P);
      for (let x = k; x <= e; x++) binOfPool[order[x]] = b;
      k = e + 1;
    }
  }
  // Flush-draw marks for M2: a suit two board cards share, with a card to come.
  const fdSuit =
    board.length < 5
      ? (SUITS.find((s) => board.filter((c) => c.suit === s).length === 2) ?? null)
      : null;
  const fd = new Uint8Array(P);
  if (fdSuit) {
    for (let p = 0; p < P; p++) {
      let k = 0;
      for (let i = 0; i < n; i++) if (unseen[cards[p * n + i]].suit === fdSuit) k++;
      fd[p] = k >= 2 ? 1 : 0;
    }
  }
  const members: number[][] = Array.from({ length: OMAHA_MEASURED_BINS }, () => []);
  const membersFd: number[][] = Array.from({ length: OMAHA_MEASURED_BINS }, () => []);
  const membersNo: number[][] = Array.from({ length: OMAHA_MEASURED_BINS }, () => []);
  for (const p of order) {
    members[binOfPool[p]].push(p);
    (fd[p] ? membersFd : membersNo)[binOfPool[p]].push(p);
  }
  // A histogram restricted to bins that have members, as cumulative weights.
  const cumOf = (h: readonly number[], pick: (b: number) => boolean): Float64Array | null => {
    const c = new Float64Array(OMAHA_MEASURED_BINS);
    let s = 0;
    for (let b = 0; b < OMAHA_MEASURED_BINS; b++) {
      if (pick(b) && members[b].length > 0 && h[b] > 0) s += h[b];
      c[b] = s;
    }
    if (!(s > 0)) return null;
    for (let b = 0; b < OMAHA_MEASURED_BINS; b++) c[b] /= s;
    return c;
  };
  const binAt = (cum: Float64Array, u: number): number => {
    for (let b = 0; b < OMAHA_MEASURED_BINS; b++) if (u < cum[b]) return b;
    return OMAHA_MEASURED_BINS - 1;
  };
  const cumValue = cumOf(bettorHist, (b) => !isWeakBin(b));
  const cumWeak = cumOf(bettorHist, (b) => isWeakBin(b));
  const cumAll = cumOf(bettorHist, () => true);
  if (!cumAll) return null;
  const others = A + B;
  const fieldCum: Float64Array[] = [];
  for (let f = 0; f < others; f++) {
    const h = f < A ? field.always[f] : field.behindHist;
    const c = h && h.length === OMAHA_MEASURED_BINS ? cumOf(h, () => true) : null;
    fieldCum.push(c ?? (cumOf(new Array(OMAHA_MEASURED_BINS).fill(1), () => true) as Float64Array));
  }
  const cont = Math.max(
    0,
    Math.min(1, Number.isFinite(field.continueRate) ? field.continueRate : 0)
  );
  const fdShare = field.flushDrawByBin && fdSuit ? field.flushDrawByBin : null;

  const used = new Uint8Array(m);
  const walks = Array.from({ length: 2 * (others + 2) + 2 }, () => rnd());
  const step = (w: number): number => {
    walks[w] = (walks[w] + WALK) % 1;
    return walks[w];
  };
  const free = (p: number): boolean => {
    for (let k = 0; k < n; k++) if (used[cards[p * n + k]]) return false;
    return true;
  };
  const mark = (p: number, v: number): void => {
    for (let k = 0; k < n; k++) used[cards[p * n + k]] = v;
  };
  const drawFrom = (list: number[], u: number): number => {
    const L = list.length;
    if (L === 0) return -1;
    const i = Math.floor(u * L);
    for (let t = 0; t < Math.min(L, 256); t++) {
      const p = list[(i + t) % L];
      if (free(p)) return p;
    }
    return -1;
  };
  const scoreOf = (p: number, full: Card[]): number => {
    for (let k = 0; k < n; k++) tmp[k] = unseen[cards[p * n + k]];
    return scoreOmahaHiPartial(tmp, full);
  };

  // Runouts.
  const idx: Array<[number, number]> = [];
  if (board.length === 3) {
    const circle = Array.from({ length: m }, (_, i) => i);
    for (let i = m - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [circle[i], circle[j]] = [circle[j], circle[i]];
    }
    const half = Math.floor((m - 1) / 2);
    const R = Math.min(OMAHA_PRICED_JOINT_FLOP_RIVERS[others > 0 ? 1 : 0], half);
    const start = rnd();
    for (let t = 0; t < m; t++)
      for (let k = 0; k < R; k++)
        idx.push([circle[t], circle[(t + 1 + (Math.floor(((k + start) * half) / R) % half)) % m]]);
  } else if (board.length === 4) for (let r = 0; r < m; r++) idx.push([r, -1]);
  else idx.push([-1, -1]);
  const sets =
    board.length === 3
      ? 3
      : board.length === 4
        ? OMAHA_PRICED_JOINT_TURN_SETS
        : OMAHA_PRICED_JOINT_RIVER_SETS;

  const rows = new Float64Array(idx.length * 4);
  const turnOf = new Int16Array(idx.length);
  const fieldScore = new Float64Array(others);
  const fieldIn = new Uint8Array(others);
  const picked = new Int32Array(others + 1);
  let sum = 0;
  let sum2 = 0;
  let samples = 0;
  let beatBettor = 0;
  let lostSameClass = 0;
  let behindIn = 0;
  let sumV = 0;
  let nV = 0;
  let sumW = 0;
  let nW = 0;
  const full: Card[] = [...board];
  for (let r = 0; r < idx.length; r++) {
    const [c1, c2] = idx[r];
    full.length = board.length;
    if (c1 >= 0) {
      full.push(unseen[c1]);
      used[c1] = 1;
    }
    if (c2 >= 0) {
      full.push(unseen[c2]);
      used[c2] = 1;
    }
    const hero = scoreOmahaHiPartial(hole, full);
    let vw = 0;
    let vn = 0;
    let ow = 0;
    let on = 0;
    for (let s = 0; s < sets; s++) {
      // The flop's tree needs both sides on every runout: two value draws and one weak draw; elsewhere the mixture.
      const side: 'value' | 'weak' | 'all' =
        board.length === 3
          ? s < 2
            ? cumValue
              ? 'value'
              : 'weak'
            : cumWeak
              ? 'weak'
              : 'value'
          : 'all';
      const cum =
        side === 'value' ? (cumValue ?? cumAll) : side === 'weak' ? (cumWeak ?? cumAll) : cumAll;
      const b = binAt(cum, step(0));
      const p = drawFrom(members[b], step(1));
      if (p < 0) continue;
      mark(p, 1);
      picked[0] = p;
      let whole = true;
      let k = 0;
      for (; k < others; k++) {
        const fb = binAt(fieldCum[k], step(2 + 2 * k));
        const u = step(3 + 2 * k);
        let g = -1;
        if (fdShare) {
          const t = fdShare[fb];
          if (t !== null && t !== undefined && Number.isFinite(t)) {
            const wantFd = (u * 7.123) % 1 < t;
            g = drawFrom(wantFd ? membersFd[fb] : membersNo[fb], u);
          }
        }
        if (g < 0) g = drawFrom(members[fb], u);
        if (g < 0) {
          whole = false;
          break;
        }
        mark(g, 1);
        picked[k + 1] = g;
        fieldScore[k] = scoreOf(g, full);
        fieldIn[k] = k < A ? 1 : step(2 * (others + 2) + (k % 2)) < cont ? 1 : 0;
      }
      for (let u = 1; u <= k; u++) mark(picked[u], 0);
      mark(p, 0);
      if (!whole) continue;
      const bettor = scoreOf(p, full);
      let best = bettor;
      let tied = hero === bettor ? 1 : 0;
      let bestField = -1;
      for (let f = 0; f < others; f++) {
        if (!fieldIn[f]) continue;
        if (f >= A) behindIn++;
        if (fieldScore[f] > bestField) bestField = fieldScore[f];
        if (fieldScore[f] > best) best = fieldScore[f];
        if (fieldScore[f] === hero) tied++;
      }
      const share = hero > best ? 1 : hero === best ? 1 / (1 + tied) : 0;
      if (hero > bettor) {
        beatBettor++;
        if (bestField > hero && Math.floor(bestField / CATEGORY) === Math.floor(hero / CATEGORY))
          lostSameClass++;
      }
      const weakSide = side === 'weak' || (side === 'all' && isWeakBin(b));
      if (weakSide) {
        ow += share;
        on++;
        sumW += share;
        nW++;
      } else {
        vw += share;
        vn++;
        sumV += share;
        nV++;
      }
      sum += share;
      sum2 += share * share;
      samples++;
    }
    if (c1 >= 0) used[c1] = 0;
    if (c2 >= 0) used[c2] = 0;
    rows[r * 4] = vw;
    rows[r * 4 + 1] = vn;
    rows[r * 4 + 2] = ow;
    rows[r * 4 + 3] = on;
    turnOf[r] = c1;
  }
  if (!(samples > 0)) return null;
  const mean = sum / samples;
  return {
    rows,
    turnOf,
    runouts: idx.length,
    samples,
    value: nV > 0 ? sumV / nV : mean,
    weak: nW > 0 ? sumW / nW : mean,
    sd: Math.sqrt(Math.max(0, sum2 / samples - mean * mean)),
    nutShareLoss: beatBettor > 0 ? lostSameClass / beatBettor : 0,
    behindIn: B > 0 ? behindIn / samples : 0,
  };
}
