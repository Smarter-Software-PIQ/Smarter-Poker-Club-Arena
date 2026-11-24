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
 * Receipts (counted live): holdem_late_priced_{check,bet_value,bet_bluff,call,fold,raise_value,bluff_raise,
 * unpriced,failed}, holdem_late_priced_blocker_decided, holdem_late_priced_nut_advantage_decided (the term changed the
 * best action), holdem_late_priced_record_decided (his record moved the fold or the bluff share enough to change it).
 */
import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { noteDecisionRuleReceipt, noteFire, telemetryOn } from './BrainTelemetry.js';
import {
  HOLDEM_PRICED_REALIZATION_OOP,
  HOLDEM_PRICED_REFERENCE_PRICE,
  holdemEquityOfShare,
  holdemLineBucket,
} from './HorseHoldemValueAndCallsArePriced.js';
import {
  holdemHeroLastToAct,
  holdemLateRaiseScope,
  holdemLateRaiseVerdict,
  holdemOpponentLineRange,
  type HoldemOpponentRange,
} from './HorseHoldemTurnRiverRaiseNeedsValue.js';
import {
  HOLDEM_LATE_FOLD_PRIOR,
  HOLDEM_LATE_FOLD_TO_RAISE_PRIOR,
  HOLDEM_LATE_PRIORS_VERSION,
} from './HorseHoldemLateStreetPriors.js';

export { HOLDEM_LATE_PRIORS_VERSION };
export const HOLDEM_LATE_STREET_IS_PRICED = 'holdemLateStreetIsPriced';
export const HOLDEM_LATE_STREET_BLUFF_RAISE_IS_PRICED = 'holdemLateStreetBluffRaiseIsPriced';
/** Weight of his own record against the prior: n / (n + K). */
export const HOLDEM_LATE_RECORD_K = 30;
/** Fold multiplier per unit of nut advantage (Horse's nutted share minus his). */
export const HOLDEM_LATE_NUT_ADV_WEIGHT = 0.5;
/** Weight of the fitted population fold prior against the indifference fold s / (1 + s). */
export const HOLDEM_LATE_PRIOR_TRUST = 0.5;
export const HOLDEM_LATE_OPEN_FRACTIONS = [1 / 3, 0.5, 0.75, 1] as const;
export const HOLDEM_LATE_RIVER_OVERBET = 1.5;
export const HOLDEM_LATE_MAX_OPPONENTS = 5;
/** EVs within this share of the pot are a tie (the fixed order decides; never a draw). */
export const HOLDEM_LATE_TIE = 1e-6;
const EPS = 0.005;

export type HoldemLateLine = 'checkthrough' | 'barrel' | 'lead' | 'other';
export const holdemLateSizeBucket = (s: number): 0 | 1 | 2 | 3 =>
  s <= 0.34 ? 0 : s <= 0.67 ? 1 : s <= 1.01 ? 2 : 3;

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
const isWager = (a: string) => a === 'bet' || a === 'raise' || a === 'all_in';

/** The line of `who` on this street from the street before: a check-through, his own barrel, a lead, or other. */
export function holdemLateLineOf(
  gs: HorseGameStateV2,
  who: SeatPlayer,
  street: 'turn' | 'river'
): HoldemLateLine {
  const prev = street === 'turn' ? 'flop' : 'turn';
  const hist = (gs.actionHistory ?? []).filter((a) => a.stage === prev);
  if (hist.length === 0) return 'other';
  const wagers = hist.filter((a) => isWager(a.action) && num(a.amount) > 0);
  if (wagers.length === 0) return 'checkthrough';
  const last = wagers[wagers.length - 1]!;
  const mine = last.userId !== undefined ? last.userId === who.user_id : last.seat === who.seat;
  return mine ? 'barrel' : 'lead';
}

/** The population fold to a bet of s x pot (or to a raise) at this street and line. */
export function holdemLateFoldPrior(
  street: 'turn' | 'river',
  line: HoldemLateLine,
  s: number
): number {
  const row = HOLDEM_LATE_FOLD_PRIOR[street][line];
  return clamp01(row[holdemLateSizeBucket(s)]!);
}

/** His fold to a wager laying `s` x pot: his record (price-scaled) weighted n/(n+K), the rest the prior. */
export function holdemLateFoldOf(
  opp: SeatPlayer,
  street: 'turn' | 'river',
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
  const prior = HOLDEM_LATE_PRIOR_TRUST * pop + (1 - HOLDEM_LATE_PRIOR_TRUST) * (s / (1 + s));
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

/** The nutted share of a weighted range (HoldemLineBucket.Nutted = 4). */
function nuttedShare(r: { weight: number[]; bucket: number[]; total: number }): number {
  if (!(r.total > 0)) return 0;
  let w = 0;
  for (let i = 0; i < r.weight.length; i++) if (r.bucket[i] === 4) w += r.weight[i]!;
  return w / r.total;
}

/** The Horse's own line range shape, read as an opponent would read it (no hole card of anyone). */
function heroNuttedShare(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  mind: boolean,
  liveCount: number
): number | null {
  try {
    const observer = (gs.players ?? []).find((p) => p.seat !== player.seat && !p.is_folded);
    if (!observer) return null;
    const asOpp = holdemOpponentLineRange(
      { ...observer, cards: [] } as SeatPlayer,
      gs,
      player,
      mind,
      liveCount,
      false
    );
    if (!asOpp) return null;
    // the observer holds no card here: the range removes the board only, never a hidden card
    return nuttedShare(asOpp.range);
  } catch {
    return null;
  }
}

export interface HoldemLateSpot {
  street: 'turn' | 'river';
  facing: boolean;
  pot: number;
  toCall: number;
  call: number;
  heroIn: number;
  stack: number;
  live: SeatPlayer[];
  bettor: SeatPlayer | null;
  r: number;
}

export function holdemLateSpot(player: SeatPlayer, gs: HorseGameStateV2): HoldemLateSpot | null {
  if (String(gs.gameVariant ?? '').toLowerCase() !== 'nlh') return null;
  if (gs.bettingStructure !== undefined && gs.bettingStructure !== 'no_limit') return null;
  const street = gs.stage;
  if (street !== 'turn' && street !== 'river') return null;
  const board = gs.communityCards ?? [];
  if (board.length !== (street === 'turn' ? 4 : 5)) return null;
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
  if (facing) {
    const scope = holdemLateRaiseScope(player, gs);
    bettor = scope?.bettor ?? null;
  }
  const r =
    street === 'river' || holdemHeroLastToAct(player, gs, live) ? 1 : HOLDEM_PRICED_REALIZATION_OOP;
  return {
    street,
    facing,
    pot: Math.max(0, num(gs.pot)),
    toCall,
    call: Math.min(toCall, stack),
    heroIn,
    stack,
    live,
    bettor,
    r,
  };
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
}

interface OppRead extends HoldemOpponentRange {
  line: HoldemLateLine;
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
  for (const o of spot.live) {
    const r = holdemOpponentLineRange(player, gs, o, mind, spot.live.length);
    if (!r) return null;
    reads.push({ ...r, line: holdemLateLineOf(gs, o, spot.street) });
  }
  const P = spot.pot;
  const showdown = eqProduct(reads);
  const { bv, bw } = holdemLateBlockers(player.cards, board);
  const heroNut = heroNuttedShare(player, gs, mind, spot.live.length);
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
      ev: spot.r * showdown * P,
      evNoBlock: spot.r * showdown * P,
      evNoNut: spot.r * showdown * P,
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
        ev: wagerEv(reads, foldsFor(s, false, true, true), P, add, spot.r),
        evNoBlock: wagerEv(reads, foldsFor(s, false, false, true), P, add, spot.r),
        evNoNut: wagerEv(reads, foldsFor(s, false, true, false), P, add, spot.r),
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
    options.push({ kind: 'fold', to: 0, ev: 0 });
    options.push({
      kind: 'call',
      to: spot.heroIn + spot.call,
      ev: spot.r * E * (P + spot.call) - spot.call,
    });
    // Raises are priced here, never carried from the decision: a value raise (holdemTurnRiverRaiseNeedsValue's test,
    // heads-up or multiway) at every legal size; a non-value raise only with holdemLateStreetBluffRaiseIsPriced on,
    // heads-up.
    const rs = spot.stack > spot.toCall + EPS ? holdemLateRaiseScope(player, gs) : null;
    if (rs && reads.some((o) => !o.opp.is_all_in && num(o.opp.stack) > 0)) {
      const heroAll = spot.heroIn + spot.stack;
      const bTotal = Math.max(...reads.map((o) => num(o.opp.bet) + num(o.opp.stack)));
      const base = P + spot.toCall;
      for (const fr of [0.75, 1]) {
        const to = legalTo(Math.min(spot.heroIn + spot.toCall + fr * base, heroAll, bTotal));
        if (!Number.isFinite(to) || !(to > spot.heroIn + spot.toCall)) continue;
        const isValue = holdemLateRaiseVerdict(player, gs, rs, to, mind).kind === 'value';
        if (!isValue && !(opts.bluffRaise && reads.length === 1)) continue;
        valueRaise.set(to, isValue);
        const add = Math.min(to - spot.heroIn, spot.stack);
        const his = Math.max(0, Math.min(to - num(b.opp.bet), num(b.opp.stack)));
        const sr = (to - spot.heroIn - spot.toCall) / Math.max(1e-9, base);
        const ev = (withBlock: boolean, withNut: boolean) => {
          const f = foldsFor(sr, true, withBlock, withNut)[0]!;
          const eqc = holdemEquityOfShare(b.range, 1 - f, 'top').equity;
          return f * P + (1 - f) * (spot.r * eqc * (P + add + his) - add);
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
  return { options, best, showdown, recordMoved, valueRaise };
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
    telemetry?: boolean;
    mind?: boolean;
  },
  legalize: (d: HorseDecision) => HorseDecision
): HorseDecision {
  if (opts.holdemLateStreetIsPriced !== true) return decision;
  const tele = telemetryOn(opts);
  try {
    const spot = holdemLateSpot(player, gs);
    if (!spot) return decision;
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
      if (tele) noteFire('holdem_late_priced_unpriced');
      return decision;
    }
    const thinkTime = decision.thinkTime ?? 0;
    const best = v.best;
    let out: HorseDecision;
    let receipt: string;
    if (best.kind === 'check') {
      out = { ...decision, action: 'check', thinkTime };
      delete out.amount;
      receipt = 'holdem_late_priced_check';
    } else if (best.kind === 'fold') {
      out = { ...decision, action: 'fold', thinkTime };
      delete out.amount;
      receipt = 'holdem_late_priced_fold';
    } else if (best.kind === 'call') {
      const c = legalize({ action: 'call', amount: spot.call, thinkTime });
      out = { ...decision, action: c.action, thinkTime };
      if (c.amount === undefined) delete out.amount;
      else out.amount = c.amount;
      receipt = 'holdem_late_priced_call';
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
        best.kind === 'raise'
          ? v.valueRaise.get(best.to)
            ? 'holdem_late_priced_raise_value'
            : 'holdem_late_priced_bluff_raise'
          : v.showdown >= 0.5
            ? 'holdem_late_priced_bet_value'
            : 'holdem_late_priced_bet_bluff';
    }
    if (tele) {
      noteFire(receipt);
      if (argmaxBy(v.options, 'evNoBlock') !== best) noteFire('holdem_late_priced_blocker_decided');
      if (argmaxBy(v.options, 'evNoNut') !== best)
        noteFire('holdem_late_priced_nut_advantage_decided');
      if (v.recordMoved) noteFire('holdem_late_priced_record_decided');
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
    const spot = holdemLateSpot(player, gs);
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
