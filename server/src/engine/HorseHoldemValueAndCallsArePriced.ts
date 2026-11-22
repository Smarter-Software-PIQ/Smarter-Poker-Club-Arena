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
import { holdemPreflopScore, scoreHoldem, straightTop } from './HorseEval.js';
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
const idOf = (c: Card): number =>
  (RANK_VALUES[c.rank] - 2) * 4 + Math.max(0, SUITS.indexOf(c.suit));
const cat = (score: number): number => Math.floor(score / 0x100000);

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
  const dead = new Set([...hero, ...board].map(idOf));
  const live = DECK.filter((c) => !dead.has(idOf(c)));
  const pairs: Card[][] = [];
  for (let i = 0; i < live.length; i++)
    for (let j = i + 1; j < live.length; j++) pairs.push([live[i], live[j]]);
  let inBand = pairs.map((p) => {
    if (!band) return 1;
    const s = holdemPreflopScore(p[0], p[1], false);
    return s >= band[0] - 1e-12 && s <= band[1] + 1e-12 ? 1 : 0;
  });
  if (!inBand.some((w) => w > 0)) inBand = pairs.map(() => 1);
  const bucket = pairs.map((p) => holdemLineBucket(p, board));
  const n = board.length;
  const weight: number[] = inBand.slice();
  for (const st of line) {
    const sb = st.board;
    const bOf = (i: number) =>
      sb.length === board.length ? bucket[i] : holdemLineBucket(pairs[i], sb);
    if ('likelihood' in st) {
      for (let i = 0; i < pairs.length; i++)
        if (weight[i] > 0) weight[i] *= Math.max(0, st.likelihood[bOf(i)] ?? 1);
      continue;
    }
    const live = pairs.map((_, i) => i).filter((i) => weight[i] > 0);
    const str = new Map<number, number>();
    for (const i of live)
      str.set(i, bOf(i) * 0x10000000 + scoreHoldem([...pairs[i], ...sb], sb.length + 2, false));
    live.sort((x, y) => (str.get(y) as number) - (str.get(x) as number) || x - y);
    const tot = live.reduce((t, i) => t + weight[i], 0);
    const kept = new Array<number>(pairs.length).fill(0);
    const take = (order: number[], share: number) => {
      let want = Math.max(0, Math.min(1, share)) * tot;
      for (const i of order) {
        if (want <= 1e-12) break;
        const room = weight[i] - kept[i];
        const t = Math.min(room, want);
        kept[i] += t;
        want -= t;
      }
    };
    take(live, st.keep.top);
    // Draw bluffs proportionally within each bucket from weakest up (Air first, then WeakPairOrDraw)
    // rather than worst-kicker-first, so unmade high-card Air does not beat 100% of villain's bluffs.
    let wantBottom = Math.max(0, Math.min(1, st.keep.bottom)) * tot;
    for (let b = HoldemLineBucket.Air; b <= HoldemLineBucket.Nutted && wantBottom > 1e-12; b++) {
      let avail = 0;
      for (const i of live) if (bOf(i) === b) avail += weight[i] - kept[i];
      if (avail <= 1e-12) continue;
      const frac = Math.min(1, wantBottom / avail);
      for (const i of live) {
        if (bOf(i) !== b) continue;
        const t = (weight[i] - kept[i]) * frac;
        kept[i] += t;
        wantBottom -= t;
      }
    }
    for (const i of live) weight[i] = kept[i];
  }
  const strength = pairs.map(
    (p, i) => bucket[i] * 0x10000000 + scoreHoldem([...p, ...board], n + 2, false)
  );
  const order = pairs
    .map((_, i) => i)
    .filter((i) => weight[i] > 0)
    .sort((x, y) => strength[y] - strength[x] || x - y);
  const total = order.reduce((s, i) => s + weight[i], 0);
  const weak = order.reduce(
    (s, i) => s + (bucket[i] <= HoldemLineBucket.WeakPairOrDraw ? weight[i] : 0),
    0
  );
  return {
    combos: pairs,
    weight,
    bucket,
    strength,
    equity: pairs.map(() => 0),
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
  const rnd = generator(seed);
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
  const need = 5 - n;
  const samples = n === 3 ? HOLDEM_PRICED_FLOP_RUNOUTS : HOLDEM_PRICED_TURN_RUNOUTS;
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
