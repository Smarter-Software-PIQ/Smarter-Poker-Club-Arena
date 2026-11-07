/**
 * The live entry freeze, shared by every Join surface (Dan 2026-11-07).
 * See src/utils/entryFreeze.ts for why the database is the authority.
 *
 * One store for the whole app. It reads `fn_maintenance_break_state()` when
 * the first surface mounts, when the tab returns or the device comes back
 * online, on every lobby maintenance broadcast, after any refused entry
 * (`withFreezeTime`), and once at the instant the freeze says it ends. While
 * the end is not yet certain it reads again after UNKNOWN_END_REREAD_MS, so a
 * missed broadcast can never leave a Join button held after the door opens.
 * It never polls while entry is open, and it never decides anything: the
 * database still refuses or admits every entry.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { serverNow } from '../utils/serverClock';
import { realtimeChannelService } from '../services/RealtimeChannelService';
import { PLATFORM_FROZEN_MESSAGE, isPlatformFrozenError } from '../utils/platformFrozen';
import {
  ENTRY_OPEN,
  entryFreezeFromRow,
  entryFreezeLabel,
  platformFrozenMessageUntil,
  secondsUntil,
  type EntryFreeze,
} from '../utils/entryFreeze';

export const UNKNOWN_END_REREAD_MS = 15_000;
/** Read a moment after the stated end, so the boundary has passed in the database. */
const AFTER_END_MS = 750;

let state: EntryFreeze = ENTRY_OPEN;
const listeners = new Set<() => void>();
let inFlight: Promise<EntryFreeze> | null = null;
/** One fresh read owed to whoever asked while a read was already running. */
let followUp: Promise<EntryFreeze> | null = null;
let deadline: ReturnType<typeof setTimeout> | null = null;
let detach: (() => void) | null = null;

function publish(next: EntryFreeze): void {
  if (next.frozen === state.frozen && next.endsAtMs === state.endsAtMs) return;
  state = next;
  listeners.forEach((listener) => listener());
}

function schedule(): void {
  if (deadline) clearTimeout(deadline);
  deadline = null;
  if (!state.frozen || listeners.size === 0) return;
  const wait =
    state.endsAtMs === null
      ? UNKNOWN_END_REREAD_MS
      : Math.max(AFTER_END_MS, state.endsAtMs - serverNow() + AFTER_END_MS);
  deadline = setTimeout(() => {
    deadline = null;
    void readEntryFreeze();
  }, wait);
}

/**
 * Read the database's freeze now. A failed read changes nothing.
 *
 * A request made while a read is running gets ONE fresh read after it, never
 * the running read's answer: that read began before the broadcast or refusal
 * that prompted the request, so its answer may predate the change.
 */
export function readEntryFreeze(): Promise<EntryFreeze> {
  if (inFlight) {
    followUp ??= inFlight.then(() => {
      followUp = null;
      return readEntryFreeze();
    });
    return followUp;
  }
  inFlight = (async () => {
    try {
      const { data, error } = await supabase.rpc('fn_maintenance_break_state');
      if (!error) publish(entryFreezeFromRow(data, serverNow()));
    } catch {
      /* the door is still the authority; keep what we knew */
    }
    schedule();
    return state;
  })().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export function getEntryFreeze(): EntryFreeze {
  return state;
}

function attach(): () => void {
  const refresh = () => void readEntryFreeze();
  const visible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', visible);
  const offLobby = realtimeChannelService.subscribeToLobby({ onMaintenance: refresh });
  refresh();
  return () => {
    window.removeEventListener('online', refresh);
    document.removeEventListener('visibilitychange', visible);
    offLobby();
  };
}

export function subscribeEntryFreeze(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) detach = attach();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detach?.();
      detach = null;
      if (deadline) clearTimeout(deadline);
      deadline = null;
    }
  };
}

/**
 * A refusal sentence with the reopening time in it. Any other sentence is
 * returned unchanged. Reading here also updates every Join button at once.
 */
export async function withFreezeTime(message: string): Promise<string> {
  if (message !== PLATFORM_FROZEN_MESSAGE) return message;
  const freeze = await readEntryFreeze();
  return platformFrozenMessageUntil(freeze.endsAtMs, serverNow());
}

/** The same, for a raw refusal error. Null when the error is not the freeze. */
export async function freezeRefusalText(err: unknown): Promise<string | null> {
  return isPlatformFrozenError(err) ? withFreezeTime(PLATFORM_FROZEN_MESSAGE) : null;
}

/** For tests only: forget the shared store. */
export function __resetEntryFreezeForTests(): void {
  state = ENTRY_OPEN;
  listeners.clear();
  inFlight = null;
  followUp = null;
  if (deadline) clearTimeout(deadline);
  deadline = null;
  detach = null;
}

export interface EntryFreezeView {
  freeze: EntryFreeze;
  /** The Join label while frozen ("Opens In 0:47"), undefined when open. */
  label: string | undefined;
  /** Whole seconds until entry reopens, or null when open or not yet certain. */
  secondsLeft: number | null;
  /** The refusal sentence for right now. */
  message: string;
}

export function useEntryFreeze(): EntryFreezeView {
  const freeze = useSyncExternalStore(subscribeEntryFreeze, getEntryFreeze, getEntryFreeze);
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    setNow(serverNow());
    if (!freeze.frozen || freeze.endsAtMs === null) return;
    const tick = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(tick);
  }, [freeze.frozen, freeze.endsAtMs]);
  return {
    freeze,
    label: entryFreezeLabel(freeze, now),
    secondsLeft:
      freeze.frozen && freeze.endsAtMs !== null && freeze.endsAtMs > now
        ? secondsUntil(freeze.endsAtMs, now)
        : null,
    message: platformFrozenMessageUntil(freeze.frozen ? freeze.endsAtMs : null, now),
  };
}
