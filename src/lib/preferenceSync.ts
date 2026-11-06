/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * PREFERENCE SYNC - one account-bound, revision-checked path for every saved
 * lobby filter, view choice, page preference and favorite
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Dan 2026-11-05: favorites and filters are durable account preferences whose
 * saved values change only through the account owner's explicit action.
 *
 * THE RULES THIS FILE ENFORCES ON THE CLIENT (the database enforces the same
 * ones in migration 20261105183133):
 *
 *   ONLY WHAT THE PLAYER CHANGED IS SENT. Callers stage fields, one per saved
 *   setting, and only when a player's action changed it. A load, a default or
 *   a fallback on screen is never staged, so it can never be written.
 *
 *   EVERY CHANGE STATES THE REVISION IT WAS MADE AGAINST. The server applies
 *   it only if that is still the field's current revision; otherwise it
 *   answers CONFLICT with the account's current value, which this device then
 *   shows. No device clock is involved anywhere.
 *
 *   A QUEUED CHANGE BELONGS TO THE ACCOUNT THAT MADE IT. Pending changes are
 *   stored under the owner's id and sent only while that same account is the
 *   signed-in session (checked against the store AND the live session), and
 *   the server acts only for auth.uid(). Switching accounts parks them.
 *
 *   AUTHENTICATION IS RENEWED BEFORE A RETRY. A request refused for an expired
 *   or invalid token triggers one session refresh; the write is retried only
 *   if the refreshed session is still the same owner.
 *
 *   SAVED MEANS ACKNOWLEDGED. The status for a scope reads "saving" while a
 *   change is unacknowledged and "saved" only after the server accepted it;
 *   a failure stays visible and retryable, and nothing pending is discarded.
 */
import { useSyncExternalStore } from 'react';
import { supabase } from './supabase';
import { useUserStore } from '../stores/useUserStore';
import { reportError } from '../utils/errorReporter';

export type FieldChange = { field: string; value: unknown; base: number | null };
export type FieldResult = {
  field: string;
  status: 'applied' | 'conflict' | 'invalid';
  revision?: number;
  value?: unknown;
  active?: boolean;
  game_key?: string;
};

export type SaveState = 'idle' | 'saving' | 'saved' | 'failed' | 'conflict' | 'signed_out';
export interface SaveStatus {
  state: SaveState;
  /** Fields the server kept at another value; the device now shows that value. */
  conflicts: string[];
  updatedAt: number;
}

// ─── Account guard and authenticated call ────────────────────────────────────

export function isAbortedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: unknown; message?: unknown; details?: unknown };
  if (e.name === 'AbortError') return true;
  const text = `${typeof e.message === 'string' ? e.message : ''} ${typeof e.details === 'string' ? e.details : ''}`;
  return /AbortError|The operation was aborted|signal is aborted/i.test(text);
}

function isAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: unknown; status?: unknown; message?: unknown };
  if (e.status === 401 || e.code === 'PGRST301' || e.code === 'PGRST303' || e.code === '42501')
    return true;
  return /jwt|token|expired|not authenticated|sign in/i.test(String(e.message ?? ''));
}

async function sessionOwner(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.getSession();
    // Unreadable session: say nothing about the owner; the store check stands.
    if (error) return null;
    return data?.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

export type RpcOutcome =
  | { ok: true; data: unknown }
  | { ok: false; reason: 'not_owner' | 'signed_out' | 'offline' | 'failed'; error?: unknown };

/**
 * Call a preference function for `owner`, or refuse. Never sends one account's
 * change while another account is signed in, and renews an expired session
 * once before retrying.
 */
export async function callPreferenceRpc(
  owner: string,
  fn: string,
  args: Record<string, unknown>
): Promise<RpcOutcome> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return { ok: false, reason: 'offline' };
  if (useUserStore.getState().user?.id !== owner) return { ok: false, reason: 'not_owner' };
  const live = await sessionOwner();
  if (live && live !== owner) return { ok: false, reason: 'not_owner' };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { data, error } = await supabase.rpc(fn, args);
      if (!error) return { ok: true, data };
      if (attempt === 0 && isAuthError(error)) {
        const refreshed = await supabase.auth.refreshSession().catch(() => null);
        const id = refreshed?.data?.session?.user?.id ?? null;
        if (id === owner && useUserStore.getState().user?.id === owner) continue;
        return { ok: false, reason: 'signed_out', error };
      }
      return { ok: false, reason: 'failed', error };
    } catch (error) {
      return { ok: false, reason: 'failed', error };
    }
  }
  return { ok: false, reason: 'failed' };
}

// ─── Save status, per owner+scope, observable from React ────────────────────

const statuses = new Map<string, SaveStatus>();
const retries = new Map<string, () => void>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  listeners.forEach((l) => l());
}

export function setSaveStatus(scopeKey: string, state: SaveState, conflicts: string[] = []): void {
  statuses.set(scopeKey, { state, conflicts, updatedAt: Date.now() });
  emit();
}

export function readSaveStatus(scopeKey: string): SaveStatus {
  return statuses.get(scopeKey) ?? { state: 'idle', conflicts: [], updatedAt: 0 };
}

/** The flush that a Retry control runs for this scope. */
export function registerRetry(scopeKey: string, retry: () => void): void {
  retries.set(scopeKey, retry);
}

export function retrySave(scopeKey: string): void {
  retries.get(scopeKey)?.();
}

/** The most urgent status across every scope starting with `prefix`. */
export function aggregateSaveStatus(prefix: string): {
  scopeKey: string | null;
  status: SaveStatus;
} {
  const rank: Record<SaveState, number> = {
    failed: 5,
    signed_out: 4,
    conflict: 3,
    saving: 2,
    saved: 1,
    idle: 0,
  };
  let best: { scopeKey: string | null; status: SaveStatus } = {
    scopeKey: null,
    status: { state: 'idle', conflicts: [], updatedAt: 0 },
  };
  for (const [key, status] of statuses) {
    if (!key.startsWith(prefix)) continue;
    if (rank[status.state] > rank[best.status.state]) best = { scopeKey: key, status };
  }
  return best;
}

export function useSaveStatus(prefix: string): { scopeKey: string | null; status: SaveStatus } {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version,
    () => version
  );
  return aggregateSaveStatus(prefix);
}

// ─── Durable per-account storage ─────────────────────────────────────────────

/* THE SESSION COPY (2026-11-05). When the browser refuses a write (storage
   full, private mode, blocked site data), the queue's own records live here
   for the rest of the session. Before this existed the write was dropped
   silently and the next read returned the OLDER stored copy: on production
   (verify-lobby-filters run 42121413754) a second sort tap was sent against
   the revision from before the first tap, so the account refused the
   player's own newer choice as "Changed On Another Device", and a third tap
   was never sent at all because its pending record could not be stored. A
   successful write or a removal retires the session copy for that key. */
const sessionCopy = new Map<string, string>();

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionCopy.has(key) ? sessionCopy.get(key)! : localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  const raw = JSON.stringify(value);
  try {
    localStorage.setItem(key, raw);
    sessionCopy.delete(key);
  } catch {
    /* Storage unavailable: the session copy drives this session. */
    sessionCopy.set(key, raw);
  }
}

function removeKey(key: string): void {
  sessionCopy.delete(key);
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Last server-acknowledged revision per field, for owner+scope. */
export interface AckState {
  revisions: Record<string, number>;
}

const ackKey = (owner: string, scope: string) => `ca_pref_ack:${owner}:${scope}`;
const pendingKey = (owner: string, scope: string) => `ca_pref_pending:${owner}:${scope}`;

export function readAck(owner: string, scope: string): AckState {
  const ack = readJson<AckState>(ackKey(owner, scope), { revisions: {} });
  return { revisions: ack.revisions && typeof ack.revisions === 'object' ? ack.revisions : {} };
}

export function noteRevisions(
  owner: string,
  scope: string,
  revisions: Record<string, unknown>
): void {
  const ack = readAck(owner, scope);
  for (const [field, rev] of Object.entries(revisions ?? {})) {
    const n = Number(rev);
    // Revisions only move forward; an out-of-order reply cannot move one back.
    if (Number.isFinite(n) && n >= (ack.revisions[field] ?? 0)) ack.revisions[field] = n;
  }
  writeJson(ackKey(owner, scope), ack);
}

/**
 * Revisions the account granted to THIS device's own saves, per field. When
 * the account refuses a change only because it now holds this device's own
 * last accepted save, the refusal is false: the player made both choices here,
 * in order. Production proof verify-lobby-filters (runs 42121413754 and
 * 42128990839): the first of two quick sort taps was accepted, the second was
 * sent against an older revision and refused, the lobby showed Changed On
 * Another Device and snapped back, and later taps were lost.
 */
const ownKey = (owner: string, scope: string) => `ca_pref_own:${owner}:${scope}`;

function readOwn(owner: string, scope: string): Record<string, number> {
  return readJson<Record<string, number>>(ownKey(owner, scope), {});
}

function noteOwn(owner: string, scope: string, granted: Record<string, number>): void {
  if (Object.keys(granted).length === 0) return;
  writeJson(ownKey(owner, scope), { ...readOwn(owner, scope), ...granted });
}

export type PendingMap = Record<string, { value: unknown; base: number | null }>;

export function readPending(owner: string, scope: string): PendingMap {
  return readJson<PendingMap>(pendingKey(owner, scope), {});
}

function writePending(owner: string, scope: string, pending: PendingMap): void {
  if (Object.keys(pending).length === 0) removeKey(pendingKey(owner, scope));
  else writeJson(pendingKey(owner, scope), pending);
}

/**
 * Record fields a player just changed. The base is the revision this device
 * last saw for the field; a field already pending keeps its original base, so
 * a run of offline edits is still judged against what the player first saw.
 */
export function stageFields(
  owner: string,
  scope: string,
  fields: Record<string, unknown>,
  bases: Record<string, number | null> = {}
): void {
  const names = Object.keys(fields);
  if (names.length === 0) return;
  const pending = readPending(owner, scope);
  const ack = readAck(owner, scope);
  for (const field of names) {
    const base =
      field in pending
        ? pending[field].base
        : field in bases
          ? bases[field]
          : (ack.revisions[field] ?? null);
    pending[field] = { value: fields[field], base };
  }
  writePending(owner, scope, pending);
  setSaveStatus(`${owner}:${scope}`, 'saving');
}

export function hasPending(owner: string, scope: string, prefix = ''): boolean {
  return Object.keys(readPending(owner, scope)).some((f) => f.startsWith(prefix));
}

// ─── Flushing a scope ────────────────────────────────────────────────────────

export interface FlushSpec {
  owner: string;
  scope: string;
  /** Send these changes; resolve with the per-field results, or a failure. */
  send: (changes: FieldChange[]) => Promise<RpcOutcome>;
  /** Pull results out of the function's reply. */
  results: (data: unknown) => FieldResult[];
  /** The account's current value for a field, after a reply (applied or not). */
  onAccepted?: (result: FieldResult) => void;
  /** The server kept another value: the device must show it. */
  onConflict?: (result: FieldResult, wanted: unknown) => void;
  /** Whether a conflicting server value already equals what the player wanted. */
  equals?: (result: FieldResult, wanted: unknown) => boolean;
}

const inFlight = new Map<string, Promise<void>>();

/**
 * Send everything pending for owner+scope, one request at a time. A change
 * staged while a request is in flight is sent by the next pass, against the
 * revision that reply returned, so a quick second tap is never judged stale
 * against the first.
 */
export function flushScope(spec: FlushSpec): Promise<void> {
  const scopeKey = `${spec.owner}:${spec.scope}`;
  registerRetry(scopeKey, () => void flushScope(spec));
  const previous = inFlight.get(scopeKey) ?? Promise.resolve();
  const run = previous.then(async () => {
    for (let pass = 0; pass < 4; pass += 1) {
      const pending = readPending(spec.owner, spec.scope);
      const fields = Object.keys(pending);
      if (fields.length === 0) {
        if (readSaveStatus(scopeKey).state === 'saving') setSaveStatus(scopeKey, 'saved');
        return;
      }
      const ack = readAck(spec.owner, spec.scope);
      const changes = fields.map((field) => ({
        field,
        value: pending[field].value,
        // A field acknowledged since it was staged (an earlier pass) is now
        // judged against that newer revision; otherwise its original base.
        base: pending[field].base,
      }));
      setSaveStatus(scopeKey, 'saving');
      const outcome = await spec.send(changes);
      if (!outcome.ok) {
        setSaveStatus(scopeKey, outcome.reason === 'signed_out' ? 'signed_out' : 'failed');
        // A request the browser abandoned (navigation) is the player leaving,
        // not a failed save: it stays pending and is not reported.
        if (outcome.reason === 'failed' && !isAbortedError(outcome.error)) {
          reportError(outcome.error, `preferenceSync.${spec.scope}`);
        }
        return;
      }
      const results = spec.results(outcome.data);
      const now = readPending(spec.owner, spec.scope);
      const conflicts: string[] = [];
      const revisions: Record<string, number> = {};
      const own = readOwn(spec.owner, spec.scope);
      const granted: Record<string, number> = {};
      for (const result of results) {
        const sent = changes.find((c) => c.field === result.field);
        if (!sent) continue;
        if (typeof result.revision === 'number') revisions[result.field] = result.revision;
        const stillSame = result.field in now && sameValue(now[result.field].value, sent.value);
        if (result.status === 'applied') {
          if (typeof result.revision === 'number') granted[result.field] = result.revision;
          if (stillSame) delete now[result.field];
          // Changed again while in flight: send that newer value next pass,
          // against the revision this reply just returned.
          else if (result.field in now)
            now[result.field].base = result.revision ?? now[result.field].base;
          spec.onAccepted?.(result);
        } else if (result.status === 'conflict') {
          const equal = spec.equals
            ? spec.equals(result, sent.value)
            : sameValue(result.value, sent.value);
          // The account holds this device's own last accepted save: the
          // pending choice is the same player's later one. Send it again
          // against that revision instead of reporting another device.
          if (
            !equal &&
            result.field in now &&
            typeof result.revision === 'number' &&
            own[result.field] === result.revision
          ) {
            now[result.field].base = result.revision;
            continue;
          }
          // Any edit to this field made on the same stale view is stale too:
          // the device shows the account's value and the player decides again.
          delete now[result.field];
          if (equal) spec.onAccepted?.(result);
          else {
            conflicts.push(result.field);
            spec.onConflict?.(result, sent.value);
          }
        } else {
          // Refused as invalid: nothing to retry, and nothing silently kept.
          if (stillSame) delete now[result.field];
          conflicts.push(result.field);
        }
      }
      noteRevisions(spec.owner, spec.scope, revisions);
      noteOwn(spec.owner, spec.scope, granted);
      writePending(spec.owner, spec.scope, now);
      if (conflicts.length > 0) {
        setSaveStatus(scopeKey, 'conflict', conflicts);
        if (Object.keys(now).length === 0) return;
      }
      if (Object.keys(now).length === 0) {
        if (conflicts.length === 0) setSaveStatus(scopeKey, 'saved');
        return;
      }
    }
  });
  const settled = run.catch((error) => {
    setSaveStatus(scopeKey, 'failed');
    reportError(error, `preferenceSync.${spec.scope}`);
  });
  inFlight.set(scopeKey, settled);
  void settled.then(() => {
    if (inFlight.get(scopeKey) === settled) inFlight.delete(scopeKey);
  });
  return settled;
}

/** The in-flight flush for owner+scope, if any (logout waits on it). */
export function pendingFlush(owner: string, scope: string): Promise<void> | undefined {
  return inFlight.get(`${owner}:${scope}`);
}

/** Re-send what is pending when the device comes back online or to the front. */
export function onResume(run: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const online = () => run();
  const visible = () => {
    if (document.visibilityState === 'visible') run();
  };
  window.addEventListener('online', online);
  document.addEventListener('visibilitychange', visible);
  return () => {
    window.removeEventListener('online', online);
    document.removeEventListener('visibilitychange', visible);
  };
}
