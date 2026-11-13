/**
 * OMAHA TOURNAMENT SHORT-HANDED FIRST-IN (owner order, Dan 2026-11-12).
 *
 * What the hands showed: in PLO4/5/6 tournaments the hand is folded to the big
 * blind in 51 to 63 percent of heads-up hands and 61 to 69 percent of
 * three-handed hands; heads-up the small blind folds its first action 47 to 71
 * percent of the time at every depth (docs/changelog/2026-11-13-omaha-
 * tournament-first-in.md).
 *
 * Cause (HorsePreflop.ts). The Omaha preflop score is correctly calibrated: it
 * is the Hold'em score at the same percentile (HorseEval omahaPreflopStrength),
 * so there is no Hold'em-versus-Omaha scale defect. The fold comes from bar
 * structure. In a PLO tournament an unopened pot whose pot raise is a quarter
 * of the stack or more (about 14 BB or less) goes to the commitment zone, whose
 * stack-off bar (0.56 from the small blind, about the top 16 percent) has NO
 * heads-up or blind-versus-blind case; deeper, the regular open path's own
 * blind-versus-blind bar (0.24 heads-up, 0.30 otherwise) admits about 45 to 48
 * percent. The heads-up big blind facing one raise meets the same zone's
 * call-off bar.
 *
 * This module replaces a FOLD the preflop engine chose, and only a fold, in
 * the measured spots, by the hand's percentile among Omaha hands of its size
 * (HorseEval omahaPreflopPercentile: a cached reservoir of random hands of the
 * same hole-card count, built on its own generator; it never touches the
 * decision random stream). It stands aside wherever the engine folds on
 * purpose for another reason: All-In-Or-Fold tables, a locked satellite seat,
 * tables larger than were measured, and stacks deeper than were measured. The
 * tournament utility arbiter (Phase 7) still evaluates and owns the final
 * action.
 */
import type { PreflopIntent, PreflopPosition } from './HorsePreflop.js';

export interface OmahaTournamentFirstInParams {
  /** True heads-up table, small blind first in: share of hands played. */
  headsUpShare: number;
  /** Small blind against the big blind alone at a larger measured table. */
  blindVsBlindShare: number;
  /** Deepest effective stack (big blinds) the module acts at. Deeper, the engine's fold stands. */
  maxStackBB: number;
  /** Largest table (players dealt in) the module acts at. */
  maxTableSize: number;
  /** Heads-up big blind against one raise: share defended. */
  bigBlindDefendShare: number;
  /** ... and the dearest price (call / final pot) it defends at. */
  bigBlindMaxPrice: number;
}

export const OMAHA_TOURNAMENT_FIRST_IN: OmahaTournamentFirstInParams = {
  headsUpShare: 1,
  blindVsBlindShare: 1,
  maxStackBB: 20,
  maxTableSize: 3,
  bigBlindDefendShare: 0.75,
  bigBlindMaxPrice: 0.5,
};

export interface OmahaTournamentFirstInInput {
  /** The hand's percentile among Omaha hands of its size, 0 (worst) to 1. */
  percentile: number;
  position: PreflopPosition;
  /** Opponents still holding cards (all-in players included). */
  liveOpponents: number;
  /** Players dealt in at the table. */
  tableSize: number;
  effectiveStackBB: number;
  raises: number;
  limpers: number;
  callers: number;
  toCall: number;
  stack: number;
  pot: number;
  /** The engine's tournament risk premium for this decision (0 to 0.15; at most
   *  0.01 with two players left in the tournament). It narrows every share. */
  riskPremium: number;
  /** The table is All-In-Or-Fold: the engine's own AoF ranges stand. */
  allInOrFold: boolean;
  /** A satellite seat is locked: the engine's deliberate folds stand. */
  satelliteLocked: boolean;
  /** Players left in the whole tournament (trusted context; NaN when
   *  unknown). The rule acts only when every remaining player is at this
   *  table: on a real money bubble with other tables still running, the
   *  2026-11-13 evaluation (R3, seed 90005, 10 left, 9 paid) lost to the
   *  adaptive opponent in every cell, scored in ICM equity. */
  playersLeft: number;
  /** Paid places among the players left (trusted payout curve; NaN when
   *  unknown). Three-handed the rule acts only when one place is paid (a
   *  winner-take-all spin): at a three-handed final table with pay jumps the
   *  2026-11-13 evaluation (R4, seed 90007, payouts 25/17/13, ICM equity)
   *  lost to the adaptive opponent at every depth and gained nothing against
   *  the others. Heads-up, ICM is chip-proportional and this does not apply. */
  paidPlacesLeft: number;
}

/**
 * The replacement for a fold, or null when the fold stands. Callers apply it
 * only to Omaha high tournaments and only when the existing engine folded.
 */
export function omahaTournamentFirstIn(
  i: OmahaTournamentFirstInInput,
  p: OmahaTournamentFirstInParams = OMAHA_TOURNAMENT_FIRST_IN
): PreflopIntent | null {
  if (!(i.toCall > 0) || !Number.isFinite(i.percentile)) return null;
  if (i.allInOrFold || i.satelliteLocked) return null;
  if (!(i.tableSize >= 2) || i.tableSize > p.maxTableSize) return null;
  if (!(i.playersLeft >= 2) || i.playersLeft > i.tableSize) return null;
  if (i.tableSize > 2 && i.paidPlacesLeft !== 1) return null;
  if (!(i.effectiveStackBB > 0) || i.effectiveStackBB > p.maxStackBB) return null;
  // Two points of range for each point of the engine's own risk premium,
  // never more than half the range.
  const narrowed = Math.min(0.5, Math.max(0, i.riskPremium) * 2);
  const plays = (share: number) => share > 0 && i.percentile >= 1 - (share - narrowed);
  if (i.raises === 0 && i.limpers === 0) {
    // First in. The play is the pot-limit maximum raise ('jam' is legalized
    // to the pot raise: about 3 to 3.25 BB heads-up, a sixth of a 20 BB
    // stack). Hands the class gate folds (three or four of a rank) never
    // reach this module.
    // Only the small blind against the big blind alone: a wider first-in
    // range from the button was measured and rejected (it lost to a big
    // blind that re-shoves against it).
    if (i.position === 'sb' && i.liveOpponents === 1) {
      return plays(i.tableSize <= 2 ? p.headsUpShare : p.blindVsBlindShare) ? { a: 'jam' } : null;
    }
    return null;
  }
  if (
    i.position === 'bb' &&
    i.tableSize <= 2 &&
    i.raises === 1 &&
    i.limpers === 0 &&
    i.callers === 0 &&
    i.liveOpponents === 1
  ) {
    const call = Math.min(i.toCall, i.stack);
    const price = call / (i.pot + call);
    if (price <= p.bigBlindMaxPrice && plays(p.bigBlindDefendShare)) return { a: 'call' };
  }
  return null;
}
