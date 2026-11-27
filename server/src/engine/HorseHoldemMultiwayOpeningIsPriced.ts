/**
 * holdemMultiwayOpeningBluffIsPriced / holdemMultiwayOpeningValueBetIsPriced (plo-lead7 2026-11-26; both default OFF,
 * read `=== true`).
 *
 * The daily NLH cash hand audit of 2026-11-26 (people against Horses, exact tier) lists 31 missed profitable bluffs
 * on the turn and river; 19 of them, 182 of 265 bb, are MULTIWAY, where holdemOpeningBluffIsPriced and
 * holdemOpeningValueBetIsPriced do nothing (heads-up only). These two options price the FIRST bet of the turn or the
 * river against two or more opponents, and only add a bet the brain did not make. Every number is a price:
 *
 *   the field's fold to a bet B into P   every opponent must fold for a bluff to win. At equilibrium the FIELD as a
 *                                        whole defends the pot once (the minimum defence is shared): its joint fold
 *                                        is the bettor's break-even a = B / (B + P), so each of N opponents folds
 *                                        a^(1/N). The joint fold is anchored there, NOT at a product of N heads-up
 *                                        fold rates and not at a product of N measured multiway fold rates.
 *   his own record                       m_i = his fold at the reference price (holdemOpeningFoldReference: his folds
 *                                        shrunk to the equilibrium anchor, K = 20) over the anchor; his fold is
 *                                        f_i = (m_i a)^(1/N), at most 0.95^(1/N). No record: m_i = 1. The joint fold
 *                                        is a x the GEOMETRIC MEAN of the m_i: one over-folder in a field of three
 *                                        moves it by the cube root of his ratio, never by the whole ratio.
 *   who folds                            the weakest f_i of HIS range read WITHOUT the Horse's cards (he cannot see
 *                                        them); with the Horse's cards removed the share below that cutoff is his
 *                                        fold given the Horse's hand (blockers), the rest is his calling part
 *   EV(bet B)                            = F' P + sum over every non-empty set S of callers of
 *                                          P(S) (r e_S (P + B_S + sum of their calls) - B_S)
 *                                        F' = product of f'_i; P(S) = product of (1 - f'_i) in S and f'_i outside it;
 *                                        e_S = the chance the Horse's hand beats EVERY caller's calling part (on the
 *                                        turn: averaged over river cards, the product taken per river card, because
 *                                        the river card is shared); B_S the part of the bet a caller covers
 *   EV(check)                            = r e_all P (e_all: beats every opponent's whole range)
 *   value bet                            the chips the callers add are won on balance:
 *                                        sum P(S) (e_S x their calls - (1 - e_S) B_S) > 0 (heads-up this is
 *                                        equity against the calling part above one half) and EV(bet) > EV(check)
 *   bluff                                no size is a value size, EV(bet) > EV(check), and F' > F (the Horse's cards
 *                                        remove more of the field's calling parts than of its folding parts: blocker
 *                                        dependent) or the Horse's line range outscores EVERY opponent's (range
 *                                        advantage on this board)
 *   size                                 the legal priced size of highest EV (never drawn)
 *
 * r: 1 on the river and when the Horse acts last, HOLDEM_PRICED_REALIZATION_OOP otherwise (the hvc module's constant).
 * Public information only: every range is built from that player's public line (HorseLogic.holdemPricedLineRead); the
 * only hole cards read are the deciding Horse's own. Draws nothing from any random stream (the river cards priced on
 * the turn are every unseen card, or an evenly spaced part of them chosen by the cards when the ranges are large).
 * No identity enters: one function for every opponent.
 */
import type { Card } from '../types.js';
import {
  HOLDEM_PRICED_FOLD_CAP,
  HOLDEM_PRICED_REFERENCE_PRICE,
  type HoldemPricedRange,
} from './HorseHoldemValueAndCallsArePriced.js';
import {
  holdemCardId,
  packHoldemBoardBits,
  scoreHoldem,
  scoreHoldemPlus2Ids,
  scoreHoldemPlus3Ids,
} from './HorseEval.js';
import { holdemFoldCutoff } from './HorseHoldemOpeningIsPriced.js';

/** The most opponents priced (2^N caller sets are enumerated). */
export const HOLDEM_MULTIWAY_OPENING_MAX_OPPONENTS = 6;
/** Turn: hand scores spent on river cards per decision at most (river cards x combinations of every range). */
export const HOLDEM_MULTIWAY_OPENING_TURN_SCORE_BUDGET = 24_000;
/** Turn: never fewer river cards than this. */
export const HOLDEM_MULTIWAY_OPENING_TURN_MIN_RIVERS = 10;

/**
 * Each opponent's fold to a bet of `risk` into `pot`, the minimum defence shared across the field: with ratios
 * m_i = foldRef_i / anchor, f_i = (m_i a)^(1/N), a = risk / (risk + pot); m_i a capped at the fold cap.
 * `joint` is their product: a x the geometric mean of the m_i (no record: exactly a, the bettor's break-even).
 */
export function holdemMultiwayFieldFold(
  foldRefs: readonly number[],
  risk: number,
  pot: number
): { each: number[]; joint: number } {
  const n = foldRefs.length;
  if (n === 0 || !(risk > 0) || !(pot > 0)) return { each: foldRefs.map(() => 0), joint: 0 };
  const price = risk / (risk + pot);
  let joint = 1;
  const each = foldRefs.map((ref) => {
    const at = Math.max(0, Math.min(1, Number.isFinite(ref) ? ref : HOLDEM_PRICED_REFERENCE_PRICE));
    const heads = Math.max(
      0,
      Math.min(HOLDEM_PRICED_FOLD_CAP, (at * price) / HOLDEM_PRICED_REFERENCE_PRICE)
    );
    const f = Math.pow(heads, 1 / n);
    joint *= f;
    return f;
  });
  return { each, joint };
}

/** One opponent as priced: his range without the Horse's cards, his fold reference, his chips. */
export interface HoldemMultiwayOpponent {
  /** his line range read WITHOUT the Horse's cards (board dead only) */
  base: HoldemPricedRange;
  /** his fold at the reference price (holdemOpeningFoldReference) */
  foldRef: number;
  /** his street chips and his stack behind */
  in: number;
  stack: number;
}

export interface HoldemMultiwayOpeningSpot {
  pot: number;
  heroIn: number;
  heroStack: number;
  /** equity realization: 1 on the river or when the Horse acts last */
  r: number;
}

export interface HoldemMultiwayOpeningCandidate {
  to: number;
  ev: number;
  /** the field's joint fold without the Horse's cards (the price it answers) */
  foldBase: number;
  /** the field's joint fold given the Horse's cards */
  fold: number;
  /** the chance the Horse beats every caller, given at least one calls */
  callEquity: number;
  /** the chips the callers add, won on balance (positive: a value size) */
  calledGain: number;
  value: boolean;
}

interface Prepared {
  /** indexes into base (weight > 0, no Horse card), strongest first */
  idx: Int32Array;
  weight: Float64Array;
  strength: Float64Array;
  /** win[c * n + j]: 1 the Horse wins, 0.5 a tie, 0 he loses, -1 the combination holds scenario c's river card */
  win: Float32Array;
  total: number;
}

/**
 * The scenarios the Horse's hand is compared on: the river itself (one), or river cards on the turn (every unseen
 * card when the budget allows, else an evenly spaced part of them starting at an offset set by the cards).
 */
function riverScenarios(
  heroIds: readonly number[],
  boardIds: readonly number[],
  combos: number
): number[] {
  if (boardIds.length >= 5) return [-1];
  const dead = new Uint8Array(64);
  for (const x of heroIds) dead[x] = 1;
  for (const x of boardIds) dead[x] = 1;
  const deck: number[] = [];
  for (let id = 0; id < 52; id++) if (dead[id] === 0) deck.push(id);
  const want = Math.max(
    HOLDEM_MULTIWAY_OPENING_TURN_MIN_RIVERS,
    Math.floor(HOLDEM_MULTIWAY_OPENING_TURN_SCORE_BUDGET / Math.max(1, combos))
  );
  if (want >= deck.length) return deck;
  let h = 0x811c9dc5;
  for (const x of [...heroIds, ...boardIds]) h = Math.imul(h ^ (x + 1), 0x01000193);
  const start = (h >>> 0) % deck.length;
  const out: number[] = [];
  for (let k = 0; k < want; k++)
    out.push(deck[(start + Math.floor((k * deck.length) / want)) % deck.length]);
  return out;
}

function prepare(
  base: HoldemPricedRange,
  heroIds: readonly number[],
  boardIds: readonly number[],
  scenarios: readonly number[]
): Prepared {
  const keep: number[] = [];
  const ids: number[] = [];
  for (const i of base.order) {
    if (!(base.weight[i] > 0)) continue;
    const a = holdemCardId(base.combos[i][0]);
    const b = holdemCardId(base.combos[i][1]);
    if (a === heroIds[0] || a === heroIds[1] || b === heroIds[0] || b === heroIds[1]) continue;
    keep.push(i);
    ids.push(a, b);
  }
  const n = keep.length;
  const weight = new Float64Array(n);
  const strength = new Float64Array(n);
  let total = 0;
  for (let j = 0; j < n; j++) {
    weight[j] = base.weight[keep[j]];
    strength[j] = base.strength[keep[j]];
    total += weight[j];
  }
  const win = new Float32Array(scenarios.length * n);
  const bits = packHoldemBoardBits(Uint8Array.from(boardIds), boardIds.length);
  for (let c = 0; c < scenarios.length; c++) {
    const rc = scenarios[c];
    const mine =
      rc < 0
        ? scoreHoldemPlus2Ids(bits, heroIds[0], heroIds[1], false)
        : scoreHoldemPlus3Ids(bits, rc, heroIds[0], heroIds[1], false);
    for (let j = 0; j < n; j++) {
      const a = ids[2 * j];
      const b = ids[2 * j + 1];
      if (rc >= 0 && (a === rc || b === rc)) {
        win[c * n + j] = -1;
        continue;
      }
      const his =
        rc < 0
          ? scoreHoldemPlus2Ids(bits, a, b, false)
          : scoreHoldemPlus3Ids(bits, rc, a, b, false);
      win[c * n + j] = mine > his ? 1 : mine === his ? 0.5 : 0;
    }
  }
  return { idx: Int32Array.from(keep), weight, strength, win, total };
}

/** The Horse's chance against a weighted part of one range, per scenario (1 where the part is empty). */
function partEquity(p: Prepared, part: Float64Array | null, scenarios: number): Float64Array {
  const n = p.idx.length;
  const out = new Float64Array(scenarios);
  for (let c = 0; c < scenarios; c++) {
    let w = 0;
    let e = 0;
    const row = c * n;
    for (let j = 0; j < n; j++) {
      const x = p.win[row + j];
      if (x < 0) continue;
      const wj = part ? part[j] : p.weight[j];
      w += wj;
      e += wj * x;
    }
    out[c] = w > 0 ? e / w : 1;
  }
  return out;
}

/**
 * Prices a bet to each legal street total `targets` against the field. `hero` the Horse's two cards, `board` four
 * or five cards. Null when the spot cannot be priced (cards, an empty range, too many opponents).
 */
export function holdemMultiwayOpeningPrice(
  spot: HoldemMultiwayOpeningSpot,
  hero: readonly Card[],
  board: readonly Card[],
  opponents: readonly HoldemMultiwayOpponent[],
  targets: readonly number[]
): { check: number; equity: number; bets: HoldemMultiwayOpeningCandidate[] } | null {
  const n = opponents.length;
  if (n < 2 || n > HOLDEM_MULTIWAY_OPENING_MAX_OPPONENTS) return null;
  if (hero.length !== 2 || (board.length !== 4 && board.length !== 5)) return null;
  const heroIds = hero.map(holdemCardId);
  const boardIds = board.map(holdemCardId);
  if (heroIds.some((x) => x < 0) || boardIds.some((x) => x < 0)) return null;
  if (new Set([...heroIds, ...boardIds]).size !== 2 + board.length) return null;
  let combos = 0;
  for (const o of opponents) combos += o.base.order.length;
  const scenarios = riverScenarios(heroIds, boardIds, combos);
  const K = scenarios.length;
  const prep = opponents.map((o) => prepare(o.base, heroIds, boardIds, scenarios));
  if (prep.some((p) => !(p.total > 0)) || opponents.some((o) => !(o.base.total > 0))) return null;

  // the check: the Horse's chance against every whole range, the product taken per scenario
  const whole = prep.map((p) => partEquity(p, null, K));
  let all = 0;
  for (let c = 0; c < K; c++) {
    let x = 1;
    for (let i = 0; i < n; i++) x *= whole[i][c];
    all += x;
  }
  all /= K;
  const check = spot.r * all * spot.pot;

  const bets: HoldemMultiwayOpeningCandidate[] = [];
  const masks = 1 << n;
  for (const to of targets) {
    const add = Math.max(0, Math.min(to - spot.heroIn, spot.heroStack));
    if (!(add > 0)) continue;
    const calls = opponents.map((o) => Math.max(0, Math.min(spot.heroIn + add - o.in, o.stack)));
    const field = holdemMultiwayFieldFold(
      opponents.map((o) => o.foldRef),
      add,
      spot.pot
    );
    const fold = new Float64Array(n);
    const callEq: Float64Array[] = [];
    for (let i = 0; i < n; i++) {
      const p = prep[i];
      const cut = holdemFoldCutoff(opponents[i].base, field.each[i]);
      const part = new Float64Array(p.idx.length);
      let folded = 0;
      for (let j = 0; j < part.length; j++) {
        const s = p.strength[j];
        const fp = s < cut.cut ? 1 : s === cut.cut ? cut.frac : 0;
        folded += p.weight[j] * fp;
        part[j] = p.weight[j] * (1 - fp);
      }
      fold[i] = Math.max(0, Math.min(1, folded / p.total));
      callEq.push(partEquity(p, part, K));
    }
    let jointFold = 1;
    for (let i = 0; i < n; i++) jointFold *= fold[i];
    let ev = jointFold * spot.pot;
    let gain = 0;
    let called = 0;
    let calledEq = 0;
    for (let mask = 1; mask < masks; mask++) {
      let pS = 1;
      let won = 0;
      let covered = 0;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i)) {
          pS *= 1 - fold[i];
          won += calls[i];
          if (calls[i] > covered) covered = calls[i];
        } else pS *= fold[i];
      }
      if (!(pS > 0)) continue;
      let eS = 0;
      for (let c = 0; c < K; c++) {
        let x = 1;
        for (let i = 0; i < n; i++) if (mask & (1 << i)) x *= callEq[i][c];
        eS += x;
      }
      eS /= K;
      const risk = Math.min(add, covered);
      ev += pS * (spot.r * eS * (spot.pot + risk + won) - risk);
      gain += pS * (eS * won - (1 - eS) * risk);
      called += pS;
      calledEq += pS * eS;
    }
    bets.push({
      to,
      ev,
      foldBase: field.joint,
      fold: jointFold,
      callEquity: called > 0 ? calledEq / called : all,
      calledGain: gain,
      value: gain > 1e-9,
    });
  }
  return { check, equity: all, bets };
}

/** The best candidate of a kind (value or not), or null. Ties keep the smaller size. */
export function holdemMultiwayOpeningBest(
  bets: readonly HoldemMultiwayOpeningCandidate[],
  value: boolean
): HoldemMultiwayOpeningCandidate | null {
  let best: HoldemMultiwayOpeningCandidate | null = null;
  for (const b of bets) {
    if (b.value !== value) continue;
    if (!best || b.ev > best.ev + 1e-9) best = b;
  }
  return best;
}

/**
 * Range advantage over the field: the lowest, over the opponents, of the probability that a combination of the
 * Horse's line range outscores one of his (both read without anyone's hole cards, by the made hand on this board,
 * ties half). The advantage is the Horse's only when it is above one half against EVERY opponent.
 */
export function holdemMultiwayRangeAdvantage(
  mine: HoldemPricedRange,
  others: readonly HoldemPricedRange[],
  board: readonly Card[]
): number {
  if (others.length === 0) return 0.5;
  const scored = (r: HoldemPricedRange) => {
    const out: Array<[number, number]> = [];
    for (const i of r.order) {
      const w = r.weight[i];
      if (!(w > 0)) continue;
      out.push([scoreHoldem([...r.combos[i], ...board], board.length + 2, false), w]);
    }
    out.sort((a, b) => a[0] - b[0]);
    return out;
  };
  const a = scored(mine);
  const wa = a.reduce((x, y) => x + y[1], 0);
  if (!(wa > 0)) return 0.5;
  let lowest = 1;
  for (const o of others) {
    const b = scored(o);
    const wb = b.reduce((x, y) => x + y[1], 0);
    if (!(wb > 0)) return 0.5;
    let j = 0;
    let below = 0;
    let total = 0;
    for (const [s, w] of a) {
      while (j < b.length && b[j][0] < s) below += b[j++][1];
      let tie = 0;
      for (let t = j; t < b.length && b[t][0] === s; t++) tie += b[t][1];
      total += w * (below + tie / 2);
    }
    lowest = Math.min(lowest, total / (wa * wb));
  }
  return lowest;
}
