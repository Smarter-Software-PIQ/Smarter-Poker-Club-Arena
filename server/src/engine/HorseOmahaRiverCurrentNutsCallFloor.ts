/**
 * omahaRiverCurrentNutsCallFloor (default OFF; EMERG lane RANGE-MODEL-2, 2026-11-20).
 *
 * Owner 9:42 AM Chicago: "EVERYTHING DEPENDS ON THE MATH"; 9:52 AM: the same
 * corrections against all players, human or Horse. Lane RANGE-MODEL graded a
 * facing-bet range read that folded the CURRENT river nuts (hand 60226889: a
 * nut straight no two unseen cards beat, folded to a wager). A range model can
 * narrow a bettor's value region until a nut hand that only ties falls below
 * the price; the math never allows that fold.
 *
 * The rule, the outermost answer of the wager_rules node (after every owner
 * rule): in PLO4/PLO5 cash (table and Lightning, one board, high only, no bomb
 * pot), on the RIVER facing a wager, a final FOLD becomes the legal call (the
 * whole-stack all-in when the call is the stack) when
 *   - hero holds the exact current nuts (HorseRiverNuts.hasRiverNuts: every
 *     unseen two-card holding enumerated, an Omaha hand always uses exactly two
 *     hole and three board cards; no holding beats hero), and
 *   - the call cannot lose chips even in the worst case, a full chop with every
 *     live opponent: (pot + paid) / (live opponents + 1) >= paid.
 * So EV(call) >= 0 whatever the bettor holds: it changes only a fold, and only
 * into a call that cannot lose.
 *
 * Near-nut hands (beaten by a small share of two-card holdings) are NOT
 * floored: in Omaha that share compounds over every pair of the holding and a
 * narrow value range concentrates it, so it is a range question, not a floor.
 *
 * Public information only: hero's cards, the board and hero's known dead
 * cards. No opponent label, account or person/Horse flag is read.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { hasRiverNuts } from './HorseRiverNuts.js';
import { omahaNoCategoricalRulesInScope } from './HorseOmahaNoCategoricalRules.js';

export interface OmahaRiverCurrentNutsCallSpot {
  /** Chips the call puts in (the whole stack when the stack is short of the wager). */
  paid: number;
  /** The call is for the whole stack: its legal form is the all-in. */
  allIn: boolean;
}

/**
 * The spot where the floor holds: in scope, river, facing a wager, hero holds
 * the exact current nuts and the worst-case chop still returns the call.
 * Null everywhere else. Pure: a function of the request only.
 */
export function omahaRiverCurrentNutsCallSpot(
  player: SeatPlayer,
  gs: HorseGameStateV2
): OmahaRiverCurrentNutsCallSpot | null {
  try {
    if (!omahaNoCategoricalRulesInScope(player, gs)) return null;
    if (gs.stage !== 'river' || gs.wagersCapped === true) return null;
    if ((gs.communityCards ?? []).length !== 5) return null;
    if (player.is_folded || player.is_all_in || player.is_sitting_out) return null;
    const toCall = Number.isFinite(gs.toCall)
      ? (gs.toCall as number)
      : Number.isFinite(gs.currentBet) && Number.isFinite(player.bet)
        ? Math.max(0, gs.currentBet - player.bet)
        : NaN;
    if (!Number.isFinite(toCall) || !(toCall > 0.005)) return null;
    if (!Number.isFinite(gs.pot) || !(gs.pot > 0)) return null;
    if (!Number.isFinite(player.stack) || !(player.stack > 0)) return null;
    const allIn = player.stack <= toCall + 0.005;
    const legal = Array.isArray(gs.legalActions) ? gs.legalActions : null;
    if (legal && !legal.includes(allIn ? 'all_in' : 'call') && !legal.includes('call')) return null;
    const paid = Math.min(toCall, player.stack);
    const live = (gs.players ?? []).filter(
      (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
    ).length;
    if (live < 1) return null;
    // Worst case: every live opponent holds the same nuts. Here pot is the pot
    // before hero's call (the wager included); the call adds `paid`.
    if ((gs.pot + paid) / (live + 1) < paid - 1e-9) return null;
    if (!hasRiverNuts(player, gs, false)) return null;
    return { paid: Math.round(paid * 100) / 100, allIn };
  } catch {
    return null;
  }
}

/**
 * The rule: a final river fold in the spot becomes the legal call. `legalize`
 * turns the call into the legal call (or the whole-stack all-in). Every other
 * decision is returned unchanged (the same object).
 */
export function omahaRiverCurrentNutsCallFloorRule(
  decision: HorseDecision,
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  legalize: (d: HorseDecision) => HorseDecision
): HorseDecision {
  if (!on || decision.action !== 'fold') return decision;
  const spot = omahaRiverCurrentNutsCallSpot(player, gs);
  if (!spot) return decision;
  try {
    const legal = legalize({ ...decision, action: 'call', amount: spot.paid });
    if (legal.action !== 'call' && legal.action !== 'all_in') return decision;
    return { ...decision, action: legal.action, amount: legal.amount };
  } catch {
    return decision;
  }
}

/** The validator's re-run: fold -> call is admitted only where the floor holds, for the exact chips owed. */
export function omahaRiverCurrentNutsCallFloorAdmitsCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined
): boolean {
  const spot = omahaRiverCurrentNutsCallSpot(player, gs);
  if (!spot) return false;
  return Number.isFinite(amount) && Math.abs((amount as number) - spot.paid) <= 0.005;
}
