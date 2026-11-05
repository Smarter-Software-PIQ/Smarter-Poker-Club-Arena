/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LOBBY FAVORITES - one star per logical GAME, changed only by its owner
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-11-05: "ONCE SET, IT CAN NEVER EVER EVER CHANGE UNDER ANY
 * CIRCUMSTANCES UNLESS THE USER PHYSICALLY GOES IN AND CHANGES IT OR 'UN
 * FAVORITES' A CASH GAME OR TOURNAMENT."
 *
 * The database keeps the star against the game (a schedule, an engine board,
 * a satellite's event, a cash game definition; migration 20261105183133) and
 * keeps an unfavorite as a record with its revision. This file is the only
 * client door:
 *   - fetchLobbyFavorites  every live game of the player's favorite rows,
 *                          starred or not, with the revision each was seen at
 *   - toggleLobbyFavorite  stages the player's tap against that revision and
 *                          sends it; queued per account, retried on resume
 *   - fetchSavedFavorites  the saved favorites themselves, live or not, so a
 *                          game that is not running still shows as saved
 *
 * Never throws. A failed read reports ok:false so the caller keeps what it
 * had: "could not find out" never looks like "you have no favorites".
 */
import { supabase } from '../../lib/supabase';
import { reportError } from '../../utils/errorReporter';
import {
  callPreferenceRpc,
  flushScope,
  readPending,
  stageFields,
  type FieldResult,
} from '../../lib/preferenceSync';
import type { LobbyEntry } from './lobbyEntries';

export type LobbyFavoriteKind = 'cash' | 'tournament';
export const FAVORITES_SCOPE = 'favorites';
/** Fired when the server kept another value for a star; the lobby re-reads. */
export const LOBBY_FAVORITES_CHANGED = 'ca-lobby-favorites-changed';

/** Every non-cash lobby row (MTT, Spin, Sit N Go, Satellite) is a tournament. */
export function favoriteKindOf(kind: LobbyEntry['kind'] | undefined): LobbyFavoriteKind {
  return kind === 'cash' ? 'cash' : 'tournament';
}

export interface LobbyFavoritesRead {
  ok: boolean;
  /** Live game ids currently starred. */
  ids: string[];
  /** The cash subset, for Quick Join's ranking. */
  cashIds: string[];
  /** Revision of each live game's favorite row (starred or not). */
  revisions: Record<string, number>;
}

export async function fetchLobbyFavorites(): Promise<LobbyFavoritesRead> {
  const empty = { ok: false, ids: [], cashIds: [], revisions: {} };
  try {
    const { data, error } = await supabase.rpc('fn_my_lobby_favorites');
    if (error) {
      reportError(error, 'lobbyFavorites.fetchLobbyFavorites');
      return empty;
    }
    const rows = Array.isArray(data)
      ? (data as { kind?: unknown; game_id?: unknown; active?: unknown; revision?: unknown }[])
      : [];
    const ids = new Set<string>();
    const cashIds = new Set<string>();
    const revisions: Record<string, number> = {};
    for (const row of rows) {
      if (typeof row?.game_id !== 'string' || !row.game_id) continue;
      const rev = Number(row.revision) || 0;
      revisions[row.game_id] = Math.max(revisions[row.game_id] ?? 0, rev);
      if (row.active === false) continue;
      ids.add(row.game_id);
      if (row.kind === 'cash') cashIds.add(row.game_id);
    }
    return { ok: true, ids: [...ids], cashIds: [...cashIds], revisions };
  } catch (error) {
    reportError(error, 'lobbyFavorites.fetchLobbyFavorites');
    return empty;
  }
}

export interface SavedFavorite {
  kind: LobbyFavoriteKind;
  label: string | null;
  clubId: string | null;
}

/** The player's saved favorites, whether or not anything of them is live. */
export async function fetchSavedFavorites(): Promise<SavedFavorite[] | null> {
  try {
    const { data, error } = await supabase
      .from('player_lobby_favorites')
      .select('kind, label, club_id, active')
      .eq('active', true)
      .limit(500);
    if (error) {
      reportError(error, 'lobbyFavorites.fetchSavedFavorites');
      return null;
    }
    return (data ?? []).map(
      (r: { kind: string; label: string | null; club_id: string | null }) => ({
        kind: r.kind === 'cash' ? 'cash' : 'tournament',
        label: r.label,
        clubId: r.club_id,
      })
    );
  } catch (error) {
    reportError(error, 'lobbyFavorites.fetchSavedFavorites');
    return null;
  }
}

const field = (kind: LobbyFavoriteKind, gameId: string) => `${kind}:${gameId}`;

/** Stars this device has not had accepted yet: gameId -> wanted state. */
export function pendingFavoriteStates(owner: string | null): Record<string, boolean> {
  if (!owner) return {};
  const out: Record<string, boolean> = {};
  for (const [f, entry] of Object.entries(readPending(owner, FAVORITES_SCOPE))) {
    const gameId = f.slice(f.indexOf(':') + 1);
    out[gameId] = (entry.value as { on?: unknown })?.on === true;
  }
  return out;
}

/** Send every queued star / unstar for this account. */
export function flushFavorites(owner: string): Promise<void> {
  return flushScope({
    owner,
    scope: FAVORITES_SCOPE,
    send: (changes) =>
      callPreferenceRpc(owner, 'fn_set_lobby_favorites', {
        p_changes: changes.map((c) => {
          const [kind, gameId] = [
            c.field.slice(0, c.field.indexOf(':')),
            c.field.slice(c.field.indexOf(':') + 1),
          ];
          return {
            kind,
            game_id: gameId,
            on: (c.value as { on?: unknown })?.on === true,
            base: c.base,
          };
        }),
      }),
    results: (data) => {
      const reply = (data ?? {}) as { results?: FieldResult[] };
      return Array.isArray(reply.results) ? reply.results : [];
    },
    equals: (result, wanted) => result.active === ((wanted as { on?: unknown })?.on === true),
    onConflict: () => notifyChanged(owner),
    onAccepted: () => notifyChanged(owner),
  });
}

function notifyChanged(owner: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(LOBBY_FAVORITES_CHANGED, { detail: { owner } }));
}

/**
 * The player starred or unstarred a game. `revision` is the revision this
 * device saw for that game's favorite (0 when it has never been starred).
 */
export function toggleLobbyFavorite(
  owner: string,
  kind: LobbyFavoriteKind,
  gameId: string,
  on: boolean,
  revision: number
): Promise<void> {
  const f = field(kind, gameId);
  stageFields(owner, FAVORITES_SCOPE, { [f]: { on } }, { [f]: revision });
  return flushFavorites(owner);
}
