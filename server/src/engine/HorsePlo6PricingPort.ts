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
import { omahaRiverBeatProbability } from './HorseEval.js';
import {
  plo6FacingBetEvFoldStands,
  plo6RiverM1Fold,
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

/**
 * PLO6 river, facing a wager: would the live river fold rule
 * (HorseLogic plo6RiverNutDiscipline, V58 paired / V59 unpaired) fold a call
 * here? The same test as that rule, in one place for its three readers
 * (HorseLogic's two pricing rules and the receipt validator): the same
 * seeded beaten share (omahaRiverBeatProbability, a deterministic sample
 * seeded by the cards alone, so every reader gets the same number), the same
 * price (the call over the pot after the call, the call capped at the stack)
 * and the same bars (the calibration's 0.15 / 0.30 / 0.10, pinned equal to
 * HorseLogic's PLO6_RIVER_* constants by test). `tests` switches a board
 * class off where its option is off; absent: on. Quiet: no receipt. False
 * outside a PLO6 single-board river facing a wager, and when the share cannot
 * be read (the live rule does not fold then either).
 */
export function plo6RiverLiveFoldTest(
  player: { cards?: Card[]; stack: number; bet?: number },
  gs: HorseGameStateV2,
  tests: { paired?: boolean; unpaired?: boolean } = {}
): boolean {
  try {
    if (String(gs.gameVariant ?? '').toLowerCase() !== 'plo6' || gs.stage !== 'river') return false;
    const board = gs.communityCards ?? [];
    if (board.length !== 5 || (gs.boardCount ?? 1) > 1) return false;
    const paired = plo6BoardPaired(board);
    if (paired ? tests.paired === false : tests.unpaired === false) return false;
    const stack = Number.isFinite(player.stack) ? Math.max(0, player.stack) : 0;
    const toCall = Number.isFinite(gs.toCall)
      ? Math.max(0, gs.toCall as number)
      : Math.max(0, (gs.currentBet || 0) - (player.bet || 0));
    if (toCall <= 0.005) return false;
    const beaten = omahaRiverBeatProbability(player.cards ?? [], board, 6);
    if (beaten === null) return false;
    const pot = Number.isFinite(gs.pot) ? Math.max(0, gs.pot) : 0;
    const price = Math.min(toCall, stack) / Math.max(1e-9, pot + Math.min(toCall, stack));
    if (!Number.isFinite(beaten) || !Number.isFinite(price)) return false;
    return plo6RiverM1Fold(beaten, paired, price);
  } catch {
    return false;
  }
}
