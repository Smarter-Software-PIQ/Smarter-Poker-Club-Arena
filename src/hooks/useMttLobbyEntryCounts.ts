import { useEffect, useMemo, useState } from 'react';
import type { LobbyEntry } from '../components/lobby/lobbyEntries';
import { supabase } from '../lib/supabase';
import { runWithRequestDeadline } from '../utils/requestDeadline';
import { reportError } from '../utils/errorReporter';

/** One bounded aggregate for the board, refreshed by its existing committed
 * tournament events (registration/seat count and rebuy prize-pool updates).
 * No per-event roster downloads, additional channels or polling loop. */
export function useMttLobbyEntryCounts(rows: LobbyEntry[]): LobbyEntry[] {
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [readFailed, setReadFailed] = useState(false);
  const signature = JSON.stringify(
    rows
      .filter((row) => row.kind === 'mtt')
      .map((row) => {
        const raw = row.raw as { prize_pool?: number; bounty_pool?: number; updated_at?: string };
        return [row.id, row.players, raw.prize_pool, raw.bounty_pool, raw.updated_at, row.status];
      })
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );
  useEffect(() => {
    const ids = (JSON.parse(signature) as unknown[][]).map((row) => String(row[0]));
    if (!ids.length) return;
    let cancelled = false;
    let inFlight = false;
    let trailing = false;
    const read = async () => {
      if (inFlight) {
        trailing = true;
        return;
      }
      inFlight = true;
      try {
        const next = new Map<string, number>();
        for (let start = 0; start < ids.length; start += 200) {
          const batch = ids.slice(start, start + 200);
          const { data, error } = await runWithRequestDeadline((signal) =>
            supabase
              .rpc('fn_mtt_lobby_entry_counts', { p_tournament_ids: batch })
              .abortSignal(signal)
          );
          if (cancelled) return;
          if (error) throw error;
          if (!Array.isArray(data)) throw new Error('Tournament entry counts unavailable');
          for (const answer of data as { tournament_id: string; entries: number | string }[]) {
            const count = Number(answer.entries);
            if (!batch.includes(answer.tournament_id) || !Number.isSafeInteger(count) || count < 0)
              throw new Error('Invalid tournament entry count');
            next.set(answer.tournament_id, count);
          }
          if (batch.some((id) => !next.has(id)))
            throw new Error('Incomplete tournament entry counts');
        }
        if (!cancelled) {
          setCounts(next);
          setReadFailed(false);
        }
      } catch (error) {
        if (!cancelled) {
          setReadFailed(true);
          reportError(error, 'useMttLobbyEntryCounts.unreadable');
        }
      } finally {
        inFlight = false;
        if (trailing && !cancelled) {
          trailing = false;
          void read();
        }
      }
    };
    void read();
    const onVisible = () => {
      if (!document.hidden) void read();
    };
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [signature]);
  return useMemo(
    () =>
      rows.map((row) =>
        row.kind === 'mtt'
          ? { ...row, entryCount: counts.get(row.id) ?? null, entryCountStale: readFailed }
          : row
      ),
    [rows, counts, readFailed]
  );
}
