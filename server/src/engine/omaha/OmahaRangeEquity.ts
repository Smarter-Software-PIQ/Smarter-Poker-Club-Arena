import type { Card } from '../../types.js';
import { omahaSamplerScoring } from './OmahaVariantSampler.js';
import {
  RANK_KEY,
  createFiveBoardTriples,
  getPoolPairKeys,
  loadFiveBoardTriples,
  scorePairKeysOnFiveBoard,
  type PoolFastData,
} from '../omahaMathCore/OmahaMathCoreEval.js';

/**
 * EMERG lane EQUITY (2026-11-19): showdown equity of a PLO4 / PLO5 hero against
 * one weighted range per live opponent, run to the river, with its standard
 * error. Built for the math-first Omaha core (omahaMathCore); no switch reads it
 * by itself.
 *
 * Correctness contract (law tests in OmahaRangeEquity.test.ts):
 * - Hand ranking is exactly two hole cards plus three board cards, scored by
 *   omahaSamplerScoring.omahaHiFast, which the tests pin against an independent
 *   brute-force evaluator and against PokerEngine.evaluateOmahaHand.
 * - The opponents' hands are drawn from the exact joint distribution
 *   P(h1..hk) proportional to w1(h1) x ... x wk(hk) x [all disjoint from each
 *   other, the hero, the board and the dead cards]: each weighted seat is drawn
 *   independently from its own range (alias table or rejection against
 *   maxWeight), and the whole sample is redrawn when two seats collide. Seats
 *   with a random range are dealt uniformly from what is left, which is exact
 *   because the number of ways to deal them does not depend on the weighted
 *   seats' cards. No sequential conditioning, no uniform escape.
 * - The board is completed uniformly from the remaining deck.
 * - Each sample's value is the hero's high-pot share (1 / number of tied best
 *   hands, 0 when beaten); equity is the mean, se = sd / sqrt(n).
 * Never throws: invalid input returns null.
 */

export interface OmahaRangeCombo {
  cards: readonly Card[];
  weight: number;
}

export type OmahaOpponentRange =
  /** Any hand, uniform. */
  | { kind: 'random' }
  /** An explicit weighted list; combos colliding with known cards are dropped. */
  | { kind: 'combos'; combos: readonly OmahaRangeCombo[] }
  /** A weight per hand in [0, maxWeight] (default 1), sampled by exact rejection.
   * `ctx.publicHigh` is the hand's exact high score on the public board (the
   * scoreOmahaHi / scoreOmahaHiPartial scale; category = floor(/0x100000)),
   * computed on the fast integer path, 0 preflop. Use it instead of scoring
   * Card objects inside the weight: the weight runs once per proposal. */
  | { kind: 'weightFn'; weight: OmahaRangeWeight; maxWeight?: number };

export type OmahaRangeWeight = (cards: readonly Card[], ctx: { publicHigh: number }) => number;

export interface EquityVsRangesOptions {
  /** Stop early once se <= targetSE (checked every 100 samples after minSamples). */
  targetSE?: number;
  minSamples?: number;
  /** Deterministic stream (tests, replay). Default: Math.random seeded. */
  seed?: number;
  /** Cards known to be out of play (e.g. a known discard); never folded seats' unknown cards. */
  deadCards?: readonly Card[];
  /** Proposal cap per weightFn seat draw before giving up (default 20,000). */
  maxProposalsPerSeat?: number;
}

export interface EquityVsRangesResult {
  equity: number;
  se: number;
  samples: number;
  /** Share of samples the hero won outright, and tied for the best hand. */
  winShare: number;
  tieShare: number;
  /** Whole-sample redraws caused by two weighted seats colliding. */
  jointRedraws: number;
  ms: number;
  stoppedOnTargetSE: boolean;
}

const SUIT_CODE: Record<string, number> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };
const RANK_CODE: Record<string, number> = {
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  T: 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
};

/** 0..51 index, or -1 for anything that is not a card. */
function indexOf(card: Card | undefined): number {
  if (!card) return -1;
  const r = RANK_CODE[card.rank];
  const s = SUIT_CODE[card.suit];
  return r === undefined || s === undefined ? -1 : (r - 2) * 4 + s;
}
/** omahaSamplerScoring card code: rank value | suit << 4. */
const codeOfIndex = (i: number) => ((i >> 2) + 2) | ((i & 3) << 4);
const DECK_CARDS: Card[] = Array.from({ length: 52 }, (_, i) => ({
  rank: '23456789TJQKA'[i >> 2] as Card['rank'],
  suit: (['clubs', 'diamonds', 'hearts', 'spades'] as const)[i & 3],
}));

function xorshift(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

interface PreparedSeat {
  kind: 'random' | 'combos' | 'weightFn';
  /** combos: flat cards, masks, precomputed RANK_KEY pair sums, suit masks, alias table. */
  count?: number;
  handCards?: Int8Array;
  maskLo?: Int32Array;
  maskHi?: Int32Array;
  pairKeys?: Int32Array;
  suitMask?: Uint8Array;
  prob?: Float64Array;
  alias?: Int32Array;
  weight?: OmahaRangeWeight;
  maxWeight?: number;
}

function aliasTable(weights: number[]) {
  const n = weights.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i];
  const prob = new Float64Array(n);
  const alias = new Int32Array(n);
  const scaled = new Float64Array(n);
  const small: number[] = [];
  const large: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (weights[i] * n) / total;
    scaled[i] = p;
    if (p < 1) small.push(i);
    else large.push(i);
  }
  while (small.length && large.length) {
    const s = small.pop()!;
    const l = large.pop()!;
    prob[s] = scaled[s];
    alias[s] = l;
    scaled[l] = scaled[l] + scaled[s] - 1;
    if (scaled[l] < 1) small.push(l);
    else large.push(l);
  }
  for (let i = 0; i < large.length; i++) prob[large[i]] = 1;
  for (let i = 0; i < small.length; i++) prob[small[i]] = 1;
  return { prob, alias };
}

function fillHandPairKeys(
  cards: ArrayLike<number>,
  offset: number,
  holes: number,
  outPairKeys: Int32Array,
  pkOffset: number
): number {
  let seenSuits = 0;
  let dupSuits = 0;
  for (let k = 0; k < holes; k++) {
    const sb = 1 << (cards[offset + k] & 3);
    dupSuits |= seenSuits & sb;
    seenSuits |= sb;
  }
  let p = 0;
  for (let a = 0; a < holes - 1; a++) {
    const ka = RANK_KEY[cards[offset + a] >> 2];
    for (let b = a + 1; b < holes; b++) {
      outPairKeys[pkOffset + p] = ka + RANK_KEY[cards[offset + b] >> 2];
      p++;
    }
  }
  return dupSuits;
}

export function equityVsRanges(
  hero: readonly Card[],
  board: readonly Card[],
  oppRanges: readonly OmahaOpponentRange[],
  samples: number,
  options: EquityVsRangesOptions = {}
): EquityVsRangesResult | null {
  try {
    return run(hero, board, oppRanges, samples, options);
  } catch {
    return null;
  }
}

function run(
  hero: readonly Card[],
  board: readonly Card[],
  oppRanges: readonly OmahaOpponentRange[],
  maxSamples: number,
  options: EquityVsRangesOptions
): EquityVsRangesResult | null {
  const started = performance.now();
  const holes = hero.length;
  if ((holes !== 4 && holes !== 5) || board.length > 5 || (board.length > 0 && board.length < 3))
    return null;
  if (!oppRanges.length || oppRanges.length > 9 || !(maxSamples >= 1)) return null;
  const known = [...hero, ...board, ...(options.deadCards ?? [])].map(indexOf);
  if (known.some((i) => i < 0) || new Set(known).size !== known.length) return null;
  const dead = new Uint8Array(52);
  for (const i of known) dead[i] = 1;
  const live: number[] = [];
  for (let i = 0; i < 52; i++) if (!dead[i]) live.push(i);
  if (live.length < oppRanges.length * holes + 5 - board.length) return null;

  const nPairs = (holes * (holes - 1)) >> 1;
  const seats: PreparedSeat[] = [];
  let hasWeightFn = false;
  for (const range of oppRanges) {
    if (range.kind === 'random') seats.push({ kind: 'random' });
    else if (range.kind === 'weightFn') {
      const maxWeight = range.maxWeight ?? 1;
      if (!(maxWeight > 0) || !Number.isFinite(maxWeight)) return null;
      hasWeightFn = true;
      seats.push({ kind: 'weightFn', weight: range.weight, maxWeight });
    } else if (range.kind === 'combos') {
      const validHands: number[][] = [];
      const weights: number[] = [];
      for (const combo of range.combos) {
        if (!(combo.weight > 0) || !Number.isFinite(combo.weight)) continue;
        if (combo.cards.length !== holes) continue;
        const idx = combo.cards.map(indexOf);
        if (idx.some((i) => i < 0 || dead[i]) || new Set(idx).size !== holes) continue;
        validHands.push(idx);
        weights.push(combo.weight);
      }
      const m = validHands.length;
      if (!m) return null; // the range is impossible given the known cards
      const handCards = new Int8Array(m * holes);
      const maskLo = new Int32Array(m);
      const maskHi = new Int32Array(m);
      const pairKeys = new Int32Array(m * nPairs);
      const suitMask = new Uint8Array(m);
      for (let i = 0; i < m; i++) {
        const h = validHands[i];
        const cOff = i * holes;
        let lo = 0;
        let hi = 0;
        for (let t = 0; t < holes; t++) {
          const c = h[t];
          handCards[cOff + t] = c;
          if (c < 32) lo |= 1 << c;
          else hi |= 1 << (c - 32);
        }
        maskLo[i] = lo;
        maskHi[i] = hi;
        suitMask[i] = fillHandPairKeys(handCards, cOff, holes, pairKeys, i * nPairs);
      }
      const { prob, alias } = aliasTable(weights);
      seats.push({
        kind: 'combos',
        count: m,
        handCards,
        maskLo,
        maskHi,
        pairKeys,
        suitMask,
        prob,
        alias,
      });
    } else return null;
  }

  const random = xorshift(options.seed ?? Math.floor(Math.random() * 0x100000000));
  const maxProposals = options.maxProposalsPerSeat ?? 20_000;
  const minSamples = Math.max(1, options.minSamples ?? 400);
  const target = options.targetSE;
  const { loadTriples, newTriples, omahaHiTable, rankPairTable } = omahaSamplerScoring;
  const publicTri = hasWeightFn ? newTriples() : null;
  let publicTable: Int32Array | null = null;
  if (hasWeightFn && board.length >= 3 && publicTri) {
    loadTriples(
      publicTri,
      board.map((c) => codeOfIndex(indexOf(c))),
      board.length
    );
    publicTable = rankPairTable(publicTri);
  }
  const proposalCodes = hasWeightFn ? new Array<number>(holes) : [];
  const weightCtx = { publicHigh: 0 };
  const heroIdx = Int8Array.from(hero.map(indexOf));
  const heroPairKeys = new Int32Array(nPairs);
  const heroSuitMask = fillHandPairKeys(heroIdx, 0, holes, heroPairKeys, 0);
  const boardIdx = board.map(indexOf);
  const fullBoard = new Int8Array(5);
  for (let i = 0; i < boardIdx.length; i++) fullBoard[i] = boardIdx[i];
  const k = seats.length;
  const oppIdx: Int32Array[] = seats.map(() => new Int32Array(holes));
  const oppPick = new Int32Array(k);
  const dynPairKeys = new Int32Array(nPairs);
  const scratchCards: Card[] = hasWeightFn ? new Array(holes) : [];
  const liveArr = Int8Array.from(live);
  const liveLen = liveArr.length;
  const pool = new Int8Array(liveLen);
  const bt = createFiveBoardTriples();
  let sum = 0;
  let sumSq = 0;
  let wins = 0;
  let ties = 0;
  let n = 0;
  let jointRedraws = 0;
  let stoppedOnTargetSE = false;

  /** One hand from a weightFn seat, uniform proposal over the live deck. */
  const drawWeighted = (seat: PreparedSeat, into: Int32Array): boolean => {
    for (let p = 0; p < maxProposals; p++) {
      for (let h = 0; h < holes; h++) {
        let pick: number;
        do pick = live[Math.floor(random() * live.length)];
        while (into.subarray(0, h).includes(pick));
        into[h] = pick;
      }
      for (let h = 0; h < holes; h++) {
        scratchCards[h] = DECK_CARDS[into[h]];
        proposalCodes[h] = codeOfIndex(into[h]);
      }
      weightCtx.publicHigh =
        publicTable && publicTri ? omahaHiTable(proposalCodes, publicTri, publicTable) : 0;
      const w = seat.weight!(scratchCards, weightCtx);
      if (!(w >= 0) || w > seat.maxWeight! * (1 + 1e-9)) throw new Error('weight out of range');
      if (w > 0 && random() * seat.maxWeight! < w) return true;
    }
    return false;
  };

  sampleLoop: while (n < maxSamples) {
    // 1. weighted seats, independently, redrawn jointly on any collision
    let redraws = 0;
    let usedLo = 0;
    let usedHi = 0;
    for (;;) {
      usedLo = 0;
      usedHi = 0;
      let collided = false;
      for (let s = 0; s < k && !collided; s++) {
        const seat = seats[s];
        if (seat.kind === 'random') continue;
        if (seat.kind === 'combos') {
          const m = seat.count!;
          const col = Math.floor(random() * m);
          const pickIndex = random() < seat.prob![col] ? col : seat.alias![col];
          oppPick[s] = pickIndex;
          const mLo = seat.maskLo![pickIndex];
          const mHi = seat.maskHi![pickIndex];
          if ((usedLo & mLo) | (usedHi & mHi)) {
            collided = true;
          } else {
            usedLo |= mLo;
            usedHi |= mHi;
          }
        } else {
          if (!drawWeighted(seat, oppIdx[s])) return null;
          for (let h = 0; h < holes; h++) {
            const c = oppIdx[s][h];
            if (c < 32) {
              const bit = 1 << c;
              if (usedLo & bit) collided = true;
              usedLo |= bit;
            } else {
              const bit = 1 << (c - 32);
              if (usedHi & bit) collided = true;
              usedHi |= bit;
            }
          }
        }
      }
      if (!collided) break;
      jointRedraws++;
      if (++redraws > 10_000) return null; // the ranges cannot coexist
    }
    // 2. random seats and the board from the remaining deck
    let m = 0;
    for (let i = 0; i < liveLen; i++) {
      const c = liveArr[i];
      if (c < 32 ? (usedLo & (1 << c)) === 0 : (usedHi & (1 << (c - 32))) === 0) pool[m++] = c;
    }
    let take = 0;
    const deal = () => {
      const j = take + Math.floor(random() * (m - take));
      const v = pool[j];
      pool[j] = pool[take];
      pool[take] = v;
      take++;
      return v;
    };
    for (let s = 0; s < k; s++)
      if (seats[s].kind === 'random') for (let h = 0; h < holes; h++) oppIdx[s][h] = deal();
    for (let i = boardIdx.length; i < 5; i++) fullBoard[i] = deal();
    // 3. showdown (exact NO_FLUSH5/FLUSH5 ordering, early-out once beaten)
    loadFiveBoardTriples(bt, fullBoard[0], fullBoard[1], fullBoard[2], fullBoard[3], fullBoard[4]);
    const heroScore = scorePairKeysOnFiveBoard(
      heroPairKeys,
      0,
      nPairs,
      heroIdx,
      0,
      holes,
      heroSuitMask,
      bt,
      -1
    );
    let bestCount = 1;
    let heroBest = true;
    for (let s = 0; s < k; s++) {
      const seat = seats[s];
      let score: number;
      if (seat.kind === 'combos') {
        const pi = oppPick[s];
        score = scorePairKeysOnFiveBoard(
          seat.pairKeys!,
          pi * nPairs,
          nPairs,
          seat.handCards!,
          pi * holes,
          holes,
          seat.suitMask![pi],
          bt,
          heroScore
        );
      } else {
        const dMask = fillHandPairKeys(oppIdx[s], 0, holes, dynPairKeys, 0);
        score = scorePairKeysOnFiveBoard(
          dynPairKeys,
          0,
          nPairs,
          oppIdx[s],
          0,
          holes,
          dMask,
          bt,
          heroScore
        );
      }
      if (score > heroScore) {
        heroBest = false;
        break;
      } else if (score === heroScore) bestCount++;
    }
    const share = heroBest ? 1 / bestCount : 0;
    if (heroBest) {
      if (bestCount === 1) wins++;
      else ties++;
    }
    sum += share;
    sumSq += share * share;
    n++;
    if (target !== undefined && n >= minSamples && n % 100 === 0) {
      const mean = sum / n;
      const se = Math.sqrt(Math.max(0, sumSq / n - mean * mean) / (n - 1));
      if (se <= target) {
        stoppedOnTargetSE = true;
        break sampleLoop;
      }
    }
  }
  const mean = sum / n;
  const se = n > 1 ? Math.sqrt(Math.max(0, sumSq / n - mean * mean) / (n - 1)) : 0.5;
  return {
    equity: mean,
    se,
    samples: n,
    winShare: wins / n,
    tieShare: ties / n,
    jointRedraws,
    ms: performance.now() - started,
    stoppedOnTargetSE,
  };
}

/**
 * Zero-allocation integer fast path for equityVsPoolsEquityLane: exact same alias-table joint draws,
 * xorshift RNG stream, deck completion and showdown ordering as equityVsRanges, reading directly from
 * a precomputed PoolFastData without constructing Card objects or re-indexing combos.
 */
export function equityVsIntPools(
  hero: readonly number[],
  board: readonly number[],
  poolCards: Int8Array,
  poolFast: PoolFastData,
  ranges: readonly { parts: readonly { idx: Int32Array; weight: number }[] }[],
  maxSamples: number,
  options: { targetSE?: number; minSamples?: number; seed?: number } = {}
): EquityVsRangesResult | null {
  try {
    const started = performance.now();
    const holes = hero.length;
    if ((holes !== 4 && holes !== 5) || board.length > 5 || (board.length > 0 && board.length < 3))
      return null;
    if (!ranges.length || ranges.length > 9 || !(maxSamples >= 1) || poolFast.holeCount !== holes)
      return null;
    let deadLo = 0;
    let deadHi = 0;
    let deadCount = 0;
    for (let i = 0; i < holes; i++) {
      const c = hero[i];
      if (c < 0 || c >= 52) return null;
      if (c < 32) {
        const bit = 1 << c;
        if (deadLo & bit) return null;
        deadLo |= bit;
      } else {
        const bit = 1 << (c - 32);
        if (deadHi & bit) return null;
        deadHi |= bit;
      }
      deadCount++;
    }
    for (let i = 0; i < board.length; i++) {
      const c = board[i];
      if (c < 0 || c >= 52) return null;
      if (c < 32) {
        const bit = 1 << c;
        if (deadLo & bit) return null;
        deadLo |= bit;
      } else {
        const bit = 1 << (c - 32);
        if (deadHi & bit) return null;
        deadHi |= bit;
      }
      deadCount++;
    }
    const liveLen = 52 - deadCount;
    if (liveLen < ranges.length * holes + 5 - board.length) return null;
    const liveArr = new Int8Array(liveLen);
    let li = 0;
    for (let c = 0; c < 52; c++) {
      if (c < 32 ? (deadLo & (1 << c)) === 0 : (deadHi & (1 << (c - 32))) === 0) liveArr[li++] = c;
    }

    const k = ranges.length;
    const pMaskLo = poolFast.maskLo;
    const pMaskHi = poolFast.maskHi;
    const pPairKeys = getPoolPairKeys(poolFast, poolCards);
    const pSuitMask = poolFast.suitMask;
    const nPairs = poolFast.nPairs;
    const seatHoldingIdx: Int32Array[] = new Array(k);
    const seatProb: Float64Array[] = new Array(k);
    const seatAlias: Int32Array[] = new Array(k);
    const seatCount = new Int32Array(k);

    for (let s = 0; s < k; s++) {
      const r = ranges[s];
      let cap = 0;
      for (let p = 0; p < r.parts.length; p++) {
        const part = r.parts[p];
        if (part.idx.length > 0 && part.weight > 0) cap += part.idx.length;
      }
      if (cap === 0) return null;
      const hIdx = new Int32Array(cap);
      const weights: number[] = [];
      let m = 0;
      for (let p = 0; p < r.parts.length; p++) {
        const part = r.parts[p];
        const plen = part.idx.length;
        if (!plen || !(part.weight > 0)) continue;
        const w = part.weight / plen;
        if (!(w > 0) || !Number.isFinite(w)) continue;
        const pidx = part.idx;
        for (let t = 0; t < plen; t++) {
          const i = pidx[t];
          if ((deadLo & pMaskLo[i]) | (deadHi & pMaskHi[i])) continue;
          hIdx[m++] = i;
          weights.push(w);
        }
      }
      if (!m) return null;
      const { prob, alias } = aliasTable(weights);
      seatHoldingIdx[s] = hIdx;
      seatProb[s] = prob;
      seatAlias[s] = alias;
      seatCount[s] = m;
    }

    const random = xorshift(options.seed ?? Math.floor(Math.random() * 0x100000000));
    const minSamples = Math.max(1, options.minSamples ?? 400);
    const target = options.targetSE;
    const heroIdx = Int8Array.from(hero);
    const heroPairKeys = new Int32Array(nPairs);
    const heroSuitMask = fillHandPairKeys(heroIdx, 0, holes, heroPairKeys, 0);
    const bLen = board.length;
    const fullBoard = new Int8Array(5);
    for (let i = 0; i < bLen; i++) fullBoard[i] = board[i];
    const oppHolding = new Int32Array(k);
    const deckPool = new Int8Array(liveLen);
    const bt = createFiveBoardTriples();
    let sum = 0;
    let sumSq = 0;
    let wins = 0;
    let ties = 0;
    let n = 0;
    let jointRedraws = 0;
    let stoppedOnTargetSE = false;

    sampleLoop: while (n < maxSamples) {
      let redraws = 0;
      let usedLo = 0;
      let usedHi = 0;
      for (;;) {
        usedLo = 0;
        usedHi = 0;
        let collided = false;
        for (let s = 0; s < k && !collided; s++) {
          const m = seatCount[s];
          const col = Math.floor(random() * m);
          const pick = random() < seatProb[s][col] ? col : seatAlias[s][col];
          const hi = seatHoldingIdx[s][pick];
          oppHolding[s] = hi;
          const mLo = pMaskLo[hi];
          const mHi = pMaskHi[hi];
          if ((usedLo & mLo) | (usedHi & mHi)) {
            collided = true;
          } else {
            usedLo |= mLo;
            usedHi |= mHi;
          }
        }
        if (!collided) break;
        jointRedraws++;
        if (++redraws > 10_000) return null;
      }
      let m = 0;
      for (let i = 0; i < liveLen; i++) {
        const c = liveArr[i];
        if (c < 32 ? (usedLo & (1 << c)) === 0 : (usedHi & (1 << (c - 32))) === 0)
          deckPool[m++] = c;
      }
      let take = 0;
      for (let i = bLen; i < 5; i++) {
        const j = take + Math.floor(random() * (m - take));
        const v = deckPool[j];
        deckPool[j] = deckPool[take];
        deckPool[take] = v;
        take++;
        fullBoard[i] = v;
      }
      loadFiveBoardTriples(
        bt,
        fullBoard[0],
        fullBoard[1],
        fullBoard[2],
        fullBoard[3],
        fullBoard[4]
      );
      const heroScore = scorePairKeysOnFiveBoard(
        heroPairKeys,
        0,
        nPairs,
        heroIdx,
        0,
        holes,
        heroSuitMask,
        bt,
        -1
      );
      let bestCount = 1;
      let heroBest = true;
      for (let s = 0; s < k; s++) {
        const hi = oppHolding[s];
        const score = scorePairKeysOnFiveBoard(
          pPairKeys,
          hi * nPairs,
          nPairs,
          poolCards,
          hi * holes,
          holes,
          pSuitMask[hi],
          bt,
          heroScore
        );
        if (score > heroScore) {
          heroBest = false;
          break;
        } else if (score === heroScore) bestCount++;
      }
      const share = heroBest ? 1 / bestCount : 0;
      if (heroBest) {
        if (bestCount === 1) wins++;
        else ties++;
      }
      sum += share;
      sumSq += share * share;
      n++;
      if (target !== undefined && n >= minSamples && n % 100 === 0) {
        const mean = sum / n;
        const se = Math.sqrt(Math.max(0, sumSq / n - mean * mean) / (n - 1));
        if (se <= target) {
          stoppedOnTargetSE = true;
          break sampleLoop;
        }
      }
    }
    const mean = sum / n;
    const se = n > 1 ? Math.sqrt(Math.max(0, sumSq / n - mean * mean) / (n - 1)) : 0.5;
    return {
      equity: mean,
      se,
      samples: n,
      winShare: wins / n,
      tieShare: ties / n,
      jointRedraws,
      ms: performance.now() - started,
      stoppedOnTargetSE,
    };
  } catch {
    return null;
  }
}

/**
 * Exact high-pot equity of the hero against fixed opponent hands: every
 * remaining runout enumerated. The reference the Monte Carlo is tested against
 * and the "true equity vs the person's actual cards" of the audits.
 */
export function exactEquityVsHands(
  hero: readonly Card[],
  board: readonly Card[],
  opponents: readonly (readonly Card[])[],
  deadCards: readonly Card[] = []
): { equity: number; runouts: number } | null {
  const holes = hero.length;
  if ((holes !== 4 && holes !== 5) || board.length > 5 || (board.length > 0 && board.length < 3))
    return null;
  if (!opponents.length || opponents.some((o) => o.length !== holes)) return null;
  const known = [...hero, ...board, ...opponents.flat(), ...deadCards].map(indexOf);
  if (known.some((i) => i < 0) || new Set(known).size !== known.length) return null;
  const dead = new Uint8Array(52);
  for (const i of known) dead[i] = 1;
  const rest: number[] = [];
  for (let i = 0; i < 52; i++) if (!dead[i]) rest.push(i);
  const need = 5 - board.length;
  if (need === 5) return null; // preflop: too many runouts for an exact reference
  const { loadTriples, newTriples, omahaHiFast } = omahaSamplerScoring;
  const tri = newTriples();
  const heroCodes = hero.map((c) => codeOfIndex(indexOf(c)));
  const oppCodes = opponents.map((o) => o.map((c) => codeOfIndex(indexOf(c))));
  const codes = board.map((c) => codeOfIndex(indexOf(c)));
  let total = 0;
  let count = 0;
  const settle = () => {
    loadTriples(tri, codes, 5);
    const h = omahaHiFast(heroCodes, tri);
    let best = h;
    let bestCount = 1;
    let heroBest = true;
    for (const o of oppCodes) {
      const s = omahaHiFast(o, tri);
      if (s > best) {
        best = s;
        bestCount = 1;
        heroBest = false;
      } else if (s === best) bestCount++;
    }
    total += heroBest ? 1 / bestCount : 0;
    count++;
  };
  const recurse = (start: number, left: number) => {
    if (left === 0) return settle();
    for (let i = start; i <= rest.length - left; i++) {
      codes.push(codeOfIndex(rest[i]));
      recurse(i + 1, left - 1);
      codes.pop();
    }
  };
  recurse(0, need);
  return { equity: total / count, runouts: count };
}
