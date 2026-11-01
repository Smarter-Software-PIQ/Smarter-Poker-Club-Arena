/**
 * The multi-day stage view for one event, read only when the multi-day
 * capability is available. Every multi-day surface uses this pair of gates:
 * the capability says the platform runs multi-day events at all, and the view
 * says THIS event has a sealed plan. Either one missing, nothing is shown.
 *
 * `refreshKey` re-reads the view when something the caller already watches
 * changes (the tournament status moving RUNNING -> BAGGED -> RUNNING); there is
 * no polling here.
 */
import { useCallback, useEffect, useState } from 'react';
import { usePlatformCapability } from './usePlatformCapability';
import { MULTI_DAY_CAPABILITY } from '../utils/multiDaySchedule';
import {
  readTournamentStageView,
  type TournamentStageView,
} from '../services/TournamentStageService';

export interface StageViewState {
  /** Present only when the capability is available and the event has a plan. */
  view: TournamentStageView | null;
  loading: boolean;
  /** Failed/refused reads cannot establish that this is an ordinary first day. */
  unknown: boolean;
  reload: () => void;
}

export function useTournamentStageView(
  tournamentId: string | null | undefined,
  refreshKey: unknown = null
): StageViewState {
  const gate = usePlatformCapability(MULTI_DAY_CAPABILITY);
  const [answer, setAnswer] = useState<{
    tournamentId: string;
    refreshKey: unknown;
    nonce: number;
    view: TournamentStageView | null;
    loading: boolean;
    unknown: boolean;
  } | null>(null);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (gate !== 'available' || !tournamentId) {
      setAnswer(null);
      return;
    }
    let live = true;
    const controller = new AbortController();
    const scope = { tournamentId, refreshKey, nonce };
    setAnswer({ ...scope, view: null, loading: true, unknown: false });
    void readTournamentStageView(tournamentId, controller.signal).then(
      (read) => {
        if (!live) return;
        setAnswer({
          ...scope,
          view: read.status === 'ok' && read.view.plan ? read.view : null,
          loading: false,
          unknown: read.status !== 'ok',
        });
      },
      () => {
        if (live) setAnswer({ ...scope, view: null, loading: false, unknown: true });
      }
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [gate, tournamentId, refreshKey, nonce]);

  // Effects run after rendering: an old event/status must never be projected
  // into the new scope while its read is still being started.
  const current =
    gate === 'available' &&
    tournamentId &&
    answer?.tournamentId === tournamentId &&
    Object.is(answer.refreshKey, refreshKey) &&
    answer.nonce === nonce;
  return {
    view: current ? answer.view : null,
    loading:
      gate === 'loading' ||
      (gate === 'available' && Boolean(tournamentId) && (!current || answer.loading)),
    unknown: gate === 'unknown' || Boolean(current && answer.unknown),
    reload,
  };
}

/**
 * The same two gates for a handful of events at once (the lobby's bagged
 * cards). Only the ids given are read; a lobby passes just its BAGGED rows.
 */
export function useTournamentStageViews(
  ids: readonly string[]
): Record<string, TournamentStageView> {
  const gate = usePlatformCapability(MULTI_DAY_CAPABILITY);
  const [answer, setAnswer] = useState<{
    key: string;
    views: Record<string, TournamentStageView>;
  } | null>(null);
  const key = [...ids].sort().join(',');

  useEffect(() => {
    if (gate !== 'available' || key === '') {
      setAnswer(null);
      return;
    }
    let live = true;
    const controller = new AbortController();
    setAnswer(null);
    void Promise.all(
      key.split(',').map((id) => readTournamentStageView(id, controller.signal))
    ).then(
      (reads) => {
        if (!live) return;
        const next: Record<string, TournamentStageView> = {};
        for (const read of reads) {
          if (read.status === 'ok' && read.view.plan) next[read.view.tournamentId] = read.view;
        }
        setAnswer({ key, views: next });
      },
      () => {
        if (live) setAnswer({ key, views: {} });
      }
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [gate, key]);

  return gate === 'available' && answer?.key === key ? answer.views : {};
}
