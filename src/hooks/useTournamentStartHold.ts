import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '../lib/supabase';
import { reportError } from '../utils/errorReporter';
import { TOURNAMENT_START_HOLD_MESSAGE } from '../config/tournamentStartHold';

export const MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE = TOURNAMENT_START_HOLD_MESSAGE;

export interface TournamentStartHoldStatus {
  blocked: boolean;
  reason: string | null;
  requestedAt: string | null;
  popupMessage: string | null;
}

const DEFAULT_HOLD_STATUS: TournamentStartHoldStatus = {
  blocked: false,
  reason: null,
  requestedAt: null,
  popupMessage: null,
};

let cachedStatus: TournamentStartHoldStatus | null = null;
let cachedAtMs: number | null = null;
let inFlightPromise: Promise<TournamentStartHoldStatus> | null = null;

const CACHE_TTL_MS = 10_000;
const listeners = new Set<() => void>();

function refresh() {
  return readTournamentStartHoldStatus({ force: true });
}

function subscribe(listener: () => void) {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    }
  };
}

const subscribeDisabled = () => () => {};

function getSnapshot() {
  return cachedStatus;
}

function normalizeHoldRow(raw: unknown): TournamentStartHoldStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.blocked !== 'boolean') return null;
  const blocked = record.blocked;
  const reason = typeof record.reason === 'string' && record.reason.trim() ? record.reason : null;
  const requestedAt =
    typeof record.requested_at === 'string' && record.requested_at.trim()
      ? record.requested_at
      : null;
  const popupMessage = blocked
    ? typeof record.popup_message === 'string' && record.popup_message.trim()
      ? record.popup_message
      : MIDWAY_MTT_SERVER_UPDATE_POPUP_MESSAGE
    : null;
  return {
    blocked,
    reason,
    requestedAt,
    popupMessage,
  };
}

export async function readTournamentStartHoldStatus(options?: {
  force?: boolean;
}): Promise<TournamentStartHoldStatus> {
  const force = options?.force === true;
  if (!force && inFlightPromise) return inFlightPromise;
  if (!force && cachedStatus && cachedAtMs !== null && Date.now() - cachedAtMs < CACHE_TTL_MS) {
    return cachedStatus;
  }
  if (typeof supabase?.rpc !== 'function') return cachedStatus ?? DEFAULT_HOLD_STATUS;

  const request = Promise.resolve().then(async (): Promise<TournamentStartHoldStatus> => {
    let next: TournamentStartHoldStatus | null = null;
    try {
      const { data, error } = await supabase.rpc('fn_get_tournament_start_hold_status');
      if (error) {
        reportError(error, 'useTournamentStartHold.readTournamentStartHoldStatus');
      } else {
        next = normalizeHoldRow(data);
      }
    } catch (err) {
      reportError(err, 'useTournamentStartHold.readTournamentStartHoldStatus_exception');
    }

    // A focus or entry refresh can supersede a read that started before it.
    // Superseded callers use the winning result too, so they cannot admit an
    // entry based on an older open response.
    if (inFlightPromise !== request) {
      return inFlightPromise ?? cachedStatus ?? DEFAULT_HOLD_STATUS;
    }

    inFlightPromise = null;
    if (next) {
      cachedStatus = next;
      cachedAtMs = Date.now();
    }
    cachedStatus ??= DEFAULT_HOLD_STATUS;
    listeners.forEach((listener) => listener());
    return cachedStatus;
  });

  inFlightPromise = request;
  return request;
}

export function resetTournamentStartHoldCacheForTests(): void {
  cachedStatus = null;
  cachedAtMs = null;
  inFlightPromise = null;
}

export function useTournamentStartHold(enabled = true): TournamentStartHoldStatus & {
  loading: boolean;
  refresh: () => Promise<TournamentStartHoldStatus>;
} {
  const status = useSyncExternalStore(
    enabled ? subscribe : subscribeDisabled,
    getSnapshot,
    getSnapshot
  );

  useEffect(() => {
    if (enabled) void readTournamentStartHoldStatus();
  }, [enabled]);

  return {
    ...(status ?? DEFAULT_HOLD_STATUS),
    loading: enabled && status === null,
    refresh,
  };
}
