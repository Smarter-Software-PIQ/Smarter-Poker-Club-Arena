/**
 * THE GAMES vpipFloorLimpOnlyTenHandWindow MAY ACT IN (lead-8 lane tenhand 2026-11-27; compiled default: no list,
 * the option acts at every ten-hand table it acts at today, exactly as before).
 *
 * WHY. Owner 2026-11-17 14:34 / 18:38 Chicago: a VPIP-floor limp folds to a raise, the floor never buys a call of a
 * raise. Tables known to be judged at ten hands still run the old floor (the integrator's exception of 2026-11-18,
 * vpipFloorLimpOnlyTenHandTable), which widens ranges and calls raises up to 6 bb. The switch that ends it,
 * vpipFloorLimpOnlyTenHandWindow, is one global row, and its measured eviction cost differs by game (its authority
 * doc: per table-hour PLO5 0.52 = inside the churn the owner accepted on thirty-hand tables, PLO4 0.65, NLH 0.99).
 * The lead's plan is PLO5 first, then PLO4 and hold'em after a day. horse.omahaGameScope cannot do this: it lists
 * only omaha* options and only switches an option off inside a PLO4/PLO5 decision, so hold'em and every other
 * variant would run the window as published.
 *
 * HOW IT IS SET. Engine runtime settings `horse.vpipFloorTenHandWindowGame.<variant>` (runtimeSettings/registry.ts,
 * published with scripts/runtime-settings-publish.ts, live at each table's next hand, no cutover), 0 or 1, compiled
 * default 0. The variants whose setting is 1 travel in the decision request as `vpipFloorLimpOnlyTenHandWindowGames`
 * (absent when none is 1, so the request, its key and its journal are byte-identical at the defaults).
 *
 * WHAT IT DOES. No list: vpipFloorLimpOnlyTenHandWindow reads as published (unchanged). A list: the option is on only
 * at a table whose variant is listed; at every other table it reads as off, which is today's exception. It never
 * turns the option on: with the switch row off the list does nothing. ONE read site, vpipFloorLimpOnlyTenHandWindowOn,
 * used by every reader of the option (HorseLogic.vpipFloorLimpOnlyGovernsTenHandTable and vpipFloorLimpOnlyApplies).
 *
 * No hidden card is read. Nothing here is a threshold or a strategy rule: it only narrows where an option is on.
 */

export const VPIP_FLOOR_TEN_HAND_WINDOW_GAME_SETTING_PREFIX = 'horse.vpipFloorTenHandWindowGame.';

/**
 * The variants that can be listed (gs.gameVariant keys, lower case). Only games with ten-hand floored cash tables the
 * lead's plan names; a variant not listed here can never be selected alone, and with any list set it keeps today's
 * exception. (The database refuses an underscore in a setting key, so short_deck could not be a key anyway.)
 */
export const VPIP_FLOOR_TEN_HAND_WINDOW_GAMES: readonly string[] = Object.freeze([
  'nlh',
  'plo4',
  'plo5',
]);

/** The list a published settings version sets: the variants whose setting is 1, in list order; undefined when none is. */
export function vpipFloorTenHandWindowGamesFromSettings(
  values: Readonly<Record<string, number>> | undefined
): readonly string[] | undefined {
  if (!values) return undefined;
  let out: string[] | undefined;
  for (const game of VPIP_FLOOR_TEN_HAND_WINDOW_GAMES)
    if (values[VPIP_FLOOR_TEN_HAND_WINDOW_GAME_SETTING_PREFIX + game] === 1)
      (out ??= []).push(game);
  return out ? Object.freeze(out) : undefined;
}

/**
 * Whether vpipFloorLimpOnlyTenHandWindow is on for this decision: the option read `=== true`, and, when a game list
 * is given (a non-empty array), the decision's variant is on it. A list that is not an array, or is empty, is no list
 * (the option as published). Never throws; any failure reads the option as off (today's exception).
 */
export function vpipFloorLimpOnlyTenHandWindowOn(
  gs: { gameVariant?: unknown },
  opts: { vpipFloorLimpOnlyTenHandWindow?: unknown; vpipFloorLimpOnlyTenHandWindowGames?: unknown }
): boolean {
  try {
    if (opts.vpipFloorLimpOnlyTenHandWindow !== true) return false;
    const games = opts.vpipFloorLimpOnlyTenHandWindowGames;
    if (!Array.isArray(games) || games.length === 0) return true;
    const variant = String(gs.gameVariant ?? '').toLowerCase();
    return variant !== '' && (games as unknown[]).includes(variant);
  } catch {
    return false;
  }
}
