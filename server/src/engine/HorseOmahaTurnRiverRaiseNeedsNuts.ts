/**
 * omahaTurnRiverRaiseNeedsNuts (owner 2026-11-15 12:52 / 12:53, hand 59534208;
 * with the standing rulings of 11:39, 12:09 and 12:30). Default OFF, read
 * `=== true` in HorseLogic.
 *
 * PLO4/PLO5 cash, high only, one board, no bomb pot, not Lightning, not fixed
 * limit: on the TURN and the RIVER, when the Horse faces a bet or a raise, a
 * final verdict that raises (a raise, a re-raise, a check-raise, an all-in
 * for more than the call) stands only when the hand is nut class right now
 * (omahaNutClassNow, HorseOmahaMadeHandDefense.ts). The one exception, turn
 * only: an in-position combo-draw raise that the 12:30 rule permits (a draw
 * below two pair with a flush draw and a straight draw of 8+ outs; since
 * 2026-11-16 a pair adds nothing; never a made hand, never out of position,
 * never a bare flush draw, never a pair with only a flush draw).
 * Every other raise becomes a call or a fold priced by the hand, the bettor
 * and the price (HorseLogic.omahaTurnRiverRaiseNeedsNutsRule).
 *
 * This file holds the public scope, the raise test, the combo-draw exception
 * and the fallback price; it draws no random number.
 */
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { variantInfo } from './HorseEval.js';
import { omahaNutClassNow } from './HorseOmahaMadeHandDefense.js';
import { omahaComboDrawForRaise } from './HorseOmahaBigDrawAggression.js';
import { omahaCategoricalCashOnlyExcludes } from './HorseOmahaTournamentScope.js';
import { omahaStrategyGameInScope, omahaStrategyConstant } from './HorseOmahaStrategyGame.js';

export const OMAHA_RAISE_NEEDS_NUTS_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/** Fallback: fold when the call is at least this share of the pot after the call. */
export const OMAHA_RAISE_NEEDS_NUTS_FOLD_PRICE = 1 / 3;

export interface OmahaRaiseNeedsNutsScope {
  street: 'turn' | 'river';
  /** What the Horse owes (gs.toCall, or the current bet less its own when absent). */
  toCall: number;
  /** The chips the call puts in (the stack when smaller). */
  paid: number;
  /** The call is for the whole stack. */
  allIn: boolean;
  /** The pot after the call (the uncalled part of a wager the Horse cannot cover excluded). */
  potAfterCall: number;
  inPosition: boolean;
}

const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** The amount owed, robust to a league state with no toCall (as HorseOmahaOopChecks reads it). */
export function omahaRaiseNeedsNutsToCall(player: SeatPlayer, gs: HorseGameStateV2): number {
  return Number.isFinite(gs.toCall)
    ? Math.max(0, gs.toCall as number)
    : Math.max(0, finite(gs.currentBet) - finite(player.bet));
}

/** In position after the flop: every live opponent acts before the Horse on a later street. */
export function omahaRaiseNeedsNutsInPosition(player: SeatPlayer, gs: HorseGameStateV2): boolean {
  const dealer = gs.dealerSeat;
  if (typeof dealer !== 'number' || !Number.isFinite(dealer)) return false;
  const live = (gs.players ?? []).filter(
    (p) => p.seat !== player.seat && !p.is_folded && !p.is_sitting_out
  );
  if (live.length === 0) return false;
  const after = (seat: number): number => (((seat - dealer - 1) % 32) + 32) % 32;
  return live.every((p) => after(p.seat) < after(player.seat));
}

/**
 * The rule's public scope, or null outside it. Looks at no hole card beyond the count. `lightning`: true only
 * from the priced owners (HorseOmahaPricedWiring) when the decision's omahaPricedInLightning is on, and from this
 * rule's own caller and admission when the decision's omahaPricedRaiseNeverMakesNonNutRaise is on, so the same
 * spot is read in a Lightning pool; otherwise this rule's own callers never pass it and stay out of Lightning.
 */
export function omahaRaiseNeedsNutsScope(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  lightning = false
): OmahaRaiseNeedsNutsScope | null {
  try {
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (!omahaStrategyGameInScope(OMAHA_RAISE_NEEDS_NUTS_VARIANTS, gs)) return null;
    const vi = variantInfo(variant);
    if (!vi.isOmaha || vi.isFixedLimit || gs.bettingStructure === 'fixed_limit') return null;
    if (gs.variantRules ? gs.variantRules.splitLow8OrBetter : vi.isHiLo) return null;
    // Cash only (HorseLogic.isTournamentMode's own reading); omahaStrategyInTournaments
    // opens its public tournament scope (HorseOmahaTournamentScope); a categorical rule
    // (omahaTournamentsExcludeCategoricalRules on: never in a tournament).
    if (omahaCategoricalCashOnlyExcludes(player, gs)) return null;
    if (
      (gs.boardCount ?? 1) !== 1 ||
      (gs.communityCards2?.length ?? 0) > 0 ||
      (gs.communityCards3?.length ?? 0) > 0 ||
      gs.bombPot === true
    )
      return null;
    const speed = (gs as { publicMemoryDomain?: { speed?: string } }).publicMemoryDomain?.speed;
    if (speed === 'lightning' && lightning !== true) return null;
    const street = gs.stage === 'turn' ? 'turn' : gs.stage === 'river' ? 'river' : null;
    if (street === null) return null;
    if ((gs.communityCards ?? []).length !== (street === 'turn' ? 4 : 5)) return null;
    if (!Array.isArray(player.cards) || player.cards.length !== vi.holeCount) return null;
    if (player.is_folded || player.is_all_in || player.is_sitting_out) return null;
    const toCall = omahaRaiseNeedsNutsToCall(player, gs);
    if (!(toCall > 0.005)) return null;
    const stack = Math.max(0, finite(player.stack));
    if (!(stack > 0)) return null;
    const paid = Math.min(stack, toCall);
    const pot = Math.max(0, finite(gs.pot));
    const potAfterCall = Math.max(0, pot - (toCall - paid)) + paid;
    return {
      street,
      toCall,
      paid,
      allIn: stack <= toCall + 0.005,
      potAfterCall,
      inPosition: omahaRaiseNeedsNutsInPosition(player, gs),
    };
  } catch {
    return null;
  }
}

/** The decision puts in more than the call: a raise, a re-raise, a check-raise, an all-in raise. */
export function omahaDecisionRaises(
  decision: HorseDecision,
  player: SeatPlayer,
  scope: OmahaRaiseNeedsNutsScope
): boolean {
  if (decision.action === 'raise' || decision.action === 'bet') return true;
  if (decision.action === 'all_in') return finite(player.stack) > scope.toCall + 0.005;
  return false;
}

/**
 * The 12:30 exception, turn only: the Horse is in position and the hand is the
 * combo draw that may raise there, by the ONE definition in
 * HorseOmahaBigDrawAggression.omahaComboDrawForRaise (a hand below two pair
 * holding a flush draw together with a straight draw of eight or more outs,
 * a 13+ out wrap included; 2026-11-16: a pair adds nothing). A made hand, a
 * draw out of position, a bare flush draw, a bare wrap, a pair with the nut
 * flush draw (with or without a gutshot) and a pair with a wrap are not
 * excepted.
 */
export function omahaTurnComboDrawRaisePermitted(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  scope: OmahaRaiseNeedsNutsScope
): boolean {
  try {
    if (scope.street !== 'turn' || !scope.inPosition) return false;
    if ((gs.communityCards ?? []).length !== 4) return false;
    // One definition: the combodraw module's (HorseOmahaBigDrawAggression).
    return omahaComboDrawForRaise(
      player.cards ?? [],
      gs.communityCards ?? [],
      player.knownDeadCards ?? []
    );
  } catch {
    return false;
  }
}

export type OmahaRaiseNeedsNutsKeep = 'nuts' | 'combo_draw' | null;

/** Why a raise in scope stands, or null when it must become a call or a fold. */
export function omahaRaiseNeedsNutsKeeps(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  scope: OmahaRaiseNeedsNutsScope
): OmahaRaiseNeedsNutsKeep {
  if (omahaNutClassNow(player, gs)) return 'nuts';
  if (omahaTurnComboDrawRaisePermitted(player, gs, scope)) return 'combo_draw';
  return null;
}

/** Fallback price verdict: fold when the call is at least a third of the pot after it. */
export function omahaRaiseNeedsNutsPriceFolds(
  scope: OmahaRaiseNeedsNutsScope,
  gs?: { gameVariant?: unknown }
): boolean {
  if (!(scope.potAfterCall > 0)) return true;
  return (
    scope.paid / scope.potAfterCall >= omahaStrategyConstant('raiseNeedsNutsFoldPrice', gs) - 1e-9
  );
}

/** The exact legal call for the scope: a call of what is owed, or the all-in when it is the stack. */
export function omahaRaiseNeedsNutsCall(
  decision: HorseDecision,
  scope: OmahaRaiseNeedsNutsScope
): HorseDecision {
  const called: HorseDecision = scope.allIn
    ? { ...decision, action: 'all_in', amount: undefined }
    : { ...decision, action: 'call', amount: scope.paid };
  if (scope.allIn) delete called.amount;
  delete called.continuationGuard;
  return called;
}

/**
 * Receipt validation (no options, no opponent memory in the request): a raise
 * that became a call is admitted only inside the scope, with a hand that the
 * rule would not keep raising, and only for the exact chips of the call.
 */
export function omahaRaiseNeedsNutsAdmitsCall(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  amount: number | null | undefined,
  lightning = false
): boolean {
  try {
    // `lightning`: true only for a decision that may have run with omahaPricedRaiseNeverMakesNonNutRaise on
    // (the rule then reads its spot in a Lightning pool); absent or false, not Lightning, as before.
    const scope = omahaRaiseNeedsNutsScope(player, gs, lightning === true);
    if (!scope || scope.allIn) return false;
    if (omahaRaiseNeedsNutsKeeps(player, gs, scope) !== null) return false;
    return typeof amount === 'number' && Math.abs(amount - scope.paid) < 1e-9;
  } catch {
    return false;
  }
}
