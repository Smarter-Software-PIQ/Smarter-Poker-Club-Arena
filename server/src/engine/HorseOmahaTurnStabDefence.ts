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
import { omahaPricedBySize } from './HorseOmahaPricedMode.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';

/**
 * RE-FIT (EMERG lane MODE-READ 2026-11-20, lead rulings 1:42 AM and 2:00 AM): the rows above were fitted on every
 * player's cards with one frequent bettor carrying up to 68% of a cell, and the line was keyed on the bettor being a
 * person. Now: provenance population_all_cards_capped, one anonymous population for every bettor (person or Horse;
 * the line no longer asks which), every player's cards from the hand facts used only to FIT the population constant
 * (offline), with no single player above 20% of any row's weight (iterative down-weighting), never keyed by player.
 * Data: every heads-up PLO4/PLO5 cash turn stab after a checked-through flop into a Horse in position, Oct 15 to
 * Nov 19 2026 (24,861 hands with a person; MODE-READ work/stab.py, fd.jsonl). The same win-share method (q makes
 * q x share vs the rest + (1 - q) x share vs the value region equal the Horse's share vs his real cards), clamped
 * to [.02, .9], shrunk toward OMAHA_PRICED_MEASURED_BLUFF.turn with 8 pseudo-bets over the capped effective n:
 *   under 40 percent: q .260 (n 48, 41 players, top share .08 -> .08, n_eff 48.0) -> .275
 *   40 to 70:         q .522 (n 70, 37 players, top share .26 -> .20, n_eff 68.8) -> .512
 *   70 to 110:        q .475 (n 192, 59 players, top share .26 -> .20, n_eff 183.8) -> .468; over 110 reads it.
 * The shown-hands-only version (the bettor tabled his hand) has 5 / 13 / 14 hands in the three rows (q 1.14 /
 * .55 / .48, uncorrected): too few to fit; reported in MODE-READ.md, not shipped.
 */
export const OMAHA_TURN_STAB_PROVENANCE = 'population_all_cards_capped';
/** The largest share of any one player in any shipped row after the cap (law: never above 0.2). */
export const OMAHA_TURN_STAB_TOP_PLAYER_SHARE: readonly [number, number, number] = Object.freeze([
  0.083, 0.2, 0.2,
]) as unknown as readonly [number, number, number];
/** The non-value share of a turn stab after a checked-through flop, by size row (under 40, 40-70, 70-110, over 110
 *  percent of the pot), re-fitted as stated above (the name is kept for the option's wiring). */
export const OMAHA_TURN_STAB_PERSON_BLUFF: readonly [number, number, number, number] =
  Object.freeze([0.275, 0.512, 0.468, 0.468]) as unknown as readonly [
    number,
    number,
    number,
    number,
  ];

/**
 * omahaTurnStabLightningRow (AUDIT48-TURN lane 2026-11-19; default OFF, read `=== true`, only with
 * omahaTurnStabDefenceIsPriced and omahaPricedInLightning on). The same line measured in the Lightning pools alone,
 * by the same method and data as the row above (every player's cards from the hand facts, no showdown selection,
 * archive woowoo-48h-audit-01BNteGYgf/repairs/TURN-STAB ws-out, 2026-11-05 22:00Z to 2026-11-19 22:00Z, PLO4/PLO5):
 *   Lightning: under 40 percent 0.539 +/- 0.209 (n 11) -> 0.536; 40 to 70: 0.800 +/- 0.162 (n 15) -> 0.740;
 *              70 to 110: 0.566 +/- 0.114 (n 47) -> 0.532; over 110 has no stab: it reads the 70 to 110 row.
 *   Table (same window, for comparison): 0.465 (n 8), 0.556 (n 21), 0.334 +/- 0.071 (n 69).
 * Each Lightning row is shrunk with 8 pseudo-bets toward the pooled row above. The 48-hour audit (repairs/AUDIT48/
 * TURN.md) measured the Horse's folds to this line in PLO5 Lightning at +0.25 pot (95% +0.07 to +0.44, n 77) of
 * call value against the persons' real cards, and the pooled row flips 1 of 20 of them on replay: the Lightning
 * pools carry more non-value stabs than the pooled row prices. Table play is untouched by this option.
 */
/**
 * RE-FIT (MODE-READ 2026-11-20): the Lightning stabs alone, same data, method, cap and provenance as the re-fitted
 * pooled row, shrunk with 8 pseudo-bets toward that row:
 *   under 40 percent: q .076 (n 12, 12 players, top .08) -> .156; 40 to 70: q .357 (n 10, 8 players, top .30 -> .20,
 *   n_eff 9.6) -> .428; 70 to 110: q .362 (n 41, 17 players, top .51 -> .20, n_eff 29.5) -> .385.
 * Uncapped the 70-110 row was .557: one bettor's Lightning stabs carried it (the old row's .532).
 */
export const OMAHA_TURN_STAB_LIGHTNING_TOP_PLAYER_SHARE: readonly [number, number, number] =
  Object.freeze([0.083, 0.2, 0.2]) as unknown as readonly [number, number, number];
export const OMAHA_TURN_STAB_PERSON_BLUFF_LIGHTNING: readonly [number, number, number, number] =
  Object.freeze([0.156, 0.428, 0.385, 0.385]) as unknown as readonly [
    number,
    number,
    number,
    number,
  ];

const WAGERS = new Set(['bet', 'raise', 'all_in']);

/**
 * True when the spot is the line this option prices: turn, not a raise, heads-up (no caller, nobody all in
 * from an earlier street, nobody behind), nobody wagered on the flop, the bettor's wager is the first action
 * of the turn. Every bettor, person or Horse (MODE-READ 2026-11-20: no rule keys on the opponent's kind). Public
 * state only.
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
    return !!bettor && bettor.seat !== hero.seat;
  } catch {
    return false;
  }
}

/** The spot with this line's measured prior, or the spot itself (the same object) outside the line. */
export function omahaTurnStabSpot(
  spot: OmahaFacingBetEvSpot,
  hero: SeatPlayer,
  gs: HorseGameStateV2,
  lightningOpen: boolean,
  lightningRow = false
): OmahaFacingBetEvSpot {
  if (!omahaTurnStabLine(spot, hero, gs, lightningOpen)) return spot;
  const speed = (gs as { publicMemoryDomain?: { speed?: string } }).publicMemoryDomain?.speed;
  const table =
    lightningRow && speed === 'lightning'
      ? OMAHA_TURN_STAB_PERSON_BLUFF_LIGHTNING
      : OMAHA_TURN_STAB_PERSON_BLUFF;
  const priorBluff = omahaPricedBySize(table, spot.potFrac);
  return Number.isFinite(priorBluff) ? { ...spot, priorBluff } : spot;
}
