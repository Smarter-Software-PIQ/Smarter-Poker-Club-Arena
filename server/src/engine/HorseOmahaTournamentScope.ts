/**
 * OMAHA STRATEGY IN TOURNAMENTS (owner 2026-11-15 13:16 Chicago, verbatim:
 * "DON'T FORGET TO SHARE EVERY SINGLE THING WE'VE BUILT, ADDED, IMPROVED,
 * OPTIMIZED AND DID, ALL THE RULES AND THINGS WE ADJUSTED TODAY, ALL NEED TO
 * BE SHARED WITH PLO6 AND IMPLEMENTED FOR TOURNAMENTS AS WELL.").
 *
 * One option, omahaStrategyInTournaments (HorseDecideOpts, read `=== true`,
 * default OFF). With it on, the PLO4/PLO5 options of 2026-11-15 that were
 * scoped to cash also run in a PLO4/PLO5 tournament hand, inside the public
 * scope below. This module is the one place that scope and the tournament
 * price are read:
 *
 *  - omahaCashOnlyExcludes(hero, gs): what every cash-scoped rule of the day
 *    now asks instead of "is this a tournament". True (the rule stands aside,
 *    exactly as before) in every tournament hand unless the option is on and
 *    the public scope holds. In a cash hand it is false, as before.
 *  - omahaTournamentIcmPremium(hero, gs, chips): the engine's existing
 *    tournament survival premium (HorseLogic icmRisk: the V16 real-ICM bubble
 *    premium, V23 endgame adjusted, at most 0.15), charged the way every
 *    tournament call in the engine charges it: premium x sqrt(share of the
 *    stack the chips risk). A rule that ADDS chips (a fold that becomes a call,
 *    a check that becomes a bet, a call that becomes a raise) adds this to the
 *    price it uses, so a tournament call or bet never clears a bar that the
 *    engine's own ICM discipline would refuse. Zero in cash and wherever the
 *    extension does not apply, so the cash arithmetic is unchanged.
 *
 * The public scope (omahaTournamentExtensionSpot): a tournament hand, PLO4 or
 * PLO5, high only, one board, not All-In-Or-Fold, not Lightning, and the Horse
 * deeper than the Omaha push/fold line (OMAHA_TOURNAMENT_PUSH_FOLD_MAX_BB):
 * at or below it the engine already plays the pot-limit commitment zone
 * (HorsePreflop ploCommitZone: an unopened pot raise of 3.5 big blinds that is
 * a quarter of the stack or more), raise-or-fold, and no rule of the day runs.
 *
 * HorseLogic.decide sets the scope for the whole decision
 * (withOmahaTournamentScope); the receipt validator, which carries neither the
 * options nor the ICM inputs, admits the public scope with a zero premium
 * (OMAHA_TOURNAMENT_SCOPE_ADMISSION): it admits every answer the rules can
 * produce, and the premium only ever removes chip-adding answers.
 *
 * Decisions are synchronous and single-threaded, so a module-level scope is
 * safe (the engine's own deep-dive capture and memo stashes rely on the same);
 * the previous scope is restored on every exit, so a nested decision inherits
 * nothing it did not set.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaStrategyGameInScope, omahaStrategyConstant } from './HorseOmahaStrategyGame.js';

/** The variants the extension covers. Hi-lo, PLO6 and Hold'em are unchanged. */
export const OMAHA_TOURNAMENT_EXTENSION_VARIANTS: ReadonlySet<string> = new Set(['plo4', 'plo5']);

/**
 * The Omaha push/fold line in big blinds: the commitment zone's unopened gate
 * (HorsePreflop ploCommitZone: a 3.5 big blind pot raise is at least a quarter
 * of the stack) holds at 14 big blinds or less. At or below it the rules of
 * the day stand aside.
 */
export const OMAHA_TOURNAMENT_PUSH_FOLD_MAX_BB = 14;

export interface OmahaTournamentScope {
  /** omahaStrategyInTournaments is on for this decision. */
  readonly extension: boolean;
  /** HorseLogic icmRisk for the Horse at this decision (0 outside tournaments). */
  readonly icmRisk: number;
}

export const OMAHA_TOURNAMENT_SCOPE_OFF: OmahaTournamentScope = Object.freeze({
  extension: false,
  icmRisk: 0,
});

/** The receipt validator's scope: the public scope admitted, no premium. */
export const OMAHA_TOURNAMENT_SCOPE_ADMISSION: OmahaTournamentScope = Object.freeze({
  extension: true,
  icmRisk: 0,
});

let current: OmahaTournamentScope = OMAHA_TOURNAMENT_SCOPE_OFF;

/** Runs fn with the scope set, restoring the previous scope on every exit. */
export function withOmahaTournamentScope<T>(scope: OmahaTournamentScope, fn: () => T): T {
  const previous = current;
  current = scope;
  try {
    return fn();
  } finally {
    current = previous;
  }
}

/** The scope in force (OFF outside a decision). */
export function omahaTournamentScopeNow(): OmahaTournamentScope {
  return current;
}

/** HorseLogic.isTournamentMode's own reading: the engine's explicit mode wins. */
export function omahaIsTournamentMode(gs: HorseGameStateV2): boolean {
  if (gs.gameMode) return gs.gameMode === 'tournament';
  return gs.tournament != null || (gs.bigBlind ?? 0) >= 10;
}

/** The public scope of the extension, read on public information only. */
export function omahaTournamentExtensionSpot(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  try {
    if (!omahaIsTournamentMode(gs)) return false;
    if (!omahaStrategyGameInScope(OMAHA_TOURNAMENT_EXTENSION_VARIANTS, gs)) return false;
    if (gs.variantRules?.splitLow8OrBetter === true) return false;
    if (
      (gs.boardCount ?? 1) > 1 ||
      (gs.communityCards2?.length ?? 0) > 0 ||
      (gs.communityCards3?.length ?? 0) > 0
    )
      return false;
    if (gs.allInOrFold === true) return false;
    const speed = (gs as { publicMemoryDomain?: { speed?: unknown } | null }).publicMemoryDomain
      ?.speed;
    if (speed === 'lightning') return false;
    const bb = Number(gs.bigBlind);
    if (!(bb > 0)) return false;
    const stack = Number.isFinite(hero.stack) ? Math.max(0, hero.stack) : 0;
    const bet = Number.isFinite(hero.bet) ? Math.max(0, hero.bet ?? 0) : 0;
    return (stack + bet) / bb > omahaStrategyConstant('tournamentPushFoldMaxBB', gs);
  } catch {
    return false;
  }
}

/**
 * True when a rule scoped to cash must stand aside: a tournament hand where
 * the extension is off or its public scope does not hold. False in cash.
 */
export function omahaCashOnlyExcludes(hero: SeatPlayer, gs: HorseGameStateV2): boolean {
  if (!omahaIsTournamentMode(gs)) return false;
  return !(current.extension && omahaTournamentExtensionSpot(hero, gs));
}

/**
 * The survival premium, in equity, on `chips` the Horse would add: the
 * engine's icmRisk x sqrt(min(1, chips / stack)). Zero in cash, with the
 * extension off, outside its scope, and in the validator's scope.
 */
export function omahaTournamentIcmPremium(
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  chips: number
): number {
  const risk = omahaTournamentIcmRisk(hero, gs);
  const stack = Number.isFinite(hero.stack) ? Math.max(0, hero.stack) : 0;
  return omahaIcmPremiumOf(risk, chips, stack);
}

/**
 * The raw survival premium (icmRisk) for a module that prices several sizes
 * itself: 0 in cash, with the extension off, outside its scope and in the
 * validator's scope.
 */
export function omahaTournamentIcmRisk(hero: SeatPlayer, gs: HorseGameStateV2): number {
  if (!current.extension || !(current.icmRisk > 0)) return 0;
  return omahaTournamentExtensionSpot(hero, gs) ? current.icmRisk : 0;
}

/** risk x sqrt(min(1, chips / stack)): the engine's charge on chips at risk. */
export function omahaIcmPremiumOf(risk: number, chips: number, stack: number): number {
  if (!(risk > 0) || !(chips > 0) || !(stack > 0)) return 0;
  return risk * Math.sqrt(Math.min(1, chips / stack));
}
