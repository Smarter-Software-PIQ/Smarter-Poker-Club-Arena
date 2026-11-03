import { useCallback, useEffect, useState } from 'react';
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
let cachedAtMs = 0;
let inFlightPromise: Promise<TournamentStartHoldStatus> | null = null;

const CACHE_TTL_MS = 10_000;

function normalizeHoldRow(raw: unknown): TournamentStartHoldStatus {
  if (!raw || typeof raw !== 'object') return DEFAULT_HOLD_STATUS;
  const record = raw as Record<string, unknown>;
  const blocked = record.blocked === true;
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
  const now = Date.now();
  if (!force && cachedStatus && now - cachedAtMs < CACHE_TTL_MS) {
    return cachedStatus;
  }
  if (!force && inFlightPromise) {
    return inFlightPromise;
  }

  let request: Promise<TournamentStartHoldStatus> | null = null;
  request = (async (): Promise<TournamentStartHoldStatus> => {
    try {
      if (typeof supabase?.rpc !== 'function') {
        return cachedStatus ?? DEFAULT_HOLD_STATUS;
      }
      const { data, error } = await supabase.rpc('fn_get_tournament_start_hold_status');
      if (error) {
        reportError(error, 'useTournamentStartHold.readTournamentStartHoldStatus');
        return cachedStatus ?? DEFAULT_HOLD_STATUS;
      }
      const next = normalizeHoldRow(data);
      cachedStatus = next;
      cachedAtMs = Date.now();
      return next;
    } catch (err) {
      reportError(err, 'useTournamentStartHold.readTournamentStartHoldStatus_exception');
      return cachedStatus ?? DEFAULT_HOLD_STATUS;
    } finally {
      if (inFlightPromise === request) {
        inFlightPromise = null;
      }
    }
  })();

  inFlightPromise = request;
  return request;
}

export function resetTournamentStartHoldCacheForTests(): void {
  cachedStatus = null;
  cachedAtMs = 0;
  inFlightPromise = null;
}

export function useTournamentStartHold(enabled = true): TournamentStartHoldStatus & {
  loading: boolean;
  refresh: () => Promise<TournamentStartHoldStatus>;
} {
  const [status, setStatus] = useState<TournamentStartHoldStatus>(
    () => cachedStatus ?? DEFAULT_HOLD_STATUS
  );
  const [loading, setLoading] = useState<boolean>(() => enabled && cachedStatus === null);

  const refresh = useCallback(async () => {
    const next = await readTournamentStartHoldStatus({ force: true });
    setStatus(next);
    setLoading(false);
    return next;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let alive = true;
    void readTournamentStartHoldStatus().then((next) => {
      if (!alive) return;
      setStatus(next);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return {
    ...status,
    loading,
    refresh,
  };
}
