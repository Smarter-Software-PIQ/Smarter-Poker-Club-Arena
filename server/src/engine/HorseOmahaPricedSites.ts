/**
 * OMAHA PRICED SITES (2026-11-18, PLO Strategy lane, sites-013U37).
 *
 * Owner, 2026-11-17 11:49 Chicago: "there should not be any blanket rules ...
 * a blanket rule shouldn't be allowed to effect a decision, they must all be
 * done by math, gto, players hand or preceived range of hands as well as the
 * opponents range of hand, equity, EV etc."
 *
 * The categorical PLO4/PLO5 cash rule sites still open after #11212 (the
 * register HorseOmahaRuleSites.ts) priced by the comparisons #11212 built.
 * Each option is default OFF (read `=== true`) and acts only inside
 * omahaPricedInScope (PLO4/PLO5 cash, one board, high only, no bomb pot, not
 * Lightning, not fixed limit). Out of scope, or with the option off, every
 * function returns null / false and the caller's rule acts exactly as before:
 * the decisions are byte-identical with the options off.
 *
 * One owner per quantity: no opponent number is computed here. Every read
 * comes through HorseOmahaPricedWiring.omahaPricedReadOfUser (the pooled read
 * plus the per-street cells of the single seam omahaPricedStreetRatesOf), and
 * the response model, the bluff prior and card removal are those of
 * HorseOmahaPricedRules.omahaPricedBet (the card-impact model with the
 * Horse's cards and the known dead cards removed from every range). A fix to
 * the prior (opponent kind, the priced2 build) reaches these sites with no
 * edit here.
 *
 * Unpriceable spots keep the decision the engine gave and say so
 * (`_unpriced_kept`); a site never falls open.
 *
 *  - omahaMadeHandBetIsPriced: the bet half of the made-hand defence
 *    (omahaBeatenMadeHandDefense / omahaMadeHandDefenseVsValueLeader: no bet
 *    into the fresh turn card out of position, no thin river value bet). In
 *    the rule's spot the bet stands when it is priced at least at the check,
 *    against every live opponent whatever his label.
 *  - omahaTurnSetSizeIsPriced: the turn set pound (omahaTurnSetPound) chose
 *    the monster tier's size by hand class. In its spot the size is the
 *    highest-valued of the public-state candidates (the card-impact sizes and
 *    the pound size itself). The decision to wager is the engine's (the
 *    pound's spot is a value bet); only its size is priced here.
 *  - omahaFlopBetIsPriced: the flop bet of a bare big pair (an overpair, or
 *    queens or better with one higher card, no flush draw, few straight outs)
 *    with the betting lead, in either position, is priced beside the check
 *    heads-up: his fold share from the read, his raise share measured, the
 *    Horse's equity against each band of his holdings (the flop facing-bet
 *    sampler, card removal applied). Replaces the out-of-position check of
 *    omahaBareOverpairOopFlopCheck; the same hand in position (owner fixture
 *    txHiARhC, hand 59833576) is priced too. Multiway: not priced.
 *  - omahaBlockerBluffIsPriced: the river nut-blocker bluff admitted hands
 *    below an equity line (0.28) and, on a paired board, by a separate bar.
 *    With the option on the hand is admitted when some bet is priced above
 *    the check against his range and his measured fold to a bet, on any
 *    board.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseDecideOpts, HorseGameStateV2 } from './HorseLogic.js';
import { noteFire, telemetryOn } from './BrainTelemetry.js';
import { omahaPricedInScope, omahaPricedReadOfUser } from './HorseOmahaPricedWiring.js';
import {
  OMAHA_FLOP_EV_REALIZATION_FULL_BEHIND,
  omahaFlopEvCounts,
  omahaFlopFittedRealization,
} from './HorseOmahaFlopFacingBetEv.js';
import { omahaPricedKindPrior } from './HorseOmahaPricedMode.js';
import {
  omahaBareBigPairOnFlop,
  omahaHeroHasPreflopLead,
  omahaOpponentActsBehind,
} from './HorseOmahaOopChecks.js';
import {
  omahaPricedBet,
  type OmahaPricedBetVerdict,
  type OmahaPricedRead,
} from './HorseOmahaPricedRules.js';

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The priced read of the opponent in a seat (the one interface; no prior here). */
export function omahaPricedSitesReadOf(
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): (seat: number) => OmahaPricedRead {
  return (seat: number) =>
    omahaPricedReadOfUser((gs.players ?? []).find((p) => p.seat === seat)?.user_id, gs, opts);
}

const isWager = (d: HorseDecision): boolean =>
  d.action === 'bet' || d.action === 'all_in' || d.action === 'raise';

const checkedOf = (decision: HorseDecision): HorseDecision => {
  const c: HorseDecision = { ...decision, action: 'check' };
  delete c.amount;
  return c;
};

const amountOf = (decision: HorseDecision, player: SeatPlayer): number =>
  decision.action === 'all_in'
    ? fin(player.stack)
      ? Math.max(0, player.stack)
      : NaN
    : fin(decision.amount)
      ? decision.amount
      : NaN;

/** The bet-or-check verdict of a proposed wager facing no bet; null when it cannot be priced. */
function pricedProposed(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): OmahaPricedBetVerdict | null {
  if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return null;
  const amount = amountOf(decision, player);
  if (!fin(amount) || !(amount > 0)) return null;
  const v = omahaPricedBet(player, gs, omahaPricedSitesReadOf(gs, opts), amount);
  return v !== null && v.proposed !== null ? v : null;
}

// ───────────────────── omahaMadeHandBetIsPriced ─────────────────────

export function omahaPricedSitesOwnsMadeHandBet(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  return opts.omahaMadeHandBetIsPriced === true && omahaPricedInScope(player, gs);
}

/**
 * The made-hand defence would check this wager (its spot: the caller has
 * established it). Returns the priced decision: the wager when it is priced
 * at least at the check, else the check. Null with the option off or out of
 * scope (the rule acts). `quiet`: no receipt (omahaWagerIsChecked's probe).
 */
export function omahaPricedSitesMadeHandBet(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): HorseDecision | null {
  if (!omahaPricedSitesOwnsMadeHandBet(player, gs, opts)) return null;
  if (!isWager(decision)) return decision;
  const tele = telemetryOn(opts);
  try {
    const v = pricedProposed(decision, player, gs, opts);
    if (v === null || v.proposed === null) {
      if (tele) noteFire('omaha_priced_site_made_hand_bet_unpriced_kept');
      return decision;
    }
    if (v.proposed.ev >= v.evCheck) {
      if (tele) noteFire('omaha_priced_site_made_hand_bet_kept');
      return decision;
    }
    if (tele) noteFire('omaha_priced_site_made_hand_bet_checked');
    return checkedOf(decision);
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    return decision;
  }
}

// ───────────────────── omahaTurnSetSizeIsPriced ─────────────────────

export function omahaPricedSitesOwnsTurnSetSize(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  return opts.omahaTurnSetSizeIsPriced === true && omahaPricedInScope(player, gs);
}

/**
 * The turn set pound's wager (the caller is in its spot). The size is the
 * highest-valued of the public-state candidates (the card-impact sizes, the
 * proposed pound size among them). The wager itself is not turned into a
 * check here. Null with the option off or out of scope.
 */
export function omahaPricedSitesTurnSetSize(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): HorseDecision | null {
  if (!omahaPricedSitesOwnsTurnSetSize(player, gs, opts)) return null;
  const tele = telemetryOn(opts);
  try {
    if (!isWager(decision) || String(gs.stage ?? '') !== 'turn') {
      if (tele) noteFire('omaha_priced_site_turn_set_size_unpriced_kept');
      return decision;
    }
    const v = pricedProposed(decision, player, gs, opts);
    if (v === null || v.best === null) {
      if (tele) noteFire('omaha_priced_site_turn_set_size_unpriced_kept');
      return decision;
    }
    const proposedAmount = amountOf(decision, player);
    if (v.proposed !== null && v.proposed.ev >= v.best.ev) {
      if (tele) noteFire('omaha_priced_site_turn_set_size_kept');
      return decision;
    }
    if (tele) noteFire('omaha_priced_site_turn_set_size_resized');
    if (
      v.best.action === 'all_in' ||
      v.best.amount >= (fin(player.stack) ? player.stack : 0) - 0.005
    )
      return {
        ...decision,
        action: 'all_in',
        amount: fin(player.stack) ? player.stack : proposedAmount,
      };
    return {
      ...decision,
      action: decision.action === 'raise' ? 'raise' : 'bet',
      amount: v.best.amount,
    };
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    return decision;
  }
}

// ───────────────────── omahaBlockerBluffIsPriced ─────────────────────

export function omahaPricedSitesOwnsBlockerBluff(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  return opts.omahaBlockerBluffIsPriced === true && omahaPricedInScope(player, gs);
}

/**
 * The river nut-blocker bluff's admission in place of its equity line and
 * paired-board bar: the EXACT bet the bluff would place (`bet`, sized by the
 * engine before this is asked) is priced above the check (his range after the
 * line, the Horse's cards removed, his measured fold to a bet). False when
 * it cannot be priced (the bluff is not made: the engine's check stands).
 * Review R3 B1 of sites 27852aafb40: the admission priced "some bet" while a
 * later, unpriced size was placed; now the placed amount is the priced one.
 */
export function omahaPricedSitesBlockerBluffAdmits(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  bet: HorseDecision
): boolean {
  const tele = telemetryOn(opts);
  try {
    const amount = isWager(bet) ? amountOf(bet, player) : NaN;
    const v = Number.isFinite(amount)
      ? omahaPricedBet(player, gs, omahaPricedSitesReadOf(gs, opts), amount)
      : null;
    if (v === null || v.proposed === null) {
      if (tele) noteFire('omaha_priced_site_blocker_bluff_unpriced_kept');
      return false;
    }
    const ok = v.proposed.ev > v.evCheck;
    if (tele)
      noteFire(
        ok ? 'omaha_priced_site_blocker_bluff_admitted' : 'omaha_priced_site_blocker_bluff_refused'
      );
    return ok;
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    return false;
  }
}

// ───────────────────── omahaFlopBetIsPriced ─────────────────────

/**
 * The share of his whole range that raises a flop bet: MEASURED, PLO4/PLO5
 * cash with a person seated, Nov 13-17 (blockbet-013U37 measurement, inbox
 * 2026-11-18T01:47:19Z: people raise Horse small flop bets 10 to 21 percent);
 * the middle of that interval. It is taken from the top of his continuing
 * range. A per-street fold-to-bet read moves the fold share; no read of his
 * raise rate exists yet, so this share is the prior for every opponent.
 */
export const OMAHA_PRICED_SITES_FLOP_RAISE_SHARE = 0.15;
/**
 * The realization of a flop one-pair holding (a bare overpair is one) over the
 * turn and river has ONE owner: the flop facing-bet verdict's fitted table
 * (HorseOmahaFlopFacingBetEv.omahaFlopFittedRealization, class 'pair', by
 * position, shrunk by its sample; flopev2, review R3 N2 of sites 27852aafb40).
 * This sampler has no runout model of its own, so the model factor is 1 and
 * the measured cell carries it; later streets count by what is left to bet,
 * as there. The constant this site fitted for itself is gone.
 */
export function omahaPricedSitesFlopRealization(
  inPosition: boolean,
  pot: number,
  bet: number,
  effective: number
): number {
  const behindAfter = Math.max(0, effective - bet);
  const later =
    pot + 2 * bet > 0 ? behindAfter / ((pot + 2 * bet) * OMAHA_FLOP_EV_REALIZATION_FULL_BEHIND) : 0;
  return omahaFlopFittedRealization(1, 'pair', inPosition, Math.min(1, Math.max(0, later)))
    .realization;
}

export interface OmahaPricedSitesFlopInput {
  /** the Horse's equity against the strongest `share` of his holdings on the flop (card removal applied) */
  equityTop: (share: number) => number;
  pot: number;
  bet: number;
  /** the effective stack: the most either can lose from here */
  effective: number;
  inPosition: boolean;
  /** his fold to a bet (posterior mean) */
  foldToBet: number;
  raiseShare?: number;
}
export interface OmahaPricedSitesFlopVerdict {
  evBet: number;
  evCheck: number;
  fold: number;
  call: number;
  raise: number;
  equityAll: number;
  equityCall: number;
  equityRaise: number;
  /** facing his raise: the Horse calls (true) or folds */
  callsRaise: boolean;
}

/**
 * Bet or check on the flop, heads-up, priced in chips of the pot now. He
 * folds the weakest `foldToBet` of his range, raises with the strongest
 * `raiseShare` (to the pot, at most the effective stack), and calls with the
 * band between. Facing his raise the Horse takes the better of the fold and
 * the call. Checking realizes the Horse's equity against his whole range.
 */
export function omahaPricedSitesFlopBetEv(
  i: OmahaPricedSitesFlopInput
): OmahaPricedSitesFlopVerdict | null {
  const P = i.pot;
  const eff = i.effective;
  if (!fin(P) || !(P > 0) || !fin(eff) || !(eff > 0) || !fin(i.bet) || !(i.bet > 0)) return null;
  const b = Math.min(i.bet, eff);
  const allInNow = b >= eff - 0.005;
  const f = Math.min(0.98, Math.max(0.02, fin(i.foldToBet) ? i.foldToBet : 0.5));
  const cont = 1 - f;
  const rz = allInNow
    ? 0
    : Math.min(cont, Math.max(0, i.raiseShare ?? OMAHA_PRICED_SITES_FLOP_RAISE_SHARE));
  const real = omahaPricedSitesFlopRealization(i.inPosition, P, b, eff);
  const eqAll = i.equityTop(1);
  const eqCont = i.equityTop(cont);
  const eqRaise = rz > 0 ? i.equityTop(rz) : eqCont;
  const eqCall = cont - rz > 1e-9 ? (cont * eqCont - rz * eqRaise) / (cont - rz) : eqCont;
  if (![eqAll, eqCont, eqRaise, eqCall].every(fin)) return null;
  const callReal = allInNow ? 1 : real;
  const raiseTo = Math.min(eff, P + 3 * b);
  const evCallRaise = eqRaise * (P + 2 * raiseTo) * (raiseTo >= eff - 0.005 ? 1 : real) - raiseTo;
  const callsRaise = evCallRaise > -b;
  const evFacingRaise = Math.max(-b, evCallRaise);
  const evBet = f * P + (cont - rz) * (eqCall * (P + 2 * b) * callReal - b) + rz * evFacingRaise;
  const evCheck = eqAll * P * omahaPricedSitesFlopRealization(i.inPosition, P, 0, eff);
  return {
    evBet,
    evCheck,
    fold: f,
    call: cont - rz,
    raise: rz,
    equityAll: eqAll,
    equityCall: eqCall,
    equityRaise: eqRaise,
    callsRaise,
  };
}

/** The spot: a bare big pair on the flop with the betting lead, nothing to call, a wager proposed. */
export function omahaPricedSitesFlopBetSpot(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (String(gs.stage ?? '') !== 'flop') return false;
    const board = gs.communityCards ?? [];
    if (board.length !== 3) return false;
    if (Array.isArray(gs.legalActions) && !gs.legalActions.includes('check')) return false;
    if (!omahaBareBigPairOnFlop(player.cards, board)) return false;
    return omahaHeroHasPreflopLead(player, gs);
  } catch {
    return false;
  }
}

/**
 * omahaFlopBetIsPriced (replaces omahaBareOverpairOopFlopCheck's check, and
 * prices the same bare big pair in position: owner fixture txHiARhC, hand
 * 59833576, "THIS NEEDS TO GO FOR KK AS WELL AS QQ"). `legacySpot`: the
 * categorical rule would check this wager. Returns the priced decision; null
 * when the option is off, out of scope, not the spot, or (in the legacy
 * spot) not priceable, in which case the caller's rule acts.
 */
export function omahaPricedSitesFlopBet(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  legacySpot: boolean
): HorseDecision | null {
  if (opts.omahaFlopBetIsPriced !== true || !omahaPricedInScope(player, gs)) return null;
  if (!isWager(decision) || !omahaPricedSitesFlopBetSpot(player, gs)) return null;
  const tele = telemetryOn(opts);
  const unpriced = (): HorseDecision | null => {
    if (tele) noteFire('omaha_priced_site_flop_bet_unpriced_kept');
    return legacySpot ? null : decision;
  };
  try {
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    );
    if (live.length !== 1 || live[0].is_all_in || !fin(live[0].stack)) return unpriced();
    const opp = live[0];
    const amount = amountOf(decision, player);
    const effective = Math.min(fin(player.stack) ? player.stack : 0, opp.stack);
    const counts = omahaFlopEvCounts(
      player.cards,
      gs.communityCards ?? [],
      player.knownDeadCards ?? [],
      OMAHA_PRICED_SITES_FLOP_RAISE_SHARE
    );
    if (counts === null) return unpriced();
    const read = omahaPricedReadOfUser(opp.user_id, gs, opts);
    const v = omahaPricedSitesFlopBetEv({
      equityTop: (s) => {
        const t = counts.top(s);
        return t.win + t.tie / 2;
      },
      pot: fin(gs.pot) ? gs.pot : NaN,
      bet: amount,
      effective,
      inPosition: !omahaOpponentActsBehind(player, gs),
      // no read: his kind's measured flop fold to a bet (priced2 HorseOmahaPricedMode.omahaPricedKindPrior)
      foldToBet: read.foldToBet ?? omahaPricedKindPrior(read.kind).foldToBet.flop,
    });
    if (v === null) return unpriced();
    if (v.evBet >= v.evCheck) {
      if (tele) noteFire('omaha_priced_site_flop_bet_kept');
      return decision;
    }
    if (tele) noteFire('omaha_priced_site_flop_bet_checked');
    return checkedOf(decision);
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    return legacySpot ? null : decision;
  }
}
