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
import {
  OMAHA_FAST_PAIR_STRIDE,
  OMAHA_FAST_TRIPLE_STRIDE,
  omahaFastBestPre,
  omahaFastPairsInto,
  omahaFastRankOnly,
  omahaFastTriplesPre,
} from './HorseOmahaFastScore.js';
import {
  OMAHA_MEASURED_BIN_EDGES,
  OMAHA_MEASURED_BINS,
  OMAHA_MEASURED_WEAK_EDGE,
  omahaMeasuredBinOf,
} from './HorseOmahaMeasuredBettorRange.js';

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const key = (c: Card): string => `${c.rank}:${c.suit}`;
/**
 * The sample's quasi-random dimensions: one additive walk per dimension, each with its own step (the fractional part
 * of the square root of a distinct prime, so the walks are jointly equidistributed). One shared step made every
 * dimension a fixed shift of the first: the field's bin, the player-behind's continue draw and the holding picked
 * inside a bin were functions of the bettor's bin draw (found 2026-11-24: a player behind was in exactly when the
 * bettor was drawn weak, and a bin's holdings were picked from one slice of the bin).
 */
const WALK_PRIMES = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79,
];
const WALK_STEPS: readonly number[] = WALK_PRIMES.map((p) => Math.sqrt(p) % 1);

export const OMAHA_PRICED_JOINT_POOL = 1024;
/** Runouts per turn card on the flop (heads-up / with a field), bettor holdings per river card on the turn, on the river. */
export const OMAHA_PRICED_JOINT_FLOP_RIVERS: readonly [number, number] = [8, 5];
export const OMAHA_PRICED_JOINT_TURN_SETS = 8;
export const OMAHA_PRICED_JOINT_RIVER_SETS = 360;
export const OMAHA_PRICED_JOINT_FIELD_MAX = 5;

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

/** The sample's random stream (mulberry32) with its state in the open, so a hand's pool can be kept and resumed. */
function streamNext(st: { a: number }): number {
  st.a = (st.a + 0x6d2b79f5) >>> 0;
  let t = st.a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
 * THE HAND'S POOL, KEPT BY CARD IDS (lead-7 2026-11-26, speed; anOmahaPricedJointRowsIsUnchanged proves the numbers
 * are the ones the sample gave before). Everything that depends only on the cards (hole, board, dead, salt) is built
 * once and kept for the next call on the same cards: the priced multiway value bet (M3) asks for up to thirteen
 * samples of one hand per decision, each of which rebuilt and re-scored the same 1,024 holdings. Cards are integers
 * (a deck id for the unseen list, HorseOmahaFastScore's integer for scoring); a holding's score on a board is the
 * largest entry, over its two-card pairs, of a table keyed by the pair's two ranks (every five cards scored as if
 * unsuited; one table per set of board ranks, shared by every runout and every call), raised by its best hand over
 * the board triples of the one suit with three or more board cards, from its pairs of that suit. On the river a
 * holding's score is its pool score. The scores are HorseOmahaFastScore's, which order hands as HorseEval does
 * (equal hands equal); the sample only compares scores on one board and reads the hand category, so every draw, every
 * comparison and every sum is the one made before.
 */
interface JointPool {
  hole: Int8Array;
  board: Int8Array;
  dead: Int8Array;
  salt: number;
  m: number;
  n: number;
  np: number;
  /** unseen cards in deck order: the fast integer and the suit of each */
  unseenInt: Int32Array;
  unseenSuit: Int8Array;
  boardInt: number[];
  boardSuits: Int8Array;
  cards: Int8Array;
  pairs: Int32Array;
  pairKey: Uint8Array;
  suitCount: Uint8Array;
  score: Int32Array;
  heroPairs: Int32Array;
  heroPairKey: Uint8Array;
  heroSuitCount: Uint8Array;
  fdSuit: number;
  members: number[][];
  membersFd: number[][];
  membersNo: number[][];
  /** the random stream's state after the pool was drawn */
  streamAfter: number;
  /** rank-pair tables by the ranks of the cards added to the board (index 0: none added) */
  tables: Array<Int32Array | undefined>;
}

let lastPool: JointPool | null = null;

const RANK_ID = new Map<unknown, number>(RANKS.map((r, i) => [r, i]));
const SUIT_ID = new Map<unknown, number>(SUITS.map((s, i) => [s, i]));
/** The deck id of a card (suit * 13 + rank, the order of the unseen list), or -1 when it is not a card. */
function deckId(c: Card): number {
  if (!c) return -1;
  const r = RANK_ID.get(c.rank);
  const s = SUIT_ID.get(c.suit);
  return r === undefined || s === undefined ? -1 : s * 13 + r;
}
const fastOf = (id: number): number => ((id % 13) + 2) * 4 + Math.floor(id / 13);

function sameIds(a: Int8Array, b: Int8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const PAIR_KEY = 16;
const rankPairScratch = new Int32Array([0, 0, -1]);
/** The rank-pair table of a board: for every pair of hole ranks, its best hand with every five cards unsuited. */
function rankPairTable(boardInts: readonly number[]): Int32Array {
  const triples = omahaFastRankOnly(omahaFastTriplesPre(boardInts));
  const t = new Int32Array(15 * PAIR_KEY);
  for (let hi = 2; hi <= 14; hi++)
    for (let lo = 2; lo <= hi; lo++) {
      rankPairScratch[0] = hi;
      rankPairScratch[1] = lo;
      t[hi * PAIR_KEY + lo] = omahaFastBestPre(rankPairScratch, 0, 1, triples);
    }
  return t;
}

/** The precomputed triples of the cards of one suit (their ranks), by how many there are (3, 4 or 5). */
const MONO_BUF: readonly Int32Array[] = [
  new Int32Array(0),
  new Int32Array(0),
  new Int32Array(0),
  new Int32Array(1 * OMAHA_FAST_TRIPLE_STRIDE),
  new Int32Array(4 * OMAHA_FAST_TRIPLE_STRIDE),
  new Int32Array(10 * OMAHA_FAST_TRIPLE_STRIDE),
];
const monoRanks = new Int32Array(5);
/** Fills the buffer for `count` ranks of suit `suit` held in monoRanks; returns it. */
function monoTriples(count: number, suit: number): Int32Array {
  // descending ranks
  for (let i = 1; i < count; i++) {
    const v = monoRanks[i];
    let j = i - 1;
    while (j >= 0 && monoRanks[j] < v) {
      monoRanks[j + 1] = monoRanks[j];
      j--;
    }
    monoRanks[j + 1] = v;
  }
  const out = MONO_BUF[count];
  let w = 0;
  for (let x = 0; x < count; x++)
    for (let y = x + 1; y < count; y++)
      for (let z = y + 1; z < count; z++) {
        out[w] = monoRanks[x];
        out[w + 1] = monoRanks[y];
        out[w + 2] = monoRanks[z];
        out[w + 3] = suit;
        w += OMAHA_FAST_TRIPLE_STRIDE;
      }
  return out;
}

/** The hand category HorseEval's score carries (it sets a royal flush apart from a straight flush). */
export function omahaPricedJointCategory(fastScore: number): number {
  const c = fastScore >> 20;
  return c === 8 && ((fastScore >> 16) & 15) === 14 ? 9 : c;
}

function buildPool(
  hole: Card[],
  board: Card[],
  dead: Card[],
  holeIds: Int8Array,
  boardIds: Int8Array,
  deadIds: Int8Array,
  removed: Uint8Array,
  m: number,
  salt: number
): JointPool {
  const n = hole.length;
  const np = (n * (n - 1)) / 2;
  const unseenInt = new Int32Array(m);
  const unseenSuit = new Int8Array(m);
  for (let id = 0, w = 0; id < 52; id++)
    if (!removed[id]) {
      unseenInt[w] = fastOf(id);
      unseenSuit[w] = Math.floor(id / 13);
      w++;
    }
  const st = { a: seedOf(hole, board, dead, salt) >>> 0 || 1 };
  const boardInt = Array.from(boardIds, fastOf);
  const boardSuits = new Int8Array(4);
  for (let i = 0; i < boardIds.length; i++) boardSuits[Math.floor(boardIds[i] / 13)]++;

  const P = OMAHA_PRICED_JOINT_POOL;
  const cards = new Int8Array(P * n);
  const ints = new Int32Array(n);
  const pairs = new Int32Array(P * np * OMAHA_FAST_PAIR_STRIDE);
  const pairKey = new Uint8Array(P * np);
  const suitCount = new Uint8Array(P * 4);
  const deck = new Int8Array(m);
  for (let p = 0; p < P; p++) {
    for (let i = 0; i < m; i++) deck[i] = i;
    for (let k = 0; k < n; k++) {
      const j = k + Math.floor(streamNext(st) * (m - k));
      const t = deck[k];
      deck[k] = deck[j];
      deck[j] = t;
      cards[p * n + k] = deck[k];
      ints[k] = unseenInt[deck[k]];
      suitCount[p * 4 + unseenSuit[deck[k]]]++;
    }
    const w0 = p * np * OMAHA_FAST_PAIR_STRIDE;
    omahaFastPairsInto(ints, 0, n, pairs, w0);
    for (let i = 0; i < np; i++)
      pairKey[p * np + i] =
        pairs[w0 + i * OMAHA_FAST_PAIR_STRIDE] * PAIR_KEY +
        pairs[w0 + i * OMAHA_FAST_PAIR_STRIDE + 1];
  }
  const heroInts = Int32Array.from(holeIds, fastOf);
  const heroPairs = new Int32Array(np * OMAHA_FAST_PAIR_STRIDE);
  omahaFastPairsInto(heroInts, 0, n, heroPairs, 0);
  const heroPairKey = new Uint8Array(np);
  for (let i = 0; i < np; i++)
    heroPairKey[i] =
      heroPairs[i * OMAHA_FAST_PAIR_STRIDE] * PAIR_KEY + heroPairs[i * OMAHA_FAST_PAIR_STRIDE + 1];
  const heroSuitCount = new Uint8Array(4);
  for (let i = 0; i < n; i++) heroSuitCount[Math.floor(holeIds[i] / 13)]++;

  // The pool ranked on the current board; strength = rank / P (0 strongest).
  const base = rankPairTable(boardInt);
  let monoSuit = -1;
  let mono = MONO_BUF[0];
  for (let s = 0; s < 4; s++)
    if (boardSuits[s] >= 3) {
      let c = 0;
      for (let i = 0; i < boardIds.length; i++)
        if (Math.floor(boardIds[i] / 13) === s) monoRanks[c++] = (boardIds[i] % 13) + 2;
      monoSuit = s;
      mono = monoTriples(c, s);
    }
  const score = new Int32Array(P);
  for (let p = 0; p < P; p++) {
    let v = 0;
    for (let i = p * np, e = i + np; i < e; i++) {
      const t = base[pairKey[i]];
      if (t > v) v = t;
    }
    if (monoSuit >= 0 && suitCount[p * 4 + monoSuit] >= 2)
      for (let i = 0, w = p * np * OMAHA_FAST_PAIR_STRIDE; i < np; i++, w += OMAHA_FAST_PAIR_STRIDE)
        if (pairs[w + 2] === monoSuit) v = omahaFastBestPre(pairs, w, 1, mono, v);
    score[p] = v;
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
  let fdSuit = -1;
  if (boardIds.length < 5)
    for (let s = 0; s < 4 && fdSuit < 0; s++) if (boardSuits[s] === 2) fdSuit = s;
  const members: number[][] = Array.from({ length: OMAHA_MEASURED_BINS }, () => []);
  const membersFd: number[][] = Array.from({ length: OMAHA_MEASURED_BINS }, () => []);
  const membersNo: number[][] = Array.from({ length: OMAHA_MEASURED_BINS }, () => []);
  for (const p of order) {
    members[binOfPool[p]].push(p);
    (fdSuit >= 0 && suitCount[p * 4 + fdSuit] >= 2 ? membersFd : membersNo)[binOfPool[p]].push(p);
  }
  const tables: Array<Int32Array | undefined> = [];
  tables[0] = base;
  return {
    hole: holeIds,
    board: boardIds,
    dead: deadIds,
    salt,
    m,
    n,
    np,
    unseenInt,
    unseenSuit,
    boardInt,
    boardSuits,
    cards,
    pairs,
    pairKey,
    suitCount,
    score,
    heroPairs,
    heroPairKey,
    heroSuitCount,
    fdSuit,
    members,
    membersFd,
    membersNo,
    streamAfter: st.a,
    tables,
  };
}

const removedScratch = new Uint8Array(52);

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
  const deadCards = dead ?? [];
  const n = hole.length;
  const nb = board.length;
  const holeIds = new Int8Array(n);
  const boardIds = new Int8Array(nb);
  const deadIds = new Int8Array(deadCards.length);
  for (let i = 0; i < n; i++) if ((holeIds[i] = deckId(hole[i])) < 0) return null;
  for (let i = 0; i < nb; i++) if ((boardIds[i] = deckId(board[i])) < 0) return null;
  for (let i = 0; i < deadCards.length; i++)
    if ((deadIds[i] = deckId(deadCards[i])) < 0) return null;
  removedScratch.fill(0);
  let m = 52;
  for (let i = 0; i < n; i++) {
    if (removedScratch[holeIds[i]]) return null;
    removedScratch[holeIds[i]] = 1;
    m--;
  }
  for (let i = 0; i < nb; i++) {
    if (removedScratch[boardIds[i]]) return null;
    removedScratch[boardIds[i]] = 1;
    m--;
  }
  for (let i = 0; i < deadIds.length; i++)
    if (!removedScratch[deadIds[i]]) {
      removedScratch[deadIds[i]] = 1;
      m--;
    }
  if (m < n * (2 + A + B) + 2) return null;
  let pool = lastPool;
  if (
    !pool ||
    pool.salt !== salt ||
    !sameIds(pool.hole, holeIds) ||
    !sameIds(pool.board, boardIds) ||
    !sameIds(pool.dead, deadIds)
  ) {
    pool = buildPool(hole, board, deadCards, holeIds, boardIds, deadIds, removedScratch, m, salt);
    lastPool = pool;
  }
  const { np, cards, pairs, pairKey, suitCount, members, membersFd, membersNo } = pool;
  const st = { a: pool.streamAfter };
  const rnd = (): number => streamNext(st);

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
  const fdShare = field.flushDrawByBin && pool.fdSuit >= 0 ? field.flushDrawByBin : null;

  const used = new Uint8Array(m);
  const walks = Array.from({ length: 2 + 4 * others }, () => rnd());
  const step = (w: number): number => {
    walks[w] = (walks[w] + WALK_STEPS[w]) % 1;
    return walks[w];
  };
  const free = (p: number): boolean => {
    for (let k = p * n, e = k + n; k < e; k++) if (used[cards[k]]) return false;
    return true;
  };
  const mark = (p: number, v: number): void => {
    for (let k = p * n, e = k + n; k < e; k++) used[cards[k]] = v;
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

  // Runouts (indices into the unseen list; -1: no card).
  let runouts: number;
  let run1: Int16Array;
  let run2: Int16Array;
  if (nb === 3) {
    const circle = Array.from({ length: m }, (_, i) => i);
    for (let i = m - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [circle[i], circle[j]] = [circle[j], circle[i]];
    }
    const half = Math.floor((m - 1) / 2);
    const R = Math.min(OMAHA_PRICED_JOINT_FLOP_RIVERS[others > 0 ? 1 : 0], half);
    const start = rnd();
    runouts = m * R;
    run1 = new Int16Array(runouts);
    run2 = new Int16Array(runouts);
    let w = 0;
    for (let t = 0; t < m; t++)
      for (let k = 0; k < R; k++) {
        run1[w] = circle[t];
        run2[w] = circle[(t + 1 + (Math.floor(((k + start) * half) / R) % half)) % m];
        w++;
      }
  } else if (nb === 4) {
    runouts = m;
    run1 = new Int16Array(m);
    run2 = new Int16Array(m).fill(-1);
    for (let r = 0; r < m; r++) run1[r] = r;
  } else {
    runouts = 1;
    run1 = new Int16Array(1).fill(-1);
    run2 = new Int16Array(1).fill(-1);
  }
  const sets =
    nb === 3 ? 3 : nb === 4 ? OMAHA_PRICED_JOINT_TURN_SETS : OMAHA_PRICED_JOINT_RIVER_SETS;

  // The board of a runout: its rank-pair table and the triples of its one suit of three or more cards.
  const { unseenInt, unseenSuit, boardInt, boardSuits, tables, heroPairs, heroPairKey } = pool;
  const suits = new Int8Array(4);
  let table = tables[0] as Int32Array;
  let monoSuit = -1;
  let mono = MONO_BUF[0];
  const setBoard = (c1: number, c2: number): void => {
    const r1 = c1 >= 0 ? unseenInt[c1] >> 2 : 0;
    const r2 = c2 >= 0 ? unseenInt[c2] >> 2 : 0;
    const tk = r1 >= r2 ? r1 * PAIR_KEY + r2 : r2 * PAIR_KEY + r1;
    let t = tables[tk];
    if (!t) {
      const ints = boardInt.slice();
      if (c1 >= 0) ints.push(unseenInt[c1]);
      if (c2 >= 0) ints.push(unseenInt[c2]);
      t = rankPairTable(ints);
      tables[tk] = t;
    }
    table = t;
    suits[0] = boardSuits[0];
    suits[1] = boardSuits[1];
    suits[2] = boardSuits[2];
    suits[3] = boardSuits[3];
    if (c1 >= 0) suits[unseenSuit[c1]]++;
    if (c2 >= 0) suits[unseenSuit[c2]]++;
    monoSuit = -1;
    for (let s = 0; s < 4; s++)
      if (suits[s] >= 3) {
        let c = 0;
        for (let i = 0; i < nb; i++) if ((boardInt[i] & 3) === s) monoRanks[c++] = boardInt[i] >> 2;
        if (c1 >= 0 && unseenSuit[c1] === s) monoRanks[c++] = unseenInt[c1] >> 2;
        if (c2 >= 0 && unseenSuit[c2] === s) monoRanks[c++] = unseenInt[c2] >> 2;
        monoSuit = s;
        mono = monoTriples(c, s);
      }
  };
  const scoreOf = (p: number): number => {
    let v = 0;
    for (let i = p * np, e = i + np; i < e; i++) {
      const t = table[pairKey[i]];
      if (t > v) v = t;
    }
    if (monoSuit >= 0 && suitCount[p * 4 + monoSuit] >= 2)
      for (let i = 0, w = p * np * OMAHA_FAST_PAIR_STRIDE; i < np; i++, w += OMAHA_FAST_PAIR_STRIDE)
        if (pairs[w + 2] === monoSuit) v = omahaFastBestPre(pairs, w, 1, mono, v);
    return v;
  };
  const heroScore = (): number => {
    let v = 0;
    for (let i = 0; i < np; i++) {
      const t = table[heroPairKey[i]];
      if (t > v) v = t;
    }
    if (monoSuit >= 0 && pool.heroSuitCount[monoSuit] >= 2)
      for (let i = 0, w = 0; i < np; i++, w += OMAHA_FAST_PAIR_STRIDE)
        if (heroPairs[w + 2] === monoSuit) v = omahaFastBestPre(heroPairs, w, 1, mono, v);
    return v;
  };

  const rows = new Float64Array(runouts * 4);
  const turnOf = new Int16Array(runouts);
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
  for (let r = 0; r < runouts; r++) {
    const c1 = run1[r];
    const c2 = run2[r];
    if (c1 >= 0) used[c1] = 1;
    if (c2 >= 0) used[c2] = 1;
    setBoard(c1, c2);
    const hero = heroScore();
    let vw = 0;
    let vn = 0;
    let ow = 0;
    let on = 0;
    for (let s = 0; s < sets; s++) {
      // The flop's tree needs both sides on every runout: two value draws and one weak draw; elsewhere the mixture.
      const side: 'value' | 'weak' | 'all' =
        nb === 3 ? (s < 2 ? (cumValue ? 'value' : 'weak') : cumWeak ? 'weak' : 'value') : 'all';
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
        const fb = binAt(fieldCum[k], step(2 + 4 * k));
        const u = step(3 + 4 * k);
        let g = -1;
        if (fdShare) {
          const t = fdShare[fb];
          if (t !== null && t !== undefined && Number.isFinite(t)) {
            const wantFd = step(4 + 4 * k) < t;
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
        fieldScore[k] = scoreOf(g);
        fieldIn[k] = k < A ? 1 : step(5 + 4 * k) < cont ? 1 : 0;
      }
      for (let u = 1; u <= k; u++) mark(picked[u], 0);
      mark(p, 0);
      if (!whole) continue;
      const bettor = scoreOf(p);
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
        if (
          bestField > hero &&
          omahaPricedJointCategory(bestField) === omahaPricedJointCategory(hero)
        )
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
    runouts,
    samples,
    value: nV > 0 ? sumV / nV : mean,
    weak: nW > 0 ? sumW / nW : mean,
    sd: Math.sqrt(Math.max(0, sum2 / samples - mean * mean)),
    nutShareLoss: beatBettor > 0 ? lostSameClass / beatBettor : 0,
    behindIn: B > 0 ? behindIn / samples : 0,
  };
}
