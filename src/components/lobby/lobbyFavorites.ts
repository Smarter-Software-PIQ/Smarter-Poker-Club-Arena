/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LOBBY FAVORITES - one star per GAME, kept until the player removes it
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-11-05: "ONCE SET, IT CAN NEVER EVER EVER CHANGE UNDER ANY
 * CIRCUMSTANCES UNLESS THE USER PHYSICALLY GOES IN AND CHANGES IT OR 'UN
 * FAVORITES' A CASH GAME OR TOURNAMENT."
 *
 * WHY THE OLD STARS VANISHED. Tournament stars were a list of one RUN's id, and
 * every scheduled event creates a new tournament row per run, so the star sat
 * on yesterday's finished run. Cash stars were one TABLE id in favorite_tables
 * with ON DELETE CASCADE, so a rebuilt table dropped them. Both "saved", both
 * were gone within a day.
 *
 * NOW. The database stores the star against the game itself (the schedule,
 * or the club's named cash game / tournament series) in player_lobby_favorites,
 * with no foreign key to any table or run, and a guard trigger refuses every
 * removal except the player's own unfavorite or account closure. This file is
 * the only client door to it:
 *   - setLobbyFavorite   the one write (fn_set_lobby_favorite)
 *   - fetchLobbyFavorites which live rows carry a star right now
 *                         (fn_my_lobby_favorites)
 *
 * Neither ever throws. A failed read reports ok:false so the caller keeps what
 * it had: "could not find out" must never look like "you have no favorites".
 * Pinned by tests/lobby-favorites-follow-the-game.law.test.ts.
 */

import { supabase } from '../../lib/supabase';
import { reportError } from '../../utils/errorReporter';
import type { LobbyEntry } from './lobbyEntries';

export type LobbyFavoriteKind = 'cash' | 'tournament';

/** Every non-cash lobby row (MTT, Spin, Sit N Go, Satellite) is a tournament. */
export function favoriteKindOf(kind: LobbyEntry['kind'] | undefined): LobbyFavoriteKind {
  return kind === 'cash' ? 'cash' : 'tournament';
}

export interface LobbyFavoritesRead {
  ok: boolean;
  /** Live table and tournament ids that belong to a starred game. */
  ids: string[];
  /** The cash-table subset, for Quick Join's ranking. */
  cashIds: string[];
}

export async function fetchLobbyFavorites(): Promise<LobbyFavoritesRead> {
  try {
    const { data, error } = await supabase.rpc('fn_my_lobby_favorites');
    if (error) {
      reportError(error, 'lobbyFavorites.fetchLobbyFavorites');
      return { ok: false, ids: [], cashIds: [] };
    }
    const rows = Array.isArray(data) ? (data as { kind?: unknown; game_id?: unknown }[]) : [];
    const ids = new Set<string>();
    const cashIds = new Set<string>();
    for (const row of rows) {
      if (typeof row?.game_id !== 'string' || !row.game_id) continue;
      ids.add(row.game_id);
      if (row.kind === 'cash') cashIds.add(row.game_id);
    }
    return { ok: true, ids: [...ids], cashIds: [...cashIds] };
  } catch (error) {
    reportError(error, 'lobbyFavorites.fetchLobbyFavorites');
    return { ok: false, ids: [], cashIds: [] };
  }
}

export async function setLobbyFavorite(
  kind: LobbyFavoriteKind,
  gameId: string,
  on: boolean
): Promise<{ ok: boolean }> {
  try {
    const { error } = await supabase.rpc('fn_set_lobby_favorite', {
      p_kind: kind,
      p_game_id: gameId,
      p_on: on,
    });
    if (error) {
      reportError(error, 'lobbyFavorites.setLobbyFavorite', { kind, gameId, on });
      return { ok: false };
    }
    return { ok: true };
  } catch (error) {
    reportError(error, 'lobbyFavorites.setLobbyFavorite', { kind, gameId, on });
    return { ok: false };
  }
}
