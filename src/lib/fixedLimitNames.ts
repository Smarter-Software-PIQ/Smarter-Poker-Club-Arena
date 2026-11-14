/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FIXED-LIMIT GAME NAMES (owner ruling, November 14, 2026)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan: limit games are "displayed as 'FIXED LIMIT 1/2' AND FOR OMAHA GAMES IT
 * SHOULD SAY 'OMAHA 4 CARD FIXED LIMIT' OMAHA 5 CARD FIXED LIMIT OMAHA 6 CARD
 * FIXED LIMIT, OMAHA 8o FIXED LIMIT", and the same morning, of the Hold'em
 * title: "they need to say Fixed Limit Holdem (spelt out) not abbreviated".
 * The abbreviations FLH / FLO8 are retired
 * from every title a player reads; the stakes that follow are the blinds, on
 * the same .25/.50 to 5/10 ladder as every other game (see stakesLabel in
 * ./bettingStructure.ts).
 *
 * One table, so the lobby card, the variant column, the filter chips, the
 * create flow and the felt cannot name the same game two ways. The database
 * names its games from the identical words (fn_cash_game_ensure and the
 * creator, migration 20261114163039).
 */

export const FIXED_LIMIT_GAME_NAMES: Readonly<Record<string, string>> = Object.freeze({
  flh: 'Fixed Limit Holdem',
  flo4: 'Omaha 4 Card Fixed Limit',
  flo5: 'Omaha 5 Card Fixed Limit',
  flo6: 'Omaha 6 Card Fixed Limit',
  flo8: 'Omaha 8o Fixed Limit',
});

/** The fixed-limit variants in lobby order: Hold'em, then Omaha by card count. */
export const FIXED_LIMIT_VARIANT_ORDER: readonly string[] = Object.freeze([
  'flh',
  'flo4',
  'flo5',
  'flo6',
  'flo8',
]);

/** The name a fixed-limit game is shown by, or null for any other game. */
export function fixedLimitGameName(variant?: string | null): string | null {
  const v = String(variant ?? '')
    .trim()
    .toLowerCase();
  return Object.prototype.hasOwnProperty.call(FIXED_LIMIT_GAME_NAMES, v)
    ? FIXED_LIMIT_GAME_NAMES[v]
    : null;
}

/**
 * Every limit game is a Classic game (Dan, November 14, 2026: "THEY ARE ALL
 * ALWAYS CLASSIC GAME SET UP"). No Action, Madness or Lightning limit game is
 * offered, created or listed.
 */
export const FIXED_LIMIT_TEMPLATE = 'classic';

/**
 * The fixed-limit stakes ladder, as blinds (Dan, November 14, 2026: "GAME
 * LIMITS SHOULD BE .25/.50 .50/1.00 1/2 2/5 AND 5/10").
 */
export const FIXED_LIMIT_STAKES: ReadonlyArray<{ sb: number; bb: number }> = Object.freeze([
  { sb: 0.25, bb: 0.5 },
  { sb: 0.5, bb: 1 },
  { sb: 1, bb: 2 },
  { sb: 2, bb: 5 },
  { sb: 5, bb: 10 },
]);
