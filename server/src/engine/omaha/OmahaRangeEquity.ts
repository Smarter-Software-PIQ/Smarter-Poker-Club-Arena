import type { Card } from '../../types.js';
import { omahaSamplerScoring } from './OmahaVariantSampler.js';

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
  /** combos: index lists, alias table. */
  hands?: Int32Array[];
  prob?: Float64Array;
  alias?: Int32Array;
  weight?: OmahaRangeWeight;
  maxWeight?: number;
}

function aliasTable(weights: number[]) {
  const n = weights.length;
  const total = weights.reduce((a, b) => a + b, 0);
  const prob = new Float64Array(n);
  const alias = new Int32Array(n);
  const scaled = weights.map((w) => (w * n) / total);
  const small: number[] = [];
  const large: number[] = [];
  scaled.forEach((p, i) => (p < 1 ? small : large).push(i));
  while (small.length && large.length) {
    const s = small.pop()!;
    const l = large.pop()!;
    prob[s] = scaled[s];
    alias[s] = l;
    scaled[l] = scaled[l] + scaled[s] - 1;
    (scaled[l] < 1 ? small : large).push(l);
  }
  for (const i of large) prob[i] = 1;
  for (const i of small) prob[i] = 1;
  return { prob, alias };
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

  const seats: PreparedSeat[] = [];
  for (const range of oppRanges) {
    if (range.kind === 'random') seats.push({ kind: 'random' });
    else if (range.kind === 'weightFn') {
      const maxWeight = range.maxWeight ?? 1;
      if (!(maxWeight > 0) || !Number.isFinite(maxWeight)) return null;
      seats.push({ kind: 'weightFn', weight: range.weight, maxWeight });
    } else if (range.kind === 'combos') {
      const hands: Int32Array[] = [];
      const weights: number[] = [];
      for (const combo of range.combos) {
        if (!(combo.weight > 0) || !Number.isFinite(combo.weight)) continue;
        if (combo.cards.length !== holes) continue;
        const idx = combo.cards.map(indexOf);
        if (idx.some((i) => i < 0 || dead[i]) || new Set(idx).size !== holes) continue;
        hands.push(Int32Array.from(idx));
        weights.push(combo.weight);
      }
      if (!hands.length) return null; // the range is impossible given the known cards
      const { prob, alias } = aliasTable(weights);
      seats.push({ kind: 'combos', hands, prob, alias });
    } else return null;
  }

  const random = xorshift(options.seed ?? Math.floor(Math.random() * 0x100000000));
  const maxProposals = options.maxProposalsPerSeat ?? 20_000;
  const minSamples = Math.max(1, options.minSamples ?? 400);
  const target = options.targetSE;
  const { loadTriples, newTriples, omahaHiFast, omahaHiTable, rankPairTable } = omahaSamplerScoring;
  const tri = newTriples();
  const publicTri = newTriples();
  let publicTable: Int32Array | null = null;
  if (board.length >= 3) {
    loadTriples(
      publicTri,
      board.map((c) => codeOfIndex(indexOf(c))),
      board.length
    );
    publicTable = rankPairTable(publicTri);
  }
  const proposalCodes = new Array<number>(holes);
  const weightCtx = { publicHigh: 0 };
  const heroCodes = hero.map((c) => codeOfIndex(indexOf(c)));
  const boardIdx = board.map(indexOf);
  const boardCodes = new Array<number>(5);
  for (let i = 0; i < boardIdx.length; i++) boardCodes[i] = codeOfIndex(boardIdx[i]);
  const k = seats.length;
  const oppIdx: Int32Array[] = seats.map(() => new Int32Array(holes));
  const oppCodes: number[][] = seats.map(() => new Array<number>(holes));
  const used = new Uint8Array(52);
  const scratchCards: Card[] = new Array(holes);
  const pool = new Int32Array(live.length);
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
      // partial Fisher-Yates on a copy of the live deck positions
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
      weightCtx.publicHigh = publicTable ? omahaHiTable(proposalCodes, publicTri, publicTable) : 0;
      const w = seat.weight!(scratchCards, weightCtx);
      if (!(w >= 0) || w > seat.maxWeight! * (1 + 1e-9)) throw new Error('weight out of range');
      if (w > 0 && random() * seat.maxWeight! < w) return true;
    }
    return false;
  };

  sampleLoop: while (n < maxSamples) {
    // 1. weighted seats, independently, redrawn jointly on any collision
    let redraws = 0;
    for (;;) {
      used.fill(0);
      let collided = false;
      for (let s = 0; s < k && !collided; s++) {
        const seat = seats[s];
        if (seat.kind === 'random') continue;
        if (seat.kind === 'combos') {
          const m = seat.hands!.length;
          const col = Math.floor(random() * m);
          const pickIndex = random() < seat.prob![col] ? col : seat.alias![col];
          oppIdx[s].set(seat.hands![pickIndex]);
        } else if (!drawWeighted(seat, oppIdx[s])) return null;
        for (let h = 0; h < holes; h++) {
          const c = oppIdx[s][h];
          if (used[c]) collided = true;
          used[c] = 1;
        }
      }
      if (!collided) break;
      jointRedraws++;
      if (++redraws > 10_000) return null; // the ranges cannot coexist
    }
    // 2. random seats and the board from the remaining deck
    let m = 0;
    for (const c of live) if (!used[c]) pool[m++] = c;
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
    for (let i = boardIdx.length; i < 5; i++) boardCodes[i] = codeOfIndex(deal());
    // 3. showdown
    loadTriples(tri, boardCodes, 5);
    const heroScore = omahaHiFast(heroCodes, tri);
    let best = heroScore;
    let bestCount = 1;
    let heroBest = true;
    for (let s = 0; s < k; s++) {
      const codes = oppCodes[s];
      for (let h = 0; h < holes; h++) codes[h] = codeOfIndex(oppIdx[s][h]);
      const score = omahaHiFast(codes, tri);
      if (score > best) {
        best = score;
        bestCount = 1;
        heroBest = false;
      } else if (score === best) bestCount++;
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
