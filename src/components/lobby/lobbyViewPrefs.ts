import { trackPreferenceWrite } from '../../lib/tableSettingIntents';
import { awaitPreferenceSave } from '../../lib/tableSettingIntents';
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LOBBY VIEW PREFERENCES — the tab, the sort and the Favorites chip, remembered
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-08-26: "ANY PREFERENCES, OR STAKES THAT ARE SELECTED SHOULD ALWAYS
 * BE AUTO SAVED FOR THE USER. WHEN THEY GO BACK TO THE PAGE, IT SHOULDN'T BE
 * RESET. THEY SHOULD AUTO SAVE UNTIL CHANGED."
 *
 * WHAT WAS ALREADY SAVED, AND WHAT WAS NOT. The lobby had two halves of this
 * and neither of them was the half a player notices first:
 *
 *   SAVED   the Advanced Filters sheet, the stake chips and the status chips
 *           (`ca_advanced_filters_<club>`, in AdvancedFilters.tsx) and each
 *           table's column sort (`ca_lobby_sort_<club>_<category>`).
 *   NOT     the GAME TYPE TAB, the SORT BY control, and the Favorites chip.
 *
 * So a player who set up the PLO tab sorted by stakes came back to ALL sorted
 * by starting time, saw a different board, and reasonably concluded nothing
 * had been remembered — the saved filters were still there, just underneath a
 * tab they were not looking at.
 *
 * THE SORT IS PER TAB, deliberately. It always was in effect: choosing a tab
 * overwrote the sort with that tab's default (MTT by starting time, cash by
 * recommended), so a single global value could never survive a tab change
 * anyway. Storing one sort per tab keeps those defaults for a first visit and
 * keeps the player's choice for every visit after.
 *
 * HOSTILE STATE. Everything read here is validated against the CURRENT tab and
 * sort lists before it is used, so a preference written by an older build (or
 * hand-edited, or truncated by a full disk) degrades to the default rather
 * than selecting a tab that no longer exists. Reads and writes are wrapped:
 * Safari private mode throws on localStorage access rather than returning null.
 *
 * ── AND AS OF 2026-09-07 THEY FOLLOW THE PLAYER, NOT THE BROWSER ───────────
 * Dan: "FILTER TAB SELECTIONS NEED TO BE SAVED AND CACHED AS WELL AS SAVED AND
 * UPDATED ON CROSS USER DEVICES. THEY SHOULD BE SAVED REGARDLESS OF WHICH
 * DEVICE YOU LOG INTO."
 *
 * Everything above was true on ONE browser. The Advanced Filters sheet went
 * cross-device on 2026-08-31 (user_lobby_filters); this file did not, so a
 * player who set up the PLO tab sorted by stakes on a laptop still opened
 * their phone to ALL sorted by starting time — the same complaint the header
 * opens with, one device over.
 *
 * SAME SPLIT AS ADVANCEDFILTERS, deliberately, because a second pattern for
 * the same problem is how the two halves of one lobby start disagreeing:
 *   - the DATABASE is the truth (user_lobby_filters.view_prefs, RLS-locked to
 *     the owner, one row per user+club beside the filters it belongs with),
 *   - localStorage stays the SYNCHRONOUS first-paint cache, so the lobby still
 *     opens instantly with the right tab and corrects itself a moment later if
 *     another device moved on,
 *   - every write is FIRE AND FORGET. A tab is a preference, not a
 *     transaction: a player offline must still see their own tap take effect,
 *     and a failed sync is worth a report, never a blocked interaction.
 */

import { reportError } from '../../utils/errorReporter';
import { supabase } from '../../lib/supabase';
import { readLocalSession } from '../../lib/authUtils';
import { useUserStore } from '../../stores/useUserStore';

/**
 * A request the browser abandoned (the page navigated, the tab closed, the
 * fetch was cancelled) is not a failure of the save or the read: it is the
 * player leaving. Reporting it filed AbortError rows for every cold return.
 * The write it belonged to stays marked unsynced and is finished next open.
 */
export function isAbortedRequest(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; message?: unknown; details?: unknown };
  if (e.name === 'AbortError') return true;
  const text = `${typeof e.message === 'string' ? e.message : ''} ${
    typeof e.details === 'string' ? e.details : ''
  }`;
  return /AbortError|The operation was aborted|signal is aborted/i.test(text);
}

/**
 * Storage-safe marker helpers shared by every lobby preference writer.
 *
 * THE MARKER IS THE TIME OF THE CHOICE (2026-11-05). It used to be a bare '1',
 * so a choice that sat unconfirmed on one device was replayed on its next open
 * as if it were new and overwrote whatever the player had chosen since on
 * another device. The marker now holds when the player made the choice, every
 * write sends that time, and the database keeps whichever choice is newer
 * (fn_player_preference_guard). A replay keeps the original time
 * (`keepTime`), so an old choice can never pass itself off as a new one.
 */
export function markUnsynced(key: string, unsynced: boolean, keepTime = false): void {
  try {
    if (!unsynced) localStorage.removeItem(key);
    else if (!(keepTime && localStorage.getItem(key))) {
      localStorage.setItem(key, new Date().toISOString());
    }
  } catch {
    /* storage unavailable: the in-session write order still holds */
  }
}

export function isUnsynced(key: string): boolean {
  try {
    return Boolean(localStorage.getItem(key));
  } catch {
    return false;
  }
}

/** When the unconfirmed choice was made, or now for a pre-2026-11-05 marker. */
export function unsyncedChoiceTime(key: string): string {
  try {
    const raw = localStorage.getItem(key);
    if (raw && raw !== '1' && !Number.isNaN(Date.parse(raw))) return new Date(raw).toISOString();
  } catch {
    /* fall through */
  }
  return new Date().toISOString();
}

export type LobbyTabKey =
  | 'ALL'
  | 'HOLDEM'
  | 'OMAHA'
  | 'LIMIT'
  | 'MIXED'
  | 'MTT'
  | 'SNG'
  | 'SPIN'
  | 'SATELLITE';
export type LobbySortKey =
  | 'recommended'
  | 'stakes_high'
  | 'stakes_low'
  | 'players'
  | 'starting_soon';

export interface LobbyViewPrefs {
  /** Last game-type tab this player used in this club. */
  tab: LobbyTabKey | null;
  /** Last Sort By choice, per tab. Absent for a tab means "use the default". */
  sortByTab: Partial<Record<LobbyTabKey, LobbySortKey>>;
  /** Was the Favorites chip lit. */
  favoritesOnly: boolean;
}

const VALID_TABS: ReadonlySet<string> = new Set<LobbyTabKey>([
  'SATELLITE',
  'ALL',
  'HOLDEM',
  'OMAHA',
  'LIMIT',
  'MIXED',
  'MTT',
  'SNG',
  'SPIN',
]);

const VALID_SORTS: ReadonlySet<string> = new Set<LobbySortKey>([
  'recommended',
  'stakes_high',
  'stakes_low',
  'players',
  'starting_soon',
]);

/**
 * Per club, exactly like the saved filters beside it. One club's "PLO, stakes
 * high to low" is not another club's — a union hub and a micro club share a
 * player and share nothing else.
 */
const KEY_PREFIX = 'ca_lobby_view_';

export const EMPTY_VIEW_PREFS: LobbyViewPrefs = {
  tab: null,
  sortByTab: {},
  favoritesOnly: false,
};

/**
 * WHO THE PREFERENCE BELONGS TO: the signed-in player, not the freshness of
 * their access token (Dan 2026-11-05). This used to read only the JWT, and
 * readLocalSession returns null once the hour-long token has expired, which
 * on a phone or a backgrounded tab is a normal state between refreshes. Every
 * filter tapped in that window was written to the SIGNED-OUT key and never
 * sent to the row, so the next fresh load read the account's older choice and
 * the lobby "silently defaulted back". The account in the user store survives
 * token expiry; the JWT is only the fallback before the store has loaded.
 */
function currentUserId(): string | null {
  try {
    const stored = useUserStore.getState().user?.id;
    if (typeof stored === 'string' && stored) return stored;
  } catch {
    /* fall through to the session cache */
  }
  try {
    return readLocalSession({ allowExpired: true })?.userId ?? null;
  } catch {
    return null;
  }
}

/**
 * THE ONE DOOR EVERY PREFERENCE COMES THROUGH, local or remote.
 *
 * Extracted from loadViewPrefs when the database became the truth. A remote
 * row is exactly as untrustworthy as a localStorage blob — it can be written
 * by an older build, by a different build on another device, or by a client
 * that has since been fixed — and validating only the local half would let a
 * stale row select a tab this build cannot render. Same door, both sides.
 */
function sanitizeViewPrefs(parsed: unknown): LobbyViewPrefs {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...EMPTY_VIEW_PREFS, sortByTab: {} };
  }
  const src = parsed as Record<string, unknown>;

  const tab =
    typeof src.tab === 'string' && VALID_TABS.has(src.tab) ? (src.tab as LobbyTabKey) : null;

  // Unknown tab keys and unknown sort keys are DROPPED rather than kept:
  // a stored value the current build cannot honour must not reach the UI.
  const sortByTab: Partial<Record<LobbyTabKey, LobbySortKey>> = {};
  const rawSorts = src.sortByTab;
  if (rawSorts && typeof rawSorts === 'object' && !Array.isArray(rawSorts)) {
    for (const [k, v] of Object.entries(rawSorts as Record<string, unknown>)) {
      if (VALID_TABS.has(k) && typeof v === 'string' && VALID_SORTS.has(v)) {
        sortByTab[k as LobbyTabKey] = validSortForTab(k as LobbyTabKey, v as LobbySortKey);
      }
    }
  }

  return { tab, sortByTab, favoritesOnly: src.favoritesOnly === true };
}

/**
 * WHAT WAS ACTUALLY STORED, per account+club (2026-11-05). sanitizeViewPrefs
 * drops a tab or sort this build does not know, which is right for the screen
 * and wrong for the row: writing the sanitized copy back erased a saved value
 * the player never touched. Every write merges the player's current view over
 * the stored original, so only the player's own change replaces a value.
 */
const storedViews = new Map<string, Record<string, unknown>>();

function rememberStoredView(userId: string | null, clubId: string, raw: unknown): void {
  if (!userId || !raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  storedViews.set(`${userId}:${clubId}`, raw as Record<string, unknown>);
}

export function preserveStoredView(
  clubId: string,
  prefs: LobbyViewPrefs,
  userId: string | null = currentUserId()
): Record<string, unknown> {
  const stored = userId ? storedViews.get(`${userId}:${clubId}`) : undefined;
  if (!stored) return { ...prefs };
  const storedSorts =
    stored.sortByTab && typeof stored.sortByTab === 'object' && !Array.isArray(stored.sortByTab)
      ? (stored.sortByTab as Record<string, unknown>)
      : {};
  // A sort shown normalized but never changed by the player keeps its saved value.
  const sortByTab: Record<string, unknown> = { ...storedSorts };
  for (const [tab, sort] of Object.entries(prefs.sortByTab)) {
    const saved = storedSorts[tab];
    const unchanged =
      typeof saved === 'string' &&
      VALID_SORTS.has(saved) &&
      validSortForTab(tab as LobbyTabKey, saved as LobbySortKey) === sort;
    if (!unchanged) sortByTab[tab] = sort;
  }
  return {
    ...stored,
    ...prefs,
    tab: prefs.tab ?? stored.tab ?? null,
    sortByTab,
  };
}

export function loadViewPrefs(clubId: string, userId = currentUserId()): LobbyViewPrefs {
  if (!clubId) return { ...EMPTY_VIEW_PREFS, sortByTab: {} };
  try {
    const legacyKey = `${KEY_PREFIX}${clubId}`;
    const accountKey = userId ? `${KEY_PREFIX}${userId}:${clubId}` : legacyKey;
    let raw = localStorage.getItem(accountKey);
    // Adopt an old browser-wide preference once without handing it to every
    // subsequent account using this browser.
    if (!raw && userId) {
      const ownerKey = `${legacyKey}:owner`;
      const owner = localStorage.getItem(ownerKey);
      if (!owner || owner === userId) {
        raw = localStorage.getItem(legacyKey);
        if (raw) {
          try {
            localStorage.setItem(ownerKey, userId);
            localStorage.setItem(accountKey, raw);
          } catch {
            /* A full store must not discard a readable preference. */
          }
        }
      }
    }
    if (!raw) return { ...EMPTY_VIEW_PREFS, sortByTab: {} };
    const parsed: unknown = JSON.parse(raw);
    rememberStoredView(userId, clubId, parsed);
    return sanitizeViewPrefs(parsed);
  } catch {
    // Corrupt JSON, a disabled store, or private-mode Safari throwing on read.
    return { ...EMPTY_VIEW_PREFS, sortByTab: {} };
  }
}

/**
 * Read this player's saved view for this club from the database, or null when
 * there is nothing to say (signed out, no club, no row, or the read failed).
 *
 * Null is deliberately indistinguishable from "no row": the caller's job is to
 * keep whatever the local cache already gave it, and a failed read must never
 * look like a player who cleared their preferences.
 */
export async function fetchRemoteViewPrefs(
  clubId: string,
  userId = currentUserId()
): Promise<LobbyViewPrefs | null> {
  if (!userId || !clubId) return null;
  try {
    const { data, error } = await supabase
      .from('user_lobby_filters')
      .select('view_prefs')
      .eq('user_id', userId)
      .eq('club_id', clubId)
      .maybeSingle();
    if (error) {
      if (!isAbortedRequest(error)) {
        reportError(error, 'lobbyViewPrefs.fetchRemoteViewPrefs', { clubId });
      }
      return null;
    }
    if (!data?.view_prefs || typeof data.view_prefs !== 'object') return null;
    rememberStoredView(userId, clubId, data.view_prefs);
    return sanitizeViewPrefs(data.view_prefs);
  } catch (e) {
    if (!isAbortedRequest(e)) reportError(e, 'lobbyViewPrefs.fetchRemoteViewPrefs', { clubId });
    return null;
  }
}

/**
 * Mirror the view to the database. Never throws, never blocks the UI.
 *
 * `onConflict: 'user_id,club_id'` and a partial payload, so this shares the
 * row with the Advanced Filters sheet without either half clobbering the
 * other's column — they are two preferences of one lobby, written
 * independently by two components.
 */
const pendingViewWrites = new Map<string, Promise<void>>();

export function pushRemoteViewPrefs(
  clubId: string,
  prefs: LobbyViewPrefs,
  userId = currentUserId(),
  options: { replay?: boolean } = {}
): Promise<void> {
  if (!userId || !clubId) return Promise.resolve();
  const key = `${userId}:${clubId}`;
  /* THE CHOICE IS OWED TO THE ROW UNTIL THE ROW CONFIRMS IT. Marked before
     the request leaves, cleared only by the last queued write succeeding. A
     save the network dropped therefore stays recorded on this device, and the
     next lobby open finishes that same write instead of letting the older row
     overwrite the newer choice (see hasUnsyncedViewPrefs). */
  markUnsynced(unsyncedViewKey(userId, clubId), true, options.replay === true);
  const changedAt = unsyncedChoiceTime(unsyncedViewKey(userId, clubId));
  const payload = preserveStoredView(clubId, prefs, userId);
  // Preserve tap order: a slow earlier save must not land after the last tap.
  // Each action contributes one bounded write, with no timer or repair loop.
  const write = async (): Promise<boolean> => {
    try {
      const { error } = await awaitPreferenceSave(
        supabase.from('user_lobby_filters').upsert(
          {
            user_id: userId,
            club_id: clubId,
            view_prefs: payload,
            view_prefs_changed_at: changedAt,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,club_id' }
        )
      );
      if (error) {
        if (!isAbortedRequest(error)) {
          reportError(error, 'lobbyViewPrefs.pushRemoteViewPrefs', { clubId });
        }
        return false;
      }
      return true;
    } catch (error) {
      if (!isAbortedRequest(error)) {
        reportError(error, 'lobbyViewPrefs.pushRemoteViewPrefs', { clubId });
      }
      return false;
    }
  };
  const previous = pendingViewWrites.get(key);
  const pending: Promise<void> = (previous ? previous.then(write) : write()).then((ok) => {
    // Only the newest queued choice may declare this account+club synced.
    if (ok && pendingViewWrites.get(key) === pending) {
      markUnsynced(unsyncedViewKey(userId, clubId), false);
    }
  });
  pendingViewWrites.set(key, pending);
  trackPreferenceWrite(userId, pending);
  void pending.then(() => {
    if (pendingViewWrites.get(key) === pending) pendingViewWrites.delete(key);
  });
  return pending;
}

/**
 * Does this device hold a choice the database never confirmed?
 *
 * True after a save that failed (offline, a dropped tab, a server error) and
 * until a later save succeeds. The lobby reads it before it lets the row
 * correct the cache: the row is the truth only once it has the latest choice,
 * so an unconfirmed local choice is finished (re-sent) rather than discarded.
 */
export function hasUnsyncedViewPrefs(clubId: string, userId = currentUserId()): boolean {
  if (!userId || !clubId) return false;
  return isUnsynced(unsyncedViewKey(userId, clubId));
}

function unsyncedViewKey(userId: string, clubId: string): string {
  return `${KEY_PREFIX}${userId}:${clubId}:unsynced`;
}

/**
 * Write, never throw. A lobby that cannot remember a tab is a small
 * disappointment; a lobby that crashes because the quota is full is not.
 */
export function saveViewPrefs(
  clubId: string,
  prefs: LobbyViewPrefs,
  userId = currentUserId()
): void {
  if (!clubId) return;
  try {
    const key = userId ? `${KEY_PREFIX}${userId}:${clubId}` : `${KEY_PREFIX}${clubId}`;
    localStorage.setItem(key, JSON.stringify(preserveStoredView(clubId, prefs, userId)));
  } catch {
    /* storage unavailable or full — the session keeps working in memory */
  }
}

/**
 * The sort a tab should show: the player's saved choice if they made one,
 * otherwise the tab's own default.
 *
 * Dan 2026-10-31: Spins, Sit N Go's and Satellites open by current Players,
 * highest first. MTT keeps Recommended. Owner 2026-11-02: cash defaults to
 * stakes high to low. Defaults apply when no explicit sort was saved.
 */
export function defaultSortForTab(tab: LobbyTabKey): LobbySortKey {
  if (tab === 'SPIN' || tab === 'SNG' || tab === 'SATELLITE') return 'players';
  if (tab === 'MTT') return 'recommended';
  return 'stakes_high';
}

function validSortForTab(tab: LobbyTabKey, saved: LobbySortKey): LobbySortKey {
  if (saved !== 'starting_soon' || tab === 'MTT' || tab === 'SATELLITE') return saved;
  return defaultSortForTab(tab);
}

export function sortForTab(prefs: LobbyViewPrefs, tab: LobbyTabKey): LobbySortKey {
  const saved = prefs.sortByTab[tab];
  // Unsupported legacy sorts normalize on read, without a remote reset write.
  return saved ? validSortForTab(tab, saved) : defaultSortForTab(tab);
}
