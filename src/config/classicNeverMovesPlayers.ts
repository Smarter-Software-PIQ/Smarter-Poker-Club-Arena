/**
 * EVERY GAME IS A MUST-MOVE GAME (Dan 2026-11-07: "NO ALL CLASSIC GAMES ARE ALSO
 * MUST MOVE GAMES. THEY JUST DON'T MOVE TO LIGHTNING. EVERY SINGLE GAME IS A
 * MUST MOVE GAME").
 *
 * This replaces the 2026-10-24 Classic exception. The database owns the rule:
 * public.fn_cash_game_never_moves_players answers false for every game since
 * 20261107070717, and this mirror for the lobby board says the same, so the
 * board and the database cannot disagree. The signature is kept so a surface
 * holding a template and rules profile asks one place.
 */
export const MADNESS_WITHOUT_LIGHTNING_PROFILE = 'madness_without_lightning';

export function cashGameNeverMovesPlayers(
  _template: string | null | undefined,
  _rulesProfile: string | null | undefined
): boolean {
  return false;
}
