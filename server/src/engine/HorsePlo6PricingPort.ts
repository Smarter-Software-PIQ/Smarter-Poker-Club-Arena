/**
 * PLO6 six-card port of two pricing rules (PLO6 lane, 2026-11-16): the glue
 * between PLO Strategy's omahaFacingBetEv / omahaRiverMediumBetStrongHandCalls
 * and the PLO6 calibration (HorsePlo6StrategyCalibration.ts). Pure: it reads
 * the board and numbers it is given, never an option, an opponent or a clock.
 *
 * Reached only for a six-card hand, which those rules see only when
 * omahaStrategyGameInScope admits plo6 (omahaStrategyInPlo6 on). No number
 * lives here: every bar is the calibration's (SPEC-A M1, 3.12, 3.13).
 */
import type { Card } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaIsTournamentMode } from './HorseOmahaTournamentScope.js';
import {
  plo6FacingBetEvFoldStands,
  plo6RiverMediumBetCalls,
} from './HorsePlo6StrategyCalibration.js';

/** Two board cards of one rank. */
export function plo6BoardPaired(board: readonly Card[]): boolean {
  return new Set(board.map((c) => c.rank)).size < board.length;
}

/** Three or more board cards of one suit: a flush is possible. */
export function plo6BoardFlushPossible(board: readonly Card[]): boolean {
  const n = new Map<string, number>();
  for (const c of board) n.set(c.suit, (n.get(c.suit) ?? 0) + 1);
  return [...n.values()].some((v) => v >= 3);
}

/**
 * SPEC-A 3.12 item 6 and 3.13 item 6: both rules add chips, so in PLO6 they
 * are cash only until the tournament price uses icmRequiredEquity; and no
 * bomb pot (the medium-bet rule has no bomb-pot test of its own).
 */
export function plo6PricingExcludes(gs: HorseGameStateV2): boolean {
  return omahaIsTournamentMode(gs) || gs.bombPot === true;
}

/** SPEC-A 3.12: the M1 guard on a river board; `beatenShare` is exact (H17). */
export function plo6EvFoldStands(
  beatenShare: number,
  board: readonly Card[],
  price: number,
  tests: { paired?: boolean; unpaired?: boolean } = {}
): boolean {
  if (board.length !== 5) return true;
  const paired = plo6BoardPaired(board);
  // The guard is the live river fold rule's own test, so it is off where that
  // rule is off: the paired-board test with v58Plo6RiverNuts false, the
  // unpaired-board test with v59Plo6RiverUnpaired false (as the river-plan
  // and street-plan hooks read them). Absent: on.
  if (paired ? tests.paired === false : tests.unpaired === false) return false;
  return plo6FacingBetEvFoldStands(beatenShare, paired, plo6BoardFlushPossible(board), price);
}

/** SPEC-A 3.13: the fold may become a call; `holds` is omahaRiverHoldsShare (1 - beaten). */
export function plo6MediumBetPriced(holds: number, board: readonly Card[], price: number): boolean {
  if (board.length !== 5 || !Number.isFinite(holds)) return false;
  return plo6RiverMediumBetCalls(
    1 - holds,
    plo6BoardPaired(board),
    plo6BoardFlushPossible(board),
    price
  );
}
