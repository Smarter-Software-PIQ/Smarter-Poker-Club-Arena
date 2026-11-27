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
import { indifferenceFold } from './HorsePreflopIndifferenceAnchor.js';
import { exploitEnvelopeFor, reRaiseLineWidth } from './HorseOpponentExploit.js';
import { preflopRaiseCount } from './HorseOmahaReraisedPot.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import { omahaPreflopDefenceRake } from './HorseOmahaPreflopReraiseDefence.js';
import { reraiseResponseNodeOf, type ReraiseResponseNode } from './HorseOmahaReraiseResponse.js';
import {
  OMAHA_RERAISED_POT_PRICED_VARIANTS,
  RERAISED_POT_PRICED_SAMPLES,
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

/**
 * THE PEOPLE PRIOR of omahaReraisedPotFoldReraiseIsPriced (lead-8 lane preflop, 2026-11-27; owner order 2026-11-26
 * 12:21 Chicago: every statistic about an opponent is measured from people's play only). One formula for every
 * opponent: his own public record, then this prior. Measured read-only from public actions of PLO4/PLO5 cash hands
 * with a person, 2026-11-19 23:00Z to 11-27 05:00Z (7,995 hands; S7/l8-preflop/stats.md), people's actions only.
 * Each cell is the PERSON-LEVEL distribution (the mean over persons and the mass of a beta fitted to their spread
 * by moments), because these rates belong to the person: a pooled rate is one or two frequent players.
 *  - threeBet: a person facing one open re-raised 42.9% in PLO5 (1,219 of 2,843) and 7.3% in PLO4 (70 of 953),
 *    but 15 person-game cells with 30 or more opportunities run from 0% to 53%: mean 0.156, mass 2.7. An own
 *    record of a dozen opportunities outweighs it four to one.
 *  - a 3-bettor facing a 4-bet: 9 persons, 277 answers, ONE fold (PLO5 0 of 265, PLO4 1 of 12): person mean 0.028,
 *    mass 3.4. The cell is not thin, so it stands alone: the first build put the indifference fold (2/3 for a pot
 *    re-raise) beside it at mass 2, which read an unknown 3-bettor as folding 27% of the time, a fold equity no
 *    person had shown; against a scripted tight 3-bettor that build lost 15.3 +/- 5.2 bb/100 heads-up and was
 *    withdrawn (S7/l8-preflop/BUILD.md, v1).
 *  - a 4-bettor facing a 5-bet: 6 persons, 15 answers, no fold. Thin, so the option does not price that node at
 *    all (reraisedPotFoldReraise acts facing exactly a 3-bet); the cell is kept, anchored to the indifference fold
 *    of the re-raise he would face (HorsePreflopIndifferenceAnchor.indifferenceFold) at mass 2, for a later build
 *    with more answers.
 * Nothing here is fitted on a Horse's play, a HUD population row or an unshown card.
 */
export const RERAISED_POT_PEOPLE_PRIOR = {
  threeBetRate: { people: 0.156, peopleMass: 2.7 },
  threeBetFacesFourBetFold: { anchorMass: 0, people: 0.028, peopleMass: 3.4 },
  fourBetFacesFiveBetFold: { anchorMass: 2, people: 0, peopleMass: 3.4 },
} as const;

/**
 * The sampling error of the price (omahaReraisedPotFoldReraiseIsPriced): the equity behind EV(re-raise) is a sample
 * of RERAISED_POT_PRICED_SAMPLES joint draws, so the called branch carries a standard error of at most
 * 0.5 / sqrt(samples) of the called pot. A fold becomes a re-raise only when the price clears that error as well as
 * the deadband: a re-raise risks many times what a call does, on the same sample.
 */
export function reraisedPotFoldReraiseSamplingMargin(calledPot: number, allFold: number): number {
  const p = Math.max(0, Math.min(1, Number.isFinite(allFold) ? allFold : 0));
  return (0.5 / Math.sqrt(RERAISED_POT_PRICED_SAMPLES)) * Math.max(0, calledPot) * (1 - p);
}

export interface ReraisedPotPricedContext {
  mind: boolean;
  telemetry: boolean;
}

const order = (seat: number, dealerSeat: number | undefined): number => {
  const d = seat - (dealerSeat ?? 0);
  return d <= 0 ? d + 1024 : d;
};

const fin = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);

/** His own decayed 3-bet record as the decision in flight reads it (0 of 0 with none, or with memory off). */
function reraisedPotOwnThreeBetRecord(
  userId: string,
  mind: boolean
): { hits: number; opp: number } {
  if (!mind || !userId) return { hits: 0, opp: 0 };
  try {
    const c = HorseMind.currentExploitCounters(userId);
    if (!c) return { hits: 0, opp: 0 };
    const opp = Math.max(0, fin(c.threeBetOpp));
    return { hits: Math.min(opp, Math.max(0, fin(c.threeBet))), opp };
  } catch {
    return { hits: 0, opp: 0 };
  }
}

/** His posterior re-raise rate: own record, then the self-play baseline and the population at their masses. */
export function reraisedPotRaiseRateOf(
  userId: string,
  variant: string,
  dealt: number,
  mind: boolean,
  /** omahaReraisedPotFoldReraiseIsPriced: his own record against the people prior (RERAISED_POT_PEOPLE_PRIOR). */
  peoplePrior = false
): number {
  if (peoplePrior) {
    const q = RERAISED_POT_PEOPLE_PRIOR.threeBetRate;
    const own = reraisedPotOwnThreeBetRecord(userId, mind);
    return (own.hits + q.people * q.peopleMass) / (own.opp + q.peopleMass);
  }
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
  mind: boolean,
  /**
   * omahaReraisedPotFoldReraiseIsPriced: his own record, then the people prior, then the equilibrium anchor: the
   * indifference fold of the re-raise he would face, of size `anchorSize` times the pot it is made into.
   */
  people?: { anchorSize: number }
): number {
  if (people) {
    const q =
      node === 'threeBetFacesFourBet'
        ? RERAISED_POT_PEOPLE_PRIOR.threeBetFacesFourBetFold
        : RERAISED_POT_PEOPLE_PRIOR.fourBetFacesFiveBetFold;
    let f = 0;
    let n = 0;
    if (mind && userId) {
      try {
        const c = HorseMind.omahaReraiseResponseOf(userId)?.[node];
        if (c && fin(c.opp) > 0) {
          n = fin(c.opp);
          f = Math.min(n, Math.max(0, fin(c.fold)));
        }
      } catch {
        /* prior alone */
      }
    }
    return (
      (f + indifferenceFold(people.anchorSize) * q.anchorMass + q.people * q.peopleMass) /
      (n + q.anchorMass + q.peopleMass)
    );
  }
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
  mind: boolean,
  peoplePrior = false
): number {
  const rate = reraisedPotRaiseRateOf(userId, variant, dealt, mind, peoplePrior);
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
  mind: boolean,
  /** omahaReraisedPotFoldReraiseIsPriced: the re-raiser read from his own record against the people prior. */
  peoplePrior = false
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
    mind,
    peoplePrior
  );
  const node = reraiseResponseNodeOf(preflopRaises) ?? 'threeBetFacesFourBet';
  // the size of the Horse's own pot re-raise as a bluff: the chips it adds over the pot it is made into
  const stackNow = Math.max(0, fin(player.stack));
  const potReraiseRisk = Math.min(stackNow, 2 * toCall + pot);
  const anchorSize = pot > 0 ? potReraiseRisk / pot : 2;
  const opponents: ReraisedPotOpponent[] = [
    {
      seat: raiser.seat,
      role: 'raiser',
      order: order(raiser.seat, dealer),
      behind: Math.max(0, fin(raiser.stack)),
      toMatch: 0,
      width: raiserWidth,
      foldToReraise: reraisedPotFoldToReraiseOf(
        String(raiser.user_id ?? ''),
        node,
        mind,
        peoplePrior ? { anchorSize } : undefined
      ),
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
  /** omahaReraisedPotFoldReraiseIsPriced: a standing fold is priced against the pot-size re-raise. */
  foldReraise?: boolean;
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
  // omahaReraisedPotFoldReraiseIsPriced (default OFF): the standing FOLD against the pot-size re-raise, heads-up
  // against the re-raiser, read from his own record against the people prior. Asked first; when it does not
  // re-raise, the fold goes on to the call price below exactly as before (omahaReraisedPotCallIsPriced, if on).
  if (kind === 'fold' && which.foldReraise === true) {
    const r = reraisedPotFoldReraise(standing, player, gs, ctx);
    if (r && (r.receipt === 'fold_reraised' || !which.call)) return r;
  }
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

/**
 * omahaReraisedPotFoldReraiseIsPriced (lead-8 lane preflop, 2026-11-27; default OFF, read `=== true`).
 *
 * THE GAP. Every re-raised-pot rule priced a standing fold against the CALL only. A Horse that opened and met a
 * 3-bet out of position therefore folded (calling there is a losing play: the measured out-of-position realization
 * prices it out) and never asked what the pot-size 4-bet was worth. Against people that fold was 72% of the Horses'
 * out-of-position answers to a 3-bet in PLO5 (495 decisions, 2026-11-19..27), while those people re-raised 43% of
 * opens and folded 0 of 265 4-bets: a range that wide, which never folds, is one the top of an opening range is
 * ahead of with the pot already built.
 *
 * WHAT IT DOES. PLO4/PLO5 cash, preflop, the Horse having made the first raise of the hand and facing exactly a cold
 * 3-bet of it (the re-raiser's first voluntary action: a limp-re-raise is a far stronger range than his 3-bet rate
 * describes, and is not priced; a fold facing a 4-bet or more is not priced here either:
 * people's answers to a 5-bet are 15, too thin to price a stack on), OUT OF POSITION against him on the later streets
 * (in position the fold is already weighed against the call by the live in-position defence, and the realization fit
 * credits an in-position aggressor with more than his equity on far stronger ranges), heads-up against the re-raiser (no other live
 * player in the hand: with callers in or players to act the called pot is not the two-range pot priced here, so
 * the fold stands), a pot-size re-raise or the all-in it amounts to being legal: the standing fold becomes that
 * re-raise when EV(re-raise) > max(EV(call), 0) + deadband + the sampling error of the price
 * (reraisedPotFoldReraiseSamplingMargin) on HorseOmahaReraisedPotPriced's verdict, with the
 * re-raiser's width and his fold to the re-raise read from HIS OWN public record, then the people prior
 * (RERAISED_POT_PEOPLE_PRIOR), then the equilibrium anchor. It never makes a call (a call of a 3-bet or 4-bet out
 * of position stays what the call price says it is), never changes a size and never touches a standing call or
 * re-raise. Receipts omaha_reraised_pot_priced_fold_reraised / _fold_reraise_kept.
 */
function reraisedPotFoldReraise(
  standing: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  ctx: ReraisedPotPricedContext
): { decision: HorseDecision; verdict: ReraisedPotVerdict | null; receipt: string | null } | null {
  const found = reraisedPotPricedSpot(player, gs, ctx.mind, true);
  if (!found) return null;
  const { spot, heroBet } = found;
  // exactly a 3-bet (the measured gap: the opener's fold); a fold facing a 4-bet or more is left to the fold
  if (spot.preflopRaises !== 2) return null;
  if (spot.opponents.length !== 1) return null;
  // a COLD 3-bet of the Horse's own first raise only: the Horse made the first raise of the hand and the re-raise
  // is the re-raiser's first voluntary action. A limp-re-raise is not priced: its range is far stronger than the
  // re-raiser's 3-bet rate, which is all the read knows.
  {
    const pre = (gs.actionHistory ?? []).filter((a) => a.stage === 'preflop');
    const isRaise = (a: (typeof pre)[number]): boolean =>
      a.action === 'raise' ||
      a.action === 'bet' ||
      (a.action === 'all_in' && a.isFullRaise !== undefined);
    const firstRaise = pre.find(isRaise);
    if (!firstRaise || firstRaise.seat !== player.seat) return null;
    const hisRaise = pre.findIndex((a) => a.seat === found.raiserSeat && isRaise(a));
    if (hisRaise < 0) return null;
    if (pre.slice(0, hisRaise).some((a) => a.seat === found.raiserSeat && a.action === 'call'))
      return null;
  }
  // out of position against the re-raiser only: in position the standing fold has already been weighed against the
  // call (omahaPreflopReraiseDefencePricedInPosition), and the fit credits an in-position aggressor with more than
  // his equity on ranges far stronger than a hand that was folded
  if (spot.heroOrder > spot.opponents[0]!.order) return null;
  const potRaise = reraisedPotPotRaise(spot, heroBet, gs);
  if (!potRaise || !(potRaise.risk > spot.call + 0.005)) return null;
  const verdict = reraisedPotVerdict(
    spot,
    player.cards ?? [],
    player.knownDeadCards ?? [],
    potRaise.risk
  );
  if (!verdict || verdict.evRaise === null) return null;
  // the called pot of the re-raise, as the verdict builds it (the re-raiser calls what he can)
  const raiser = spot.opponents[0]!;
  const hisCall = Math.max(0, Math.min(potRaise.risk - spot.call, raiser.behind));
  const calledPot = spot.pot + spot.call + 2 * hisCall;
  const margin =
    verdict.deadband + reraisedPotFoldReraiseSamplingMargin(calledPot, raiser.foldToReraise);
  if (!(verdict.evRaise > Math.max(verdict.evCall, 0) + margin))
    return { decision: standing, verdict, receipt: 'fold_reraise_kept' };
  const r: HorseDecision = potRaise.allIn
    ? { ...standing, action: 'all_in' }
    : { ...standing, action: 'raise', amount: cents(potRaise.to) };
  if (potRaise.allIn) delete r.amount;
  delete r.continuationGuard;
  return { decision: r, verdict, receipt: 'fold_reraised' };
}

/** The rule: the standing decision, or the priced one. Never throws. */
export function omahaReraisedPotPricedRule(
  standing: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  which: ReraisedPotPricedOptions,
  ctx: ReraisedPotPricedContext
): HorseDecision {
  if (!which.call && !which.reraise && which.foldReraise !== true) return standing;
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
      else if (r.receipt === 'fold_reraised') noteFire('omaha_reraised_pot_priced_fold_reraised');
      else if (r.receipt === 'fold_reraise_kept')
        noteFire('omaha_reraised_pot_priced_fold_reraise_kept');
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
