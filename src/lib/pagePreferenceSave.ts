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
  noteOwn,
  noteRevisions,
  readAck,
  readOwn,
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

/* ONE SAVE AT A TIME PER SETTING (2026-11-05). Every save used to go out at
   once: two quick taps on a table heading were both sent against the revision
   from before either, the account accepted the first and refused the second
   as Changed On Another Device, and the board snapped back to the first tap
   (production proof verify-lobby-filters, run 42140994979, Spins). A save now
   waits for the previous save of the same setting, so it is stated against
   the revision that save was granted. */
const pageChains = new Map<string, Promise<unknown>>();

/**
 * Save `value` for owner+key. The base is the journal's (the revision the
 * player first chose against), else the last revision seen.
 */
export function savePagePreference(
  owner: string,
  key: string,
  value: unknown,
  intentId: string,
  retry: () => void
): Promise<PageSaveOutcome> {
  const chainKey = `${owner}:${key}`;
  const previous = pageChains.get(chainKey) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(() => savePagePreferenceNow(owner, key, value, intentId, retry));
  pageChains.set(chainKey, run);
  void run.finally(() => {
    if (pageChains.get(chainKey) === run) pageChains.delete(chainKey);
  });
  return run;
}

async function savePagePreferenceNow(
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
  let outcome = await callPreferenceRpc(owner, 'fn_save_page_preferences', {
    p_changes: [{ field: key, value, base }],
  });
  /* The account holds this device's own last accepted save of this setting:
     the refusal is not another device, the player chose again here. Send the
     newer choice once more against that revision. */
  const first = outcome.ok
    ? ((outcome.data as { results?: FieldResult[] })?.results ?? [])[0]
    : undefined;
  if (
    first?.status === 'conflict' &&
    !sameValue(first.value, value) &&
    typeof first.revision === 'number' &&
    readOwn(owner, PAGE_SCOPE)[key] === first.revision
  ) {
    outcome = await callPreferenceRpc(owner, 'fn_save_page_preferences', {
      p_changes: [{ field: key, value, base: first.revision }],
    });
  }
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
  if (result.status === 'applied' && typeof result.revision === 'number') {
    noteOwn(owner, PAGE_SCOPE, { [key]: result.revision });
  }
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
