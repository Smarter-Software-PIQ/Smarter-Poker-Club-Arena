/**
 * omahaReraisedPotCallIsPriced and omahaReraisedPotReraiseIsPriced (PLO lead-6 2026-11-24; each default OFF, read
 * `=== true`): the rule that applies HorseOmahaReraisedPotPriced's verdict to the decision every earlier rule left
 * standing, facing a 3-bet or more preflop in PLO4/PLO5 cash.
 *
 * WHERE IT RUNS. Outermost seat of the re-raised-pot rules (HorseLogic.omahaReraisedPotRulesThenCallVsRaise, on
 * both decision paths), after omahaOopReraisedPotStrongRange, omahaPreflopReraiseDefencePricedInPosition and the
 * other re-raised-pot rules. It reads only the decision they leave standing.
 *
 * WHAT IT CHANGES.
 *  - omahaReraisedPotCallIsPriced: a standing CALL stands only when EV(call) is not below 0 by more than the
 *    deadband; otherwise it becomes a fold. A standing FOLD becomes the call when EV(call) is above 0 by more than
 *    the deadband (an over-fold to a measured wide re-raiser is a leak too). With it on, the in-position defence of
 *    #11594 (omahaPreflopReraiseDefencePricedInPosition) answers to this price: a call it made of a fold stands
 *    only where this price says call.
 *  - omahaReraisedPotReraiseIsPriced: a standing RE-RAISE (a 4-bet or more; an all-in that raises) stands only when
 *    EV(re-raise) is not below max(EV(call), 0) by more than the deadband; otherwise it becomes the call when
 *    EV(call) >= 0, else a fold.
 *  Nothing else moves: no raise is ever invented, no size is changed, a call that is the whole stack is priced as
 *  the all-in call it is, and every other street, game, format or decision is returned as it is.
 *
 * THE READS (one function each, identity-free: no person-vs-Horse kind, no name, no unshown card):
 *  - the re-raiser's re-raise rate: his own decayed record (HorseMind.currentExploitCounters threeBet/threeBetOpp)
 *    against the anchored prior (self-play baseline plus a reduced population weight; PRIOR below);
 *  - his fold to the Horse's re-raise at that node: his own decayed answers (HorseMind.omahaReraiseResponseOf)
 *    against the same kind of anchored prior;
 *  - a player behind: the measured self-play answer of a player in his spot (no per-player counter exists for it).
 *
 * Receipts: omaha_reraised_pot_priced_call_kept / _call_folded / _fold_called / _fold_kept and
 * omaha_reraised_pot_priced_reraise_kept / _reraise_called / _reraise_folded; omaha_reraised_pot_priced_failed on an
 * exception (the standing decision is returned).
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { noteFire } from './BrainTelemetry.js';
import { variantInfo } from './HorseEval.js';
import { HorseMind, readScopeOf } from './HorseMind.js';
import { exploitEnvelopeFor, reRaiseLineWidth } from './HorseOpponentExploit.js';
import { preflopRaiseCount } from './HorseOmahaReraisedPot.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { omahaPreflopDefenceRake } from './HorseOmahaPreflopReraiseDefence.js';
import { reraiseResponseNodeOf, type ReraiseResponseNode } from './HorseOmahaReraiseResponse.js';
import {
  OMAHA_RERAISED_POT_PRICED_VARIANTS,
  RERAISED_POT_BEHIND_WIDTH_RATIO,
  RERAISED_POT_CALLER_WIDTH_RATIO,
  reraisedPotRaiserWidth,
  reraisedPotVerdict,
  type ReraisedPotOpponent,
  type ReraisedPotSpot,
  type ReraisedPotVerdict,
} from './HorseOmahaReraisedPotPriced.js';

/**
 * THE PRIOR ANCHOR (docs/horse-option-authority.d/omahaReraisedPotCallIsPriced.md, "## Prior anchor").
 *  - baseline: league self-play of the production brain (PLO5 6-max, 100 bb; the engine's own simulated players);
 *  - population: the measured live rate of the population, at a reduced weight because the live population is on
 *    the exploitable side of the baseline (people 3-bet 58% of Horse opens in PLO5 and fold 0 of 196 4-bets);
 *  - own record: his decayed opportunities, which dominate once they pass the two masses together.
 */
export const RERAISED_POT_PRIOR = {
  /** a re-raise of a single raise (3-bet rate), self-play PLO5 6-max 100 bb (89,427 decisions: 0.085) */
  threeBetRate: { baseline: 0.085, baselineMass: 8, populationMass: 3 },
  /**
   * the 3-bettor facing a 4-bet: fold share. Self-play 100 bb 0.493 (1,688); at 300 bb 0.739 (552) is the Horses'
   * documented over-fold of the 3-bet range deep (threebet-fold trace), not a baseline, so the anchor is 0.45. The
   * population pooled (all players, 284 answers: 0.187; persons 0 of 196) at reduced weight.
   */
  threeBetFacesFourBetFold: {
    baseline: 0.45,
    baselineMass: 6,
    population: 0.187,
    populationMass: 2,
  },
  /** the 4-bettor facing a 5-bet: fold share (anchor 0.2; population pooled 1 of 23) */
  fourBetFacesFiveBetFold: { baseline: 0.2, baselineMass: 6, population: 0.043, populationMass: 2 },
  /** the opener facing a 3-bet: fold share (sets how wide a 4-bettor who opened continues), self-play 100 bb 0.253 */
  openFacesThreeBetFold: { baseline: 0.253, baselineMass: 8 },
  /** an opener's continue that is a 4-bet, self-play 100 bb (0.161 / 0.747) */
  openFacesThreeBetFourBetShare: 0.216,
  /** a player who must call a re-raise cold, self-play 100 bb (11,812): [fold, call, re-raise] */
  coldFacesReraise: { fold: 0.895, call: 0.082, reraise: 0.023 },
  /** a player with chips in, behind a re-raise and a call (the squeeze spot), self-play 100 bb (1,372) */
  inFacesReraiseAndCall: { fold: 0.533, call: 0.45, reraise: 0.017 },
  /** facing a 4-bet or more while not the last re-raised player, self-play 100 bb (898) */
  facesFourBetCold: { fold: 0.768, call: 0.135, reraise: 0.097 },
} as const;

export interface ReraisedPotPricedContext {
  mind: boolean;
  telemetry: boolean;
}

const order = (seat: number, dealerSeat: number | undefined): number => {
  const d = seat - (dealerSeat ?? 0);
  return d <= 0 ? d + 1024 : d;
};

const fin = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/** His posterior re-raise rate: own record, then the self-play baseline and the population at their masses. */
export function reraisedPotRaiseRateOf(
  userId: string,
  variant: string,
  dealt: number,
  mind: boolean
): number {
  const p = RERAISED_POT_PRIOR.threeBetRate;
  let pop: number = p.baseline;
  try {
    const env = exploitEnvelopeFor(readScopeOf(variant, dealt), variant);
    if (env && Number.isFinite(env.threeBet?.mean)) pop = env.threeBet.mean;
  } catch {
    /* baseline */
  }
  let hits = 0;
  let opp = 0;
  if (mind && userId) {
    try {
      const c = HorseMind.currentExploitCounters(userId);
      if (c) {
        hits = Math.max(0, fin(c.threeBet));
        opp = Math.max(0, fin(c.threeBetOpp));
        if (hits > opp) hits = opp;
      }
    } catch {
      /* prior alone */
    }
  }
  return (
    (hits + p.baseline * p.baselineMass + pop * p.populationMass) /
    (opp + p.baselineMass + p.populationMass)
  );
}

/** His posterior fold share when re-raised at `node`. */
export function reraisedPotFoldToReraiseOf(
  userId: string,
  node: ReraiseResponseNode,
  mind: boolean
): number {
  const p =
    node === 'threeBetFacesFourBet'
      ? RERAISED_POT_PRIOR.threeBetFacesFourBetFold
      : RERAISED_POT_PRIOR.fourBetFacesFiveBetFold;
  let fold = 0;
  let opp = 0;
  if (mind && userId) {
    try {
      const row = HorseMind.omahaReraiseResponseOf(userId);
      const c = row?.[node];
      if (c && fin(c.opp) > 0) {
        opp = fin(c.opp);
        fold = Math.min(opp, Math.max(0, fin(c.fold)));
      }
    } catch {
      /* prior alone */
    }
  }
  return (
    (fold + p.baseline * p.baselineMass + p.population * p.populationMass) /
    (opp + p.baselineMass + p.populationMass)
  );
}

/**
 * The width of the last re-raiser's range. A 3-bet: his anchored re-raise rate mapped to a range. A 4-bet or more:
 * that width narrowed by the line rule, or, for a re-raiser who opened, his continuing share against a 3-bet (his
 * own fold-to-3-bet record against the self-play baseline) times the self-play share of continues that re-raise,
 * whichever is wider (a player who answers every 3-bet with a 4-bet is read that wide).
 */
export function reraisedPotRaiserWidthOf(
  userId: string,
  variant: string,
  dealt: number,
  preflopRaises: number,
  raiserOpened: boolean,
  mind: boolean
): number {
  const rate = reraisedPotRaiseRateOf(userId, variant, dealt, mind);
  let width = reraisedPotRaiserWidth(rate, preflopRaises);
  if (preflopRaises >= 3 && raiserOpened && mind && userId) {
    try {
      const c = HorseMind.currentExploitCounters(userId);
      if (c) {
        const p = RERAISED_POT_PRIOR.openFacesThreeBetFold;
        const fOpp = Math.max(0, fin(c.foldTo3BetOpp));
        const f = Math.min(fOpp, Math.max(0, fin(c.foldTo3Bet)));
        const fold = (f + p.baseline * p.baselineMass) / (fOpp + p.baselineMass);
        const rfiOpp = Math.max(0, fin(c.rfiOpp));
        const rfi = Math.min(rfiOpp, Math.max(0, fin(c.rfi)));
        const openWidth = (rfi + 0.25 * 8) / (rfiOpp + 8);
        // his continues that re-raise: the baseline share, raised toward all of them as his fold share falls below it
        const s4 =
          RERAISED_POT_PRIOR.openFacesThreeBetFourBetShare +
          (1 - RERAISED_POT_PRIOR.openFacesThreeBetFourBetShare) *
            Math.max(0, (p.baseline - fold) / p.baseline);
        width = Math.max(width, Math.min(1, openWidth * (1 - fold) * s4));
        for (let d = 4; d <= Math.min(preflopRaises, 6); d++) width = reRaiseLineWidth(width, d);
      }
    } catch {
      /* the rate width stands */
    }
  }
  return width;
}

export interface ReraisedPotPricedSpotFound {
  spot: ReraisedPotSpot;
  heroBet: number;
  raiserSeat: number;
}

/** The spot, or null outside PLO4/PLO5 cash, preflop, facing a 3-bet or more with a fold available. */
export function reraisedPotPricedSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  mind: boolean
): ReraisedPotPricedSpotFound | null {
  if (String(gs.stage ?? '') !== 'preflop') return null;
  const variant = String(gs.gameVariant ?? '').toLowerCase();
  if (!OMAHA_RERAISED_POT_PRICED_VARIANTS.has(variant)) return null;
  const hole = player.cards ?? [];
  if (hole.length !== 4 && hole.length !== 5) return null;
  if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : variantInfo(gs.gameVariant).isHiLo)
    return null;
  if (gs.communityCards2?.length || gs.communityCards3?.length) return null;
  if (gs.bombPot === true || gs.allInOrFold === true) return null;
  if (omahaIsTournamentMode(gs)) return null;
  if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('fold')) return null;
  const history = gs.actionHistory ?? [];
  const preflopRaises = preflopRaiseCount(history);
  if (preflopRaises < 2) return null;
  const stack = Math.max(0, fin(player.stack));
  const heroBet = Math.max(0, fin(player.bet));
  const toCall = Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, fin(gs.currentBet) - heroBet);
  if (toCall <= 0.005 || stack <= 0) return null;
  const pot = Math.max(0, fin(gs.pot));
  if (!(pot > 0)) return null;
  const raises = history.filter(
    (a) =>
      a.stage === 'preflop' &&
      (a.action === 'raise' ||
        a.action === 'bet' ||
        (a.action === 'all_in' && a.isFullRaise !== undefined))
  );
  let raiserSeat = -1;
  for (let k = history.length - 1; k >= 0; k--) {
    const a = history[k]!;
    if (a.stage !== 'preflop' || a.seat === player.seat) continue;
    if (a.action !== 'raise' && a.action !== 'all_in' && a.action !== 'bet') continue;
    raiserSeat = a.seat;
    break;
  }
  const raiser = (gs.players ?? []).find((p) => p.seat === raiserSeat);
  if (!raiser || raiser.is_folded) return null;
  const bb = gs.bigBlind || 1;
  const price = fin(gs.currentBet);
  const dealt =
    gs.dealtSeatIds !== undefined
      ? gs.dealtSeatIds.length
      : (gs.players ?? []).filter((p) => !p.is_sitting_out || p.is_all_in).length;
  const dealer = gs.dealerSeat;
  const raiserOpened = raises.length > 0 && raises[0]!.seat === raiserSeat;
  const raiserWidth = reraisedPotRaiserWidthOf(
    String(raiser.user_id ?? ''),
    variant,
    dealt,
    preflopRaises,
    raiserOpened,
    mind
  );
  const node = reraiseResponseNodeOf(preflopRaises) ?? 'threeBetFacesFourBet';
  const opponents: ReraisedPotOpponent[] = [
    {
      seat: raiser.seat,
      role: 'raiser',
      order: order(raiser.seat, dealer),
      behind: Math.max(0, fin(raiser.stack)),
      toMatch: 0,
      width: raiserWidth,
      foldToReraise: reraisedPotFoldToReraiseOf(String(raiser.user_id ?? ''), node, mind),
    },
  ];
  const cold = preflopRaises >= 3 ? RERAISED_POT_PRIOR.facesFourBetCold : null;
  const level: 'threeBet' | 'fourBet' = preflopRaises >= 3 ? 'fourBet' : 'threeBet';
  for (const p of gs.players ?? []) {
    if (p.seat === player.seat || p.seat === raiserSeat || p.is_folded || p.is_sitting_out)
      continue;
    const bet = Math.max(0, fin(p.bet));
    const allIn = p.is_all_in === true;
    const inFor = bet >= price - 0.005 || (allIn && bet > bb + 0.005);
    if (inFor || allIn) {
      opponents.push({
        seat: p.seat,
        role: 'in',
        order: order(p.seat, dealer),
        behind: Math.max(0, fin(p.stack)),
        toMatch: 0,
        width: Math.min(1, raiserWidth * RERAISED_POT_CALLER_WIDTH_RATIO[level]),
        foldToReraise: (cold ?? RERAISED_POT_PRIOR.coldFacesReraise).fold,
      });
      continue;
    }
    // Still to act behind the call: his answer is the measured answer of a player in his spot.
    const hasMoneyIn = bet > bb + 0.005;
    const r =
      cold ??
      (hasMoneyIn ? RERAISED_POT_PRIOR.inFacesReraiseAndCall : RERAISED_POT_PRIOR.coldFacesReraise);
    opponents.push({
      seat: p.seat,
      role: 'behind',
      order: order(p.seat, dealer),
      behind: Math.max(0, fin(p.stack)),
      toMatch: Math.max(0, price - bet),
      width: Math.min(1, raiserWidth * RERAISED_POT_BEHIND_WIDTH_RATIO[level]),
      cont: r.call,
      reraise: r.reraise,
      foldToReraise: r.fold,
    });
  }
  return {
    heroBet,
    raiserSeat,
    spot: {
      variant,
      preflopRaises,
      call: Math.min(toCall, stack),
      pot,
      stack,
      heroOrder: order(player.seat, dealer),
      opponents,
      rake: (size: number) => omahaPreflopDefenceRake(size, bb, gs.rakeConfig, dealt),
    },
  };
}

/** The pot-size re-raise legal now: the raise-to and the chips it adds, or the all-in when it takes the whole stack. */
export function reraisedPotPotRaise(
  spot: ReraisedPotSpot,
  heroBet: number,
  gs: HorseGameStateV2
): { to: number; risk: number; allIn: boolean } | null {
  const legal = Array.isArray(gs.legalActions) ? gs.legalActions : [];
  const maxTo = fin(gs.maxRaiseTo, NaN);
  const allInTo = heroBet + spot.stack;
  if (legal.includes('raise') && Number.isFinite(maxTo) && maxTo > fin(gs.currentBet) + 0.005) {
    if (maxTo >= allInTo - 0.005)
      return legal.includes('all_in') ? { to: allInTo, risk: spot.stack, allIn: true } : null;
    return { to: maxTo, risk: maxTo - heroBet, allIn: false };
  }
  if (legal.includes('all_in') && allInTo > fin(gs.currentBet) + 0.005)
    return { to: allInTo, risk: spot.stack, allIn: true };
  return null;
}

export interface ReraisedPotPricedOptions {
  call: boolean;
  reraise: boolean;
}

const cents = (x: number): number => Math.round(x * 100) / 100;

/** What the rule decides for the standing decision (exported for the laws and the receipt validator). */
export function reraisedPotPricedDecision(
  standing: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  which: ReraisedPotPricedOptions,
  ctx: ReraisedPotPricedContext
): { decision: HorseDecision; verdict: ReraisedPotVerdict | null; receipt: string | null } {
  const same = { decision: standing, verdict: null, receipt: null };
  const given = standing.action;
  if (given !== 'fold' && given !== 'call' && given !== 'raise' && given !== 'all_in') return same;
  const found = reraisedPotPricedSpot(player, gs, ctx.mind);
  if (!found) return same;
  const { spot, heroBet } = found;
  const callIsAllIn = spot.stack <= spot.call + 0.005;
  const givenRaise = given === 'raise' || (given === 'all_in' && !callIsAllIn);
  const kind: 'fold' | 'call' | 'raise' = given === 'fold' ? 'fold' : givenRaise ? 'raise' : 'call';
  if (kind === 'raise' && !which.reraise) return same;
  if (kind === 'fold' && !which.call) return same;
  if (kind === 'call' && !which.call && !which.reraise) return same;
  let risk: number | null = null;
  if (kind === 'raise') {
    const to = given === 'all_in' ? heroBet + spot.stack : Number(standing.amount);
    if (!Number.isFinite(to)) return same;
    risk = Math.min(spot.stack, Math.max(0, to - heroBet));
    if (!(risk > spot.call + 0.005)) return same;
  }
  // A standing call is priced against the pot-size re-raise too (omahaReraisedPotReraiseIsPriced): the largest legal
  // re-raise, the whole stack when that is all the chips.
  const potRaise = kind === 'call' && which.reraise ? reraisedPotPotRaise(spot, heroBet, gs) : null;
  if (potRaise) risk = potRaise.risk;
  const verdict = reraisedPotVerdict(spot, player.cards ?? [], player.knownDeadCards ?? [], risk);
  if (!verdict) return same;
  const db = verdict.deadband;
  const asCall = (): HorseDecision => {
    const c: HorseDecision = callIsAllIn
      ? { ...standing, action: 'all_in' }
      : { ...standing, action: 'call', amount: cents(spot.call) };
    if (callIsAllIn) delete c.amount;
    delete c.continuationGuard;
    return c;
  };
  const asFold = (): HorseDecision => {
    const f: HorseDecision = { ...standing, action: 'fold' };
    delete f.amount;
    delete f.continuationGuard;
    return f;
  };
  if (kind === 'call') {
    if (
      potRaise &&
      verdict.evRaise !== null &&
      verdict.evRaise > Math.max(verdict.evCall, 0) + db
    ) {
      const r: HorseDecision = potRaise.allIn
        ? { ...standing, action: 'all_in' }
        : { ...standing, action: 'raise', amount: cents(potRaise.to) };
      if (potRaise.allIn) delete r.amount;
      delete r.continuationGuard;
      return { decision: r, verdict, receipt: 'call_reraised' };
    }
    if (which.call && verdict.evCall < -db)
      return { decision: asFold(), verdict, receipt: 'call_folded' };
    return { decision: standing, verdict, receipt: 'call_kept' };
  }
  if (kind === 'fold') {
    if (verdict.evCall > db) return { decision: asCall(), verdict, receipt: 'fold_called' };
    return { decision: standing, verdict, receipt: 'fold_kept' };
  }
  const evRaise = verdict.evRaise;
  if (evRaise === null) return { decision: standing, verdict, receipt: null };
  if (evRaise >= Math.max(verdict.evCall, 0) - db)
    return { decision: standing, verdict, receipt: 'reraise_kept' };
  if (verdict.evCall >= 0) return { decision: asCall(), verdict, receipt: 'reraise_called' };
  return { decision: asFold(), verdict, receipt: 'reraise_folded' };
}

/** The rule: the standing decision, or the priced one. Never throws. */
export function omahaReraisedPotPricedRule(
  standing: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  which: ReraisedPotPricedOptions,
  ctx: ReraisedPotPricedContext
): HorseDecision {
  if (!which.call && !which.reraise) return standing;
  try {
    if (String(gs.stage ?? '') !== 'preflop') return standing;
    const r = reraisedPotPricedDecision(standing, player, gs, which, ctx);
    if (ctx.telemetry && r.receipt) {
      // Literal receipts (one per outcome), so the receipt registries can read them from source.
      if (r.receipt === 'call_kept') noteFire('omaha_reraised_pot_priced_call_kept');
      else if (r.receipt === 'call_folded') noteFire('omaha_reraised_pot_priced_call_folded');
      else if (r.receipt === 'call_reraised') noteFire('omaha_reraised_pot_priced_call_reraised');
      else if (r.receipt === 'fold_called') noteFire('omaha_reraised_pot_priced_fold_called');
      else if (r.receipt === 'fold_kept') noteFire('omaha_reraised_pot_priced_fold_kept');
      else if (r.receipt === 'reraise_kept') noteFire('omaha_reraised_pot_priced_reraise_kept');
      else if (r.receipt === 'reraise_called') noteFire('omaha_reraised_pot_priced_reraise_called');
      else if (r.receipt === 'reraise_folded') noteFire('omaha_reraised_pot_priced_reraise_folded');
    }
    return r.decision;
  } catch {
    if (ctx.telemetry) noteFire('omaha_reraised_pot_priced_failed');
    return standing;
  }
}

/**
 * Receipt validation (no options and no opponent memory in the request): a preflop change this rule can make is
 * admitted only in its own spot: a fold or a re-raise that became a call for the exact chips of the call (the
 * whole-stack call is an all-in, a wager action), and a call or a re-raise that became a fold.
 */
export function omahaReraisedPotPricedAdmitsCall(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    const found = reraisedPotPricedSpot(hero, gs, false);
    if (!found) return false;
    const { spot } = found;
    if (spot.stack <= spot.call + 0.005) return false;
    return typeof amount === 'number' && Math.abs(cents(spot.call) - amount) <= 0.005;
  } catch {
    return false;
  }
}

export function omahaReraisedPotPricedAdmitsFold(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    return reraisedPotPricedSpot(hero, gs, false) !== null;
  } catch {
    return false;
  }
}

/**
 * Receipt validation: a call that became the pot-size re-raise (omahaReraisedPotReraiseIsPriced) is admitted only in
 * the rule's own spot re-derived from the request and only at the largest legal raise-to (the all-in is a wager
 * action already).
 */
export function omahaReraisedPotPricedAdmitsRaise(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  try {
    const found = reraisedPotPricedSpot(hero, gs, false);
    if (!found) return false;
    const r = reraisedPotPotRaise(found.spot, found.heroBet, gs);
    if (!r || r.allIn) return false;
    return typeof amount === 'number' && Math.abs(cents(r.to) - amount) <= 0.005;
  } catch {
    return false;
  }
}
