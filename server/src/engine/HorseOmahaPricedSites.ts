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
 * Lightning unless omahaPricedInLightning is on, not fixed limit). Out of scope, or with the option off, every
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
import { HUD_DEFAULT_K, hudStat } from './opponentHud/OpponentHud.js';
import {
  OMAHA_FLOP_EV_REALIZATION_FULL_BEHIND,
  omahaFlopEvCounts,
  omahaFlopFittedRealization,
} from './HorseOmahaFlopFacingBetEv.js';
import { omahaPricedKindPrior } from './HorseOmahaPricedMode.js';
import { OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET } from './HorseOmahaBigDrawAggression.js';
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
  return opts.omahaMadeHandBetIsPriced === true && omahaPricedInScope(player, gs, opts);
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
  return opts.omahaTurnSetSizeIsPriced === true && omahaPricedInScope(player, gs, opts);
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
  return opts.omahaBlockerBluffIsPriced === true && omahaPricedInScope(player, gs, opts);
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

export interface OmahaPricedSitesFlopRaiseAnswer {
  /** his raise: to the pot, at most the effective stack */
  raiseTo: number;
  /** the Horse's call of the raise, in chips of the pot before the bet */
  evCall: number;
  callsRaise: boolean;
  /** the better of the call and the fold (the fold loses the bet) */
  ev: number;
}
/**
 * THE ONE RAISE ANSWER of a heads-up flop bet: he raises a bet `bet` into
 * `pot` to the pot (P + 3b, at most `effective`) and the Horse takes the
 * better of the call (his equity against the raising share, realized with
 * `realization` unless the raise is all in) and the fold. Owned here; read by
 * omahaPricedSitesFlopBetEv and by the v38 flop bet's raise branch
 * (omahaFlopBetPricesTheRaise, HorseOmahaFlopBetRaiseBranch). `rake`: the
 * marginal rake on the called pot; 0 (this site's own price) leaves the
 * arithmetic exactly as it was.
 */
export function omahaPricedSitesFlopRaiseAnswer(
  pot: number,
  bet: number,
  effective: number,
  equityRaise: number,
  realization: number,
  rake = 0
): OmahaPricedSitesFlopRaiseAnswer {
  const raiseTo = Math.min(effective, pot + 3 * bet);
  const won = equityRaise * (pot + 2 * raiseTo) * (raiseTo >= effective - 0.005 ? 1 : realization);
  const evCall = (rake > 0 ? won * (1 - rake) : won) - raiseTo;
  const callsRaise = evCall > -bet;
  return { raiseTo, evCall, callsRaise, ev: Math.max(-bet, evCall) };
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
  const facing = omahaPricedSitesFlopRaiseAnswer(P, b, eff, eqRaise, real);
  const callsRaise = facing.callsRaise;
  const evFacingRaise = facing.ev;
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

/**
 * His flop fold to a bet when the priced read has none. With omahaPricedPriorsByOpponentKind on: his
 * kind's measured flop figure (priced2, HorseOmahaPricedMode.omahaPricedKindPrior). Off: the documented
 * prior this site was built and replayed with (OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET, 0.42), so the option off
 * changes nothing here (lead ruling 2026-11-18 on helper H1's note).
 */
export function omahaPricedSitesFlopNoReadFold(
  kind: Parameters<typeof omahaPricedKindPrior>[0],
  opts: HorseDecideOpts
): number {
  return opts.omahaPricedPriorsByOpponentKind === true
    ? omahaPricedKindPrior(kind).foldToBet.flop
    : OMAHA_BIG_DRAW_PRIOR_FOLD_TO_BET;
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
  if (opts.omahaFlopBetIsPriced !== true || !omahaPricedInScope(player, gs, opts)) return null;
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
      foldToBet: read.foldToBet ?? omahaPricedSitesFlopNoReadFold(read.kind, opts),
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

// ───────────────────── R2: omahaFlopBetIsPricedOnHisResponse ─────────────────────

/**
 * Measured population fallback priors for flop response statistics (33,689 public PLO4/PLO5 cash hands,
 * fitHudPriors at e65149c76498, hud-priors-e65149c.json sha256 f5e76b4d...). Used ONLY when no HUD packet
 * supplies a cell's own population prior. `stabsz` follows OpponentHudProfile's convention (halved pot ratio).
 */
export const OMAHA_FLOP_RESPONSE_PRIORS: Readonly<
  Record<
    'plo4' | 'plo5',
    Readonly<{
      fbSmHu: number;
      fbBgHu: number;
      fbSmMw: number;
      fbBgMw: number;
      rBetHu: number;
      rBetMw: number;
      stabHu: number;
      stabMw: number;
      stabszHu: number;
      stabszMw: number;
    }>
  >
> = Object.freeze({
  plo4: Object.freeze({
    fbSmHu: 0.37,
    fbBgHu: 0.65,
    fbSmMw: 0.64,
    fbBgMw: 0.76,
    rBetHu: 0.1,
    rBetMw: 0.04,
    stabHu: 0.84,
    stabMw: 0.26,
    stabszHu: 0.26,
    stabszMw: 0.27,
  }),
  plo5: Object.freeze({
    fbSmHu: 0.32,
    fbBgHu: 0.58,
    fbSmMw: 0.63,
    fbBgMw: 0.73,
    rBetHu: 0.11,
    rBetMw: 0.03,
    stabHu: 0.82,
    stabMw: 0.24,
    stabszHu: 0.28,
    stabszMw: 0.28,
  }),
});

export interface OmahaFlopBetOnResponseOpponent {
  /** posterior mean fold-to-bet rate (shrunk n/(n+k) toward population prior) */
  fold: number;
  foldN: number;
  foldK: number;
  /** posterior mean raise-vs-bet rate (shrunk n/(n+k) toward population prior) */
  raise: number;
  raiseN: number;
  raiseK: number;
  /** posterior mean stab rate when checked to (OOP check branch) */
  stab: number;
  /** stab size as a fraction of the pot (already doubled from HUD stabsz) */
  stabSizeFrac: number;
}

export interface OmahaFlopBetOnResponseInput {
  /** the Horse's equity against the strongest `share` of one opponent's holdings (card removal applied) */
  equityTop: (share: number) => number;
  pot: number;
  bet: number;
  effective: number;
  inPosition: boolean;
  opponents: readonly OmahaFlopBetOnResponseOpponent[];
  /** showdown sample count (from omahaFlopEvCounts.samples) for sampling standard error */
  samples: number;
}

export interface OmahaFlopBetOnResponseVerdict {
  evBet: number;
  evCheck: number;
  gap: number;
  sampleSe: number;
  readSpread: number;
  proof: number;
  /** true when evBet - evCheck > proof (the bet is proven above the check) */
  betStands: boolean;
  foldAll: number;
  callAll: number;
  raiseAll: number;
  stabProb: number;
  equityAll: number;
  equityCall: number;
  equityRaise: number;
  callsRaise: boolean;
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/**
 * Pure EV comparison for R2 (`omahaFlopBetIsPricedOnHisResponse`):
 * - Bet branch: every opponent folds (f_j), raises (rz_j, from HUD f.rBet.{hu|mw}), or calls (1 - f_j - rz_j).
 *   Facing his raise the Horse takes the better of call and fold (`omahaPricedSitesFlopRaiseAnswer`).
 * - Check branch: in position checking closes the flop (`eqAll * P * realCheck`); out of position each opponent
 *   stabs with his measured `f.stab.{hu|mw}` rate at his measured `2 * f.stabsz.{hu|mw}` pot fraction, so
 *   `evCheck = (1 - beta) * eqAll * P * realCheck + beta * max(0, eqStab * (P + 2s) * realCallStab - s)`.
 * - Proof bar: the bet stands only when `evBet - evCheck > sampleSe + readSpread` (prove-it-to-bet over checking).
 * Identity-free, continuous in every rate, no cliff, no hand-class or size-band switch.
 */
export function omahaPricedSitesFlopBetOnResponseEv(
  i: OmahaFlopBetOnResponseInput
): OmahaFlopBetOnResponseVerdict | null {
  const P = i.pot;
  const eff = i.effective;
  const m = i.opponents.length;
  if (!fin(P) || !(P > 0) || !fin(eff) || !(eff > 0) || !fin(i.bet) || !(i.bet > 0) || m === 0)
    return null;
  const b = Math.min(i.bet, eff);
  const allInNow = b >= eff - 0.005;
  let fAll = 1;
  let noRaiseAll = 1;
  let sumCont = 0;
  let sumRz = 0;
  let sumCallCond = 0;
  let foldThinN = Infinity;
  let foldThinK = HUD_DEFAULT_K;
  let raiseThinN = Infinity;
  let raiseThinK = HUD_DEFAULT_K;
  let noStabAll = 1;
  let sumStab = 0;
  let sumStabSz = 0;
  for (const o of i.opponents) {
    const fj = clamp(fin(o.fold) ? o.fold : 0.5, 0.02, 0.98);
    const contj = 1 - fj;
    const rzj = allInNow ? 0 : Math.min(contj, Math.max(0, fin(o.raise) ? o.raise : 0.1));
    const cj = Math.max(0, contj - rzj);
    fAll *= fj;
    noRaiseAll *= 1 - rzj;
    sumCont += contj;
    sumRz += rzj;
    sumCallCond += cj / Math.max(1e-9, 1 - rzj);
    const fn = fin(o.foldN) ? Math.max(0, o.foldN) : 0;
    const fk = fin(o.foldK) ? Math.max(1, o.foldK) : HUD_DEFAULT_K;
    if (fn < foldThinN) {
      foldThinN = fn;
      foldThinK = fk;
    }
    const rn = fin(o.raiseN) ? Math.max(0, o.raiseN) : 0;
    const rk = fin(o.raiseK) ? Math.max(1, o.raiseK) : HUD_DEFAULT_K;
    if (rn < raiseThinN) {
      raiseThinN = rn;
      raiseThinK = rk;
    }
    const sj = clamp(fin(o.stab) ? o.stab : 0, 0, 0.98);
    const szj = clamp(fin(o.stabSizeFrac) ? o.stabSizeFrac : 0.5, 0.15, 1);
    noStabAll *= 1 - sj;
    sumStab += sj;
    sumStabSz += sj * szj;
  }
  const raiseAll = allInNow ? 0 : Math.min(1 - fAll, Math.max(0, 1 - noRaiseAll));
  const callAll = Math.max(0, 1 - fAll - raiseAll);
  const meanCont = sumCont / m;
  const meanRz = sumRz / m;
  const eqAll1 = i.equityTop(1);
  const eqCont1 = i.equityTop(meanCont);
  const eqRaise1 = meanRz > 1e-6 ? i.equityTop(meanRz) : eqCont1;
  const eqCall1 =
    meanCont - meanRz > 1e-9
      ? (meanCont * eqCont1 - meanRz * eqRaise1) / (meanCont - meanRz)
      : eqCont1;
  if (![eqAll1, eqCont1, eqRaise1, eqCall1].every(fin)) return null;
  const pSomeCallGivenNoRaise = Math.max(1e-9, 1 - fAll / Math.max(1e-9, noRaiseAll));
  const expCallers = m === 1 ? 1 : Math.max(1, Math.min(m, sumCallCond / pSomeCallGivenNoRaise));
  const eqCall = m === 1 ? eqCall1 : Math.pow(Math.max(0, eqCall1), expCallers);
  const eqAll = m === 1 ? eqAll1 : Math.pow(Math.max(0, eqAll1), m);
  const eqRaise = eqRaise1;
  const realBet = omahaPricedSitesFlopRealization(i.inPosition, P, b, eff);
  const callReal = allInNow ? 1 : realBet;
  const facing = omahaPricedSitesFlopRaiseAnswer(P, b, eff, eqRaise, realBet);
  const evWhenCalled = eqCall * (P + (1 + expCallers) * b) * callReal - b;
  const evBet = fAll * P + callAll * evWhenCalled + raiseAll * facing.ev;

  const realCheck = omahaPricedSitesFlopRealization(i.inPosition, P, 0, eff);
  let evCheck = eqAll * P * realCheck;
  let stabProb = 0;
  if (!i.inPosition) {
    stabProb = clamp(1 - noStabAll, 0, 0.98);
    if (stabProb > 1e-6) {
      const stabFrac = sumStab > 1e-6 ? sumStabSz / sumStab : 0.55;
      const stabBet = Math.min(eff, clamp(stabFrac, 0.15, 1) * P);
      const stabShare = clamp(sumStab / m, 0.05, 1);
      const eqStab = i.equityTop(stabShare);
      if (!fin(eqStab)) return null;
      const realCallStab = omahaPricedSitesFlopRealization(false, P, stabBet, eff);
      const callStabReal = stabBet >= eff - 0.005 ? 1 : realCallStab;
      const evCallStab = Math.max(0, eqStab * (P + 2 * stabBet) * callStabReal - stabBet);
      evCheck = (1 - stabProb) * (eqAll * P * realCheck) + stabProb * evCallStab;
    }
  }

  const samples = fin(i.samples) && i.samples > 0 ? i.samples : 1;
  const sampleSe = (0.5 / Math.sqrt(samples)) * (P + 2 * b);
  const fEach = Math.pow(fAll, 1 / m);
  const sdFold = Math.sqrt(
    (fEach * (1 - fEach)) / ((Number.isFinite(foldThinN) ? foldThinN : 0) + foldThinK + 1)
  );
  const foldSpread = m * Math.pow(fEach, m - 1) * sdFold * Math.max(0, P - evWhenCalled);
  const rzEach = allInNow ? 0 : 1 - Math.pow(noRaiseAll, 1 / m);
  const sdRaise = allInNow
    ? 0
    : Math.sqrt(
        (rzEach * (1 - rzEach)) / ((Number.isFinite(raiseThinN) ? raiseThinN : 0) + raiseThinK + 1)
      );
  const raiseSpread = allInNow
    ? 0
    : m * Math.pow(1 - rzEach, m - 1) * sdRaise * Math.max(0, evWhenCalled - facing.ev);
  const readSpread = foldSpread + raiseSpread;
  const proof = sampleSe + readSpread;
  const gap = evBet - evCheck;
  return {
    evBet,
    evCheck,
    gap,
    sampleSe,
    readSpread,
    proof,
    betStands: gap > proof,
    foldAll: fAll,
    callAll,
    raiseAll,
    stabProb,
    equityAll: eqAll,
    equityCall: eqCall,
    equityRaise: eqRaise,
    callsRaise: facing.callsRaise,
  };
}

/**
 * R2 (`omahaFlopBetIsPricedOnHisResponse`, default OFF, PLO4/PLO5 cash):
 * Prices the bare big pair's flop bet with the preflop lead (HU and multiway, OOP and IP) against every
 * live opponent's lifetime HUD fold (`f.fb.{sm|bg}.{hu|mw}`), raise (`f.rBet.{hu|mw}`), and OOP stab
 * (`f.stab.{hu|mw}`, `2 * f.stabsz.{hu|mw}`) response. Replaces #13 `omahaBareOverpairOopFlopCheck` without
 * opponent-kind priors. The bet stands only when `evBet - evCheck > sampleSe + readSpread`, else check.
 */
export function omahaPricedSitesFlopBetOnHisResponse(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts,
  legacySpot: boolean
): HorseDecision | null {
  if (opts.omahaFlopBetIsPricedOnHisResponse !== true || !omahaPricedInScope(player, gs, opts))
    return null;
  if (!isWager(decision) || !omahaPricedSitesFlopBetSpot(player, gs)) return null;
  const tele = telemetryOn(opts);
  const unpriced = (): HorseDecision | null => {
    if (tele) noteFire('omaha_flop_bet_on_his_response_unpriced_kept');
    return legacySpot ? null : decision;
  };
  try {
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    );
    if (live.length === 0 || live.some((p) => p.is_all_in || !fin(p.stack) || p.stack <= 0))
      return unpriced();
    const pot = fin(gs.pot) ? gs.pot : NaN;
    const amount = amountOf(decision, player);
    const heroStack = fin(player.stack) ? player.stack : 0;
    const maxOppStack = Math.max(...live.map((p) => p.stack));
    const effective = Math.min(heroStack, maxOppStack);
    if (!fin(pot) || !(pot > 0) || !fin(amount) || !(amount > 0) || !(effective > 0))
      return unpriced();

    const family: 'plo4' | 'plo5' = (player.cards ?? []).length === 5 ? 'plo5' : 'plo4';
    const pri = OMAHA_FLOP_RESPONSE_PRIORS[family];
    const hu = live.length === 1;
    const pl = hu ? 'hu' : 'mw';
    const bigBet = amount / pot > 0.7 || amount >= effective - 0.005;
    const fbStat = `f.fb.${bigBet ? 'bg' : 'sm'}.${pl}`;
    const fbPrior = hu ? (bigBet ? pri.fbBgHu : pri.fbSmHu) : bigBet ? pri.fbBgMw : pri.fbSmMw;
    const rbStat = `f.rBet.${pl}`;
    const rbPrior = hu ? pri.rBetHu : pri.rBetMw;
    const stabStat = `f.stab.${pl}`;
    const stabPrior = hu ? pri.stabHu : pri.stabMw;
    const stabszStat = `f.stabsz.${pl}`;
    const stabszPrior = hu ? pri.stabszHu : pri.stabszMw;
    const mind = opts.mind !== false;

    const opponents: OmahaFlopBetOnResponseOpponent[] = live.map((opp) => {
      const id = String(opp.user_id ?? '');
      if (!mind || !id) {
        return {
          fold: fbPrior,
          foldN: 0,
          foldK: HUD_DEFAULT_K,
          raise: rbPrior,
          raiseN: 0,
          raiseK: HUD_DEFAULT_K,
          stab: stabPrior,
          stabSizeFrac: 2 * stabszPrior,
        };
      }
      const fb = hudStat(id, family, fbStat, undefined, tele);
      const rb = hudStat(id, family, rbStat, undefined, false);
      const st = hudStat(id, family, stabStat, undefined, false);
      const sz = hudStat(id, family, stabszStat, undefined, false);
      return {
        fold: fb.p ?? fbPrior,
        foldN: fb.n,
        foldK: fb.k,
        raise: rb.p ?? rbPrior,
        raiseN: rb.n,
        raiseK: rb.k,
        stab: st.p ?? stabPrior,
        stabSizeFrac: 2 * (sz.p ?? stabszPrior),
      };
    });

    const meanRaise = opponents.reduce((s, o) => s + o.raise, 0) / opponents.length;
    const counts = omahaFlopEvCounts(
      player.cards,
      gs.communityCards ?? [],
      player.knownDeadCards ?? [],
      clamp(meanRaise, 0.02, 0.5)
    );
    if (counts === null) return unpriced();
    const v = omahaPricedSitesFlopBetOnResponseEv({
      equityTop: (s) => {
        const t = counts.top(s);
        return t.win + t.tie / 2;
      },
      pot,
      bet: amount,
      effective,
      inPosition: !omahaOpponentActsBehind(player, gs),
      opponents,
      samples: counts.samples,
    });
    if (v === null) return unpriced();
    if (v.betStands) {
      if (tele) noteFire('omaha_flop_bet_on_his_response_kept');
      return decision;
    }
    if (tele) noteFire('omaha_flop_bet_on_his_response_checked');
    return checkedOf(decision);
  } catch {
    if (tele) noteFire('omaha_strategy_rule_failed');
    return legacySpot ? null : decision;
  }
}

/**
 * R2 companion (addressing the flop facing-bet verdict's unmeasured raiser/stabber range, B6 folded into R2):
 * Returns a multiplicative `rangeFactor` (> 1 widens range, < 1 narrows range, 1.0 when n === 0 / no record)
 * from the bettor/raiser's lifetime HUD `f.rBet.{hu|mw}` (when facing a flop raise) or `f.stab.{hu|mw}` (when
 * facing a flop stab after checks). Pure read of lifetime HUD; identity-free, no cliff.
 */
export function omahaFlopFacingHudRangeFactor(
  bettorId: string | null | undefined,
  family: 'plo4' | 'plo5',
  hu: boolean,
  line: 'raise' | 'stab',
  telemetry: boolean
): { factor: number; measured: boolean } {
  if (!bettorId) return { factor: 1, measured: false };
  const pri = OMAHA_FLOP_RESPONSE_PRIORS[family];
  const stat = line === 'raise' ? `f.rBet.${hu ? 'hu' : 'mw'}` : `f.stab.${hu ? 'hu' : 'mw'}`;
  const fallback = line === 'raise' ? (hu ? pri.rBetHu : pri.rBetMw) : hu ? pri.stabHu : pri.stabMw;
  const r = hudStat(bettorId, family, stat, undefined, telemetry);
  const base = r.prior ?? fallback;
  if (r.n <= 0 || r.p === null || !(base > 0)) return { factor: 1, measured: false };
  const raw = r.p / base;
  const factor = line === 'raise' ? clamp(raw, 0.5, 2.5) : clamp(raw, 0.5, 2);
  return { factor, measured: Math.abs(factor - 1) > 1e-6 };
}
