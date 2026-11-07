import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { useUserStore } from '../stores/useUserStore';
import { supabase } from '../lib/supabase';
import { reportError } from '../utils/errorReporter';
import {
  awaitPreferenceSave,
  beginTableSettingIntent,
  bindInitialTableSettingRevision,
  confirmTableSettingIntent,
  orderTableSettingWrite,
  readTableSettingIntent,
  registerPreferenceFlush,
} from '../lib/tableSettingIntents';
import {
  notePagePreferenceRevision,
  pagePreferenceRevision,
  savePagePreference,
} from '../lib/pagePreferenceSave';

const PREFIX = 'ca_player_preference:';
const CHANGED = 'ca-player-preference-changed';
// Keep the latest identity even after confirmation removes its durable journal.
// Other mounted consumers can still hold an older deferred save.
const latestSelections = new Map<
  string,
  { id: string; journaled: boolean; baseline?: Promise<void> }
>();

function validShape(value: unknown, fallback: unknown): boolean {
  if (fallback === null) return value === null || typeof value === 'string';
  if (typeof value !== typeof fallback) return false;
  if (typeof value === 'string') return value.length <= 512;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(fallback)) return Array.isArray(value);
  if (fallback && typeof fallback === 'object') {
    return Boolean(
      value &&
      !Array.isArray(value) &&
      Object.entries(fallback).every(([key, entry]) =>
        validShape((value as Record<string, unknown>)[key], entry)
      )
    );
  }
  return true;
}

function read<T>(owner: string, name: string, fallback: T): T {
  const pending = readTableSettingIntent(owner, `page:${name}`);
  if (pending && validShape(pending.value, fallback)) return pending.value as T;
  try {
    const raw = localStorage.getItem(`${PREFIX}${owner}:${name}`);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (validShape(value, fallback)) return value as T;
    }
  } catch {
    /* Unreadable storage never changes the active selection. */
  }
  return fallback;
}

function cache(owner: string, name: string, value: unknown): void {
  try {
    localStorage.setItem(`${PREFIX}${owner}:${name}`, JSON.stringify(value));
  } catch {
    /* Keep the selection even if browser storage is unavailable. */
  }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: { owner, name, value } }));
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

async function save(owner: string, name: string, value: unknown, id: string): Promise<void> {
  if (owner === 'guest' || useUserStore.getState().user?.id !== owner || isOffline()) return;
  const selectionKey = `${owner}:${name}`;
  const selection = latestSelections.get(selectionKey);
  if (selection?.id === id && selection.baseline) {
    // A lost first read gets the same bounded wait as a save. The journal's
    // unbound base still goes through normal conflict checks if it times out.
    await awaitPreferenceSave(selection.baseline.then(() => ({ error: null })));
  }
  if (
    readTableSettingIntent(owner, `page:${name}`)?.id === id &&
    latestSelections.get(selectionKey)?.journaled !== false
  )
    latestSelections.set(selectionKey, { id, journaled: true });
  await orderTableSettingWrite(owner, `page:${name}`, async () => {
    const held = readTableSettingIntent(owner, `page:${name}`);
    const latest = latestSelections.get(selectionKey);
    if (
      useUserStore.getState().user?.id !== owner ||
      isOffline() ||
      latest?.id !== id ||
      (latest.journaled && held?.id !== id)
    )
      return;
    /* REVISION-CHECKED (2026-11-05): the server applies this choice only
       against the revision it was made from, so a stale tab or a replay
       after a reload cannot overwrite a newer choice from another device.
       A refused choice is dropped and the account's value is shown. */
    const outcome = await savePagePreference(owner, name, value, id, () => {
      const pending = readTableSettingIntent(owner, `page:${name}`);
      if (pending) void save(owner, name, pending.value, pending.id);
    });
    if (outcome.status === 'conflict') cache(owner, name, outcome.value);
  });
}

/** Player-selected filters have no TTL. Mounting never writes a default. */
export function usePlayerPreference<T>(
  name: string,
  initial: T | (() => T),
  scopeId?: string | null
): [T, (next: SetStateAction<T>) => void] {
  const userId = useUserStore((state) => state.user?.id ?? null);
  const owner = userId ?? 'guest';
  // The public URL is shared by full pages and native routing. Embedded lobbies
  // may pass their explicit club instead of inheriting the host page's URL.
  const url = typeof window === 'undefined' ? null : new URL(window.location.href);
  const routeScope = url?.pathname.match(/\/(?:clubs|unions)\/([^/]+)/)?.[1];
  const scopedName = `${name}:${scopeId ?? routeScope ?? url?.searchParams.get('club') ?? 'global'}`;
  const scope = `${owner}:${scopedName}`;
  const fallbackRef = useRef<T>(typeof initial === 'function' ? (initial as () => T)() : initial);
  const [state, setState] = useState(() => ({
    scope,
    value: read(owner, scopedName, fallbackRef.current),
  }));
  const current =
    state.scope === scope ? state.value : read(owner, scopedName, fallbackRef.current);
  const valueRef = useRef({ scope, value: current });
  valueRef.current = { scope, value: current };
  const revisionRef = useRef(0);
  // The scope whose account value has been read (or that has no account).
  // Until then, the shown value is only the device cache or the default.
  const settledScopeRef = useRef<string | null>(userId ? null : scope);
  const initialRead = useRef<{ scope: string; result: Promise<number | null> } | null>(null);
  const pendingRef = useRef<{ owner: string; name: string; value: T; id: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingRef.current;
    // The original choice stays in memory as well as its journal while offline.
    if (isOffline()) return;
    pendingRef.current = null;
    if (pending) return save(pending.owner, pending.name, pending.value, pending.id);
  }, []);

  useEffect(() => registerPreferenceFlush(owner, flush), [owner, flush]);

  useEffect(() => {
    const reconnect = () => {
      if (isOffline()) return;
      const queued = pendingRef.current;
      if (queued?.owner === owner && queued.name === scopedName) {
        void flush();
        return;
      }
      // Resume this account's original intent, including after an offline remount.
      // No new intent or default is created by a connectivity event.
      const pending = readTableSettingIntent(owner, `page:${scopedName}`);
      if (pending) void save(owner, scopedName, pending.value, pending.id);
    };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [owner, scopedName, flush]);

  // Closed, mounted settings sheets share the same preference owner too.
  // A second instance must not reopen with the value from before the last gesture.
  useEffect(() => {
    const accept = (value: unknown) => {
      if (!validShape(value, fallbackRef.current)) return;
      // A newer consumer/tab owns this choice. Retire this instance's older
      // debounce without replaying it after the other writer has confirmed.
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingRef.current = null;
      latestSelections.delete(`${owner}:${scopedName}`);
      revisionRef.current += 1;
      valueRef.current = { scope, value: value as T };
      setState({ scope, value: value as T });
    };
    const changed = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.owner === owner && detail?.name === scopedName) accept(detail.value);
    };
    const storage = (event: StorageEvent) => {
      if (event.key !== `${PREFIX}${owner}:${scopedName}` || event.newValue === null) return;
      try {
        accept(JSON.parse(event.newValue));
      } catch {
        /* Ignore invalid external cache data. */
      }
    };
    window.addEventListener(CHANGED, changed);
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener(CHANGED, changed);
      window.removeEventListener('storage', storage);
    };
  }, [owner, scopedName, scope]);

  useEffect(() => {
    let active = true;
    const revision = revisionRef.current;
    const pending = readTableSettingIntent(owner, `page:${scopedName}`);
    /* A replayed choice is finished first, then the row is read back: the
       database keeps whichever choice is newer, so a choice made since on
       another device is what this screen ends up showing (2026-11-05). */
    const replay = pending ? save(owner, scopedName, pending.value, pending.id) : Promise.resolve();
    if (userId) {
      const result = replay.then(async () => {
        try {
          const { data, error } = await supabase
            .from('user_page_preferences')
            .select('value, revision')
            .eq('user_id', userId)
            .eq('preference_key', scopedName)
            .maybeSingle();
          if (error) throw error;
          if (active) settledScopeRef.current = scope;
          if (data)
            notePagePreferenceRevision(
              owner,
              scopedName,
              (data as { revision?: unknown }).revision
            );
          const baseline = typeof data?.revision === 'number' ? data.revision : null;
          if (
            !active ||
            revisionRef.current !== revision ||
            !data ||
            readTableSettingIntent(owner, `page:${scopedName}`) ||
            !validShape(data.value, fallbackRef.current)
          )
            return baseline;
          cache(owner, scopedName, data.value);
          setState({ scope, value: data.value as T });
          return baseline;
        } catch (error) {
          if (active) settledScopeRef.current = scope;
          reportError(error, 'usePlayerPreference.Load_failed');
          return null;
        }
      });
      const read = { scope, result };
      initialRead.current = read;
      void result.then(() => {
        if (initialRead.current === read) initialRead.current = null;
      });
    } else {
      settledScopeRef.current = scope;
    }
    return () => {
      active = false;
      flush();
    };
  }, [owner, scopedName, scope, userId, flush]);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [flush]);

  const select = useCallback(
    (next: SetStateAction<T>) => {
      const previous =
        valueRef.current.scope === scope
          ? valueRef.current.value
          : read(owner, scopedName, fallbackRef.current);
      const value = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
      /* A gesture made before the account value arrives is still the player's
         choice even when it matches the cached/default value on screen: it
         claims the selection, so the late read cannot flip the page to the
         account's older value (Players stayed on Advanced after tapping
         Simple, post-deploy run 42370089738). Once the account value is
         known, re-selecting the shown value is a no-op as before. */
      if (
        Object.is(previous, value) &&
        (typeof next === 'function' || settledScopeRef.current === scope)
      )
        return;
      const hydration = initialRead.current?.scope === scope ? initialRead.current : null;
      const column = `page:${scopedName}`;
      const held = readTableSettingIntent(owner, column);
      const base = pagePreferenceRevision(owner, scopedName);
      const earlier = latestSelections.get(scope);
      const needsInitialBase = !held || (held.id === earlier?.id && earlier.baseline !== undefined);
      revisionRef.current += 1;
      valueRef.current = { scope, value };
      cache(owner, scopedName, value);
      const id = beginTableSettingIntent(owner, `page:${scopedName}`, value, base);
      latestSelections.set(`${owner}:${scopedName}`, {
        id,
        baseline:
          needsInitialBase && hydration && base === null
            ? hydration.result.then((revision) => {
                if (revision !== null) bindInitialTableSettingRevision(owner, column, id, revision);
              })
            : undefined,
        journaled: readTableSettingIntent(owner, `page:${scopedName}`)?.id === id,
      });
      setState({ scope, value });
      pendingRef.current = { owner, name: scopedName, value, id };
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, 500);
    },
    [owner, scopedName, scope, flush]
  );
  return [current, select];
}
