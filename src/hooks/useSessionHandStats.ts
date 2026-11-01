import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useMasterBusSubscription } from './useMasterBusSubscription';
import { reportError } from '../utils/errorReporter';

export interface SessionHandStats {
  handsPlayed: number;
  handsWon: number | null;
  vpipPercent: number | null;
  pfrPercent: number | null;
  startedAt: string;
  throughAt?: string;
}

/** One persisted, self-only snapshot. Never mix a mount counter into its denominator. */
export function parseSessionHandStats(value: unknown): SessionHandStats | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const rate = (n: unknown) =>
    n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100);
  if (
    !count(row.hands_played) ||
    !(row.hands_won === null || count(row.hands_won)) ||
    !rate(row.vpip_percent) ||
    !rate(row.pfr_percent) ||
    typeof row.started_at !== 'string' ||
    !Number.isFinite(Date.parse(row.started_at))
  )
    return null;
  return {
    handsPlayed: row.hands_played as number,
    handsWon: row.hands_won as number | null,
    vpipPercent: row.vpip_percent as number | null,
    pfrPercent: row.pfr_percent as number | null,
    startedAt: row.started_at,
    throughAt:
      typeof row.through_at === 'string' && Number.isFinite(Date.parse(row.through_at))
        ? row.through_at
        : undefined,
  };
}

export function useSessionHandStats(
  tableId: string | undefined,
  userId: string,
  enabled: boolean,
  asOf?: number,
  refreshRevision?: string
) {
  const key =
    enabled && tableId && userId && userId !== 'guest'
      ? `${userId}:${tableId}:${asOf ?? 'live'}`
      : '';
  const currentKey = useRef(key);
  currentKey.current = key;
  const sequence = useRef(0);
  const [result, setResult] = useState<{ key: string; stats: SessionHandStats | null }>({
    key: '',
    stats: null,
  });
  const refresh = useCallback(async () => {
    if (!key || !tableId) return;
    const request = ++sequence.current;
    try {
      const { getLightningPoolSession } = await import('../lightning/lightningSession');
      if (request !== sequence.current || currentKey.current !== key) return;
      const lightning = !!getLightningPoolSession(tableId);
      const { data: raw, error } = lightning
        ? await supabase.rpc('fn_lightning_session_stats', { p_pool_session_id: tableId })
        : await supabase.rpc('fn_my_game_session_hand_stats', {
            p_table_id: tableId,
            ...(asOf === undefined ? {} : { p_as_of: new Date(asOf).toISOString() }),
          });
      const data =
        lightning && raw
          ? {
              hands_played: raw.hands,
              hands_won: null,
              vpip_percent: raw.vpip,
              pfr_percent: raw.pfr,
              started_at: raw.started_at,
              through_at: raw.ended_at ?? new Date().toISOString(),
            }
          : raw;
      if (request !== sequence.current || currentKey.current !== key) return;
      if (error) throw error;
      const stats = parseSessionHandStats(data);
      if (!stats && data !== null) throw new Error('Invalid Session Hand Statistics');
      setResult({ key, stats });
    } catch (error) {
      if (request !== sequence.current || currentKey.current !== key) return;
      reportError(error, 'useSessionHandStats.read');
      setResult({ key, stats: null });
    }
  }, [key, tableId, asOf]);

  useEffect(() => {
    void refresh();
    const visible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', visible);
    return () => {
      ++sequence.current;
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [refresh, refreshRevision]);
  useMasterBusSubscription('HAND_COMPLETED', (payload) => {
    if (payload.tableId === tableId) void refresh();
  });
  // The presentation completion precedes persistence. Unlock follows the
  // original settlement transaction, including a final hand with no successor.
  useMasterBusSubscription('TABLE_UNLOCKED', (payload) => {
    if ((payload.tableId ?? payload.table_id) === tableId) void refresh();
  });
  useMasterBusSubscription('WS_CONNECTED', () => {
    void refresh();
  });
  useMasterBusSubscription('SESSION_ENDED', (payload) => {
    if (payload.tableId === tableId && payload.userId === userId) void refresh();
  });
  return { stats: key && result.key === key ? result.stats : null, refresh };
}
