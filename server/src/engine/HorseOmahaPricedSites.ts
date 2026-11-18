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
 *    the pound size itself); the check is taken only when it out-prices
 *    every size.
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
 * proposed pound size among them); the check when it is worth more than
 * every size. Null with the option off or out of scope.
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
    if (!(v.best.ev >= v.evCheck)) {
      if (tele) noteFire('omaha_priced_site_turn_set_size_checked');
      return checkedOf(decision);
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
 * paired-board bar: some bet is priced above the check (his range after the
 * line, the Horse's cards removed, his measured fold to a bet). False when
 * it cannot be priced (the bluff is not made: the engine's check stands).
 */
export function omahaPricedSitesBlockerBluffAdmits(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  opts: HorseDecideOpts
): boolean {
  const tele = telemetryOn(opts);
  try {
    const v = omahaPricedBet(player, gs, omahaPricedSitesReadOf(gs, opts));
    if (v === null) {
      if (tele) noteFire('omaha_priced_site_blocker_bluff_unpriced_kept');
      return false;
    }
    const ok = v.best !== null && v.best.ev > v.evCheck;
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
