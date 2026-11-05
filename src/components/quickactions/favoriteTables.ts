/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  FAVOURITE TABLES — the shared id-only read of `favorite_tables`
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-08-23: "'quick join' should be users favorite games, or similar
 * games to the one they are playing."
 *
 * WHY THIS FILE EXISTS. Favourites already had exactly one reader:
 * `FavoriteTablesWidget.loadFavorites`, a closure inside the component that
 * joins `tables` and `clubs` to draw a row. Quick Join needs the same fact
 * ("which tables has this user starred?") and none of the display join, and it
 * cannot call a closure. The alternative was a second favourites query written
 * from scratch in MultiTablePage — which is how a codebase ends up with two
 * favourites concepts that disagree. This is the shared read; the widget's
 * richer query stays as it is for its own row rendering.
 *
 * Never throws. Quick Join has to open in a few hundred milliseconds whatever
 * happens, and "no favourites" degrades the ranking to similar-games-first,
 * which is still a correct sheet. A rejected promise here would take the whole
 * sheet down to the lobby-tab fallback.
 */

import { fetchLobbyFavorites } from '../lobby/lobbyFavorites';

/**
 * Live cash-table ids of the games this user has starred.
 *
 * Reads the same per-game favorites the lobby shows (lobbyFavorites.ts), so a
 * rebuilt table of a starred game still ranks first in Quick Join. Returns []
 * for a signed-out user, no favorites, or any failure.
 */
export async function fetchFavoriteTableIds(userId: string | null | undefined): Promise<string[]> {
  if (!userId) return [];
  const read = await fetchLobbyFavorites();
  return read.ok ? read.cashIds : [];
}

export default fetchFavoriteTableIds;
