/**
 * HOLD'EM LATE STREET IS PRICED (option holdemLateStreetIsPriced, default OFF, read `=== true`) and its separate
 * bluff-raise option (holdemLateStreetBluffRaiseIsPriced, default OFF, acts only with the first one on).
 *
 * Owner 2026-11-24 (Hold'em late-street audit, plo-lead6): a late-street bluff, bet or raise, is never random; it is
 * made when the math supports it. One priced chooser decides every No-Limit Hold'em turn and river decision in its
 * scope (cash, Lightning, tournaments; heads-up and multiway), replacing the random and fixed-frequency paths and the
 * blanket rules of HorseLogic.decidePostflop for those spots (it is the outermost answer of wager_rules, so no earlier
 * rule can veto it). Nothing is drawn at random: every term below is a price.
 *
 * INPUTS, per live opponent o (only the Horse's own cards, the board and the public line):
 *   R_o      his line range (HorseHoldemTurnRiverRaiseNeedsValue.holdemOpponentLineRange: his preflop band narrowed by
 *            his public line), the Horse's equity against every combination (exact river, seeded runouts turn).
 *            Exact card removal: no combination holding a Horse card or a board card is in R_o.
 *   F_o(s)   his fold to a bet of s x pot on this street and LINE (after a check-through, a barrel, a lead, other):
 *            his own record (fold to a bet at the reference price, scaled by the price) weighted n/(n + 30), the rest
 *            the fitted population curve HOLDEM_LATE_FOLD_PRIOR (Horse and person decisions together, refit with
 *            scripts/horse-measure/holdem-late-street/fit.py; never an is-person branch).
 *   blockers the share of his strong (top pair or better) and weak combinations, on the board alone, that hold one of
 *            the Horse's cards (bv, bw); the fold becomes F(1 - bw) / (F(1 - bw) + (1 - F)(1 - bv)).
 *   nut adv  N = (nutted share of the Horse's own line range) - (nutted share of R_o); the fold is scaled by
 *            (1 + HOLDEM_LATE_NUT_ADV_WEIGHT x N) and capped by the weak share of R_o.
 *   beta_o   his bluff share for a bet of s on this line: his record (shown big-bet value tendency) weighted
 *            n/(n + 30), the rest the balanced share s/(1 + 2s) (the minimum-defence prior; the fitted population bluff
 *            share is below it and is kept only as a reference in HOLDEM_LATE_BLUFF_SHARE_POPULATION).
 *
 * OPENING (checked to, or first to act): every legal size s in {1/3, 1/2, 3/4, 1, 1.5 (river)} and all in (within
 * 1.5 pots) is priced against check, jointly over the field (no per-opponent penalty on top of the equity):
 *   EV(bet s) = sum over every subset C of opponents that continue, P(C) x [ C empty: P ; else r x prod_{o in C}
 *               eqc_o x (P + s x P x (|C| + 1)) - s x P ],   P(C) = prod_{o in C}(1 - f_o) x prod_{o not in C} f_o,
 *   eqc_o the equity against the top (1 - f_o) of R_o; EV(check) = r x prod_o eq_o x P (showdown value);
 *   r the realization (1 river or last to act, 0.88 out of position on the turn). The best EV wins; a tie checks.
 * FACING A BET: EV(call) = r x E x (P + c) - c, E = [(1 - beta) x eq(top 1 - beta of R_b) + beta x eq(bottom beta of
 *   R_b)] x prod over the others still in (called: eq against their range; still to act: f + (1 - f) x eq); a tie calls.
 *   A raise the decision already carries stands only when holdemTurnRiverRaiseNeedsValue's value test passes; with
 *   holdemLateStreetBluffRaiseIsPriced also on, a non-value raise to T is made when EV(raise T) beats call and fold:
 *   EV(raise) = f_r x P + (1 - f_r) x (r x eqc x (P + add + his) - add), f_r his fold to a raise (blockers and nut
 *   advantage as above, prior HOLDEM_LATE_FOLD_TO_RAISE_PRIOR).
 *
 * FLOP (option holdemFlopIsPriced, default OFF, cash and Lightning only; plo-lead6 BUILD-II step 2): the same model on
 * the flop. The line of a flop wager is the bettor's preflop role (barrel = he made the last preflop raise, lead =
 * another player did, checkthrough = a limped pot), priors fitted on NLH cash. Raises: a value raise (ahead of the
 * continuing part of every live range) at every legal size; a non-value raise only heads-up, in position, with a combo
 * draw, when its EV beats call and fold (owner: a draw is never raised out of position). On every street the
 * constant realization is replaced by a computed one (holdemLateRealization): a two-street look-ahead over every next
 * card (flop: a sampled river behind it) in which he bets his range's top and balanced bottom, the Horse calls a bet
 * when the call pays, bets into his checking range when that pays (in position) or leads when that pays (out of
 * position): draw equity is credited with the bets it wins when it completes (implied odds) and debited with the
 * equity it gives up when it must fold to a bet (realization). Realization = that value over the raw equity.
 *
 * Receipts (counted live): holdem_late_priced_{check,bet_value,bet_bluff,call,fold,raise_value,bluff_raise,
 * unpriced,failed}, holdem_flop_priced_{check,bet_value,bet_bluff,call,fold,raise_value,draw_raise} (flop),
 * holdem_late_priced_blocker_decided, holdem_late_priced_nut_advantage_decided (the term changed the
 * best action), holdem_late_priced_record_decided (his record moved the fold or the bluff share enough to change it).
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { noteDecisionRuleReceipt, noteFire, telemetryOn } from './BrainTelemetry.js';
import {
  holdemCardId,
  packHoldemBoardBits,
  scoreHoldem,
  scoreHoldemPlus2Ids,
  straightTop,
} from './HorseEval.js';
import { RANK_VALUES } from './PokerEngine.js';
import {
  HOLDEM_PRICED_REFERENCE_PRICE,
  holdemEquityOfShare,
  holdemHandIsMade,
  holdemLineBucket,
  holdemPricedSeed,
  type HoldemPricedRange,
} from './HorseHoldemValueAndCallsArePriced.js';
import {
  holdemHeroLastToAct,
  holdemLateRaiseScope,
  HOLDEM_LATE_RAISE_VALUE_EQUITY,
  holdemLateRaiseVerdict,
  holdemOpponentLineRange,
  type HoldemOpponentRange,
} from './HorseHoldemTurnRiverRaiseNeedsValue.js';
import {
  HOLDEM_LATE_BET_SHARE_PRIOR,
  HOLDEM_LATE_FOLD_PRIOR,
  HOLDEM_LATE_FOLD_PRIOR_N,
  HOLDEM_LATE_FOLD_TO_RAISE_PRIOR,
  HOLDEM_LATE_FOLD_TO_RAISE_PRIOR_N,
  HOLDEM_LATE_PRIORS_VERSION,
} from './HorseHoldemLateStreetPriors.js';

export { HOLDEM_LATE_PRIORS_VERSION };
export const HOLDEM_LATE_STREET_IS_PRICED = 'holdemLateStreetIsPriced';
export const HOLDEM_LATE_STREET_BLUFF_RAISE_IS_PRICED = 'holdemLateStreetBluffRaiseIsPriced';
export const HOLDEM_FLOP_IS_PRICED = 'holdemFlopIsPriced';
/** The next street's bet in the realization look-ahead, in pots (the population's median turn/river bet). */
export const HOLDEM_LATE_LOOKAHEAD_BET = 2 / 3;
/** Bounds of the computed realization (value over raw equity). */
export const HOLDEM_LATE_RHO_MIN = 0.25;
export const HOLDEM_LATE_RHO_MAX = 2;
/** Rivers sampled behind each turn card in the flop look-ahead (seeded by the spot; never a decision roll). */
export const HOLDEM_LATE_FLOP_LOOKAHEAD_RIVERS = 2;
/** Weight of his own record against the prior: n / (n + K). */
export const HOLDEM_LATE_RECORD_K = 30;
/** Fold multiplier per unit of nut advantage (Horse's nutted share minus his). */
export const HOLDEM_LATE_NUT_ADV_WEIGHT = 0.5;
/** Weight of the fitted population fold prior against the indifference fold s / (1 + s). */
export const HOLDEM_LATE_PRIOR_TRUST = 0.5;
/** Sample size at which a population cell is trusted half (before the over-fold halving). */
export const HOLDEM_LATE_PRIOR_N0 = 200;
export const HOLDEM_LATE_OPEN_FRACTIONS = [1 / 3, 0.5, 0.75, 1] as const;
export const HOLDEM_LATE_RIVER_OVERBET = 1.5;
export const HOLDEM_LATE_MAX_OPPONENTS = 5;
/** EVs within this share of the pot are a tie (the fixed order decides; never a draw). */
export const HOLDEM_LATE_TIE = 1e-6;
const EPS = 0.005;

export type HoldemLateLine = 'checkthrough' | 'barrel' | 'lead' | 'other';
export type HoldemPricedStreet = 'flop' | 'turn' | 'river';
const PREVIOUS_STREET: Record<HoldemPricedStreet, string> = {
  flop: 'preflop',
  turn: 'flop',
  river: 'turn',
};
export const holdemLateSizeBucket = (s: number): 0 | 1 | 2 | 3 =>
  s <= 0.34 ? 0 : s <= 0.67 ? 1 : s <= 1.01 ? 2 : 3;

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const isWager = (a: string) => a === 'bet' || a === 'raise' || a === 'all_in';

/**
 * The line of `who` (the player who wagers, or would) from the street before: a check-through, his own barrel, a
 * lead (another player's wager), or other. On the flop the street before is preflop: barrel = he made the last
 * preflop raise, lead = another player did, checkthrough = nobody raised.
 */
export function holdemLateLineOf(
  gs: HorseGameStateV2,
  who: SeatPlayer,
  street: HoldemPricedStreet
): HoldemLateLine {
  const prev = PREVIOUS_STREET[street];
  const hist = (gs.actionHistory ?? []).filter((a) => a.stage === prev);
  if (hist.length === 0) return 'other';
  const wagers = hist.filter(
    (a) =>
      (prev === 'preflop' ? a.action !== 'bet' : true) && isWager(a.action) && num(a.amount) > 0
  );
  if (wagers.length === 0) return 'checkthrough';
  const last = wagers[wagers.length - 1]!;
  const mine = last.userId !== undefined ? last.userId === who.user_id : last.seat === who.seat;
  return mine ? 'barrel' : 'lead';
}

/** The population fold to a bet of s x pot (or to a raise) at this street and line. */
export function holdemLateFoldPrior(
  street: HoldemPricedStreet,
  line: HoldemLateLine,
  s: number
): number {
  const row = HOLDEM_LATE_FOLD_PRIOR[street][line];
  return clamp01(row[holdemLateSizeBucket(s)]!);
}

/**
 * Trust in the population fold prior of one cell: n / (n + HOLDEM_LATE_PRIOR_N0) for the cell's sample, halved when the
 * population itself over-folds there (its fold above the indifference fold s / (1 + s) by more than 0.10: a field that
 * changes once these options go live). The rest of the prior is the indifference fold. His own record then dominates
 * by n / (n + HOLDEM_LATE_RECORD_K).
 */
export function holdemLatePriorTrust(
  street: HoldemPricedStreet,
  line: HoldemLateLine,
  s: number,
  pop: number,
  raise: boolean
): number {
  const n = raise
    ? num(HOLDEM_LATE_FOLD_TO_RAISE_PRIOR_N[street])
    : num(HOLDEM_LATE_FOLD_PRIOR_N[street]?.[line]?.[holdemLateSizeBucket(s)]);
  const sample = n / (n + HOLDEM_LATE_PRIOR_N0);
  return pop > s / (1 + s) + 0.1 ? sample * HOLDEM_LATE_PRIOR_TRUST : sample;
}

/** His fold to a wager laying `s` x pot: his record (price-scaled) weighted n/(n+K), the rest the prior. */
export function holdemLateFoldOf(
  opp: SeatPlayer,
  street: HoldemPricedStreet,
  line: HoldemLateLine,
  s: number,
  mind: boolean,
  raise = false
): { f: number; recordWeight: number } {
  // The population prior is measured on a field that is itself changing (the Horses' own over-fold), so it is trusted
  // HOLDEM_LATE_PRIOR_TRUST and the rest is the indifference fold s / (1 + s) (where a bluff of s neither wins nor
  // loses); his own record then moves it by n / (n + K).
  const pop = raise
    ? clamp01(HOLDEM_LATE_FOLD_TO_RAISE_PRIOR[street])
    : holdemLateFoldPrior(street, line, s);
  const trust = holdemLatePriorTrust(street, line, s, pop, raise);
  const prior = trust * pop + (1 - trust) * (s / (1 + s));
  if (!mind) return { f: prior, recordWeight: 0 };
  let n = 0;
  let rate = prior;
  try {
    const scope = HorseMind.currentScope();
    const c = scope ? HorseMind.getExploitCounters(opp.user_id, scope) : undefined;
    if (c && num(c.foldToBetOpp) > 0) {
      n = num(c.foldToBetOpp);
      const atRef = num(c.foldToBet) / n;
      const price = s / (1 + s);
      rate = clamp01((atRef * price) / HOLDEM_PRICED_REFERENCE_PRICE);
    }
  } catch {
    n = 0;
  }
  const w = n / (n + HOLDEM_LATE_RECORD_K);
  return { f: clamp01(w * rate + (1 - w) * prior), recordWeight: w };
}

/**
 * The share of his range a player bets with the first wager of a street (the line range keeps it): the fitted
 * population bet share for his line and position (first to act, or checked to; HOLDEM_LATE_BET_SHARE_PRIOR from NLH
 * cash hands that reached the flop), moved toward his own bet-when-checked-to record by n / (n + 30). Replaces the
 * single generic bet-when-checked-to read (about 0.31) the builder otherwise uses for every first wager, which read a
 * c-bet (made about 75% of the time) as a narrow, value-heavy range.
 */
export function holdemLateBetShareOf(
  gs: HorseGameStateV2,
  mind: boolean
): (stage: HoldemPricedStreet, index: number) => number | null {
  const history = gs.actionHistory ?? [];
  return (stage, index) => {
    const x = history[index];
    if (!x) return null;
    const who = (gs.players ?? []).find((p) =>
      x.userId !== undefined ? p.user_id === x.userId : p.seat === x.seat
    );
    if (!who) return null;
    const before = history.slice(0, index);
    const line = holdemLateLineOf({ ...gs, actionHistory: before } as HorseGameStateV2, who, stage);
    const pos = before.some((a) => a.stage === stage && a.action === 'check')
      ? 'checkedTo'
      : 'first';
    const prior = HOLDEM_LATE_BET_SHARE_PRIOR[stage]?.[line]?.[pos];
    if (typeof prior !== 'number') return null;
    if (!mind) return prior;
    try {
      const scope = HorseMind.currentScope();
      const c = scope ? HorseMind.getExploitCounters(who.user_id, scope) : undefined;
      const n = num(c?.betCheckedToOpp);
      if (!(n > 0)) return prior;
      const w = n / (n + HOLDEM_LATE_RECORD_K);
      return clamp01(w * (num(c?.betCheckedTo) / n) + (1 - w) * prior);
    } catch {
      return prior;
    }
  };
}

/** Share of strong (top pair+) and weak combinations on the board alone that hold one of the Horse's cards. */
export function holdemLateBlockers(
  hero: readonly Card[],
  board: readonly Card[]
): { bv: number; bw: number } {
  const key = (c: Card) => `${c.rank}${c.suit}`;
  const dead = new Set(board.map(key));
  const heroKeys = new Set(hero.map(key));
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'] as const;
  const deck: Card[] = [];
  for (const r of ranks)
    for (const s of suits) {
      const c = { rank: r, suit: s } as Card;
      if (!dead.has(key(c))) deck.push(c);
    }
  let strong = 0;
  let weak = 0;
  let strongB = 0;
  let weakB = 0;
  for (let i = 0; i < deck.length; i++)
    for (let j = i + 1; j < deck.length; j++) {
      const a = deck[i]!;
      const b = deck[j]!;
      const bucket = holdemLineBucket([a, b], board);
      const blocked = heroKeys.has(key(a)) || heroKeys.has(key(b));
      if (bucket >= 3) {
        strong++;
        if (blocked) strongB++;
      } else {
        weak++;
        if (blocked) weakB++;
      }
    }
  return { bv: strong > 0 ? strongB / strong : 0, bw: weak > 0 ? weakB / weak : 0 };
}

export function holdemLateBlockedFold(f: number, bv: number, bw: number): number {
  const a = f * (1 - bw);
  const b = (1 - f) * (1 - bv);
  return a + b > 0 ? a / (a + b) : f;
}

/** A private seeded generator (mulberry32) for the look-ahead's sampled rivers: a computation, never a decision roll. */
function runoutGenerator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HoldemLateRealization {
  /** realized value over raw equity, in [HOLDEM_LATE_RHO_MIN, HOLDEM_LATE_RHO_MAX]; 1 on the river */
  rho: number;
  /** mean raw equity and mean look-ahead value over the next cards (pot shares) */
  raw: number;
  realized: number;
}

/**
 * Equity realization by a two-street look-ahead (flop and turn; 1 on the river), against one weighted range.
 * For every next card x (and on the flop HOLDEM_LATE_FLOP_LOOKAHEAD_RIVERS sampled rivers behind it, a seeded
 * computation): his combinations are ordered by strength on the board with x; he bets the top (1 - beta) pi and the
 * bottom beta pi of them (pi his bet share when checked to, beta = b / (1 + 2b) the balanced bluff share of the
 * look-ahead bet b), checks the rest, and folds a bet of b with probability F (his fold at the next street). In units
 * of the next street's pot, the Horse's value is
 *   in position:     pi' max(0, eB (1 + 2b) - b) + (1 - pi') max(eC, F + (1 - F)(eCc (1 + 2b) - b))
 *   out of position: max(that with "check behind" in place of the bet into his checks, F + (1 - F)(eA (1 + 2b) - b))
 * eB, eC: the Horse's final equity against his betting and checking parts, eCc against the part of his checks that
 * calls, eA against the top (1 - F) of all of it. A draw that completes wins the bets it is paid (implied odds); one
 * that misses and faces a bet gives up its equity when the call does not pay (realization). rho = mean value over mean
 * raw equity.
 */
export function holdemLateRealization(
  hero: readonly Card[],
  board: readonly Card[],
  range: HoldemPricedRange,
  p: { betShare: number; foldNext: number; inPosition: boolean; seed: number }
): HoldemLateRealization {
  const one: HoldemLateRealization = { rho: 1, raw: 0, realized: 0 };
  const n = board.length;
  if (n >= 5 || n < 3 || hero.length !== 2) return one;
  const h0 = holdemCardId(hero[0]!);
  const h1 = holdemCardId(hero[1]!);
  const bIds = board.map((c) => holdemCardId(c));
  if (h0 < 0 || h1 < 0 || bIds.some((x) => x < 0)) return one;
  const dead = new Uint8Array(52);
  dead[h0] = 1;
  dead[h1] = 1;
  for (const x of bIds) dead[x] = 1;
  const deck: number[] = [];
  for (let i = 0; i < 52; i++) if (dead[i] === 0) deck.push(i);
  const ca: number[] = [];
  const cb: number[] = [];
  const cw: number[] = [];
  for (const i of range.order) {
    const w = range.weight[i]!;
    if (!(w > 0)) continue;
    const c = range.combos[i]!;
    ca.push(holdemCardId(c[0]!));
    cb.push(holdemCardId(c[1]!));
    cw.push(w);
  }
  const m = cw.length;
  if (m === 0) return one;
  const b = HOLDEM_LATE_LOOKAHEAD_BET;
  const beta = b / (1 + 2 * b);
  const pi = clamp01(p.betShare);
  const F = Math.max(0, Math.min(0.98, p.foldNext));
  const rnd = runoutGenerator(p.seed);
  const ids = new Uint8Array(5);
  const str = new Float64Array(m);
  const win = new Float64Array(m);
  const ok = new Uint8Array(m);
  const all: number[] = Array.from({ length: m }, (_, j) => j);
  let raw = 0;
  let real = 0;
  let count = 0;
  const flop = n === 3;
  for (const x of deck) {
    for (let k = 0; k < n; k++) ids[k] = bIds[k]!;
    ids[n] = x;
    const next = packHoldemBoardBits(ids, n + 1);
    const rivers: number[] = [];
    const finals: ReturnType<typeof packHoldemBoardBits>[] = [];
    const heroFinal: number[] = [];
    if (flop) {
      const rest = deck.filter((y) => y !== x);
      while (rivers.length < HOLDEM_LATE_FLOP_LOOKAHEAD_RIVERS && rivers.length < rest.length) {
        const y = rest[Math.floor(rnd() * rest.length)]!;
        if (rivers.includes(y)) continue;
        rivers.push(y);
        ids[n + 1] = y;
        const fb = packHoldemBoardBits(ids, 5);
        finals.push(fb);
        heroFinal.push(scoreHoldemPlus2Ids(fb, h0, h1, false));
      }
    } else heroFinal.push(scoreHoldemPlus2Ids(next, h0, h1, false));
    let W = 0;
    for (let j = 0; j < m; j++) {
      const a = ca[j]!;
      const bb = cb[j]!;
      ok[j] = 0;
      if (a === x || bb === x) continue;
      str[j] = scoreHoldemPlus2Ids(next, a, bb, false);
      if (flop) {
        let won = 0;
        let used = 0;
        for (let r = 0; r < rivers.length; r++) {
          const y = rivers[r]!;
          if (a === y || bb === y) continue;
          const o = scoreHoldemPlus2Ids(finals[r]!, a, bb, false);
          const h = heroFinal[r]!;
          won += h > o ? 1 : h === o ? 0.5 : 0;
          used++;
        }
        if (used === 0) continue;
        win[j] = won / used;
      } else {
        const h = heroFinal[0]!;
        const o = str[j]!;
        win[j] = h > o ? 1 : h === o ? 0.5 : 0;
      }
      ok[j] = 1;
      W += cw[j]!;
    }
    if (!(W > 0)) continue;
    const live = all.filter((j) => ok[j] === 1).sort((u, v) => str[v]! - str[u]! || u - v);
    const slice = (lo: number, hi: number): { e: number; w: number } => {
      const L = lo * W;
      const H = hi * W;
      let acc = 0;
      let e = 0;
      let w = 0;
      for (const j of live) {
        const a0 = acc;
        acc += cw[j]!;
        if (a0 >= H) break;
        const ov = Math.min(acc, H) - Math.max(a0, L);
        if (ov > 0) {
          w += ov;
          e += ov * win[j]!;
        }
      }
      return { e, w };
    };
    const eqOf = (q: { e: number; w: number }, fallback: number) =>
      q.w > 0 ? q.e / q.w : fallback;
    const whole = slice(0, 1);
    const ex = eqOf(whole, 0);
    const topEnd = (1 - beta) * pi;
    const botStart = 1 - beta * pi;
    const vb = slice(0, topEnd);
    const ab = slice(botStart, 1);
    const betW = vb.w + ab.w;
    const eB = betW > 0 ? (vb.e + ab.e) / betW : ex;
    const piEff = betW / W;
    const eC = eqOf(slice(topEnd, botStart), ex);
    const eCc = eqOf(slice(topEnd, topEnd + (botStart - topEnd) * (1 - F)), eC);
    const eA = eqOf(slice(0, 1 - F), ex);
    const callB = Math.max(0, eB * (1 + 2 * b) - b);
    const betIntoChecks = F + (1 - F) * (eCc * (1 + 2 * b) - b);
    const lead = F + (1 - F) * (eA * (1 + 2 * b) - b);
    const v = p.inPosition
      ? piEff * callB + (1 - piEff) * Math.max(eC, betIntoChecks)
      : Math.max(piEff * callB + (1 - piEff) * eC, lead);
    raw += ex;
    real += v;
    count++;
  }
  if (count === 0 || !(raw > 1e-9)) return one;
  const rho = Math.max(HOLDEM_LATE_RHO_MIN, Math.min(HOLDEM_LATE_RHO_MAX, real / raw));
  return { rho, raw: raw / count, realized: real / count };
}

/** Ranks that would complete a straight using a hole card (none when the hand already has one). */
function holeStraightOuts(hole: readonly Card[], board: readonly Card[]): number {
  const add = (m: number, r: number) => m | (1 << r) | (r === 14 ? 1 << 1 : 0);
  let mask = 0;
  let boardMask = 0;
  for (const c of hole) mask = add(mask, RANK_VALUES[c.rank]);
  for (const c of board) {
    mask = add(mask, RANK_VALUES[c.rank]);
    boardMask = add(boardMask, RANK_VALUES[c.rank]);
  }
  if (straightTop(mask, false) > 0) return 0;
  let outs = 0;
  for (let r = 2; r <= 14; r++)
    if (straightTop(add(mask, r), false) > 0 && straightTop(add(boardMask, r), false) === 0) outs++;
  return outs;
}

/** A flush draw that uses a hole card (four of a suit, no flush yet). */
function holeFlushDraw(hole: readonly Card[], board: readonly Card[]): boolean {
  if (board.length >= 5) return false;
  const count = (s: string) =>
    board.filter((c) => c.suit === s).length + hole.filter((c) => c.suit === s).length;
  if (hole.some((c) => count(c.suit) >= 5)) return false;
  return hole.some((c) => count(c.suit) === 4);
}

/** A drawing hand: a flush draw or a straight draw that uses a hole card (flop and turn). */
export function holdemIsDraw(hole: readonly Card[], board: readonly Card[]): boolean {
  if (board.length >= 5 || hole.length !== 2) return false;
  return holeFlushDraw(hole, board) || holeStraightOuts(hole, board) >= 1;
}

/**
 * A combo draw: a flush draw with a straight draw or a pair, or an open-ended straight draw with a pair (flop and
 * turn). The only non-value hand the chooser may raise with on the flop, and only in position.
 */
export function holdemIsComboDraw(hole: readonly Card[], board: readonly Card[]): boolean {
  if (board.length >= 5 || hole.length !== 2) return false;
  const fd = holeFlushDraw(hole, board);
  const outs = holeStraightOuts(hole, board);
  const made = holdemHandIsMade(hole, board);
  const pair =
    made &&
    Math.floor(scoreHoldem([...hole, ...board], hole.length + board.length, false) / 0x100000) <= 2;
  return (fd && (outs >= 1 || pair)) || (outs >= 2 && pair);
}

/** The nutted share of a weighted range (HoldemLineBucket.Nutted = 4). */
function nuttedShare(r: { weight: number[]; bucket: number[]; total: number }): number {
  if (!(r.total > 0)) return 0;
  let w = 0;
  for (let i = 0; i < r.weight.length; i++) if (r.bucket[i] === 4) w += r.weight[i]!;
  return w / r.total;
}

/** The Horse's own line range shape, read as an opponent would read it (no hole card of anyone). */
function heroLineRange(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  mind: boolean,
  liveCount: number,
  betShareOf: (stage: HoldemPricedStreet, index: number) => number | null
): HoldemPricedRange | null {
  try {
    const observer = (gs.players ?? []).find((p) => p.seat !== player.seat && !p.is_folded);
    if (!observer) return null;
    const asOpp = holdemOpponentLineRange(
      { ...observer, cards: [] } as SeatPlayer,
      gs,
      player,
      mind,
      liveCount,
      false,
      betShareOf
    );
    // the observer holds no card here: the range removes the board only, never a hidden card
    return asOpp ? asOpp.range : null;
  } catch {
    return null;
  }
}

export interface HoldemLateSpot {
  street: HoldemPricedStreet;
  /** the Horse acts after every live opponent on this street */
  inPosition: boolean;
  facing: boolean;
  pot: number;
  toCall: number;
  call: number;
  heroIn: number;
  stack: number;
  live: SeatPlayer[];
  bettor: SeatPlayer | null;
}

export function holdemLateSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  tournaments = false,
  flop = false,
  late = true
): HoldemLateSpot | null {
  if (String(gs.gameVariant ?? '').toLowerCase() !== 'nlh') return null;
  // Tournaments only under holdemLateStreetIsPricedInTournaments: the chooser prices chips; until its EVs go through
  // the Phase 7 tournament utility it must not override that utility. The flop is cash and Lightning only.
  const tourn = gs.gameMode ? gs.gameMode === 'tournament' : gs.tournament != null;
  if (gs.bettingStructure !== undefined && gs.bettingStructure !== 'no_limit') return null;
  const street = gs.stage;
  if (street === 'flop') {
    if (!flop || tourn) return null;
  } else if (street === 'turn' || street === 'river') {
    if (!late || (tourn && !tournaments)) return null;
  } else return null;
  const board = gs.communityCards ?? [];
  if (board.length !== (street === 'flop' ? 3 : street === 'turn' ? 4 : 5)) return null;
  if (gs.bombPot === true || gs.allInOrFold === true) return null;
  const g = gs as { communityCards2?: readonly unknown[]; communityCards3?: readonly unknown[] };
  if ((g.communityCards2?.length ?? 0) > 0 || (g.communityCards3?.length ?? 0) > 0) return null;
  if ((gs.boardCount ?? 1) !== 1 || gs.variantRules?.splitLow8OrBetter === true) return null;
  if (!Array.isArray(player.cards) || player.cards.length !== 2) return null;
  const live = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && !p.is_folded && (!p.is_sitting_out || p.is_all_in)
  );
  if (live.length === 0 || live.length > HOLDEM_LATE_MAX_OPPONENTS) return null;
  const heroIn = Math.max(0, num(player.bet));
  const currentBet = Math.max(num(gs.currentBet), heroIn);
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, currentBet - heroIn);
  const stack = Math.max(0, num(player.stack));
  if (!(stack > 0)) return null;
  const facing = toCall > EPS;
  if (!facing && !live.some((o) => !o.is_all_in && num(o.stack) > 0)) return null;
  let bettor: SeatPlayer | null = null;
  if (facing) bettor = lastWagerer(gs, street, live);
  const inPosition = holdemHeroLastToAct(player, gs, live);
  return {
    street,
    inPosition,
    facing,
    pot: Math.max(0, num(gs.pot)),
    toCall,
    call: Math.min(toCall, stack),
    heroIn,
    stack,
    live,
    bettor,
  };
}

/** The last live opponent who wagered on this street (public line only). */
function lastWagerer(
  gs: HorseGameStateV2,
  street: HoldemPricedStreet,
  live: SeatPlayer[]
): SeatPlayer | null {
  let bettor: SeatPlayer | null = null;
  for (const a of gs.actionHistory ?? []) {
    if (a.stage !== street || !isWager(a.action)) continue;
    const who = live.find(
      (p) =>
        (a.userId !== undefined && p.user_id === a.userId) ||
        (a.userId === undefined && p.seat === a.seat)
    );
    if (who) bettor = who;
  }
  return bettor;
}

export interface HoldemLateOption {
  kind: 'check' | 'bet' | 'call' | 'fold' | 'raise';
  to: number;
  ev: number;
  /** EV without the blocker term, without the nut-advantage term (opening and raising only) */
  evNoBlock?: number;
  evNoNut?: number;
}
export interface HoldemLateVerdict {
  options: HoldemLateOption[];
  best: HoldemLateOption;
  showdown: number;
  recordMoved: boolean;
  /** raise street totals priced, true where the raise is a value raise */
  valueRaise: Map<number, boolean>;
  /** the computed realization over the field (product over the live ranges; 1 on the river) */
  rho: number;
  /** the range-level plan (heads-up), when it decided or was consulted */
  range: HoldemLateRangePlan | null;
  /** the per-hand best before the range plan */
  perHand: HoldemLateOption;
}

interface OppRead extends HoldemOpponentRange {
  /** the line of the wager the fold prior is read for (the Horse's, when it bets) */
  line: HoldemLateLine;
  rho: number;
}

function eqProduct(reads: OppRead[]): number {
  let e = 1;
  for (const o of reads) e *= holdemEquityOfShare(o.range, 1).equity;
  return e;
}

/** EV of a wager laying s x pot (chips `add` from the Horse) against the field, jointly over who continues. */
function wagerEv(reads: OppRead[], folds: number[], P: number, add: number, r: number): number {
  const k = reads.length;
  const eqc = reads.map((o, i) => holdemEquityOfShare(o.range, 1 - folds[i]!, 'top').equity);
  let ev = 0;
  for (let mask = 0; mask < 1 << k; mask++) {
    let p = 1;
    let e = 1;
    let callers = 0;
    for (let i = 0; i < k; i++) {
      if (mask & (1 << i)) {
        p *= 1 - folds[i]!;
        e *= eqc[i]!;
        callers++;
      } else p *= folds[i]!;
    }
    if (p <= 0) continue;
    ev += callers === 0 ? p * P : p * (r * e * (P + add * (callers + 1)) - add);
  }
  return ev;
}

/** The priced verdict. `legalTo` legalizes a wager street total and returns it (NaN when illegal). */
export function holdemLateVerdict(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot: HoldemLateSpot,
  mind: boolean,
  legalTo: (to: number) => number,
  opts: { bluffRaise: boolean; decisionRaiseTo: number | null }
): HoldemLateVerdict | null {
  const board = gs.communityCards ?? [];
  const reads: OppRead[] = [];
  // the Horse's own line: the cell of HIS fold prior when the Horse wagers (the bettor's line, as fitted)
  const heroLine = holdemLateLineOf(gs, player, spot.street);
  const nextStreet: HoldemPricedStreet = spot.street === 'flop' ? 'turn' : 'river';
  const seed = holdemPricedSeed(player.cards, board, num(gs.pot));
  const betShareOf = holdemLateBetShareOf(gs, mind);
  for (const o of spot.live) {
    const r = holdemOpponentLineRange(player, gs, o, mind, spot.live.length, true, betShareOf);
    if (!r) return null;
    let rho = 1;
    if (spot.street !== 'river') {
      const foldNext = holdemLateFoldOf(
        o,
        nextStreet,
        spot.facing ? 'lead' : 'barrel',
        HOLDEM_LATE_LOOKAHEAD_BET,
        mind
      ).f;
      // his bet share on the next street: the fitted share for a player who bet this street (facing: him) or who
      // faced the Horse's wager (opening), first to act when the Horse is in position
      const nextShare =
        HOLDEM_LATE_BET_SHARE_PRIOR[nextStreet][spot.facing ? 'barrel' : 'lead'][
          spot.inPosition ? 'first' : 'checkedTo'
        ];
      rho = holdemLateRealization(player.cards, board, r.range, {
        betShare: nextShare,
        foldNext,
        inPosition: spot.inPosition,
        seed: (seed ^ Math.imul(o.seat + 1, 0x9e3779b1)) >>> 0,
      }).rho;
    }
    reads.push({ ...r, line: heroLine, rho });
  }
  let rho = 1;
  for (const o of reads) rho *= o.rho;
  rho = Math.max(HOLDEM_LATE_RHO_MIN, Math.min(HOLDEM_LATE_RHO_MAX, rho));
  const P = spot.pot;
  const showdown = eqProduct(reads);
  const { bv, bw } = holdemLateBlockers(player.cards, board);
  const heroBuilt = heroLineRange(player, gs, mind, spot.live.length, betShareOf);
  const heroNut = heroBuilt ? nuttedShare(heroBuilt) : null;
  // the range-level plan reads the Horse's own range as this model itself would hold it (heads-up only)
  const heroR = spot.live.length === 1 ? heroPlanRange(player, gs, mind, 1, betShareOf) : null;
  let facingBeta: number | null = null;
  let recordMoved = false;
  const foldsFor = (s: number, raise: boolean, withBlock: boolean, withNut: boolean) =>
    reads.map((o) => {
      if (o.opp.is_all_in || !(num(o.opp.stack) > 0)) return 0;
      const fr = holdemLateFoldOf(o.opp, spot.street, o.line, s, mind, raise);
      if (fr.recordWeight > 0.2) recordMoved = true;
      let f = fr.f;
      if (withBlock) f = holdemLateBlockedFold(f, bv, bw);
      if (withNut && heroNut !== null)
        f = f * (1 + HOLDEM_LATE_NUT_ADV_WEIGHT * (heroNut - nuttedShare(o.range)));
      return Math.max(0, Math.min(f, o.range.weakShare, 0.98));
    });
  const options: HoldemLateOption[] = [];
  const valueRaise = new Map<number, boolean>();
  if (!spot.facing) {
    options.push({
      kind: 'check',
      to: 0,
      ev: rho * showdown * P,
      evNoBlock: rho * showdown * P,
      evNoNut: rho * showdown * P,
    });
    const effAll = Math.min(
      spot.heroIn + spot.stack,
      Math.max(...reads.map((o) => num(o.opp.bet) + num(o.opp.stack)))
    );
    const fracs: number[] = [...HOLDEM_LATE_OPEN_FRACTIONS];
    if (spot.street === 'river') fracs.push(HOLDEM_LATE_RIVER_OVERBET);
    const targets = new Set<number>();
    for (const fr of fracs) targets.add(legalTo(Math.min(spot.heroIn + fr * P, effAll)));
    if (effAll - spot.heroIn <= 1.5 * P) targets.add(legalTo(effAll));
    for (const to of targets) {
      if (!Number.isFinite(to) || !(to > spot.heroIn)) continue;
      const add = Math.min(to - spot.heroIn, spot.stack);
      const s = add / Math.max(1e-9, P);
      options.push({
        kind: 'bet',
        to,
        ev: wagerEv(reads, foldsFor(s, false, true, true), P, add, rho),
        evNoBlock: wagerEv(reads, foldsFor(s, false, false, true), P, add, rho),
        evNoNut: wagerEv(reads, foldsFor(s, false, true, false), P, add, rho),
      });
    }
  } else {
    const b = spot.bettor ? reads.find((o) => o.opp.seat === spot.bettor!.seat) : reads[0];
    if (!b) return null;
    const potBefore = Math.max(1e-9, P - spot.toCall);
    const s = spot.toCall / potBefore;
    let beta = s / (1 + 2 * s);
    if (mind) {
      try {
        const tend = HorseMind.bigBetValueTendency(b.opp.user_id);
        if (tend !== null && spot.street === 'river' && s >= 0.7) {
          const w = 0.5;
          beta = w * (1 - tend) + (1 - w) * beta;
          recordMoved = true;
          facingBeta = beta;
        }
      } catch {
        /* the balanced prior stands */
      }
    }
    beta = clamp01(beta);
    let E =
      (1 - beta) * holdemEquityOfShare(b.range, 1 - beta, 'top').equity +
      beta * holdemEquityOfShare(b.range, beta, 'bottom').equity;
    for (const o of reads) {
      if (o === b) continue;
      const eq = holdemEquityOfShare(o.range, 1).equity;
      const acted = (gs.actionHistory ?? []).some(
        (a) =>
          a.stage === spot.street &&
          (a.userId === o.opp.user_id || (a.userId === undefined && a.seat === o.opp.seat)) &&
          a.action === 'call'
      );
      if (acted || o.opp.is_all_in) E *= eq;
      else {
        const f = holdemLateFoldOf(o.opp, spot.street, 'other', s, mind).f;
        E *= f + (1 - f) * eq;
      }
    }
    // A hand whose equity against his whole value part (the top 1 - beta) already pays the price never folds: the
    // bluff part can only add to it (guards a bluff part the line range filled with value combinations).
    const eqValue = holdemEquityOfShare(b.range, 1 - beta, 'top').equity;
    if (eqValue > E) E = eqValue;
    options.push({ kind: 'fold', to: 0, ev: 0 });
    options.push({
      kind: 'call',
      to: spot.heroIn + spot.call,
      ev: rho * E * (P + spot.call) - spot.call,
    });
    // Raises are priced here, never carried from the decision. A value raise (ahead of the continuing part of every
    // live range: holdemTurnRiverRaiseNeedsValue's test on the turn and river, the same test here on the flop) at
    // every legal size. A non-value raise only heads-up: a draw never out of position, and in position only a combo
    // draw (flop under holdemFlopIsPriced, turn under holdemLateStreetBluffRaiseIsPriced); a hand without a draw on
    // the turn or river under holdemLateStreetBluffRaiseIsPriced.
    const canRaise =
      spot.stack > spot.toCall + EPS && reads.some((o) => !o.opp.is_all_in && num(o.opp.stack) > 0);
    const rs = canRaise && spot.street !== 'flop' ? holdemLateRaiseScope(player, gs) : null;
    if (canRaise && (spot.street === 'flop' || rs)) {
      const draw = holdemIsDraw(player.cards, board);
      const nonValueAllowed =
        reads.length === 1 &&
        (draw
          ? spot.inPosition &&
            holdemIsComboDraw(player.cards, board) &&
            (spot.street === 'flop' || opts.bluffRaise)
          : spot.street !== 'flop' && opts.bluffRaise);
      const heroAll = spot.heroIn + spot.stack;
      const bTotal = Math.max(...reads.map((o) => num(o.opp.bet) + num(o.opp.stack)));
      const base = P + spot.toCall;
      for (const fr of [0.75, 1]) {
        const to = legalTo(Math.min(spot.heroIn + spot.toCall + fr * base, heroAll, bTotal));
        if (!Number.isFinite(to) || !(to > spot.heroIn + spot.toCall)) continue;
        const sr = (to - spot.heroIn - spot.toCall) / Math.max(1e-9, base);
        let isValue: boolean;
        if (spot.street === 'flop') {
          const f = foldsFor(sr, true, false, false);
          isValue = reads.every(
            (o, i) =>
              holdemEquityOfShare(o.range, 1 - f[i]!, 'top').equity > HOLDEM_LATE_RAISE_VALUE_EQUITY
          );
        } else isValue = holdemLateRaiseVerdict(player, gs, rs!, to, mind).kind === 'value';
        if (!isValue && !nonValueAllowed) continue;
        valueRaise.set(to, isValue);
        const add = Math.min(to - spot.heroIn, spot.stack);
        const his = Math.max(0, Math.min(to - num(b.opp.bet), num(b.opp.stack)));
        const ev = (withBlock: boolean, withNut: boolean) => {
          const f = foldsFor(sr, true, withBlock, withNut)[0]!;
          const eqc = holdemEquityOfShare(b.range, 1 - f, 'top').equity;
          return f * P + (1 - f) * (rho * eqc * (P + add + his) - add);
        };
        options.push({
          kind: 'raise',
          to,
          ev: ev(true, true),
          evNoBlock: ev(false, true),
          evNoNut: ev(true, false),
        });
      }
    }
  }
  // Deterministic: the highest EV wins. Ties (within HOLDEM_LATE_TIE) keep the earlier option in the fixed order
  // the options are listed: check before any bet, smaller bets before larger (lower variance first); facing a bet
  // the call is listed before the fold is compared, so an exact tie calls (the minimum-defence order).
  const ordered = spot.facing
    ? [
        ...options.filter((o) => o.kind === 'call'),
        ...options.filter((o) => o.kind === 'fold'),
        ...options.filter((o) => o.kind === 'raise'),
      ]
    : options;
  let best = ordered[0]!;
  for (const o of ordered) if (o.ev > best.ev + HOLDEM_LATE_TIE * Math.max(1, P)) best = o;
  const perHand = best;
  // Range-level balance (heads-up): minimum defence facing a wager; one size and balanced bluffs opening.
  let range: HoldemLateRangePlan | null = null;
  if (reads.length === 1 && heroR && !(spot.facing && best.kind === 'raise')) {
    range = holdemLateRangePlan(
      player,
      gs,
      spot,
      heroR,
      reads[0]!,
      { options, best },
      (s) => foldsFor(s, false, false, true)[0]!,
      facingBeta
    );
    if (range.best) best = range.best;
  }
  return { options, best, showdown, recordMoved, valueRaise, rho, range, perHand };
}

/** Salt of the residual-frequency draw (the only draw the chooser makes; see holdemLateMixDraw). */
const MIX_SALT = 0x5f3759df;

/**
 * The residual-frequency draw: a number in [0, 1) seeded by the spot (the Horse's cards, the board, the pot, the
 * node). The range plan asks for it only for the one boundary hand class whose share of the range is split between
 * two actions, and the decision records it (receipt holdem_late_priced_mix_*). Same state, same draw.
 */
export function holdemLateMixDraw(
  hero: readonly Card[],
  board: readonly Card[],
  pot: number,
  node: number
): number {
  return runoutGenerator(
    (holdemPricedSeed(hero, board, pot) ^ MIX_SALT ^ Math.imul(node + 1, 0x85ebca6b)) >>> 0
  )();
}

function scoreOn(bits: ReturnType<typeof packHoldemBoardBits>, a: Card, b: Card): number {
  return scoreHoldemPlus2Ids(bits, holdemCardId(a), holdemCardId(b), false);
}

/** Defence order: the range builder's bucket first (a draw above a weak pair on the flop and turn), then the score. */
const defenceKey = (bucket: number, score: number) => bucket * 0x1000000 + score;

interface HEntry {
  /** index into the range's combinations */
  i: number;
  a: Card;
  b: Card;
  w: number;
  score: number;
  bucket: number;
}
interface OppSorted {
  os: { a: Card; b: Card; w: number; score: number }[];
  cum: number[];
  Wo: number;
}

function heroEntries(range: HoldemPricedRange, board: readonly Card[], w?: Float64Array): HEntry[] {
  const bits = packHoldemBoardBits(
    board.map((c) => holdemCardId(c)),
    board.length
  );
  const hs: HEntry[] = [];
  for (const i of range.order) {
    const wi = w ? w[i]! : range.weight[i]!;
    if (!(wi > 0)) continue;
    const c = range.combos[i]!;
    hs.push({
      i,
      a: c[0]!,
      b: c[1]!,
      w: wi,
      score: scoreOn(bits, c[0]!, c[1]!),
      bucket: holdemLineBucket(c, board),
    });
  }
  return hs;
}

function oppSorted(range: HoldemPricedRange, board: readonly Card[]): OppSorted {
  const bits = packHoldemBoardBits(
    board.map((c) => holdemCardId(c)),
    board.length
  );
  const os: OppSorted['os'] = [];
  for (const i of range.order) {
    const w = range.weight[i]!;
    if (!(w > 0)) continue;
    const c = range.combos[i]!;
    os.push({ a: c[0]!, b: c[1]!, w, score: scoreOn(bits, c[0]!, c[1]!) });
  }
  os.sort((x, y) => y.score - x.score);
  const cum: number[] = [];
  let acc = 0;
  for (const o of os) cum.push((acc += o.w));
  return { os, cum, Wo: acc };
}

/** Showdown share (on this board, made hands only) of a score against the strongest `share` of his range. */
function eqVsOf(o: OppSorted, sc: number, share: number): number {
  const firstAtOrBelow = (strict: boolean) => {
    let lo = 0;
    let hi = o.os.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (strict ? o.os[mid]!.score < sc : o.os[mid]!.score <= sc) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  };
  const before = (idx: number) => (idx > 0 ? o.cum[idx - 1]! : 0);
  const C = Math.max(1e-12, Math.min(1, share) * o.Wo);
  const ahead = Math.min(before(firstAtOrBelow(false)), C);
  const aheadOrTie = Math.min(before(firstAtOrBelow(true)), C);
  return (C - aheadOrTie + 0.5 * (aheadOrTie - ahead)) / C;
}

interface NodeBetPlan {
  s: number;
  f: number;
  total: number;
  callShare: number;
  /** bluff weight the node takes */
  bw: number;
  /** the share of each hero entry that bets (value 1, selected bluffs 1, the boundary class its residual) */
  mult: Float64Array;
  /** rank key of a non-value hand for the bluff selection, and the candidates' keys and weights */
  keyOf: (a: Card, b: Card, bucket: number, q: number) => number;
  cands: { key: number; w: number }[];
}

/**
 * The opening plan of one node over the Horse's range entries: for each size s (pots) with his fold f_s, value =
 * entries ahead of his calling part, bluffs = |value| x min(s / (1 + s), f_s) taken from the non-value entries
 * ranked draw (flop, turn), air, weak made, then blocker score, then lowest showdown. The best size by the gain over
 * checking; `forced` prices one size only (a wager already made).
 */
function nodeBetPlan(
  hs: HEntry[],
  o: OppSorted,
  late: boolean,
  sizes: number[],
  foldAt: (s: number) => number,
  forced: number | null
): NodeBetPlan | null {
  if (o.Wo <= 0 || hs.length === 0) return null;
  const prioOf = (bucket: number) => (!late && bucket === 2 ? 2 : bucket === 0 ? 1 : 0);
  let best: NodeBetPlan | null = null;
  for (const s of forced !== null ? [forced] : sizes) {
    const f = Math.max(0, Math.min(0.98, foldAt(s)));
    const callShare = 1 - f;
    const callW = new Float64Array(64);
    const foldW = new Float64Array(64);
    let wc = 0;
    let wf = 0;
    {
      let acc = 0;
      const cut = callShare * o.Wo;
      for (const x of o.os) {
        const inCall = Math.max(0, Math.min(x.w, cut - acc));
        const inFold = x.w - inCall;
        acc += x.w;
        for (const c of [x.a, x.b]) {
          const id = holdemCardId(c);
          callW[id] += inCall;
          foldW[id] += inFold;
        }
        wc += inCall;
        wf += inFold;
      }
    }
    const blockerScore = (a: Card, b: Card) =>
      (wc > 0 ? (callW[holdemCardId(a)]! + callW[holdemCardId(b)]!) / wc : 0) -
      (wf > 0 ? (foldW[holdemCardId(a)]! + foldW[holdemCardId(b)]!) / wf : 0);
    const keyOf = (a: Card, b: Card, bucket: number, q: number) =>
      prioOf(bucket) * 10 + blockerScore(a, b) - q * 1e-3;
    const mult = new Float64Array(hs.length);
    let vw = 0;
    let gainV = 0;
    const cands: { key: number; w: number; gain: number; j: number }[] = [];
    for (let j = 0; j < hs.length; j++) {
      const h = hs[j]!;
      const q = eqVsOf(o, h.score, 1);
      const eqc = eqVsOf(o, h.score, callShare);
      const gain = f + (1 - f) * (eqc * (1 + 2 * s) - s) - q;
      if (eqc > 0.5) {
        vw += h.w;
        gainV += h.w * gain;
        mult[j] = 1;
      } else cands.push({ key: keyOf(h.a, h.b, h.bucket, q), w: h.w, gain, j });
    }
    cands.sort((x, y) => y.key - x.key || x.j - y.j);
    const bw = vw * Math.min(s / (1 + s), f);
    let gainB = 0;
    {
      let left = bw;
      let k = 0;
      while (k < cands.length && left > 1e-12) {
        // a class of equal keys shares the residual
        let e = k;
        let classW = 0;
        while (e < cands.length && Math.abs(cands[e]!.key - cands[k]!.key) <= 1e-12)
          classW += cands[e++]!.w;
        const share = Math.min(1, left / classW);
        for (let t = k; t < e; t++) {
          mult[cands[t]!.j] = share;
          gainB += share * cands[t]!.w * cands[t]!.gain;
        }
        left -= share * classW;
        k = e;
      }
    }
    const total = gainV + gainB;
    if (best === null || total > best.total + 1e-12)
      best = {
        s,
        f,
        total,
        callShare,
        bw,
        mult,
        keyOf,
        cands: cands.map((c) => ({ key: c.key, w: c.w })),
      };
  }
  return best;
}

/** Minimum-defence share of each entry: the strongest d of the range by the defence order (the boundary class its residual). */
function defenceMult(hs: HEntry[], d: number): Float64Array {
  const idx = hs
    .map((_, j) => j)
    .sort((x, y) => {
      const kx = defenceKey(hs[x]!.bucket, hs[x]!.score);
      const ky = defenceKey(hs[y]!.bucket, hs[y]!.score);
      return ky - kx || x - y;
    });
  const W = hs.reduce((x, h) => x + h.w, 0);
  const mult = new Float64Array(hs.length);
  let left = d * W;
  let k = 0;
  while (k < idx.length && left > 1e-12) {
    const key = defenceKey(hs[idx[k]!]!.bucket, hs[idx[k]!]!.score);
    let e = k;
    let classW = 0;
    while (e < idx.length && defenceKey(hs[idx[e]!]!.bucket, hs[idx[e]!]!.score) === key)
      classW += hs[idx[e++]!]!.w;
    const share = Math.min(1, left / classW);
    for (let t = k; t < e; t++) mult[idx[t]!] = share;
    left -= share * classW;
    k = e;
  }
  return mult;
}

/** Pot before every action of the history (the pot of the request less what each later action added). */
function potsBefore(gs: HorseGameStateV2): number[] {
  const hist = gs.actionHistory ?? [];
  const added: number[] = [];
  let st = '';
  let comm = new Map<string, number>();
  for (const x of hist) {
    if ((x.stage ?? 'preflop') !== st) {
      st = x.stage ?? 'preflop';
      comm = new Map();
    }
    const key = x.userId ?? `s${x.seat}`;
    const prev = comm.get(key) ?? 0;
    const amt = Math.max(0, num(x.amount));
    const total = x.action === 'raise' || x.action === 'all_in' ? Math.max(prev, amt) : prev + amt;
    added.push(Math.max(0, total - prev));
    comm.set(key, total);
  }
  const out = new Array<number>(hist.length);
  let after = 0;
  for (let k = hist.length - 1; k >= 0; k--) {
    after += added[k]!;
    out[k] = Math.max(0, num(gs.pot) - after);
  }
  return out;
}

/**
 * The Horse's own line range, read as the opponent reads it but narrowed by THIS model's own plan at every earlier
 * postflop node the Horse acted on heads-up (self-consistent: a range the chooser itself would hold): preflop band
 * (the builder); each own check keeps what the node's plan checks, each own first wager what the plan bets at that
 * size, each call the minimum-defence share, each raise its value part. A node the plan cannot price (more than one
 * opponent, no range) keeps the builder's narrowing for that street. No hidden card is read.
 */
function heroPlanRange(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  mind: boolean,
  liveCount: number,
  betShareOf: (stage: HoldemPricedStreet, index: number) => number | null
): HoldemPricedRange | null {
  const hist = gs.actionHistory ?? [];
  const observer = (gs.players ?? []).find((p) => p.seat !== player.seat && !p.is_folded);
  if (!observer) return null;
  const blind = { ...observer, cards: [] } as SeatPlayer;
  const builder = heroLineRange(player, gs, mind, liveCount, betShareOf);
  const pre = hist.filter((a) => (a.stage ?? 'preflop') === 'preflop');
  const base = holdemOpponentLineRange(
    blind,
    { ...gs, actionHistory: pre } as HorseGameStateV2,
    player,
    mind,
    liveCount,
    false
  );
  if (!base) return builder;
  const range = base.range;
  const w = Float64Array.from(range.weight);
  const board = (gs.communityCards ?? []) as Card[];
  const pots = potsBefore(gs);
  const streets: HoldemPricedStreet[] = ['flop', 'turn', 'river'];
  const isHero = (x: (typeof hist)[number]) =>
    x.userId !== undefined ? x.userId === player.user_id : x.seat === player.seat;
  let narrowed = 0;
  for (let j = 0; j < hist.length; j++) {
    const x = hist[j]!;
    const st = x.stage as HoldemPricedStreet;
    const k = streets.indexOf(st);
    if (k < 0 || !isHero(x) || k + 3 > board.length) continue;
    // the node as it stood: board, history, pot
    const boardAt = board.slice(0, k + 3);
    const before = hist.slice(0, j);
    const foldedBefore = (p: SeatPlayer) =>
      before.some(
        (a) =>
          a.action === 'fold' &&
          (a.userId !== undefined ? a.userId === p.user_id : a.seat === p.seat)
      );
    const foldedLater = (p: SeatPlayer) =>
      hist
        .slice(j)
        .some(
          (a) =>
            a.action === 'fold' &&
            (a.userId !== undefined ? a.userId === p.user_id : a.seat === p.seat)
        );
    const liveAt = (gs.players ?? []).filter(
      (p) =>
        p.seat !== player.seat &&
        !foldedBefore(p) &&
        (p.is_folded !== true || foldedLater(p)) &&
        (!p.is_sitting_out || p.is_all_in)
    );
    if (liveAt.length !== 1) continue;
    const opp = liveAt[0]!;
    const potAt = pots[j]!;
    const streetBefore = before.filter((a) => a.stage === st);
    const facingAt = streetBefore.some((a) => isWager(a.action) && num(a.amount) > 0);
    const gsAt = {
      ...gs,
      actionHistory: before,
      stage: st,
      communityCards: boardAt,
      pot: potAt,
    } as HorseGameStateV2;
    const oppR = holdemOpponentLineRange(
      { ...player } as SeatPlayer,
      gsAt,
      opp,
      mind,
      1,
      false,
      betShareOf
    );
    if (!oppR) continue;
    const hs = heroEntries(range, boardAt, w);
    if (hs.length === 0) break;
    const o = oppSorted(oppR.range, boardAt);
    const late = k === 2;
    let mult: Float64Array | null = null;
    if (
      !facingAt &&
      (x.action === 'check' || ((x.action === 'bet' || x.action === 'all_in') && num(x.amount) > 0))
    ) {
      const heroLine = holdemLateLineOf(gsAt, player, st);
      const foldAt = (s: number) => holdemLateFoldOf(opp, st, heroLine, s, mind).f;
      const sizes: number[] = [...HOLDEM_LATE_OPEN_FRACTIONS];
      if (late) sizes.push(HOLDEM_LATE_RIVER_OVERBET);
      const forced = x.action === 'check' ? null : num(x.amount) / Math.max(1e-9, potAt);
      const plan = nodeBetPlan(hs, o, late, sizes, foldAt, forced);
      if (!plan) continue;
      if (x.action === 'check') {
        mult = new Float64Array(hs.length);
        const bets = plan.total > 0;
        for (let t = 0; t < hs.length; t++) mult[t] = bets ? 1 - plan.mult[t]! : 1;
      } else mult = plan.mult;
    } else if (facingAt && x.action === 'call') {
      const cb = Math.max(...streetBefore.map((a) => (isWager(a.action) ? num(a.amount) : 0)));
      const alpha = Math.min(1, cb / Math.max(1e-9, potAt));
      mult = defenceMult(hs, 1 - alpha);
      // the per-hand call beyond the minimum defence: showdown share against his range at the call's price, or a
      // draw on the flop and turn (credited by the realization)
      const toCallAt = Math.max(
        0,
        cb - streetBefore.filter(isHero).reduce((x, a) => x + num(a.amount), 0)
      );
      const price = toCallAt / Math.max(1e-9, potAt + toCallAt);
      for (let t = 0; t < hs.length; t++) {
        const h = hs[t]!;
        if (eqVsOf(o, h.score, 1) >= price || (!late && h.bucket === 2)) mult[t] = 1;
      }
    } else if (facingAt && (x.action === 'raise' || x.action === 'all_in')) {
      const fr = holdemLateFoldOf(opp, st, 'other', 1, mind, true).f;
      mult = new Float64Array(hs.length);
      for (let t = 0; t < hs.length; t++) {
        const h = hs[t]!;
        mult[t] = eqVsOf(o, h.score, 1 - fr) > 0.5 || (!late && h.bucket === 2) ? 1 : 0;
      }
    }
    if (!mult) continue;
    let kept = 0;
    let had = 0;
    for (let t = 0; t < hs.length; t++) {
      had += hs[t]!.w;
      kept += hs[t]!.w * mult[t]!;
    }
    // an own action the plan gives (almost) no weight to was not the plan's: keep the range as it was
    if (!(kept > 0.01 * had)) continue;
    for (let t = 0; t < hs.length; t++) w[hs[t]!.i] = hs[t]!.w * mult[t]!;
    narrowed++;
  }
  if (narrowed === 0) return builder;
  let total = 0;
  for (let i = 0; i < w.length; i++) total += w[i]!;
  if (!(total > 0)) return builder;
  return {
    ...range,
    weight: Array.from(w),
    total,
    bucket: range.combos.map((c) => holdemLineBucket(c, board)),
  };
}

export interface HoldemLateRangePlan {
  kind: 'defend' | 'value' | 'bluff' | 'check' | 'none';
  /** the option the range plan takes (null: the per-hand best stands) */
  best: HoldemLateOption | null;
  /** the residual frequency the boundary class needed (0 when none) and the draw that realised it */
  frequency: number;
  draw: number | null;
  /** opening: the node's size; facing: the defence share */
  size?: number;
  defence?: number;
}

/**
 * RANGE-LEVEL BALANCE (BUILD-II step 3), heads-up, over the Horse's own self-consistent line range (heroPlanRange).
 *
 * Facing a wager (minimum defence): the Horse defends the strongest d = (1 - alpha) x min(1, beta / beta0) of its
 * range, alpha = his street wager over the pot (his break-even fold), beta0 = s / (1 + 2s) the balanced bluff share
 * and beta his bluff share (his record where it has one, else beta0). A hand inside that share calls when the
 * per-hand verdict folds; the boundary class calls with the residual frequency. A per-hand call or raise stands.
 *
 * Opening (checked to or first to act): nodeBetPlan over the range: one size s* for the node; the hand bets s* when
 * it is value (and its own priced bet at s* is not below its check) or a selected bluff (the boundary class with the
 * residual frequency); else it checks. No gain at any size: the node checks.
 */
export function holdemLateRangePlan(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  spot: HoldemLateSpot,
  heroRange: HoldemPricedRange,
  opp: { range: HoldemPricedRange },
  v: { options: HoldemLateOption[]; best: HoldemLateOption },
  foldAt: (s: number) => number,
  beta: number | null
): HoldemLateRangePlan {
  const none: HoldemLateRangePlan = { kind: 'none', best: null, frequency: 0, draw: null };
  const board = (gs.communityCards ?? []) as Card[];
  const hero = player.cards as Card[];
  if (hero.length !== 2 || board.length < 3) return none;
  const bits = packHoldemBoardBits(
    board.map((c) => holdemCardId(c)),
    board.length
  );
  const P = spot.pot;
  const node = board.length * 2 + (spot.facing ? 1 : 0);
  const heroScore = scoreOn(bits, hero[0]!, hero[1]!);
  const heroBucket = holdemLineBucket(hero, board);
  const hs = heroEntries(heroRange, board, Float64Array.from(heroRange.weight));
  const Wh = hs.reduce((x, h) => x + h.w, 0);
  if (!(Wh > 0)) return none;

  if (spot.facing) {
    const call = v.options.find((o) => o.kind === 'call');
    if (!call || v.best.kind !== 'fold') return none;
    const bettorIn = num(spot.bettor?.bet) > 0 ? num(spot.bettor?.bet) : spot.toCall;
    const alpha = Math.min(1, bettorIn / Math.max(1e-9, P));
    const s = spot.toCall / Math.max(1e-9, P - spot.toCall);
    const beta0 = s / (1 + 2 * s);
    const d = Math.max(0, (1 - alpha) * Math.min(1, beta !== null ? beta / beta0 : 1));
    const hk = defenceKey(heroBucket, heroScore);
    let above = 0;
    let tie = 0;
    for (const h of hs) {
      const k = defenceKey(h.bucket, h.score);
      if (k > hk) above += h.w;
      else if (k === hk) tie += h.w;
    }
    const D = d * Wh;
    if (above >= D) return { ...none, defence: d };
    if (tie <= 0 || above + tie <= D)
      return { kind: 'defend', best: call, frequency: 1, draw: null, defence: d };
    const frequency = (D - above) / tie;
    const draw = holdemLateMixDraw(hero, board, P, node);
    return {
      kind: draw < frequency ? 'defend' : 'none',
      best: draw < frequency ? call : null,
      frequency,
      draw,
      defence: d,
    };
  }

  const o = oppSorted(opp.range, board);
  const bets = v.options.filter((x) => x.kind === 'bet');
  const check = v.options.find((x) => x.kind === 'check');
  if (bets.length === 0 || !check || o.Wo <= 0) return none;
  const late = board.length >= 5;
  const sizeOf = (x: HoldemLateOption) => (x.to - spot.heroIn) / Math.max(1e-9, P);
  const plan = nodeBetPlan(hs, o, late, bets.map(sizeOf), foldAt, null);
  if (!plan) return none;
  if (!(plan.total > 0)) return { kind: 'check', best: check, frequency: 0, draw: null, size: 0 };
  const option = bets.find((x) => Math.abs(sizeOf(x) - plan.s) < 1e-12)!;
  const heroQ = eqVsOf(o, heroScore, 1);
  if (eqVsOf(o, heroScore, plan.callShare) > 0.5) {
    // value at the node's size: bet it unless its own priced bet there is below its check
    return option.ev >= check.ev - HOLDEM_LATE_TIE * Math.max(1, P)
      ? { kind: 'value', best: option, frequency: 1, draw: null, size: plan.s }
      : { kind: 'check', best: check, frequency: 0, draw: null, size: plan.s };
  }
  const hk = plan.keyOf(hero[0]!, hero[1]!, heroBucket, heroQ);
  let above = 0;
  let tie = 0;
  for (const c of plan.cands) {
    if (c.key > hk + 1e-12) above += c.w;
    else if (Math.abs(c.key - hk) <= 1e-12) tie += c.w;
  }
  if (above >= plan.bw)
    return { kind: 'check', best: check, frequency: 0, draw: null, size: plan.s };
  if (tie <= 0 || above + tie <= plan.bw)
    return { kind: 'bluff', best: option, frequency: 1, draw: null, size: plan.s };
  const frequency = (plan.bw - above) / tie;
  const draw = holdemLateMixDraw(hero, board, P, node);
  return draw < frequency
    ? { kind: 'bluff', best: option, frequency, draw, size: plan.s }
    : { kind: 'check', best: check, frequency, draw, size: plan.s };
}

const argmaxBy = (options: HoldemLateOption[], key: 'evNoBlock' | 'evNoNut'): HoldemLateOption => {
  let best = options[0]!;
  for (const o of options) {
    const v = o[key] ?? o.ev;
    const bv = best[key] ?? best.ev;
    if (v > bv + 1e-9) best = o;
  }
  return best;
};

/**
 * The rule. Off: the decision itself, untouched, nothing read. On: in its spot, the priced chooser's answer replaces
 * the decision (a carried raise that passes the value test of holdemTurnRiverRaiseNeedsValue stands).
 */
export function holdemLateStreetIsPricedRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: {
    holdemLateStreetIsPriced?: boolean;
    holdemLateStreetBluffRaiseIsPriced?: boolean;
    holdemLateStreetIsPricedInTournaments?: boolean;
    holdemFlopIsPriced?: boolean;
    telemetry?: boolean;
    mind?: boolean;
  },
  legalize: (d: HorseDecision) => HorseDecision
): HorseDecision {
  const late = opts.holdemLateStreetIsPriced === true;
  const flop = opts.holdemFlopIsPriced === true;
  if (!late && !flop) return decision;
  const tele = telemetryOn(opts);
  try {
    const spot = holdemLateSpot(
      player,
      gs,
      opts.holdemLateStreetIsPricedInTournaments === true,
      flop,
      late
    );
    if (!spot) return decision;
    const pre = spot.street === 'flop' ? 'holdem_flop_priced_' : 'holdem_late_priced_';
    const mind = opts.mind !== false;
    const legalTo = (to: number): number => {
      const d = legalize({ action: spot.facing ? 'raise' : 'bet', amount: to, thinkTime: 0 });
      if (d.action === 'raise' || d.action === 'bet') return Number(d.amount);
      if (d.action === 'all_in') return spot.heroIn + spot.stack;
      return NaN;
    };
    const v = holdemLateVerdict(player, gs, spot, mind, legalTo, {
      bluffRaise: opts.holdemLateStreetBluffRaiseIsPriced === true,
      decisionRaiseTo: null,
    });
    if (!v) {
      if (tele) noteFire(pre + 'unpriced');
      return decision;
    }
    const thinkTime = decision.thinkTime ?? 0;
    const best = v.best;
    let out: HorseDecision;
    let receipt: string;
    if (best.kind === 'check') {
      out = { ...decision, action: 'check', thinkTime };
      delete out.amount;
      receipt = pre + 'check';
    } else if (best.kind === 'fold') {
      out = { ...decision, action: 'fold', thinkTime };
      delete out.amount;
      receipt = pre + 'fold';
    } else if (best.kind === 'call') {
      const c = legalize({ action: 'call', amount: spot.call, thinkTime });
      out = { ...decision, action: c.action, thinkTime };
      if (c.amount === undefined) delete out.amount;
      else out.amount = c.amount;
      receipt = pre + 'call';
    } else {
      const d = legalize({
        action: best.kind === 'raise' ? 'raise' : 'bet',
        amount: best.to,
        thinkTime,
      });
      out = { ...decision, action: d.action, thinkTime };
      if (d.amount === undefined) delete out.amount;
      else out.amount = d.amount;
      receipt =
        pre +
        (best.kind === 'raise'
          ? v.valueRaise.get(best.to)
            ? 'raise_value'
            : spot.street === 'flop'
              ? 'draw_raise'
              : 'bluff_raise'
          : v.range?.kind === 'bluff'
            ? 'bet_bluff'
            : v.range?.kind === 'value'
              ? 'bet_value'
              : v.showdown >= 0.5
                ? 'bet_value'
                : 'bet_bluff');
    }
    if (tele) {
      noteFire(receipt);
      if (argmaxBy(v.options, 'evNoBlock') !== best) noteFire('holdem_late_priced_blocker_decided');
      if (argmaxBy(v.options, 'evNoNut') !== best)
        noteFire('holdem_late_priced_nut_advantage_decided');
      if (v.recordMoved) noteFire('holdem_late_priced_record_decided');
      if (v.range && v.range.kind !== 'none' && v.range.best && v.range.best !== v.perHand)
        noteFire(pre + 'range_' + v.range.kind);
      if (v.range && v.range.draw !== null) {
        // the one model-requested draw: the boundary class's residual frequency, recorded with the decision
        const mix = pre + (spot.facing ? 'mix_defend' : 'mix_bet');
        noteFire(mix);
        noteDecisionRuleReceipt(mix, decision, out);
      }
      if (out.action !== decision.action || (out.amount ?? null) !== (decision.amount ?? null))
        noteDecisionRuleReceipt(receipt, decision, out);
    }
    return out;
  } catch {
    if (tele) noteFire('holdem_late_priced_failed');
    return decision;
  }
}

/** Receipt validator admission: a passive answer of the chooser, re-derived from the public request. */
export function holdemLateStreetIsPricedAdmits(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  after: { action: string; amount: number | null }
): boolean {
  try {
    const spot = holdemLateSpot(player, gs, true, true);
    if (!spot) return false;
    if (after.action === 'check') return !spot.facing;
    if (after.action === 'fold') return spot.facing;
    if (after.action === 'call')
      return (
        spot.facing && typeof after.amount === 'number' && Math.abs(after.amount - spot.call) < 1e-6
      );
    return false;
  } catch {
    return false;
  }
}

/** The Horse's own self-consistent line range the range plan reads (heads-up); for laws and measurement. */
export function holdemLateHeroRange(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  mind: boolean
): HoldemPricedRange | null {
  return heroPlanRange(player, gs, mind, 1, holdemLateBetShareOf(gs, mind));
}
