/**
 * PAGE PREFERENCE SAVE - one revision-checked write for every
 * user_page_preferences value (usePlayerPreference, the roster workspace).
 *
 * Browsers can no longer write the table directly (migration 20261105183133);
 * fn_save_page_preferences applies a value only against the revision it was
 * chosen from, so a stale tab or a late replay cannot overwrite a newer choice
 * made on another device. See src/lib/preferenceSync.ts for the shared rules.
 */
import {
  callPreferenceRpc,
  noteRevisions,
  readAck,
  registerRetry,
  sameValue,
  setSaveStatus,
  type FieldResult,
} from './preferenceSync';
import { confirmTableSettingIntent, readTableSettingIntent } from './tableSettingIntents';
import { reportError } from '../utils/errorReporter';

export const PAGE_SCOPE = 'page';

/** The revision this device last saw for a page preference (0 when none). */
export function pagePreferenceRevision(owner: string, key: string): number | null {
  const rev = readAck(owner, PAGE_SCOPE).revisions[key];
  return typeof rev === 'number' ? rev : null;
}

export function notePagePreferenceRevision(owner: string, key: string, revision: unknown): void {
  const n = Number(revision);
  if (Number.isFinite(n)) noteRevisions(owner, PAGE_SCOPE, { [key]: n });
}

export type PageSaveOutcome =
  | { status: 'saved' }
  | { status: 'conflict'; value: unknown }
  | { status: 'failed' };

/**
 * Save `value` for owner+key. The base is the journal's (the revision the
 * player first chose against), else the last revision seen.
 */
export async function savePagePreference(
  owner: string,
  key: string,
  value: unknown,
  intentId: string,
  retry: () => void
): Promise<PageSaveOutcome> {
  const column = `page:${key}`;
  const scopeKey = `${owner}:${PAGE_SCOPE}`;
  registerRetry(scopeKey, retry);
  const held = readTableSettingIntent(owner, column);
  const base =
    held?.id === intentId && held && 'base' in held && held.base !== undefined
      ? held.base
      : pagePreferenceRevision(owner, key);
  setSaveStatus(scopeKey, 'saving');
  const outcome = await callPreferenceRpc(owner, 'fn_save_page_preferences', {
    p_changes: [{ field: key, value, base }],
  });
  if (!outcome.ok) {
    if (outcome.reason === 'failed') reportError(outcome.error, 'pagePreferenceSave.failed');
    setSaveStatus(scopeKey, outcome.reason === 'signed_out' ? 'signed_out' : 'failed');
    return { status: 'failed' };
  }
  const result = ((outcome.data as { results?: FieldResult[] })?.results ?? [])[0];
  if (!result) {
    setSaveStatus(scopeKey, 'failed');
    return { status: 'failed' };
  }
  notePagePreferenceRevision(owner, key, result.revision);
  if (
    result.status === 'applied' ||
    (result.status === 'conflict' && sameValue(result.value, value))
  ) {
    confirmTableSettingIntent(owner, column, intentId);
    setSaveStatus(scopeKey, 'saved');
    return { status: 'saved' };
  }
  // Refused: the account holds a newer choice. Drop this one and show that.
  confirmTableSettingIntent(owner, column, intentId);
  setSaveStatus(scopeKey, 'conflict', [key]);
  return result.status === 'conflict'
    ? { status: 'conflict', value: result.value }
    : { status: 'failed' };
}
