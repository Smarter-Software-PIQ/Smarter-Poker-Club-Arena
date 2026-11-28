/**
 * omahaLimpReraiseVsIsoRaiser (owner order 2026-11-27 12:48 PM Chicago; lead-8 lane limprr; default OFF, read
 * `=== true`). PLO4/PLO5 cash, preflop.
 *
 * THE ORDER. "Incorporate some limp re-raises in position when you know you have a [player] that will always raise
 * when the Horse has a strong hand, but this should always be in position or with a connected rundown hand."
 *
 * WHY. Since vpipFloorLimpFoldsToARaise went on (owner ruling: a VPIP-floor limp folds to any raise, untouched here),
 * a Horse limp is almost always a hand that folds to a raise, so a zero-equity isolation raise over a Horse limp
 * profits: PLO5 tables +0.42 +/- 0.18 bb per isolation raise (era A, n 734), +1.26 +/- 0.36 (era B, n 175). Strong
 * hands that sometimes limp and then re-raise the isolation make that raise pay.
 *
 * TWO STEPS, ONE FORMULA FOR EVERY OPPONENT (no person-vs-Horse key, no named player, no unshown card):
 *  1. THE LIMP. First in (nobody has entered the pot), at most two players behind, the Horse's own decision a raise
 *     with a strong hand (top LIMP_RERAISE_STRONG_SHARE by the engine's preflop percentile, not trips or trash).
 *     J = the player behind with the highest raise-when-unraised rate, read from HIS OWN decayed record
 *     (HorseMind exploit counters rfi / rfiOpp: his raise at his first action into an unraised pot, an isolation
 *     raise over a limp included) shrunk to the PEOPLE-ONLY prior (LIMP_RERAISE_PEOPLE_PRIOR). Only when the Horse
 *     will be IN POSITION against J after the flop OR the hand is a connected rundown (limpReraiseRundown) is the
 *     limp priced:
 *        EV(open)  = F x pot + (1 - F) x [R x eq(any) x pot called - open]
 *        EV(limp)  = r x EV(pot 3-bet of his pot isolation) + (1 - r) x [R x eq(any) x limped pot - limp]
 *        EV(3-bet) = F x (pot + his isolation) + (1 - F) x [R x eq(his range) x 3-bet pot called - our chips]
 *     r = his shrunk raise rate, his range = the top 0.9 r of holdings, F = his fold when his raise is re-raised
 *     (own foldTo3Bet record against the people prior: people folded 1 of 833 3-bets), R = the measured realization
 *     (HorseOmahaReraisedPotPriced.reraisedPotRealization). When EV(limp) clears EV(open) by the deadband plus the
 *     sampling error, the raise becomes the limp with probability LIMP_RERAISE_MIX, a deterministic draw on the
 *     Horse's own cards and seat: the open keeps the rest of the strong hands, so neither line is capped.
 *     eq(any) for the called open over-states the open (he calls an open with more than random would lose to), so
 *     the comparison leans to the open.
 *  2. THE RE-RAISE. The Horse's own limp (a call before any raise; NEVER the VPIP floor's: a hand marked
 *     ownVpipFloorLimpThisHand is never touched) faces exactly one raise, heads-up against the raiser, with a strong
 *     hand, IN POSITION against him OR a connected rundown: a standing fold or call becomes the pot-size re-raise
 *     when EV(3-bet) > max(EV(call), 0) + deadband + sampling error. Out of position without a rundown: nothing.
 *
 * Off (the default) nothing here runs. Receipts: omaha_limp_reraise_limped, omaha_limp_reraise_open_kept,
 * omaha_limp_reraise_reraised, omaha_limp_reraise_reraise_kept.
 *
 * NEVER refer to the horses as "bots" - they are HORSES only.
 */

import type { Card, HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaPreflopPercentile, variantInfo } from './HorseEval.js';
import { omahaHandClass } from './HorseHandClasses.js';
import { HorseMind } from './HorseMind.js';
import { omahaReraisedEquityAgainstPercentileFloors } from './HorseOmahaReraisedPot.js';
import {
  RERAISED_POT_DEADBAND_POT_SHARE,
  RERAISED_POT_PRICED_SAMPLES,
  RERAISED_POT_WIDTH_PER_RATE,
  reraisedPotFloorOf,
  reraisedPotRealization,
} from './HorseOmahaReraisedPotPriced.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { potLimitRaiseTo } from './BettingStructure.js';

export const OMAHA_LIMP_RERAISE_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/**
 * THE PEOPLE-ONLY PRIOR (owner order 2026-11-26 12:21: statistics from people's play only). Public actions of
 * PLO4/PLO5 cash hands with a person, 2026-11-19 23:00Z to 11-27 05:00Z (lane l8-preflop stats.md), people only:
 *  - isolation raise over a limp: PLO5 65.5% pooled (1,137), but per person (n >= 15) 73%, 74%, 87%, 23%, 15%:
 *    person mean 0.54; PLO4 36.7% (90, thin: pooled). Mass 5: an own record of 20 chances outweighs it four to one.
 *  - the raiser's answer to a 3-bet: fold PLO5 0 of 786, PLO4 1 of 47: 0.01 at mass 3.4 (the cell is not thin).
 * No Horse play, no HUD '*' population row, no unshown card.
 */
export const LIMP_RERAISE_PEOPLE_PRIOR = {
  raiseRate: { plo5: 0.54, plo4: 0.367, mass: 5 },
  foldToReraise: { people: 0.01, mass: 3.4 },
} as const;

/** The strong hands that may take the limp-re-raise line: the top share by the engine's preflop percentile. */
export const LIMP_RERAISE_STRONG_SHARE = 0.2;
/** The share of qualifying strong hands that limp when the limp is priced above the open (the rest open). */
export const LIMP_RERAISE_MIX = 0.5;
/** Players still to act behind the first-in Horse, at most. */
export const LIMP_RERAISE_MAX_BEHIND = 2;

const fin = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const cents = (x: number): number => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/** Postflop acting order relative to the dealer (larger acts later; the dealer acts last). */
export function limpReraisePostflopOrder(seat: number, dealerSeat: number | undefined): number {
  const d = seat - (dealerSeat ?? 0);
  return d <= 0 ? d + 1024 : d;
}

const RANK_VALUE: Readonly<Record<string, number>> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };

/**
 * A CONNECTED RUNDOWN: four distinct ranks inside a five-rank window (at most one gap), the window's top card a nine
 * or better; in PLO5 any four of the five cards. Suits are not part of the shape: they are in the equity of the price.
 */
export function limpReraiseRundown(cards: readonly Card[] | undefined | null): boolean {
  if (!Array.isArray(cards) || cards.length < 4) return false;
  const rv = (c: Card): number => RANK_VALUE[c.rank] ?? Number(c.rank);
  const uniq = [...new Set(cards.map(rv))].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  for (let i = 0; i + 3 < uniq.length; i++) {
    if (uniq[i + 3]! - uniq[i]! <= 4 && uniq[i + 3]! >= 9) return true;
  }
  return false;
}

/** The hand may take the line: top LIMP_RERAISE_STRONG_SHARE by percentile, and not a class the ladder overrates. */
export function limpReraiseStrongHand(cards: readonly Card[] | undefined | null): boolean {
  if (!Array.isArray(cards) || (cards.length !== 4 && cards.length !== 5)) return false;
  const cls = omahaHandClass([...cards]);
  if (cls === 'trips' || cls === 'trash') return false;
  return omahaPreflopPercentile([...cards], false) >= 1 - LIMP_RERAISE_STRONG_SHARE;
}

/** His raise-when-unraised rate: his own decayed record (rfi / rfiOpp) against the people prior. */
export function limpReraiseRaiseRateOf(userId: string, variant: string, mind: boolean): number {
  const p = LIMP_RERAISE_PEOPLE_PRIOR.raiseRate;
  const prior = variant === 'plo4' ? p.plo4 : p.plo5;
  let hits = 0;
  let opp = 0;
  if (mind && userId) {
    try {
      const c = HorseMind.currentExploitCounters(userId);
      if (c) {
        opp = Math.max(0, fin(c.rfiOpp));
        hits = Math.min(opp, Math.max(0, fin(c.rfi)));
      }
    } catch {
      /* prior alone */
    }
  }
  return (hits + prior * p.mass) / (opp + p.mass);
}

/** His fold when his raise is re-raised: his own decayed record (foldTo3Bet) against the people prior. */
export function limpReraiseFoldToReraiseOf(userId: string, mind: boolean): number {
  const p = LIMP_RERAISE_PEOPLE_PRIOR.foldToReraise;
  let f = 0;
  let n = 0;
  if (mind && userId) {
    try {
      const c = HorseMind.currentExploitCounters(userId);
      if (c) {
        n = Math.max(0, fin(c.foldTo3BetOpp));
        f = Math.min(n, Math.max(0, fin(c.foldTo3Bet)));
      }
    } catch {
      /* prior alone */
    }
  }
  return (f + p.people * p.mass) / (n + p.mass);
}

const VOLUNTARY = new Set(['fold', 'check', 'call', 'bet', 'raise', 'all_in']);

function scopeOk(player: SeatPlayer, gs: HorseGameStateV2): string | null {
  if (String(gs.stage ?? '') !== 'preflop') return null;
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!OMAHA_LIMP_RERAISE_VARIANTS.has(variant)) return null;
  const hole = player.cards ?? [];
  if (hole.length !== 4 && hole.length !== 5) return null;
  if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : variantInfo(gs.gameVariant).isHiLo)
    return null;
  if (gs.communityCards2?.length || gs.communityCards3?.length) return null;
  if (gs.bombPot === true || gs.allInOrFold === true || gs.straddleActive === true) return null;
  if (omahaIsTournamentMode(gs)) return null;
  return variant;
}

const isRaiseAction = (a: { action: string; isFullRaise?: boolean }): boolean =>
  a.action === 'raise' ||
  a.action === 'bet' ||
  (a.action === 'all_in' && a.isFullRaise !== undefined);

export interface LimpReraiseThreeBet {
  /** the Horse's raise-to and the chips it adds from now */
  to: number;
  add: number;
  allIn: boolean;
  /** the pot when he calls it */
  calledPot: number;
}

/** EV of the pot 3-bet of a raise to `raiseTo` (net chips from the decision; the Horse's chips in now are sunk). */
export function limpReraiseThreeBetEv(args: {
  potBefore: number;
  heroBet: number;
  heroStack: number;
  raiserBet: number;
  raiserStack: number;
  raiseTo: number;
  fold: number;
  equity: number;
  inPosition: boolean;
}): { ev: number; threeBet: LimpReraiseThreeBet } {
  const { potBefore, heroBet, heroStack, raiserBet, raiserStack, raiseTo, fold, equity } = args;
  const toCall = Math.max(0, raiseTo - heroBet);
  const potTo = potLimitRaiseTo(potBefore, raiseTo, toCall);
  const heroCap = heroBet + heroStack;
  const raiserCap = raiserBet + raiserStack;
  const to = Math.min(potTo, heroCap);
  const allIn = to >= heroCap - 0.005;
  const add = Math.max(0, to - heroBet);
  const matched = Math.min(to, raiserCap);
  const calledPot = potBefore + Math.max(0, matched - heroBet) + Math.max(0, matched - raiserBet);
  const behind = Math.max(0, Math.min(heroCap, raiserCap) - matched);
  const spr = calledPot > 0 ? behind / calledPot : 0;
  const R = reraisedPotRealization('aggressor', args.inPosition, spr, 2, equity);
  // called: the chips the Horse gets matched (an uncalled excess comes back)
  const cost = Math.max(0, Math.min(add, matched - heroBet));
  const ev = fold * potBefore + (1 - fold) * (R * equity * calledPot - cost);
  return { ev, threeBet: { to: cents(to), add: cents(add), allIn, calledPot } };
}

export interface LimpReraiseLimpVerdict {
  raiserSeat: number;
  raiseRate: number;
  fold: number;
  inPosition: boolean;
  rundown: boolean;
  evOpen: number;
  evLimp: number;
  evThreeBet: number;
  deadband: number;
  draw: number;
  limps: boolean;
}

/** A deterministic unit on the Horse's own cards, seat and dealer (the same answer on every re-decision). */
export function limpReraiseDraw(player: SeatPlayer, gs: HorseGameStateV2): number {
  const key = `${(player.cards ?? []).map((c) => c.rank + c.suit).join('')}|${player.seat}|${gs.dealerSeat ?? ''}`;
  let h = (0x811c9dc5 ^ 0x5bd1e995) >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 8) / 16777216;
}

/** Step 1: the priced limp of a strong first-in raise, or null when this is not the spot (the decision stands). */
export function limpReraiseLimpVerdict(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  mind: boolean
): LimpReraiseLimpVerdict | null {
  if (decision.action !== 'raise' && decision.action !== 'all_in') return null;
  const variant = scopeOk(player, gs);
  if (!variant) return null;
  const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
  if (legal && !legal.includes('call')) return null;
  const bb = fin(gs.bigBlind);
  const heroBet = Math.max(0, fin(player.bet));
  const heroStack = Math.max(0, fin(player.stack));
  const currentBet = fin(gs.currentBet);
  const limp = currentBet - heroBet;
  if (!(bb > 0) || currentBet > bb + 1e-9 || !(limp > 0.005) || !(heroStack > limp * 8))
    return null;
  const pre = (gs.actionHistory ?? []).filter((a) => a.stage === 'preflop');
  // first in: nobody has entered (no call, no raise) before the Horse
  if (pre.some((a) => a.action === 'call' || a.action === 'all_in' || isRaiseAction(a)))
    return null;
  if (!limpReraiseStrongHand(player.cards)) return null;
  const acted = new Set(pre.filter((a) => VOLUNTARY.has(a.action)).map((a) => a.seat));
  const behind = (gs.players ?? []).filter(
    (p) =>
      p.seat !== player.seat &&
      !p.is_folded &&
      !p.is_sitting_out &&
      !p.is_all_in &&
      !acted.has(p.seat) &&
      fin(p.stack) > 0
  );
  if (behind.length === 0 || behind.length > LIMP_RERAISE_MAX_BEHIND) return null;
  let J = behind[0]!;
  let r = -1;
  for (const p of behind) {
    const rate = limpReraiseRaiseRateOf(String(p.user_id ?? ''), variant, mind);
    if (rate > r) {
      r = rate;
      J = p;
    }
  }
  const dealer = gs.dealerSeat;
  const inPosition =
    limpReraisePostflopOrder(player.seat, dealer) > limpReraisePostflopOrder(J.seat, dealer);
  const rundown = limpReraiseRundown(player.cards);
  if (!inPosition && !rundown) return null;
  const width = clamp(RERAISED_POT_WIDTH_PER_RATE * r, 0.02, 1);
  const hole = player.cards ?? [];
  const dead = player.knownDeadCards ?? [];
  const eqAny = omahaReraisedEquityAgainstPercentileFloors(
    hole,
    dead,
    [0],
    RERAISED_POT_PRICED_SAMPLES
  );
  const eqRange = omahaReraisedEquityAgainstPercentileFloors(
    hole,
    dead,
    [reraisedPotFloorOf(width)],
    RERAISED_POT_PRICED_SAMPLES
  );
  if (eqAny === null || eqRange === null) return null;
  const fold = limpReraiseFoldToReraiseOf(String(J.user_id ?? ''), mind);
  const pot = Math.max(0, fin(gs.pot));
  const jBet = Math.max(0, fin(J.bet));
  const jStack = Math.max(0, fin(J.stack));
  const heroCap = heroBet + heroStack;
  // the open: the Horse's own raise as proposed (the all-in: its whole stack)
  const openTo =
    decision.action === 'all_in' ? heroCap : Math.min(heroCap, fin(decision.amount, currentBet));
  const openAdd = Math.max(0, openTo - heroBet);
  const openMatched = Math.min(openTo, jBet + jStack);
  const openPot = pot + Math.max(0, openMatched - heroBet) + Math.max(0, openMatched - jBet);
  const openSpr =
    openPot > 0 ? Math.max(0, Math.min(heroCap, jBet + jStack) - openMatched) / openPot : 0;
  const rOpen = reraisedPotRealization('aggressor', inPosition, openSpr, 2, eqAny);
  const evOpen =
    fold * pot +
    (1 - fold) * (rOpen * eqAny * openPot - Math.max(0, Math.min(openAdd, openMatched - heroBet)));
  // the limp, then his pot isolation raise, then the Horse's pot 3-bet
  const potAfterLimp = pot + limp;
  const isoTo = Math.min(
    jBet + jStack,
    potLimitRaiseTo(potAfterLimp, currentBet, Math.max(0, currentBet - jBet))
  );
  const potAfterIso = potAfterLimp + Math.max(0, isoTo - jBet);
  const three = limpReraiseThreeBetEv({
    potBefore: potAfterIso,
    heroBet: currentBet,
    heroStack: heroStack - limp,
    raiserBet: isoTo,
    raiserStack: Math.max(0, jStack - (isoTo - jBet)),
    raiseTo: isoTo,
    fold,
    equity: eqRange,
    inPosition,
  });
  // from the limp decision: the 3-bet branch's EV is measured with the limp already in
  const evThreeBet = three.ev - limp;
  const limpedPot = potAfterLimp + Math.max(0, currentBet - jBet);
  const limpedSpr = limpedPot > 0 ? Math.max(0, Math.min(heroStack - limp, jStack)) / limpedPot : 0;
  const rLimped = reraisedPotRealization('caller', inPosition, limpedSpr, 2, eqAny);
  const evNoRaise = rLimped * eqAny * limpedPot - limp;
  const evLimp = r * evThreeBet + (1 - r) * evNoRaise;
  const deadband =
    RERAISED_POT_DEADBAND_POT_SHARE * openPot +
    (0.5 / Math.sqrt(RERAISED_POT_PRICED_SAMPLES)) * three.threeBet.calledPot * r * (1 - fold);
  const draw = limpReraiseDraw(player, gs);
  const limps = evLimp > evOpen + deadband && draw < LIMP_RERAISE_MIX;
  return {
    raiserSeat: J.seat,
    raiseRate: r,
    fold,
    inPosition,
    rundown,
    evOpen,
    evLimp,
    evThreeBet,
    deadband,
    draw,
    limps,
  };
}

export function limpReraiseLimpStep(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  mind: boolean
): { decision: HorseDecision; receipt: 'limped' | 'open_kept' | null } {
  const v = limpReraiseLimpVerdict(decision, player, gs, mind);
  if (!v) return { decision, receipt: null };
  if (!v.limps) return { decision, receipt: 'open_kept' };
  const limp = Math.max(0, fin(gs.currentBet) - Math.max(0, fin(player.bet)));
  const out: HorseDecision = { ...decision, action: 'call', amount: cents(limp) };
  delete out.valueSize;
  delete out.continuationGuard;
  return { decision: out, receipt: 'limped' };
}

export interface LimpReraiseSpot {
  raiserSeat: number;
  inPosition: boolean;
  rundown: boolean;
  fold: number;
  raiseRate: number;
}

/**
 * Step 2's spot: the Horse's own limp (not the floor's), now facing exactly one raise heads-up, a strong hand, in
 * position against the raiser or a connected rundown. Null otherwise.
 */
export function limpReraiseSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  mind: boolean
): LimpReraiseSpot | null {
  const variant = scopeOk(player, gs);
  if (!variant) return null;
  if (gs.ownVpipFloorLimpThisHand === true) return null;
  const heroBet = Math.max(0, fin(player.bet));
  if (!(fin(gs.currentBet) > heroBet + 0.005)) return null;
  const pre = (gs.actionHistory ?? []).filter((a) => a.stage === 'preflop');
  const raises = pre.filter(isRaiseAction);
  if (raises.length !== 1) return null;
  // the Horse's one voluntary action is its limp, made before the raise
  const raiseIdx = pre.indexOf(raises[0]!);
  const mine = pre
    .map((a, i) => ({ a, i }))
    .filter((x) => x.a.seat === player.seat && VOLUNTARY.has(x.a.action));
  if (mine.length !== 1 || mine[0]!.a.action !== 'call' || mine[0]!.i > raiseIdx) return null;
  if (!limpReraiseStrongHand(player.cards)) return null;
  const raiserSeat = raises[0]!.seat;
  const others = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
  );
  if (others.length !== 1 || others[0]!.seat !== raiserSeat) return null;
  const raiser = others[0]!;
  const dealer = gs.dealerSeat;
  const inPosition =
    limpReraisePostflopOrder(player.seat, dealer) > limpReraisePostflopOrder(raiserSeat, dealer);
  const rundown = limpReraiseRundown(player.cards);
  if (!inPosition && !rundown) return null;
  const uid = String(raiser.user_id ?? '');
  return {
    raiserSeat,
    inPosition,
    rundown,
    fold: limpReraiseFoldToReraiseOf(uid, mind),
    raiseRate: limpReraiseRaiseRateOf(uid, variant, mind),
  };
}

/** Step 2: the Horse's limp, raised, re-raises the pot where that is priced above the call and the fold. */
export function limpReraiseReraiseStep(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  mind: boolean
): { decision: HorseDecision; receipt: 'reraised' | 'reraise_kept' | null } {
  if (decision.action === 'raise' || decision.action === 'all_in')
    return { decision, receipt: null };
  const s = limpReraiseSpot(player, gs, mind);
  if (!s) return { decision, receipt: null };
  const raiser = (gs.players ?? []).find((p) => p.seat === s.raiserSeat)!;
  const heroBet = Math.max(0, fin(player.bet));
  const heroStack = Math.max(0, fin(player.stack));
  const raiseTo = fin(gs.currentBet);
  const legal = Array.isArray(gs.legalActions) ? gs.legalActions : [];
  const width = clamp(RERAISED_POT_WIDTH_PER_RATE * s.raiseRate, 0.02, 1);
  const eq = omahaReraisedEquityAgainstPercentileFloors(
    player.cards ?? [],
    player.knownDeadCards ?? [],
    [reraisedPotFloorOf(width)],
    RERAISED_POT_PRICED_SAMPLES
  );
  if (eq === null) return { decision, receipt: null };
  const pot = Math.max(0, fin(gs.pot));
  const three = limpReraiseThreeBetEv({
    potBefore: pot,
    heroBet,
    heroStack,
    raiserBet: raiseTo,
    raiserStack: Math.max(0, fin(raiser.stack)),
    raiseTo,
    fold: s.fold,
    equity: eq,
    inPosition: s.inPosition,
  });
  // the legal pot re-raise: the table's maximum raise-to, or the all-in
  const maxTo = fin(gs.maxRaiseTo, NaN);
  const heroCap = heroBet + heroStack;
  let to = three.threeBet.to;
  let allIn = three.threeBet.allIn;
  if (Number.isFinite(maxTo) && to > maxTo + 0.005) {
    to = maxTo;
    allIn = maxTo >= heroCap - 0.005;
  }
  const canRaise = legal.length === 0 || legal.includes('raise');
  const canAllIn = legal.length === 0 || legal.includes('all_in');
  if (allIn ? !canAllIn : !canRaise) return { decision, receipt: null };
  const call = Math.min(heroStack, raiseTo - heroBet);
  const calledPot = pot + call;
  const callSpr = calledPot > 0 ? Math.max(0, heroStack - call) / calledPot : 0;
  const evCall =
    reraisedPotRealization('caller', s.inPosition, callSpr, 2, eq) * eq * calledPot - call;
  const deadband =
    RERAISED_POT_DEADBAND_POT_SHARE * calledPot +
    (0.5 / Math.sqrt(RERAISED_POT_PRICED_SAMPLES)) * three.threeBet.calledPot * (1 - s.fold);
  if (!(three.ev > Math.max(evCall, 0) + deadband)) return { decision, receipt: 'reraise_kept' };
  const out: HorseDecision = allIn
    ? { ...decision, action: 'all_in' }
    : { ...decision, action: 'raise', amount: cents(to) };
  if (allIn) delete out.amount;
  delete out.valueSize;
  delete out.continuationGuard;
  return { decision: out, receipt: 'reraised' };
}
