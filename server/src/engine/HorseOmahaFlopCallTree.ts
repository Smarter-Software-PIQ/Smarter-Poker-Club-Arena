/**
 * THE PLO4 / PLO5 CASH FLOP CALL PRICED AS A TWO-STREET TREE ON MEASURED RANGES (option
 * omahaFlopRealizationIsPriced, default OFF, read `=== true`; PLO-OWNER lead-6 2026-11-24, design
 * plo-overfold/PLO-OVERFOLD-ROOT-CAUSE.md section 4 F3).
 *
 * WHY. The flop verdict (omahaFlopFacingBetEv) multiplies the call's showdown share by a realization factor with
 * median 0.42: a runout model times a multiplier fitted on what Horse flop calls returned under the Horses' own
 * later-street play, which folds the turn and river far above the price. The factor is circular: over-folding later
 * streets lowers measured flop realization, which drives more flop folds (73 of 80 sampled verdict folds had a
 * showdown share above the price). This file is its replacement; omahaFlopFacingBetEv may be off or on.
 *
 * WHAT. Facing a flop bet or raise, EV(call) is a two-street tree on this file's own sampled runouts:
 *  - his flop holding is drawn from his MEASURED flop strength histogram for the line (the preflop raiser's c-bet
 *    or another first wager, or a raise), size and pot type, his own shown record shrunk toward it where he has one,
 *    else the table moved by today's public read factor and, with omahaFacingBetMinimumDefencePrior on, the F6 bound;
 *  - every other player in the hand is dealt on the same runouts (callers and earlier all-ins from the measured
 *    calling range, players still to act at the measured continue rate, their calls added to the pot);
 *    omahaMultiwayCallNeedsNutShare (M2) gives the field the measured flush-draw share of callers;
 *  - his turn barrel and his river wager (after a barrel, or after a turn checked through) come from his measured
 *    rate and his measured range for each size, CONDITIONED ON THE RUNOUT: each holding's chance to wager is set by
 *    its own strength on that turn and that river so that the wagering holdings match the measured wager range
 *    (HorseOmahaFacingBetRangeTables.json `later` and `bettor`). A barrel therefore carries the holdings a turn card
 *    improved: the Horse's one pair or non-nut draw that a scare card hits is priced against the hands that bet it;
 *  - every Horse decision in the tree (call the barrel, call the river) is made on samples that are not the ones
 *    scored, so the tree never folds or calls with knowledge of the sampled holding (the 2026-11-24 version decided
 *    each river on the two or three holdings it then scored, a clairvoyant call that inflated EV(call)).
 * No realization factor, no fitted multiplier, no person / Horse split: every input is a measured table or his own
 * public counters, identity-free.
 *
 * PRICE. The call is made when EV > the flop margin of today's verdict (2% of the final pot); with
 * omahaFacingBetIndifferenceCalls on, when EV >= the sample's own standard error. Only a fold or a call changes;
 * a raise is never made or removed here.
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { noteFire } from './BrainTelemetry.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { HorseMind } from './HorseMind.js';
import { omahaEvBluffShare } from './HorseOmahaFacingBetEv.js';
import {
  omahaFlopFacingBetEvSpot,
  type OmahaFlopFacingBetEvSpot,
} from './HorseOmahaFlopFacingBetEv.js';
import { omahaBareOverpairFlopFacingBetSpot } from './HorseOmahaOopChecks.js';
import { omahaPricedShrunk } from './HorseOmahaPricedRules.js';
import { omahaStrategyConstant } from './HorseOmahaStrategyGame.js';
import { omahaBetReadOwnCellOf } from './HorseOmahaBetRead.js';
import {
  OMAHA_MEASURED_BIN_EDGES,
  OMAHA_MEASURED_BINS,
  omahaMeasuredBettorRange,
  omahaMeasuredBinOf,
  omahaMeasuredCallerHist,
  omahaMeasuredContinueRate,
  omahaMeasuredFlushDrawShare,
  omahaMeasuredLater,
  omahaMeasuredLineOf,
  type OmahaMeasuredLaterBucket,
  type OmahaMeasuredLine,
  type OmahaMeasuredRecord,
} from './HorseOmahaMeasuredBettorRange.js';
import type { StreetReadCounters } from './HorseOmahaStreetRead.js';

/** Runouts per turn card (heads-up / with a field) and bettor holdings per runout (half decide, half are scored). */
export const OMAHA_FLOP_CALL_TREE_RIVERS: readonly [number, number] = [8, 5];
export const OMAHA_FLOP_CALL_TREE_HOLDINGS = 8;
/** Uniform holdings that rank a holding on the flop, on each turn and on each river (the tables' strength scale). */
export const OMAHA_FLOP_CALL_TREE_POOL = 1024;
export const OMAHA_FLOP_CALL_TREE_TURN_POOL = 96;
export const OMAHA_FLOP_CALL_TREE_RIVER_POOL = 48;
export const OMAHA_FLOP_CALL_TREE_FIELD_MAX = 5;

export interface OmahaFlopCallTreeInput {
  variant: string;
  spot: OmahaFlopFacingBetEvSpot;
  hole: Card[];
  board: Card[];
  dead: Card[];
  line: OmahaMeasuredLine;
  record: OmahaMeasuredRecord | null;
  readFactor: number;
  rake: number;
  /** chips that can still be wagered after the call: the smaller of the two stacks behind */
  left: number;
  /** his public per-street bet counters (HorseMind.omahaStreetReadOf), or null */
  counters: StreetReadCounters | null;
}

export interface OmahaFlopCallTreeResult {
  ev: number;
  /** share of scored turn barrels the Horse calls */
  turnCallShare: number;
  /** his turn barrel rate over the scored samples (his measured rate, conditioned on the runouts) */
  turnBarrel: number;
  turnCards: number;
  runouts: number;
}

export interface OmahaFlopCallTreeVerdict {
  call: boolean;
  ev: number;
  margin: number;
  weak: number;
  source: 'record' | 'prior';
  bounded: boolean;
  tree: OmahaFlopCallTreeResult;
  samples: number;
  nutShareLoss: number | null;
}

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;
const cardKey = (c: Card): string => `${c.rank}:${c.suit}`;
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
const CATEGORY = 0x100000;
const EDGES = OMAHA_MEASURED_BIN_EDGES;
const NB = OMAHA_MEASURED_BINS;

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

function seedOf(hole: Card[], board: Card[], dead: Card[]): number {
  let h = 0x811c9dc5 ^ 0x5f3;
  for (const g of [hole, board, dead]) {
    for (const k of g.map(cardKey).sort())
      for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 124, 0x01000193);
  }
  return h >>> 0 || 1;
}

/** The flop's samples: one row per (runout, bettor holding); every number the tree needs, nothing decided. */
interface FlopSamples {
  /** per sample */
  turn: Int16Array;
  runout: Int32Array;
  scored: Uint8Array;
  binT: Int8Array;
  binR: Int8Array;
  share: Float64Array;
  /** the Horse ties or beats every player of the field who is in (1 heads-up) */
  beatsField: Uint8Array;
  n: number;
  /** per runout: the Horse's river strength (share of holdings that beat it) */
  heroRiver: Float64Array;
  runouts: number;
  turnCards: number;
  nutShareLoss: number;
  behindIn: number;
}

interface FlopField {
  always: ReadonlyArray<readonly number[]>;
  behind: number;
  continueRate: number;
  behindHist: readonly number[] | null;
  flushDrawByBin: ReadonlyArray<number | null> | null;
}

function flopSamples(
  hole: Card[],
  board: Card[],
  dead: Card[],
  bettorHist: readonly number[],
  field: FlopField
): FlopSamples | null {
  if (bettorHist.length !== NB) return null;
  const A = field.always.length;
  const B = Math.max(0, Math.floor(field.behind));
  const others = A + B;
  if (others > OMAHA_FLOP_CALL_TREE_FIELD_MAX) return null;
  const known = [...hole, ...board, ...(dead ?? [])];
  if (known.some((c) => !c || !RANKS.includes(c.rank as never) || !SUITS.includes(c.suit as never)))
    return null;
  if (new Set([...hole, ...board].map(cardKey)).size !== hole.length + board.length) return null;
  const removed = new Set(known.map(cardKey));
  const unseen: Card[] = [];
  for (const s of SUITS)
    for (const r of RANKS) {
      const c = { rank: r, suit: s } as Card;
      if (!removed.has(cardKey(c))) unseen.push(c);
    }
  const m = unseen.length;
  const n = hole.length;
  if (m < n * (2 + others) + 2) return null;
  const rnd = stream(seedOf(hole, board, dead ?? []));

  // The pool, ranked on the flop: the bettor's and the field's flop bins.
  const P = OMAHA_FLOP_CALL_TREE_POOL;
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
  const fdSuit = SUITS.find((s) => board.filter((c) => c.suit === s).length === 2) ?? null;
  const fd = new Uint8Array(P);
  if (fdSuit)
    for (let p = 0; p < P; p++) {
      let k = 0;
      for (let i = 0; i < n; i++) if (unseen[cards[p * n + i]].suit === fdSuit) k++;
      fd[p] = k >= 2 ? 1 : 0;
    }
  const members: number[][] = Array.from({ length: NB }, () => []);
  const membersFd: number[][] = Array.from({ length: NB }, () => []);
  const membersNo: number[][] = Array.from({ length: NB }, () => []);
  for (const p of order) {
    members[binOfPool[p]].push(p);
    (fd[p] ? membersFd : membersNo)[binOfPool[p]].push(p);
  }
  const cumOf = (h: readonly number[]): Float64Array | null => {
    const c = new Float64Array(NB);
    let s = 0;
    for (let b = 0; b < NB; b++) {
      if (members[b].length > 0 && h[b] > 0) s += h[b];
      c[b] = s;
    }
    if (!(s > 0)) return null;
    for (let b = 0; b < NB; b++) c[b] /= s;
    return c;
  };
  const binAt = (cum: Float64Array, u: number): number => {
    for (let b = 0; b < NB; b++) if (u < cum[b]) return b;
    return NB - 1;
  };
  const cumBettor = cumOf(bettorHist);
  if (!cumBettor) return null;
  const fieldCum: Float64Array[] = [];
  for (let f = 0; f < others; f++) {
    const h = f < A ? field.always[f] : field.behindHist;
    const c = h && h.length === NB ? cumOf(h) : null;
    fieldCum.push(c ?? (cumOf(new Array(NB).fill(1)) as Float64Array));
  }
  const cont = Math.max(
    0,
    Math.min(1, Number.isFinite(field.continueRate) ? field.continueRate : 0)
  );
  const fdShare = field.flushDrawByBin && fdSuit ? field.flushDrawByBin : null;

  // The ranking pools of the later streets: the pool's own order, skipping holdings that hold a board card.
  const holds = (p: number, c: number): boolean => {
    for (let k = 0; k < n; k++) if (cards[p * n + k] === c) return true;
    return false;
  };
  const used = new Uint8Array(m);
  const walks = Array.from({ length: 2 + 4 * others }, () => rnd());
  const step = (w: number): number => {
    walks[w] = (walks[w] + WALK_STEPS[w]) % 1;
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
  const rankPool = (full: Card[], size: number, skip: number[]): Float64Array => {
    const out: number[] = [];
    for (let p = 0; p < P && out.length < size; p++) {
      if (skip.some((c) => holds(p, c))) continue;
      out.push(scoreOf(p, full));
    }
    return Float64Array.from(out);
  };
  const strengthIn = (pool: Float64Array, sc: number): number => {
    let k = 0;
    for (let i = 0; i < pool.length; i++) if (pool[i] > sc) k++;
    return pool.length > 0 ? k / pool.length : 1;
  };

  // Runouts: every unseen card is a turn card, with R river cards each.
  const circle = Array.from({ length: m }, (_, i) => i);
  for (let i = m - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [circle[i], circle[j]] = [circle[j], circle[i]];
  }
  const half = Math.floor((m - 1) / 2);
  const R = Math.min(OMAHA_FLOP_CALL_TREE_RIVERS[others > 0 ? 1 : 0], half);
  const start = rnd();
  const H = OMAHA_FLOP_CALL_TREE_HOLDINGS;
  const cap = m * R * H;
  const sTurn = new Int16Array(cap);
  const sRun = new Int32Array(cap);
  const sScored = new Uint8Array(cap);
  const sBinT = new Int8Array(cap);
  const sBinR = new Int8Array(cap);
  const sShare = new Float64Array(cap);
  const sBeats = new Uint8Array(cap);
  const heroRiver = new Float64Array(m * R);
  const fieldScore = new Float64Array(others);
  const fieldIn = new Uint8Array(others);
  const picked = new Int32Array(others + 1);
  let ns = 0;
  let beatBettor = 0;
  let lostSameClass = 0;
  let behindIn = 0;
  const turnBoard: Card[] = [...board, board[0]];
  const full: Card[] = [...board, board[0], board[0]];
  for (let t = 0; t < m; t++) {
    const c1 = circle[t];
    turnBoard[3] = unseen[c1];
    full[3] = unseen[c1];
    used[c1] = 1;
    const poolT = rankPool(turnBoard, OMAHA_FLOP_CALL_TREE_TURN_POOL, [c1]);
    for (let k = 0; k < R; k++) {
      const c2 = circle[(t + 1 + (Math.floor(((k + start) * half) / R) % half)) % m];
      const r = t * R + k;
      full[4] = unseen[c2];
      used[c2] = 1;
      const poolR = rankPool(full, OMAHA_FLOP_CALL_TREE_RIVER_POOL, [c1, c2]);
      const hero = scoreOmahaHiPartial(hole, full);
      heroRiver[r] = strengthIn(poolR, hero);
      for (let s = 0; s < H; s++) {
        const b = binAt(cumBettor, step(0));
        const p = drawFrom(members[b], step(1));
        if (p < 0) continue;
        mark(p, 1);
        picked[0] = p;
        let whole = true;
        let f = 0;
        for (; f < others; f++) {
          const fb = binAt(fieldCum[f], step(2 + 4 * f));
          const u = step(3 + 4 * f);
          let g = -1;
          if (fdShare) {
            const want = fdShare[fb];
            if (want !== null && want !== undefined && Number.isFinite(want))
              g = drawFrom((step(4 + 4 * f) < want ? membersFd : membersNo)[fb], u);
          }
          if (g < 0) g = drawFrom(members[fb], u);
          if (g < 0) {
            whole = false;
            break;
          }
          mark(g, 1);
          picked[f + 1] = g;
          fieldScore[f] = scoreOf(g, full);
          fieldIn[f] = f < A ? 1 : step(5 + 4 * f) < cont ? 1 : 0;
        }
        for (let u = 1; u <= f; u++) mark(picked[u], 0);
        mark(p, 0);
        if (!whole) continue;
        const bettor = scoreOf(p, full);
        let best = bettor;
        let tied = hero === bettor ? 1 : 0;
        let bestField = -1;
        let beats = 1;
        for (let x = 0; x < others; x++) {
          if (!fieldIn[x]) continue;
          if (x >= A) behindIn++;
          if (fieldScore[x] > bestField) bestField = fieldScore[x];
          if (fieldScore[x] > best) best = fieldScore[x];
          if (fieldScore[x] === hero) tied++;
          if (fieldScore[x] > hero) beats = 0;
        }
        if (hero > bettor) {
          beatBettor++;
          if (bestField > hero && Math.floor(bestField / CATEGORY) === Math.floor(hero / CATEGORY))
            lostSameClass++;
        }
        sTurn[ns] = t;
        sRun[ns] = r;
        sScored[ns] = s >= H / 2 ? 1 : 0;
        sBinT[ns] = omahaMeasuredBinOf(strengthIn(poolT, scoreOf(p, turnBoard)));
        sBinR[ns] = omahaMeasuredBinOf(strengthIn(poolR, bettor));
        sShare[ns] = hero > best ? 1 : hero === best ? 1 / (1 + tied) : 0;
        sBeats[ns] = beats;
        ns++;
      }
      used[c2] = 0;
    }
    used[c1] = 0;
  }
  if (!(ns > 0)) return null;
  return {
    turn: sTurn,
    runout: sRun,
    scored: sScored,
    binT: sBinT,
    binR: sBinR,
    share: sShare,
    beatsField: sBeats,
    n: ns,
    heroRiver,
    runouts: m * R,
    turnCards: m,
    nutShareLoss: beatBettor > 0 ? lostSameClass / beatBettor : 0,
    behindIn: B > 0 ? behindIn / ns : 0,
  };
}

/**
 * His wager probability by strength bin on a later street, so that the strength of the holdings that wager is his
 * MEASURED range for that wager and the total rate is his measured rate: P(wager | bin) = min(1, k * h(bin) / g(bin)),
 * where g is the strength distribution of the holdings that reach the street in this spot (the runouts' own) and h
 * the measured mix of his wager ranges by size; k sets the total to the measured rate. Per size bucket, the bin's
 * probability is split by that bucket's share of h. Null when nothing reaches the street.
 */
function wagerByBin(
  g: Float64Array,
  later: { rate: number; buckets: OmahaMeasuredLaterBucket[] }
): { all: Float64Array; byBucket: Float64Array[] } | null {
  let gs = 0;
  for (let b = 0; b < NB; b++) gs += g[b];
  if (!(gs > 0)) return null;
  const w = new Float64Array(NB);
  for (const bk of later.buckets) for (let b = 0; b < NB; b++) w[b] += bk.share * bk.hist[b];
  const ratio = new Float64Array(NB);
  for (let b = 0; b < NB; b++) ratio[b] = g[b] > 0 ? w[b] / (g[b] / gs) : 0;
  const total = (k: number): number => {
    let s = 0;
    for (let b = 0; b < NB; b++) s += (g[b] / gs) * Math.min(1, k * ratio[b]);
    return s;
  };
  const target = Math.max(0, Math.min(1, later.rate));
  let lo = 0;
  let hi = 1;
  while (total(hi) < target - 1e-9 && hi < 1e9) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (total(mid) < target) lo = mid;
    else hi = mid;
  }
  const all = new Float64Array(NB);
  for (let b = 0; b < NB; b++) all[b] = Math.min(1, hi * ratio[b]);
  const byBucket = later.buckets.map((bk) => {
    const x = new Float64Array(NB);
    for (let b = 0; b < NB; b++) x[b] = w[b] > 0 ? (all[b] * bk.share * bk.hist[b]) / w[b] : 0;
    return x;
  });
  return { all, byBucket };
}

/** The Horse's pot share against one holding of a measured strength bin, from its own strength (0 = the nuts). */
function shareVsBin(hero: number, b: number): number {
  const lo = EDGES[b];
  const hi = EDGES[b + 1];
  if (hero < lo) return 1;
  if (hero >= hi) return 0;
  return (hi - hero) / Math.max(1e-9, hi - lo);
}

/**
 * The two-street tree on the samples. His turn barrel and his river wager are drawn from his measured rates and
 * measured ranges conditioned on each holding's strength on that turn and that river (wagerByBin), so a barrel
 * carries the holdings a turn card improved. Every Horse decision is made without the scored samples: a river call
 * prices the Horse's own river strength against his measured river range for the size (times, multiway, the share
 * of deciding samples on that runout where the Horse beats the field); a turn call is the deciding samples' value
 * of the call on that turn card. The scored samples then give the call's EV. No realization factor, no fitted number.
 */
function flopCallTreeEv(
  S: FlopSamples,
  turnBets: { rate: number; buckets: OmahaMeasuredLaterBucket[] },
  riverAfterBet: { rate: number; buckets: OmahaMeasuredLaterBucket[] },
  riverAfterCheck: { rate: number; buckets: OmahaMeasuredLaterBucket[] },
  spot: { paid: number; winnable: number; left: number; rake: number }
): (OmahaFlopCallTreeResult & { sd: number; scored: number }) | null {
  const keep = 1 - Math.max(0, Math.min(0.2, spot.rake));
  const Pc = spot.winnable + spot.paid;
  const left = Math.max(0, spot.left);
  const N = S.n;
  // His turn barrel by turn bin.
  const gT = new Float64Array(NB);
  for (let x = 0; x < N; x++) gT[S.binT[x]] += 1;
  const canBet = left > 0;
  const pT = canBet ? wagerByBin(gT, turnBets) : null;
  const barrel = (x: number): number => (pT ? pT.all[S.binT[x]] : 0);
  // His river wager by river bin, after a barrel and after a checked turn.
  const gRb = new Float64Array(NB);
  const gRc = new Float64Array(NB);
  for (let x = 0; x < N; x++) {
    const q = barrel(x);
    gRb[S.binR[x]] += q;
    gRc[S.binR[x]] += 1 - q;
  }
  const pRb = canBet ? wagerByBin(gRb, riverAfterBet) : null;
  const pRc = canBet ? wagerByBin(gRc, riverAfterCheck) : null;

  // The field factor of a river decision: the deciding samples of the runout where the Horse beats the field.
  const fieldWin = new Float64Array(S.runouts).fill(1);
  {
    const k = new Float64Array(S.runouts);
    const c = new Float64Array(S.runouts);
    for (let x = 0; x < N; x++)
      if (!S.scored[x]) {
        c[S.runout[x]] += 1;
        k[S.runout[x]] += S.beatsField[x];
      }
    for (let r = 0; r < S.runouts; r++) if (c[r] > 0) fieldWin[r] = k[r] / c[r];
  }
  // River call decisions: the Horse's river strength against his measured river range for the size.
  const riverCall = (
    r: number,
    bk: OmahaMeasuredLaterBucket,
    pot: number,
    stack: number
  ): boolean => {
    const c = Math.min(bk.size * pot, Math.max(0, stack));
    if (!(c > 0)) return true;
    let eq = 0;
    for (let b = 0; b < NB; b++) eq += bk.hist[b] * shareVsBin(S.heroRiver[r], b);
    eq *= fieldWin[r];
    return eq * (pot + 2 * c) * keep - c > 0;
  };
  const decideRiver = (
    tables: { buckets: OmahaMeasuredLaterBucket[] },
    pot: number,
    stack: number
  ): Uint8Array[] =>
    tables.buckets.map((bk) => {
      const d = new Uint8Array(S.runouts);
      for (let r = 0; r < S.runouts; r++) d[r] = riverCall(r, bk, pot, stack) ? 1 : 0;
      return d;
    });
  // The river from pot X with `stack` behind, sample x, his wager table p (null: he cannot wager), decisions d.
  const riverValue = (
    x: number,
    X: number,
    stack: number,
    p: { all: Float64Array; byBucket: Float64Array[] } | null,
    tables: { buckets: OmahaMeasuredLaterBucket[] },
    d: Uint8Array[]
  ): number => {
    const s = S.share[x];
    if (!p || !(stack > 0)) return s * X * keep;
    const bR = S.binR[x];
    let v = (1 - p.all[bR]) * s * X * keep;
    for (let i = 0; i < tables.buckets.length; i++) {
      const q = p.byBucket[i][bR];
      if (!(q > 0) || !d[i][S.runout[x]]) continue;
      const c = Math.min(tables.buckets[i].size * X, stack);
      v += q * (s * (X + 2 * c) * keep - c);
    }
    return v;
  };
  const dCheck = decideRiver(riverAfterCheck, Pc, left);
  const turnCosts = turnBets.buckets.map((bk) => Math.min(bk.size * Pc, left));
  const dAfter = turnBets.buckets.map((_, j) =>
    decideRiver(riverAfterBet, Pc + 2 * turnCosts[j], left - turnCosts[j])
  );
  // Turn call decisions per turn card and barrel size: the deciding samples' value of the call.
  const T = S.turnCards;
  const J = turnBets.buckets.length;
  const num = new Float64Array(T * J);
  const den = new Float64Array(T * J);
  if (pT)
    for (let x = 0; x < N; x++) {
      if (S.scored[x]) continue;
      for (let j = 0; j < J; j++) {
        const q = pT.byBucket[j][S.binT[x]];
        if (!(q > 0)) continue;
        const X = Pc + 2 * turnCosts[j];
        const v =
          riverValue(x, X, left - turnCosts[j], pRb, riverAfterBet, dAfter[j]) - turnCosts[j];
        num[S.turn[x] * J + j] += q * v;
        den[S.turn[x] * J + j] += q;
      }
    }
  const turnCall = new Uint8Array(T * J);
  for (let i = 0; i < T * J; i++) turnCall[i] = den[i] > 0 && num[i] > 0 ? 1 : 0;
  // The scored samples.
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  let barrels = 0;
  let called = 0;
  for (let x = 0; x < N; x++) {
    if (!S.scored[x]) continue;
    const q = barrel(x);
    let v = (1 - q) * riverValue(x, Pc, left, pRc, riverAfterCheck, dCheck);
    if (pT)
      for (let j = 0; j < J; j++) {
        const qj = pT.byBucket[j][S.binT[x]];
        if (!(qj > 0)) continue;
        barrels += qj;
        if (!turnCall[S.turn[x] * J + j]) continue;
        called += qj;
        const X = Pc + 2 * turnCosts[j];
        v +=
          qj *
          (riverValue(x, X, left - turnCosts[j], pRb, riverAfterBet, dAfter[j]) - turnCosts[j]);
      }
    v -= spot.paid;
    sum += v;
    sum2 += v * v;
    n++;
  }
  if (!(n > 0)) return null;
  const ev = sum / n;
  return {
    ev,
    sd: Math.sqrt(Math.max(0, sum2 / n - ev * ev)),
    scored: n,
    turnCallShare: barrels > 0 ? called / barrels : 0,
    turnBarrel: barrels / n,
    turnCards: S.turnCards,
    runouts: S.runouts,
  };
}

export function omahaFlopCallTreeVerdict(
  input: OmahaFlopCallTreeInput,
  o: { minDefence: boolean; indifference: boolean; nutShare: boolean }
): OmahaFlopCallTreeVerdict | null {
  const { spot, hole, board, dead } = input;
  if ((hole.length !== 4 && hole.length !== 5) || board.length !== 3) return null;
  const multi = spot.callers + spot.allIns + spot.behind > 0;
  const into = multi ? 'mw' : 'hu';
  const range = omahaMeasuredBettorRange(input.variant, 'flop', input.line, spot.potFrac, into, {
    record: input.record,
    readFactor: input.readFactor,
    minDefence: o.minDefence,
  });
  if (!range) return null;
  const callerHist = multi
    ? omahaMeasuredCallerHist(input.variant, 'flop', spot.potFrac, 'mw')
    : null;
  const cont = multi ? omahaMeasuredContinueRate(input.variant, 'flop', spot.potFrac, 'mw') : 0;
  if (multi && (!callerHist || cont === null)) return null;
  const fd =
    multi && o.nutShare
      ? Array.from({ length: NB }, (_, b) => omahaMeasuredFlushDrawShare(input.variant, 'flop', b))
      : null;
  const turnBets = omahaMeasuredLater(input.variant, 'turn', 'bet', into);
  const riverAfterBet = omahaMeasuredLater(input.variant, 'river', 'bet', into);
  const riverAfterCheck = omahaMeasuredLater(input.variant, 'river', 'check', into);
  if (!turnBets || !riverAfterBet || !riverAfterCheck) return null;
  // His public per-street bet counters move the measured rates (shrunk toward them); the ranges stay measured.
  const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);
  const turnRate = clamp01(omahaPricedShrunk(input.counters?.bet?.turn ?? null, turnBets.rate));
  const riverScale =
    riverAfterBet.rate > 0
      ? clamp01(omahaPricedShrunk(input.counters?.bet?.river ?? null, riverAfterBet.rate)) /
        riverAfterBet.rate
      : 1;
  const S = flopSamples(hole, board, dead, range.hist, {
    always: Array.from({ length: spot.callers + spot.allIns }, () => callerHist as number[]),
    behind: spot.behind,
    continueRate: cont ?? 0,
    behindHist: callerHist,
    flushDrawByBin: fd,
  });
  if (!S) return null;
  const rake = Math.max(0, Math.min(0.2, Number.isFinite(input.rake) ? input.rake : 0));
  const winnable = spot.winnable + S.behindIn * Math.max(0, spot.behindCall);
  const tree = flopCallTreeEv(
    S,
    { rate: turnRate, buckets: turnBets.buckets },
    { rate: riverAfterBet.rate * riverScale, buckets: riverAfterBet.buckets },
    { rate: clamp01(riverAfterCheck.rate * riverScale), buckets: riverAfterCheck.buckets },
    {
      paid: spot.paid,
      winnable,
      left: spot.allIn || spot.final ? 0 : Math.max(0, input.left),
      rake,
    }
  );
  if (!tree) return null;
  const baseMargin =
    omahaStrategyConstant('facingBetEvMargin', { gameVariant: `plo${hole.length}` }) *
    (winnable + spot.paid);
  const se = tree.sd / Math.sqrt(Math.max(1, tree.scored));
  const margin = o.indifference
    ? se
    : spot.potFrac < 0.1
      ? Math.min(baseMargin, 0.5 * spot.paid)
      : baseMargin;
  return {
    call: o.indifference ? tree.ev >= margin : tree.ev > margin,
    ev: tree.ev,
    margin,
    weak: range.weak,
    source: range.source,
    bounded: range.bounded,
    tree: {
      ev: tree.ev,
      turnCallShare: tree.turnCallShare,
      turnBarrel: tree.turnBarrel,
      turnCards: tree.turnCards,
      runouts: tree.runouts,
    },
    samples: S.n,
    nutShareLoss: multi && o.nutShare ? S.nutShareLoss : null,
  };
}

export interface OmahaFlopCallTreeRuleContext {
  mind: boolean;
  telemetry: boolean;
  rake: number;
  bareOverpairContinuation: boolean;
  minDefence: boolean;
  indifference: boolean;
  nutShare: boolean;
}

/**
 * The rule: on the flop, a fold or a call in the covered spot becomes the tree's verdict. Null where it does not
 * answer (not the flop, outside the spot, a raise given, the bare-overpair continuation's spot, nothing to price):
 * the caller then decides as with the option off.
 */
export function omahaFlopCallTreeRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: OmahaFlopCallTreeRuleContext
): HorseDecision | null {
  try {
    if (gs.stage !== 'flop') return null;
    const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
    const heroBet = Number.isFinite(player.bet) ? Math.max(0, player.bet ?? 0) : 0;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - heroBet);
    const legacyCall =
      decision.action === 'call' || (decision.action === 'all_in' && stack <= toCall + 0.005);
    if (decision.action !== 'fold' && !legacyCall) return null;
    const spot = omahaFlopFacingBetEvSpot(player, gs);
    if (!spot) return null;
    if (ctx.bareOverpairContinuation && omahaBareOverpairFlopFacingBetSpot(player, gs) !== null)
      return null;
    const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    let readFactor = 1;
    let record: OmahaMeasuredRecord | null = null;
    let counters: StreetReadCounters | null = null;
    if (ctx.mind && bettor) {
      try {
        const read = HorseMind.omahaFacingBetEvReadOf(
          bettor.user_id,
          'turn',
          spot.potFrac,
          spot.isRaise
        );
        if (spot.priorBluff > 0)
          readFactor = omahaEvBluffShare(spot.priorBluff, read) / spot.priorBluff;
      } catch {
        readFactor = 1;
      }
      try {
        record = spot.isRaise
          ? null
          : omahaBetReadOwnCellOf(bettor.user_id, variant, 'flop', spot.potFrac, false);
      } catch {
        record = null;
      }
      try {
        counters = HorseMind.omahaStreetReadOf(bettor.user_id)?.counters ?? null;
      } catch {
        counters = null;
      }
    }
    const his = bettor && Number.isFinite(bettor.stack) ? Math.max(0, bettor.stack) : Infinity;
    const verdict = omahaFlopCallTreeVerdict(
      {
        variant,
        spot,
        hole: player.cards ?? [],
        board: gs.communityCards ?? [],
        dead: player.knownDeadCards ?? [],
        line: omahaMeasuredLineOf(gs.actionHistory, 'flop', spot.bettorSeat, spot.isRaise),
        record,
        readFactor,
        rake: ctx.rake,
        left: Math.min(Math.max(0, stack - spot.paid), his),
        counters,
      },
      { minDefence: ctx.minDefence, indifference: ctx.indifference, nutShare: ctx.nutShare }
    );
    if (!verdict) return null;
    if (ctx.telemetry) {
      if (verdict.call) noteFire('omaha_flop_call_tree_call');
      else noteFire('omaha_flop_call_tree_fold');
      if (verdict.source === 'record') noteFire('omaha_flop_call_tree_record_read');
      if (verdict.bounded) noteFire('omaha_flop_call_tree_min_defence_bounded');
    }
    if (verdict.call === legacyCall) return decision;
    if (ctx.telemetry) noteFire('omaha_flop_call_tree_changed');
    if (verdict.call) {
      const called: HorseDecision = spot.allIn
        ? { ...decision, action: 'all_in' }
        : { ...decision, action: 'call', amount: spot.paid };
      if (spot.allIn) delete called.amount;
      delete called.continuationGuard;
      return called;
    }
    const folded: HorseDecision = { ...decision, action: 'fold' };
    delete folded.amount;
    return folded;
  } catch {
    if (ctx.telemetry) noteFire('omaha_strategy_rule_failed');
    return null;
  }
}
