/**
 * LOBBY PREFERENCE SYNC - the filter sheet, the quick chips and the tab / sort
 * / Favorites bar save through here, one field per setting (2026-11-05).
 *
 * Fields: `filters.<GAME TYPE>` (one Advanced Filters tab), `view.tab`,
 * `view.favoritesOnly`, `view.sort.<TAB>`. A field is staged only when the
 * player's action changed it, measured against what this device last showed
 * (the BASELINE, set by every load). A load, a default or a sanitized copy is
 * therefore never sent, and a change to one tab never rewrites another.
 * The server (fn_save_lobby_preferences) applies a field only against the
 * revision it was made from; see src/lib/preferenceSync.ts.
 */
import {
  callPreferenceRpc,
  flushScope,
  hasPending,
  noteRevisions,
  readPending,
  sameValue,
  stageFields,
  type FieldResult,
} from '../../lib/preferenceSync';

export const lobbyScope = (clubId: string) => `lobby:${clubId}`;

/** Fired when the server kept another value; the lobby re-reads and shows it. */
export const LOBBY_PREFERENCE_ADOPT = 'ca-lobby-preference-adopt';

type FilterValues = Record<string, unknown>;
interface ViewValues {
  tab: unknown;
  favoritesOnly: unknown;
  sortByTab: Record<string, unknown>;
}

const filterBaselines = new Map<string, FilterValues>();
const viewBaselines = new Map<string, ViewValues>();
const key = (owner: string, clubId: string) => `${owner}:${clubId}`;

/** What this device shows after a load: the reference a player's change is measured from. */
export function setFilterBaseline(
  owner: string | null,
  clubId: string,
  filters: FilterValues
): void {
  if (owner) filterBaselines.set(key(owner, clubId), { ...filters });
}

export function setViewBaseline(
  owner: string | null,
  clubId: string,
  view: { tab: unknown; favoritesOnly: unknown; sortByTab: Record<string, unknown> }
): void {
  if (owner) viewBaselines.set(key(owner, clubId), { ...view, sortByTab: { ...view.sortByTab } });
}

/** Stage the filter tabs this store changed relative to the baseline. */
export function stageFilterChanges(owner: string, clubId: string, next: FilterValues): void {
  const baseline = filterBaselines.get(key(owner, clubId)) ?? {};
  const fields: Record<string, unknown> = {};
  for (const [type, value] of Object.entries(next)) {
    if (!sameValue(baseline[type], value)) fields[`filters.${type}`] = value;
  }
  filterBaselines.set(key(owner, clubId), { ...baseline, ...next });
  stageFields(owner, lobbyScope(clubId), fields);
}

/** Stage the view settings this state changed relative to the baseline. */
export function stageViewChanges(
  owner: string,
  clubId: string,
  next: { tab: unknown; favoritesOnly: unknown; sortByTab: Record<string, unknown> }
): void {
  // Before any load the reference is the empty view, so only a real choice
  // (a tab picked, the chip lit, a sort chosen) can differ from it.
  const baseline = viewBaselines.get(key(owner, clubId)) ?? {
    tab: null,
    favoritesOnly: false,
    sortByTab: {},
  };
  const fields: Record<string, unknown> = {};
  if (!sameValue(baseline.tab, next.tab) && next.tab !== null && next.tab !== undefined) {
    fields['view.tab'] = next.tab;
  }
  if (!sameValue(baseline.favoritesOnly === true, next.favoritesOnly === true)) {
    fields['view.favoritesOnly'] = next.favoritesOnly === true;
  }
  for (const [tab, sort] of Object.entries(next.sortByTab ?? {})) {
    if (!sameValue(baseline.sortByTab[tab], sort)) fields[`view.sort.${tab}`] = sort;
  }
  viewBaselines.set(key(owner, clubId), { ...next, sortByTab: { ...next.sortByTab } });
  stageFields(owner, lobbyScope(clubId), fields);
}

export function hasPendingFilters(owner: string | null, clubId: string): boolean {
  return Boolean(owner) && hasPending(owner!, lobbyScope(clubId), 'filters.');
}

export function hasPendingView(owner: string | null, clubId: string): boolean {
  return Boolean(owner) && hasPending(owner!, lobbyScope(clubId), 'view.');
}

/** Pending filter tabs, to lay over a freshly loaded row. */
export function pendingFilterValues(owner: string | null, clubId: string): FilterValues {
  if (!owner) return {};
  const out: FilterValues = {};
  for (const [field, entry] of Object.entries(readPending(owner, lobbyScope(clubId)))) {
    if (field.startsWith('filters.')) out[field.slice(8)] = entry.value;
  }
  return out;
}

/** Pending view settings, to lay over a freshly loaded row. */
export function pendingViewValues(
  owner: string | null,
  clubId: string
): { tab?: unknown; favoritesOnly?: unknown; sortByTab: Record<string, unknown> } {
  const out: { tab?: unknown; favoritesOnly?: unknown; sortByTab: Record<string, unknown> } = {
    sortByTab: {},
  };
  if (!owner) return out;
  for (const [field, entry] of Object.entries(readPending(owner, lobbyScope(clubId)))) {
    if (field === 'view.tab') out.tab = entry.value;
    else if (field === 'view.favoritesOnly') out.favoritesOnly = entry.value;
    else if (field.startsWith('view.sort.')) out.sortByTab[field.slice(10)] = entry.value;
  }
  return out;
}

/** Record the revisions a loaded row carries. */
export function noteLobbyRow(owner: string | null, clubId: string, revisions: unknown): void {
  if (!owner || !revisions || typeof revisions !== 'object') return;
  noteRevisions(owner, lobbyScope(clubId), revisions as Record<string, unknown>);
}

/** Send everything pending for this account and club. */
export function flushLobby(owner: string, clubId: string): Promise<void> {
  return flushScope({
    owner,
    scope: lobbyScope(clubId),
    send: (changes) =>
      callPreferenceRpc(owner, 'fn_save_lobby_preferences', {
        p_club_id: clubId,
        p_changes: changes,
      }),
    results: (data) => {
      const reply = (data ?? {}) as {
        results?: FieldResult[];
        revisions?: Record<string, unknown>;
      };
      if (reply.revisions) noteRevisions(owner, lobbyScope(clubId), reply.revisions);
      return Array.isArray(reply.results) ? reply.results : [];
    },
    onConflict: (result) => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(
        new CustomEvent(LOBBY_PREFERENCE_ADOPT, {
          detail: { owner, clubId, field: result.field, value: result.value },
        })
      );
    },
  });
}
