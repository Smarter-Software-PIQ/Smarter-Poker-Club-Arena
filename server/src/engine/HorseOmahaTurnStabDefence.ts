/**
 * omahaTurnStabDefenceIsPriced (TURN-STAB lane 2026-11-19; owner 2026-11-19 4:53 PM Chicago, verbatim: "EVERY
 * SINGLE TIME A HORSE CHECKS BACK FLOP WHEN HE CHECKS HE FIRES TURN FULL POT OR NEAR IT 100% OF THE TIME").
 * Default OFF (opt-in, read `=== true`).
 *
 * THE SPOT. PLO4/PLO5 cash, one board, heads-up: the flop checked through (nobody wagered on it), and the
 * bettor, a person, makes the first wager of the turn into the Horse. omahaFacingBetEv (HorseOmahaFacingBetEv)
 * prices the Horse's fold or call against the bettor's range: a value region (the strongest share of holdings,
 * by the bet's size) and the rest of his holdings at a non-value share, the prior, moved by his own read. For
 * this line the prior it uses is the turn table for every turn bet (OMAHA_EV_PRIOR_BLUFF.turn: 0.22 at 70 to
 * 110 percent of the pot, 0.40 at 40 to 70, 0.34 under 40) with no term for the checked-through flop
 * (aggressorStreets = callerStreets = 0, line factor 1).
 *
 * WHAT IS MEASURED (archive woowoo-48h-audit-01BNteGYgf/repairs/TURN-STAB/MEASURE.md). Production PLO4/PLO5
 * cash with a person seated, 2026-11-05 22:00Z to 2026-11-18 00:00Z (the fit window; the evaluation window is
 * after it): every turn stab of this line, every player's cards from the hand facts (no showdown selection).
 * The non-value share q is the one that makes the predicted win share (q x the Horse's share against the rest
 * of his range + (1 - q) x its share against the value region, the engine's own omahaEvHandCounts) equal the
 * share it had against his real cards: the method of OMAHA_PRICED_MEASURED_BLUFF. Shrunk toward the person
 * table (OMAHA_PRICED_MEASURED_BLUFF.turn) with its 8 pseudo-bets:
 *   under 40 percent: 0.627 +/- 0.181 (n 14) -> 0.532; 40 to 70: 0.685 +/- 0.113 (n 26) -> 0.626;
 *   70 to 110: 0.341 +/- 0.075 (n 66) -> 0.336; over 110 has no stab: it reads the 70 to 110 row.
 * The same person's barrel after his called flop bet measures 0.31 to 0.36, the person table: the check-through
 * stab, not the person, is what carries the extra non-value hands. People stab 0.43 of their checked-through
 * turns (197 of 457, PLO, 14 days), 4x their turn lead after calling a flop bet (0.11); the Horse folded 0.61.
 *
 * WHAT CHANGES. With the option on, in the spot above only, the prior of the spot is this line's measured
 * share read at the bet's size (omahaPricedBySize: each row at its band's centre, linear between, no size
 * step). Nothing else: the value region, the price, the realization (the Horse is in position: the engine's
 * turn factor, whose in-position depth term is the measured 0.14 of repairs/REALIZATION), the margin and the
 * bettor's own read (omahaEvBluffShare: his measured bet rate beside the population, or the priced read) are
 * the facing-bet EV's own. So a person who stabs more than the pool is read through the same priced path that
 * reads every other bettor; a Horse bettor, an unknown bettor, a raise, a multiway pot, tournaments, Lightning
 * (unless omahaPricedInLightning is on), PLO6 and the river are untouched. Off or unset: byte-identical.
 */
import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import type { OmahaFacingBetEvSpot } from './HorseOmahaFacingBetEv.js';
import { omahaOpponentKindOf, omahaPricedBySize } from './HorseOmahaPricedMode.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';

/** The non-value share of a person's turn stab after a checked-through flop, by size row (under 40, 40-70,
 *  70-110, over 110 percent of the pot), measured and shrunk as stated above. */
export const OMAHA_TURN_STAB_PERSON_BLUFF: readonly [number, number, number, number] =
  Object.freeze([0.532, 0.626, 0.336, 0.336]) as unknown as readonly [
    number,
    number,
    number,
    number,
  ];

const WAGERS = new Set(['bet', 'raise', 'all_in']);

/**
 * True when the spot is the line this option prices: turn, not a raise, heads-up (no caller, nobody all in
 * from an earlier street, nobody behind), nobody wagered on the flop, the bettor's wager is the first action
 * of the turn, and the bettor is a person. Public state only.
 */
export function omahaTurnStabLine(
  spot: OmahaFacingBetEvSpot,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  lightningOpen: boolean
): boolean {
  try {
    if (spot.street !== 'turn' || spot.isRaise) return false;
    if (spot.callers !== 0 || spot.allIns !== 0 || spot.behind !== 0) return false;
    if (spot.aggressorStreets !== 0 || spot.callerStreets !== 0) return false;
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    if (variant !== 'plo4' && variant !== 'plo5') return false;
    if (omahaIsTournamentMode(gs)) return false;
    const speed = (gs as { publicMemoryDomain?: { speed?: string } }).publicMemoryDomain?.speed;
    if (speed === 'lightning' && !lightningOpen) return false;
    const history = gs.actionHistory ?? [];
    const flop = history.filter((a) => String(a.stage) === 'flop');
    if (flop.length < 2 || flop.some((a) => a.action !== 'check')) return false;
    const turn = history.filter((a) => String(a.stage) === 'turn');
    const first = turn[0];
    if (!first || first.seat !== spot.bettorSeat || !WAGERS.has(String(first.action))) return false;
    const bettor = (gs.players ?? []).find((p) => p.seat === spot.bettorSeat);
    if (!bettor || bettor.seat === hero.seat) return false;
    return omahaOpponentKindOf(gs, bettor.user_id) === 'person';
  } catch {
    return false;
  }
}

/** The spot with this line's measured prior, or the spot itself (the same object) outside the line. */
export function omahaTurnStabSpot(
  spot: OmahaFacingBetEvSpot,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  lightningOpen: boolean
): OmahaFacingBetEvSpot {
  if (!omahaTurnStabLine(spot, hero, gs, lightningOpen)) return spot;
  const priorBluff = omahaPricedBySize(OMAHA_TURN_STAB_PERSON_BLUFF, spot.potFrac);
  return Number.isFinite(priorBluff) ? { ...spot, priorBluff } : spot;
}
