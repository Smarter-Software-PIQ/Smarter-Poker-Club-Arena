/**
 * HOLD'EM VALUE AND CALLS ARE PRICED (option holdemValueAndCallsArePriced, default OFF, read === true).
 *
 * Auditor D (hvh48-audit-01TLQer7J, NLH cash against people, 3,891 Horse decisions) found four leaks that come
 * from decisions no price ever touched:
 *   1. a monster facing a bet raised only when a random draw came under 0.55 x aggression + checkRaiseFreq
 *      (HorseLogic decidePostflop, originalValueRaise), otherwise it called (348 bb);
 *   2. a strong made hand without the lead checked at the V11 initiative gate, or at random under the
 *      slowplay mix (slowplayFreq), and checked back in position as the aggressor (~300 bb);
 *   3. a call facing a bet was priced against a preflop band with respect multipliers, not against the range
 *      that made the bet (~340 bb);
 *   4. river thin bets and fixed 0.28-0.32 pot block bets were made with no comparison against the check
 *      (164 bb).
 *
 * This module prices those decisions, heads-up, against the bettor's LINE RANGE: his preflop band
 * (HorseMind.bandFor on the preflop history, the engine's own range read) re-weighted by the likelihood of
 * his postflop line (HorseActionLinePosterior: the posterior bucket shares over the shares with no postflop
 * action), each combination placed in one of the posterior's five buckets on this board. Every value is
 * computed from that range, the Horse's equity against each combination, the stacks and the opponent's
 * measured response; the action of highest value is taken. Nothing here draws from fastRandom: the runouts
 * are sampled by a private generator seeded by the public spot and the Horse's own cards, so the same spot
 * always gives the same answer.
 *
 * Values are in chips, counted from the decision (chips already in the pot are sunk):
 *
 *   fold        0
 *   call        R * eq(range) * (pot + c) - c
 *   raise to T  f * pot + (1 - f) * (R * eq(top (1 - f) of range) * (pot + a + d) - a)
 *   bet s       f * pot + (1 - f) * (R * eq(top (1 - f) of range) * (pot + a + d) - a)
 *   check       in position or with his action already taken: R * eq(range) * pot
 *               out of position, he still to act:
 *                 (1 - b) * R * eq(range that checks back) * pot
 *                 + b * max(0, call his bet, raise his bet at the priced sizes)
 *
 * c is the Horse's call; a the chips the Horse adds and d the chips he adds to call, each capped by the
 * stacks (a counts only the part he can match). R realizes equity: 1 on the river and in position, 0.88 out
 * of position on the flop and turn (the audit's stated figure). f is his fold at the price the wager lays
 * him, a / (a + pot): his measured fold to a bet (HorseOpponentExploit.statRead posterior on his decayed
 * counters, centred on the measured population cell) carried along the minimum-defence line from the price
 * at which it was measured (HOLDEM_PRICED_REFERENCE_PRICE), and never more than the weak part of his range
 * (a weak pair or draw, or air: he does not fold top pair, a strong draw or better). The part of his range that continues is its
 * strongest (1 - f) share (bucket first, then made strength on the board; never ordered by the Horse's own
 * cards). b is his measured share of spots checked to him that he bets; his bet is made at the mean measured
 * size, with the strongest b(1 - beta) of his range and the weakest b * beta (beta: the posterior's bluff
 * share). A raise is priced only as a value raise: a made hand whose equity against the part of his range
 * that continues is above one half. Re-raises by him and rake are left out of every value alike.
 */
import type { Card, CardRank, CardSuit } from '../types.js';
import type { ActionLinePosterior } from './HorseActionLinePosterior.js';
import {
  holdemCardId,
  holdemPreflopScore,
  packHoldemBoardBits,
  scoreHoldem,
  scoreHoldemFromBoardBits,
  scoreHoldemPlus2Ids,
  scoreHoldemPlus3Ids,
  scoreHoldemPlus4Ids,
  straightTop,
  type HoldemBoardBits,
} from './HorseEval.js';
import { RANK_VALUES } from './PokerEngine.js';

/** Mean price (wager / (pot + wager)) of the Horses' postflop bets in Auditor D's slice: 334 bets, 0.337. */
export const HOLDEM_PRICED_REFERENCE_PRICE = 0.337;
/** The audit's stated realization out of position on the flop and turn (1 in position and on the river). */
export const HOLDEM_PRICED_REALIZATION_OOP = 0.88;
/** Bet sizes priced, as fractions of the pot; all in as well when the stack is at most 1.5 pots. */
export const HOLDEM_PRICED_BET_FRACTIONS = [0.33, 0.5, 0.75, 1] as const;
/** Raise sizes priced: raise to the bet plus this share of (pot + call); all in too within 1.5 such pots. */
export const HOLDEM_PRICED_RAISE_FRACTIONS = [0.5, 0.75, 1] as const;
export const HOLDEM_PRICED_ALL_IN_POTS = 1.5;
/** His fold is never priced above this share. */
export const HOLDEM_PRICED_FOLD_CAP = 0.95;
/** Runouts sampled per combination on the flop and turn (the river is exact). */
export const HOLDEM_PRICED_FLOP_RUNOUTS = 8;
export const HOLDEM_PRICED_TURN_RUNOUTS = 12;

/** The posterior's five buckets, strongest first. */
export const enum HoldemLineBucket {
  Nutted = 4,
  TopPair = 3,
  StrongDraw = 2,
  WeakPairOrDraw = 1,
  Air = 0,
}

const SUITS: readonly CardSuit[] = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS: readonly CardRank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'T',
  'J',
  'Q',
  'K',
  'A',
];
const DECK: readonly Card[] = RANKS.flatMap((rank) => SUITS.map((suit) => ({ rank, suit })));
const DECK_IDS = new Uint8Array(DECK.length);
for (let i = 0; i < DECK.length; i++) DECK_IDS[i] = holdemCardId(DECK[i]);
const idOf = (c: Card): number => {
  const id = holdemCardId(c);
  return id >= 0 ? id : (RANK_VALUES[c.rank] - 2) * 4;
};
const cat = (score: number): number => Math.floor(score / 0x100000);

interface LineBoardContext {
  bits: HoldemBoardBits;
  len: number;
  bc: number;
  top: number;
  boardMask: number;
  /** Bit r (2..14) is set iff adding rank r to board alone does NOT make a straight. */
  boardNoStraightRanks: number;
}

function buildLineBoardContext(board: readonly Card[]): LineBoardContext | null {
  const len = board.length;
  const ids = new Uint8Array(len);
  let top = 0;
  let boardMask = 0;
  for (let i = 0; i < len; i++) {
    const id = holdemCardId(board[i]);
    if (id < 0) return null;
    ids[i] = id;
    const r = (id >> 2) + 2;
    if (r > top) top = r;
    boardMask |= 1 << r;
  }
  const bits = packHoldemBoardBits(ids, len);
  const bc = cat(scoreHoldemFromBoardBits(bits, false));
  let boardNoStraightRanks = 0;
  if (len < 5) {
    for (let r = 2; r <= 14; r++) {
      if (straightTop(boardMask | (1 << r), false) === 0) boardNoStraightRanks |= 1 << r;
    }
  }
  return { bits, len, bc, top, boardMask, boardNoStraightRanks };
}

function lineBucketFromIdsAndScore(
  id0: number,
  id1: number,
  made: number,
  ctx: LineBoardContext
): HoldemLineBucket {
  const mc = cat(made);
  const bc = ctx.bc;
  const r1 = (id0 >> 2) + 2;
  const r2 = (id1 >> 2) + 2;
  if (mc > bc) {
    if (mc >= 4) return HoldemLineBucket.Nutted;
    if (mc === 3 && bc === 1) return HoldemLineBucket.Nutted;
    const pocket = r1 === r2;
    const top = ctx.top;
    if ((pocket && r1 > top) || r1 === top || r2 === top) return HoldemLineBucket.TopPair;
    return HoldemLineBucket.WeakPairOrDraw;
  }
  if (ctx.len >= 5) return HoldemLineBucket.Air;
  const b = ctx.bits;
  const s0 = id0 & 3;
  const s1 = id1 & 3;
  const sameSuit = s0 === s1 ? 1 : 0;
  const c0 = (s0 === 0 ? b.sc0 : s0 === 1 ? b.sc1 : s0 === 2 ? b.sc2 : b.sc3) + 1 + sameSuit;
  if (c0 === 4) return HoldemLineBucket.StrongDraw;
  if (!sameSuit) {
    const c1 = (s1 === 0 ? b.sc0 : s1 === 1 ? b.sc1 : s1 === 2 ? b.sc2 : b.sc3) + 1;
    if (c1 === 4) return HoldemLineBucket.StrongDraw;
  }
  const mask = ctx.boardMask | (1 << r1) | (1 << r2);
  if (straightTop(mask, false) === 0) {
    let outs = 0;
    const cand = ctx.boardNoStraightRanks;
    for (let r = 2; r <= 14; r++) {
      const bit = 1 << r;
      if ((cand & bit) !== 0 && straightTop(mask | bit, false) > 0) {
        outs++;
        if (outs >= 2) return HoldemLineBucket.StrongDraw;
      }
    }
    if (outs === 1) return HoldemLineBucket.WeakPairOrDraw;
  }
  return HoldemLineBucket.Air;
}

/** A private, seeded generator (mulberry32). It never touches fastRandom. */
function generator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed of a spot: the Horse's cards, the board and the pot (all known to the deciding Horse). */
export function holdemPricedSeed(
  hero: readonly Card[],
  board: readonly Card[],
  pot: number
): number {
  let h = 2166136261;
  const mix = (x: number) => {
    h ^= x;
    h = Math.imul(h, 16777619) >>> 0;
  };
  for (const c of hero) mix(idOf(c) + 1);
  for (const c of board) mix(idOf(c) + 61);
  mix(Math.round(pot * 100) >>> 0);
  return h >>> 0;
}

/** The made category the board alone shows. */
function boardScore(board: readonly Card[]): number {
  return scoreHoldem([...board], board.length, false);
}

/** True when the hand's category is above the board's own (a made hand that uses a hole card). */
export function holdemHandIsMade(hole: readonly Card[], board: readonly Card[]): boolean {
  if (board.length < 3 || hole.length !== 2) return false;
  return cat(scoreHoldem([...hole, ...board], board.length + 2, false)) > cat(boardScore(board));
}

/** Ranks that complete a straight using a hole card, when the hand has none yet. */
function straightOuts(hole: readonly Card[], board: readonly Card[]): number {
  let mask = 0;
  let boardMask = 0;
  const add = (m: number, r: number) => m | (1 << r) | (r === 14 ? 1 << 1 : 0);
  for (const c of hole) mask = add(mask, RANK_VALUES[c.rank]);
  for (const c of board) {
    mask = add(mask, RANK_VALUES[c.rank]);
    boardMask = add(boardMask, RANK_VALUES[c.rank]);
  }
  if (straightTop(mask, false) > 0) return 0;
  let outs = 0;
  for (let r = 2; r <= 14; r++) {
    if (straightTop(add(mask, r), false) > 0 && straightTop(add(boardMask, r), false) === 0) outs++;
  }
  return outs;
}

/** The posterior bucket a combination falls in on this board. River: no draws. */
export function holdemLineBucket(hole: readonly Card[], board: readonly Card[]): HoldemLineBucket {
  const n = board.length;
  const made = scoreHoldem([...hole, ...board], n + 2, false);
  const mc = cat(made);
  const bc = cat(boardScore(board));
  const top = Math.max(...board.map((c) => RANK_VALUES[c.rank]));
  const r1 = RANK_VALUES[hole[0].rank];
  const r2 = RANK_VALUES[hole[1].rank];
  if (mc > bc) {
    if (mc >= 4) return HoldemLineBucket.Nutted; // trips or better above the board
    if (mc === 3 && bc === 1) return HoldemLineBucket.Nutted; // two pair with both hole cards
    // one new pair (or a new pair beside the board's): top pair or an overpair, else a weak pair
    const pocket = r1 === r2;
    if ((pocket && r1 > top) || r1 === top || r2 === top) return HoldemLineBucket.TopPair;
    return HoldemLineBucket.WeakPairOrDraw;
  }
  if (n >= 5) return HoldemLineBucket.Air;
  const suitCount = (s: CardSuit) =>
    board.filter((c) => c.suit === s).length + hole.filter((c) => c.suit === s).length;
  const flushDraw = hole.some((c) => suitCount(c.suit) === 4);
  const outs = straightOuts(hole, board);
  if (flushDraw || outs >= 2) return HoldemLineBucket.StrongDraw;
  if (outs === 1) return HoldemLineBucket.WeakPairOrDraw;
  return HoldemLineBucket.Air;
}

/** The posterior's bucket shares, normalized, strongest bucket last (index = HoldemLineBucket). */
function bucketShares(p: ActionLinePosterior): number[] {
  const raw = [p.airBlocker, p.floatWeakDraw, p.nutDrawWrap, p.overpairTopPair, p.nutted];
  const sum = raw.reduce((x, y) => x + Math.max(0, y), 0);
  return sum > 0 ? raw.map((x) => Math.max(0, x) / sum) : raw.map(() => 0.2);
}

/** The likelihood per bucket of one street of his line: the posterior after that street over the one before. */
export function holdemLineLikelihood(
  withLine: ActionLinePosterior,
  preflopOnly: ActionLinePosterior
): number[] {
  const a = bucketShares(withLine);
  const b = bucketShares(preflopOnly);
  return a.map((x, i) => (b[i] > 1e-9 ? x / b[i] : 1));
}

/** A weighted two-card range with each combination's strength order and the Horse's equity against it. */
export interface HoldemPricedRange {
  combos: Card[][];
  weight: number[];
  bucket: HoldemLineBucket[];
  /** Strength on the board for the order of continuing: bucket first, then made score. */
  strength: number[];
  /** The Horse's equity against the combination (ties half). */
  equity: number[];
  /** Combination indexes, strongest first (weight > 0 only). */
  order: number[];
  total: number;
  /** The share of the weight in the two weakest buckets (a weak pair or draw, air): the most he folds. */
  weakShare: number;
}

/**
 * One step of his line, on the board he acted on:
 *   likelihood  every combination weighted by the likelihood of his action for its bucket there (a street of
 *               checks only: HorseActionLinePosterior's move over that street);
 *   keep        he wagered or called: he keeps the strongest `top` share of his range and the weakest
 *               `bottom` share (his bluffs), ordered by strength on that board; the rest is gone.
 */
export type HoldemLineStreet =
  | { board: readonly Card[]; likelihood: readonly number[] }
  | { board: readonly Card[]; keep: { top: number; bottom: number } };

/**
 * His line range: every combination the dead cards allow, kept where its preflop score lies inside his band
 * (all of them when the band keeps none or there is no band), weighted street by street by the likelihood of
 * his actions on that street for the bucket the combination held on that street's board (a draw he bet on
 * the flop is weighted as a draw there, and as whatever it became on the river for his river action).
 */
export function holdemLineRange(
  hero: readonly Card[],
  board: readonly Card[],
  band: readonly [number, number] | null,
  line: readonly HoldemLineStreet[]
): HoldemPricedRange {
  const deadFlags = new Uint8Array(64);
  for (let i = 0; i < hero.length; i++) deadFlags[idOf(hero[i])] = 1;
  for (let i = 0; i < board.length; i++) deadFlags[idOf(board[i])] = 1;

  const live: Card[] = [];
  const liveIds = new Uint8Array(52);
  let liveLen = 0;
  for (let i = 0; i < DECK.length; i++) {
    const id = DECK_IDS[i];
    if (deadFlags[id] === 0) {
      live.push(DECK[i]);
      liveIds[liveLen++] = id;
    }
  }
  const numPairs = (liveLen * (liveLen - 1)) >> 1;
  const pairs: Card[][] = new Array(numPairs);
  const pairId0 = new Uint8Array(numPairs);
  const pairId1 = new Uint8Array(numPairs);
  const inBand: number[] = new Array(numPairs);
  let anyInBand = false;
  let pIdx = 0;
  for (let i = 0; i < liveLen; i++) {
    const ci = live[i];
    const idI = liveIds[i];
    for (let j = i + 1; j < liveLen; j++) {
      const cj = live[j];
      pairs[pIdx] = [ci, cj];
      pairId0[pIdx] = idI;
      pairId1[pIdx] = liveIds[j];
      if (!band) {
        inBand[pIdx] = 1;
        anyInBand = true;
      } else {
        const s = holdemPreflopScore(ci, cj, false);
        const keep = s >= band[0] - 1e-12 && s <= band[1] + 1e-12 ? 1 : 0;
        inBand[pIdx] = keep;
        if (keep) anyInBand = true;
      }
      pIdx++;
    }
  }
  if (!anyInBand) inBand.fill(1);

  const n = board.length;
  const mainCtx = buildLineBoardContext(board);
  const bucket: HoldemLineBucket[] = new Array(numPairs);
  const finalScores = new Int32Array(numPairs);
  if (mainCtx) {
    const mainBits = mainCtx.bits;
    for (let i = 0; i < numPairs; i++) {
      const id0 = pairId0[i];
      const id1 = pairId1[i];
      const sc = scoreHoldemPlus2Ids(mainBits, id0, id1, false);
      finalScores[i] = sc;
      bucket[i] = lineBucketFromIdsAndScore(id0, id1, sc, mainCtx);
    }
  } else {
    for (let i = 0; i < numPairs; i++) {
      bucket[i] = holdemLineBucket(pairs[i], board);
      finalScores[i] = scoreHoldem([...pairs[i], ...board], n + 2, false);
    }
  }

  const weight: number[] = inBand.slice();
  const strScratch = new Float64Array(numPairs);
  const streetBucketScratch = new Uint8Array(numPairs);
  for (const st of line) {
    const sb = st.board;
    const sameBoard = sb.length === n;
    const sbCtx = sameBoard ? mainCtx : buildLineBoardContext(sb);
    if ('likelihood' in st) {
      const lik = st.likelihood;
      if (sameBoard) {
        for (let i = 0; i < numPairs; i++) {
          if (weight[i] > 0) weight[i] *= Math.max(0, lik[bucket[i]] ?? 1);
        }
      } else if (sbCtx) {
        const sbBits = sbCtx.bits;
        for (let i = 0; i < numPairs; i++) {
          if (weight[i] > 0) {
            const id0 = pairId0[i];
            const id1 = pairId1[i];
            const sc = scoreHoldemPlus2Ids(sbBits, id0, id1, false);
            const b = lineBucketFromIdsAndScore(id0, id1, sc, sbCtx);
            weight[i] *= Math.max(0, lik[b] ?? 1);
          }
        }
      } else {
        for (let i = 0; i < numPairs; i++) {
          if (weight[i] > 0) weight[i] *= Math.max(0, lik[holdemLineBucket(pairs[i], sb)] ?? 1);
        }
      }
      continue;
    }

    const liveIdx: number[] = [];
    for (let i = 0; i < numPairs; i++) if (weight[i] > 0) liveIdx.push(i);

    if (sameBoard) {
      for (let k = 0; k < liveIdx.length; k++) {
        const i = liveIdx[k];
        const b = bucket[i];
        streetBucketScratch[i] = b;
        strScratch[i] = b * 0x10000000 + finalScores[i];
      }
    } else if (sbCtx) {
      const sbBits = sbCtx.bits;
      for (let k = 0; k < liveIdx.length; k++) {
        const i = liveIdx[k];
        const id0 = pairId0[i];
        const id1 = pairId1[i];
        const sc = scoreHoldemPlus2Ids(sbBits, id0, id1, false);
        const b = lineBucketFromIdsAndScore(id0, id1, sc, sbCtx);
        streetBucketScratch[i] = b;
        strScratch[i] = b * 0x10000000 + sc;
      }
    } else {
      for (let k = 0; k < liveIdx.length; k++) {
        const i = liveIdx[k];
        const b = holdemLineBucket(pairs[i], sb);
        streetBucketScratch[i] = b;
        strScratch[i] = b * 0x10000000 + scoreHoldem([...pairs[i], ...sb], sb.length + 2, false);
      }
    }

    liveIdx.sort((x, y) => strScratch[y] - strScratch[x] || x - y);
    let tot = 0;
    for (let k = 0; k < liveIdx.length; k++) tot += weight[liveIdx[k]];
    const kept = new Float64Array(numPairs);
    let wantTop = Math.max(0, Math.min(1, st.keep.top)) * tot;
    for (let k = 0; k < liveIdx.length; k++) {
      if (wantTop <= 1e-12) break;
      const i = liveIdx[k];
      const room = weight[i] - kept[i];
      const t = Math.min(room, wantTop);
      kept[i] += t;
      wantTop -= t;
    }
    // Draw bluffs proportionally within each bucket from weakest up (Air first, then WeakPairOrDraw)
    // rather than worst-kicker-first, so unmade high-card Air does not beat 100% of villain's bluffs.
    let wantBottom = Math.max(0, Math.min(1, st.keep.bottom)) * tot;
    for (let b = HoldemLineBucket.Air; b <= HoldemLineBucket.Nutted && wantBottom > 1e-12; b++) {
      let avail = 0;
      for (let k = 0; k < liveIdx.length; k++) {
        const i = liveIdx[k];
        if (streetBucketScratch[i] === b) avail += weight[i] - kept[i];
      }
      if (avail <= 1e-12) continue;
      const frac = Math.min(1, wantBottom / avail);
      for (let k = 0; k < liveIdx.length; k++) {
        const i = liveIdx[k];
        if (streetBucketScratch[i] !== b) continue;
        const t = (weight[i] - kept[i]) * frac;
        kept[i] += t;
        wantBottom -= t;
      }
    }
    for (let k = 0; k < liveIdx.length; k++) {
      const i = liveIdx[k];
      weight[i] = kept[i];
    }
  }

  const strength: number[] = new Array(numPairs);
  const order: number[] = [];
  for (let i = 0; i < numPairs; i++) {
    strength[i] = bucket[i] * 0x10000000 + finalScores[i];
    if (weight[i] > 0) order.push(i);
  }
  order.sort((x, y) => strength[y] - strength[x] || x - y);
  let total = 0;
  let weak = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const w = weight[i];
    total += w;
    if (bucket[i] <= HoldemLineBucket.WeakPairOrDraw) weak += w;
  }
  return {
    combos: pairs,
    weight,
    bucket,
    strength,
    equity: new Array<number>(numPairs).fill(0),
    order,
    total,
    weakShare: total > 0 ? weak / total : 0,
  };
}

/**
 * The Horse's equity against each weighted combination: exact on the river; on the flop and turn over a
 * fixed number of runouts per combination drawn by the private generator.
 */
export function holdemFillEquities(
  range: HoldemPricedRange,
  hero: readonly Card[],
  board: readonly Card[],
  seed: number
): void {
  const n = board.length;
  const need = 5 - n;
  const rnd = generator(seed);
  const samples = n === 3 ? HOLDEM_PRICED_FLOP_RUNOUTS : HOLDEM_PRICED_TURN_RUNOUTS;

  const h0 = hero.length === 2 ? holdemCardId(hero[0]) : -1;
  const h1 = hero.length === 2 ? holdemCardId(hero[1]) : -1;
  const boardIds = new Uint8Array(n);
  let fastOk = h0 >= 0 && h1 >= 0 && need >= 0 && need <= 2;
  if (fastOk) {
    for (let i = 0; i < n; i++) {
      const bid = holdemCardId(board[i]);
      if (bid < 0) {
        fastOk = false;
        break;
      }
      boardIds[i] = bid;
    }
  }

  if (fastOk) {
    const boardBits = packHoldemBoardBits(boardIds, n);
    if (need === 0) {
      const h = scoreHoldemPlus2Ids(boardBits, h0, h1, false);
      const order = range.order;
      const combos = range.combos;
      const eq = range.equity;
      for (let idx = 0; idx < order.length; idx++) {
        const i = order[idx];
        const v = combos[i];
        const o = scoreHoldemPlus2Ids(boardBits, holdemCardId(v[0]), holdemCardId(v[1]), false);
        eq[i] = h > o ? 1 : h === o ? 0.5 : 0;
      }
      return;
    }

    const deadFlags = new Uint8Array(64);
    deadFlags[h0] = 1;
    deadFlags[h1] = 1;
    for (let i = 0; i < n; i++) deadFlags[boardIds[i]] = 1;
    const deckIds = new Uint8Array(52);
    let deckLen = 0;
    for (let i = 0; i < DECK.length; i++) {
      const id = DECK_IDS[i];
      if (deadFlags[id] === 0) deckIds[deckLen++] = id;
    }
    const restIds = new Uint8Array(52);
    const heroCache = new Int32Array(need === 1 ? 52 : 52 * 52);
    const order = range.order;
    const combos = range.combos;
    const eq = range.equity;

    if (need === 1) {
      for (let idx = 0; idx < order.length; idx++) {
        const i = order[idx];
        const v = combos[i];
        const a = holdemCardId(v[0]);
        const b = holdemCardId(v[1]);
        let restLen = 0;
        for (let d = 0; d < deckLen; d++) {
          const id = deckIds[d];
          if (id !== a && id !== b) restIds[restLen++] = id;
        }
        let won = 0;
        for (let k = 0; k < samples; k++) {
          const r0 = restIds[Math.floor(rnd() * restLen)];
          let h = heroCache[r0];
          if (h === 0) {
            h = scoreHoldemPlus3Ids(boardBits, r0, h0, h1, false);
            heroCache[r0] = h;
          }
          const o = scoreHoldemPlus3Ids(boardBits, r0, a, b, false);
          won += h > o ? 1 : h === o ? 0.5 : 0;
        }
        eq[i] = won / samples;
      }
      return;
    }

    // need === 2 (flop)
    for (let idx = 0; idx < order.length; idx++) {
      const i = order[idx];
      const v = combos[i];
      const a = holdemCardId(v[0]);
      const b = holdemCardId(v[1]);
      let restLen = 0;
      for (let d = 0; d < deckLen; d++) {
        const id = deckIds[d];
        if (id !== a && id !== b) restIds[restLen++] = id;
      }
      let won = 0;
      for (let k = 0; k < samples; k++) {
        const x = Math.floor(rnd() * restLen);
        let y = Math.floor(rnd() * (restLen - 1));
        if (y >= x) y++;
        const rx = restIds[x];
        const ry = restIds[y];
        const r0 = rx < ry ? rx : ry;
        const r1 = rx < ry ? ry : rx;
        const cacheKey = r0 * 52 + r1;
        let h = heroCache[cacheKey];
        if (h === 0) {
          h = scoreHoldemPlus4Ids(boardBits, r0, r1, h0, h1, false);
          heroCache[cacheKey] = h;
        }
        const o = scoreHoldemPlus4Ids(boardBits, r0, r1, a, b, false);
        won += h > o ? 1 : h === o ? 0.5 : 0;
      }
      eq[i] = won / samples;
    }
    return;
  }

  // Generic fallback for non-standard inputs.
  const heroCache = new Map<number, number>();
  const heroScore = (runout: Card[]): number => {
    const key = runout.reduce((k, c) => k * 64 + idOf(c) + 1, 0);
    let s = heroCache.get(key);
    if (s === undefined) {
      s = scoreHoldem([...hero, ...board, ...runout], n + 2 + runout.length, false);
      heroCache.set(key, s);
    }
    return s;
  };
  const deadHero = new Set([...hero, ...board].map(idOf));
  const deck = DECK.filter((c) => !deadHero.has(idOf(c)));
  for (const i of range.order) {
    const v = range.combos[i];
    if (need === 0) {
      const h = heroScore([]);
      const o = scoreHoldem([...v, ...board], 7, false);
      range.equity[i] = h > o ? 1 : h === o ? 0.5 : 0;
      continue;
    }
    const a = idOf(v[0]);
    const b = idOf(v[1]);
    const rest = deck.filter((c) => {
      const id = idOf(c);
      return id !== a && id !== b;
    });
    let won = 0;
    for (let k = 0; k < samples; k++) {
      const x = Math.floor(rnd() * rest.length);
      let runout: Card[];
      if (need === 1) runout = [rest[x]];
      else {
        let y = Math.floor(rnd() * (rest.length - 1));
        if (y >= x) y++;
        runout = idOf(rest[x]) < idOf(rest[y]) ? [rest[x], rest[y]] : [rest[y], rest[x]];
      }
      const h = heroScore(runout);
      const o = scoreHoldem([...v, ...board, ...runout], 7, false);
      won += h > o ? 1 : h === o ? 0.5 : 0;
    }
    range.equity[i] = won / samples;
  }
}

/** The Horse's equity against a slice of the range ordered by strength: the top or the bottom share. */
export function holdemEquityOfShare(
  range: HoldemPricedRange,
  share: number,
  from: 'top' | 'bottom' = 'top',
  skipTop = 0
): { equity: number; weight: number } {
  const order = from === 'top' ? range.order : [...range.order].reverse();
  let skip = Math.max(0, skipTop) * range.total;
  let want = Math.max(0, Math.min(1, share)) * range.total;
  let w = 0;
  let e = 0;
  for (const i of order) {
    if (want <= 1e-12) break;
    let wi = range.weight[i];
    if (skip > 0) {
      const s = Math.min(skip, wi);
      skip -= s;
      wi -= s;
      if (wi <= 0) continue;
    }
    const take = Math.min(wi, want);
    w += take;
    e += take * range.equity[i];
    want -= take;
  }
  if (w <= 0) return { equity: holdemEquityOfShare(range, 1).equity, weight: 0 };
  return { equity: e / w, weight: w };
}

/** The spot as the Horse sees it, heads-up. Amounts in chips. */
export interface HoldemPricedSpot {
  street: 'flop' | 'turn' | 'river';
  /** Everything in the pot now, the current street's wagers included. */
  pot: number;
  /** The current street's highest wager (0 when nobody has wagered). */
  currentBet: number;
  heroIn: number;
  villainIn: number;
  heroStack: number;
  villainStack: number;
  /** The Horse acts after him on this street. */
  inPosition: boolean;
  /** Not facing a wager and he has not acted on this street yet. */
  villainToAct: boolean;
  /** His fold to a bet at the reference price (posterior mean of his measured fold to a bet). */
  foldAtReference: number;
  /** His share of spots checked to him that he bets (posterior mean). */
  betWhenCheckedTo: number;
  /** The share of bluffs in his bet when checked to (the posterior's estimate for his line). */
  bluffShare: number;
  /** Raises are priced only for a made hand (a value raise); a draw prices fold and call. */
  heroMade: boolean;
}

export interface HoldemPricedOption {
  kind: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  /** The wager's street total (raise to / bet), 0 for fold and check, the call's street total for a call. */
  to: number;
  ev: number;
  fold?: number;
  equityWhenCalled?: number;
}

export interface HoldemPricedVerdict {
  options: HoldemPricedOption[];
  best: HoldemPricedOption;
  equity: number;
}

const realization = (spot: HoldemPricedSpot): number =>
  spot.street === 'river' || spot.inPosition ? 1 : HOLDEM_PRICED_REALIZATION_OOP;

/** His fold at the price a wager lays him (risk over risk plus the pot it wins). */
export function holdemPricedFold(foldAtReference: number, risk: number, pot: number): number {
  if (!(risk > 0) || !(pot > 0)) return 0;
  const price = risk / (risk + pot);
  const f = (Math.max(0, Math.min(1, foldAtReference)) * price) / HOLDEM_PRICED_REFERENCE_PRICE;
  return Math.max(0, Math.min(HOLDEM_PRICED_FOLD_CAP, f));
}

/** The value of a wager to `to` from the Horse's `heroIn`, against `range`, into `pot`. */
function wagerValue(
  range: HoldemPricedRange,
  pot: number,
  to: number,
  heroIn: number,
  villainIn: number,
  heroStack: number,
  villainStack: number,
  foldAtReference: number,
  r: number,
  rangeShare = 1,
  rangeSkip = 0
): HoldemPricedOption & { kind: 'raise' } {
  const add = Math.max(0, Math.min(to - heroIn, heroStack));
  const his = Math.max(0, Math.min(to - villainIn, villainStack));
  const matched = Math.max(0, Math.min(add, villainIn + his - heroIn));
  // he folds at the effective matched price (unmatched surplus above his stack cannot lay a higher price),
  // never more than the weak part of the range facing the wager
  const f = Math.min(holdemPricedFold(foldAtReference, matched, pot), range.weakShare);
  const cont = holdemEquityOfShare(range, (1 - f) * rangeShare, 'top', rangeSkip);
  const ev = f * pot + (1 - f) * (r * cont.equity * (pot + matched + his) - matched);
  return { kind: 'raise', to, ev, fold: f, equityWhenCalled: cont.equity };
}

/**
 * Prices the Horse's options in a heads-up spot. `wagers` are the legal street totals the engine admits
 * (already legalized). Facing a wager: fold, call and (for a made hand) each raise. Not facing one: check
 * and each bet. The best is the option of highest value; a tie keeps the passive option.
 */
export function holdemPricedVerdict(
  spot: HoldemPricedSpot,
  range: HoldemPricedRange,
  wagers: readonly number[]
): HoldemPricedVerdict {
  const r = realization(spot);
  const all = holdemEquityOfShare(range, 1).equity;
  const options: HoldemPricedOption[] = [];
  const facing = spot.currentBet > spot.heroIn + 1e-9;
  if (facing) {
    const c = Math.max(0, Math.min(spot.currentBet - spot.heroIn, spot.heroStack));
    options.push({ kind: 'fold', to: 0, ev: 0 });
    options.push({
      kind: 'call',
      to: spot.heroIn + c,
      ev: r * all * (spot.pot + c) - c,
      equityWhenCalled: all,
    });
    if (spot.heroMade && spot.villainStack > 0) {
      for (const to of wagers) {
        if (!(to > spot.currentBet)) continue;
        const v = wagerValue(
          range,
          spot.pot,
          to,
          spot.heroIn,
          spot.villainIn,
          spot.heroStack,
          spot.villainStack,
          spot.foldAtReference,
          r
        );
        // a value raise: ahead of the part of his range that continues
        if ((v.equityWhenCalled ?? 0) > 0.5) options.push(v);
      }
    }
  } else {
    let check: number;
    if (!spot.villainToAct) check = r * all * spot.pot;
    else {
      const b = Math.max(0, Math.min(1, spot.betWhenCheckedTo));
      const beta = Math.max(0, Math.min(1, spot.bluffShare));
      // his bet when checked to: the mean measured size, his strongest b(1 - beta) and weakest b * beta
      const size = Math.min(
        (HOLDEM_PRICED_REFERENCE_PRICE / (1 - HOLDEM_PRICED_REFERENCE_PRICE)) * spot.pot,
        spot.villainStack
      );
      const value = holdemEquityOfShare(range, b * (1 - beta), 'top');
      const bluff = holdemEquityOfShare(range, b * beta, 'bottom');
      const wb = value.weight + bluff.weight;
      const eqBet = wb > 0 ? (value.equity * value.weight + bluff.equity * bluff.weight) / wb : all;
      const back = holdemEquityOfShare(range, Math.max(0, 1 - b), 'top', b * (1 - beta));
      let answer = 0;
      if (size > 0) {
        const call = Math.min(size, spot.heroStack);
        answer = Math.max(answer, r * eqBet * (spot.pot + size + call) - call);
        if (spot.heroMade && spot.heroStack > call) {
          for (const frac of HOLDEM_PRICED_RAISE_FRACTIONS) {
            const to = Math.min(size + frac * (spot.pot + 2 * size), spot.heroStack);
            if (!(to > size)) continue;
            // his continuing part of the range he bet with (value part ordered first)
            const v = wagerValue(
              range,
              spot.pot + size,
              to,
              0,
              size,
              spot.heroStack,
              Math.max(0, spot.villainStack - size),
              spot.foldAtReference,
              r,
              b * (1 - beta)
            );
            if ((v.equityWhenCalled ?? 0) > 0.5) answer = Math.max(answer, v.ev);
          }
        }
      }
      check = (1 - b) * r * back.equity * spot.pot + b * answer;
    }
    options.push({ kind: 'check', to: 0, ev: check, equityWhenCalled: all });
    // On the river, a made hand priced here bets only as a value bet (equity >= 0.5 against his range);
    // otherwise foldAtReference / HOLDEM_PRICED_REFERENCE_PRICE > 1 turns 0%-equity weak pairs into
    // auto-profit river bluffs. Checking still emits holdem_priced_check so thin/blocker bets check cleanly.
    if (!(spot.street === 'river' && all < 0.5)) {
      for (const to of wagers) {
        if (!(to > 0)) continue;
        const v = wagerValue(
          range,
          spot.pot,
          to,
          spot.heroIn,
          spot.villainIn,
          spot.heroStack,
          spot.villainStack,
          spot.foldAtReference,
          r
        );
        options.push({ ...v, kind: 'bet' });
      }
    }
  }
  let best = options[0];
  for (const o of options) if (o.ev > best.ev + 1e-9) best = o;
  return { options, best, equity: all };
}

/** The wager street totals to price: the bet or raise fractions and, within 1.5 pots, effective all in. */
export function holdemPricedWagerTargets(spot: HoldemPricedSpot): number[] {
  const facing = spot.currentBet > spot.heroIn + 1e-9;
  const effAllIn = Math.min(spot.heroIn + spot.heroStack, spot.villainIn + spot.villainStack);
  const effStack = Math.max(0, effAllIn - spot.heroIn);
  const out: number[] = [];
  const pushUnique = (x: number) => {
    if (!out.some((y) => Math.abs(y - x) <= 1e-9)) out.push(x);
  };
  if (facing) {
    const base = spot.pot + (spot.currentBet - spot.heroIn);
    for (const f of HOLDEM_PRICED_RAISE_FRACTIONS) {
      const t = Math.min(spot.currentBet + f * base, effAllIn);
      if (t > spot.currentBet) pushUnique(t);
    }
    if (
      effAllIn > spot.currentBet &&
      effAllIn - spot.currentBet <= HOLDEM_PRICED_ALL_IN_POTS * base
    )
      pushUnique(effAllIn);
  } else {
    for (const f of HOLDEM_PRICED_BET_FRACTIONS) {
      const t = Math.min(spot.heroIn + f * spot.pot, effAllIn);
      if (t > spot.heroIn) pushUnique(t);
    }
    if (effStack > 0 && effStack <= HOLDEM_PRICED_ALL_IN_POTS * spot.pot) pushUnique(effAllIn);
  }
  return out;
}
