import { supabase } from './supabase';
import {
  notePagePreferenceRevision,
  pagePreferenceRevision,
  savePagePreference,
} from './pagePreferenceSave';
import {
  awaitPreferenceSave,
  beginTableSettingIntent,
  confirmTableSettingIntent,
  orderTableSettingWrite,
  readTableSettingIntent,
} from './tableSettingIntents';
import { reportError } from '../utils/errorReporter';
import { rosterSearchKey } from './rosterCache';
import type { RosterFilter, RosterSort } from '../services/ClubRosterService';

export type RosterColumn = 'downlines' | 'wallets' | 'fees' | 'activity';
export interface RosterWorkspace {
  search: string;
  filter: RosterFilter;
  sort: RosterSort;
  columns: RosterColumn[];
}
export interface RosterReturnPosition {
  version: 1;
  entryKey: string;
  workspace: RosterWorkspace;
  viewportTop: number;
  windowTop: number;
}
const workspaceRevisions = new Map<string, number>();
const FILTERS = [
  'all',
  'mine',
  'seated',
  'online',
  'agents',
  'admins',
  'inactive_30',
  'inactive_60',
  'inactive_90',
  'high_fees',
];
const SORTS = ['newest', 'oldest', 'hierarchy', 'activity', 'name', 'downlines', 'wallet', 'fees'];
export const ROSTER_COLUMNS: RosterColumn[] = ['downlines', 'wallets', 'fees', 'activity'];
export const ROSTER_ROW_HEIGHT = 123;
export const MAX_ROSTER_RETURN_TOP = ROSTER_ROW_HEIGHT * 10_000;
/* Fees lead, wallets are opt-in: Player Management always shows fees
   generated, never a wallet balance by default (Dan, 2026-10-14). */
export const DEFAULT_ROSTER_COLUMNS: RosterColumn[] = ['fees', 'downlines', 'activity'];
/* Active Now leads (Dan, 2026-11-12): players at a table, then players online
   watching, then everyone else by last active. Newest Players First is no
   longer the default. */
export const DEFAULT_ROSTER_SORT: RosterSort = 'activity';
/* A stored workspace below this version predates the Active Now default and
   adopts it once; the operator's search, filter and columns are kept. */
const WORKSPACE_VERSION = 3;
export function defaultRosterWorkspace(): RosterWorkspace {
  return {
    search: '',
    filter: 'all',
    sort: DEFAULT_ROSTER_SORT,
    columns: [...DEFAULT_ROSTER_COLUMNS],
  };
}
function adoptCurrentDefaults(value: unknown, workspace: RosterWorkspace | null) {
  if (!workspace) return null;
  const version = (value as { version?: unknown } | null)?.version;
  return typeof version === 'number' && version >= WORKSPACE_VERSION
    ? workspace
    : { ...workspace, sort: DEFAULT_ROSTER_SORT };
}
export function rosterWorkspaceKey(viewer: string, club: string): string {
  return `roster_workspace_v1_${encodeURIComponent(viewer)}_${encodeURIComponent(club)}`;
}
export function rosterPositionKey(viewer: string, club: string): string {
  return `roster_position_v1_${encodeURIComponent(viewer)}_${encodeURIComponent(club)}`;
}
function decodeWorkspace(value: unknown): RosterWorkspace | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (
    typeof v.search !== 'string' ||
    v.search.length > 120 ||
    typeof v.filter !== 'string' ||
    !FILTERS.includes(v.filter) ||
    typeof v.sort !== 'string' ||
    !SORTS.includes(v.sort) ||
    !Array.isArray(v.columns) ||
    v.columns.length > ROSTER_COLUMNS.length ||
    !v.columns.every((c) => ROSTER_COLUMNS.includes(c)) ||
    new Set(v.columns).size !== v.columns.length
  )
    return null;
  return {
    search: v.search,
    filter: v.filter as RosterFilter,
    sort: v.sort as RosterSort,
    columns: [...v.columns] as RosterColumn[],
  };
}
export function readRosterWorkspace(viewer: string, club: string): RosterWorkspace | null {
  const pending = readTableSettingIntent(viewer, `page:roster:workspace:${club}`);
  const pendingWorkspace = pending && decodeWorkspace(pending.value);
  if (pendingWorkspace) return pendingWorkspace;
  try {
    const raw = sessionStorage.getItem(rosterWorkspaceKey(viewer, club));
    if (!raw) {
      const legacy = sessionStorage.getItem(rosterSearchKey(viewer, club));
      if (!legacy || legacy.length > 1024) return null;
      const search = JSON.parse(legacy);
      return typeof search === 'string' && search.length <= 120
        ? { ...defaultRosterWorkspace(), search }
        : null;
    }
    if (raw.length > 2048) return null;
    const value = JSON.parse(raw);
    if (![1, 2, WORKSPACE_VERSION].includes(value?.version)) return null;
    return adoptCurrentDefaults(value, decodeWorkspace(value));
  } catch {
    return null;
  }
}
function cacheWorkspace(viewer: string, club: string, workspace: RosterWorkspace): void {
  try {
    sessionStorage.setItem(
      rosterWorkspaceKey(viewer, club),
      JSON.stringify({ version: WORKSPACE_VERSION, ...workspace })
    );
  } catch {
    /* The account row remains authoritative if browser storage is unavailable. */
  }
}
async function saveWorkspace(
  viewer: string,
  club: string,
  workspace: RosterWorkspace,
  id: string
): Promise<void> {
  const key = `roster:workspace:${club}`;
  await orderTableSettingWrite(viewer, `page:${key}`, async () => {
    /* Revision-checked like every page preference (2026-11-05): a refused
       save means the account holds a newer workspace, which is shown. */
    const stored = { ...workspace, version: WORKSPACE_VERSION };
    const outcome = await savePagePreference(viewer, key, stored, id, () => {
      const pending = readTableSettingIntent(viewer, `page:${key}`);
      const held = pending && decodeWorkspace(pending.value);
      if (held && pending) void saveWorkspace(viewer, club, held, pending.id);
    });
    if (outcome.status === 'conflict') {
      const newer = adoptCurrentDefaults(outcome.value, decodeWorkspace(outcome.value));
      if (newer) cacheWorkspace(viewer, club, newer);
    }
  });
}
/** Resolve the same workspace before publishing its account/club scope. */
export async function loadRosterWorkspace(viewer: string, club: string): Promise<RosterWorkspace> {
  const key = `page:roster:workspace:${club}`;
  const revision = workspaceRevisions.get(rosterWorkspaceKey(viewer, club)) ?? 0;
  const pending = readTableSettingIntent(viewer, key);
  const held = pending && decodeWorkspace(pending.value);
  if (held) {
    void saveWorkspace(viewer, club, held, pending.id);
    return held;
  }
  let workspace = readRosterWorkspace(viewer, club) ?? defaultRosterWorkspace();
  try {
    const { data, error } = (await awaitPreferenceSave(
      supabase
        .from('user_page_preferences')
        .select('value, revision')
        .eq('user_id', viewer)
        .eq('preference_key', `roster:workspace:${club}`)
        .maybeSingle()
    )) as { data?: { value: unknown; revision?: unknown } | null; error: unknown };
    if (error) throw error;
    if (data) notePagePreferenceRevision(viewer, `roster:workspace:${club}`, data.revision);
    if ((workspaceRevisions.get(rosterWorkspaceKey(viewer, club)) ?? 0) !== revision)
      return readRosterWorkspace(viewer, club) ?? workspace;
    workspace = adoptCurrentDefaults(data?.value, decodeWorkspace(data?.value)) ?? workspace;
  } catch (error) {
    reportError(error, 'RosterWorkspace.load');
  }
  cacheWorkspace(viewer, club, workspace);
  return workspace;
}
export function writeRosterWorkspace(
  viewer: string,
  club: string,
  workspace: RosterWorkspace
): void {
  const safe = decodeWorkspace(workspace);
  if (!safe) return;
  const previous = readRosterWorkspace(viewer, club);
  if (previous && JSON.stringify(previous) === JSON.stringify(safe)) return;
  const revisionKey = rosterWorkspaceKey(viewer, club);
  workspaceRevisions.set(revisionKey, (workspaceRevisions.get(revisionKey) ?? 0) + 1);
  cacheWorkspace(viewer, club, safe);
  const id = beginTableSettingIntent(
    viewer,
    `page:roster:workspace:${club}`,
    safe,
    pagePreferenceRevision(viewer, `roster:workspace:${club}`)
  );
  void saveWorkspace(viewer, club, safe, id);
}
export function writeRosterReturnPosition(
  viewer: string,
  club: string,
  position: RosterReturnPosition
): void {
  const workspace = decodeWorkspace(position.workspace);
  if (!workspace) return;
  try {
    sessionStorage.setItem(
      rosterPositionKey(viewer, club),
      JSON.stringify({
        version: 1,
        entryKey: position.entryKey,
        workspace,
        viewportTop: Math.min(MAX_ROSTER_RETURN_TOP, Math.max(0, position.viewportTop)),
        windowTop: Math.min(MAX_ROSTER_RETURN_TOP, Math.max(0, position.windowTop)),
      })
    );
  } catch {
    /* Optional browser continuity. */
  }
}
export function takeRosterReturnPosition(
  viewer: string,
  club: string,
  entryKey: string
): RosterReturnPosition | null {
  try {
    const key = rosterPositionKey(viewer, club);
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw || raw.length > 4096) return null;
    const v = JSON.parse(raw);
    const workspace = decodeWorkspace(v?.workspace);
    const validOffset = (n: unknown) =>
      typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= MAX_ROSTER_RETURN_TOP;
    if (
      v?.version !== 1 ||
      v.entryKey !== entryKey ||
      !workspace ||
      !validOffset(v.viewportTop) ||
      !validOffset(v.windowTop)
    )
      return null;
    return { version: 1, entryKey, workspace, viewportTop: v.viewportTop, windowTop: v.windowTop };
  } catch {
    return null;
  }
}
export function sameRosterQuery(a: RosterWorkspace, b: RosterWorkspace): boolean {
  return a.search === b.search && a.filter === b.filter && a.sort === b.sort;
}
