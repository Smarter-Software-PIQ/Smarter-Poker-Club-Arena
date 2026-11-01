import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  tournamentScheduleService,
  type TournamentScheduleRow,
} from '../services/TournamentScheduleService';

/** One read per requested union/tab scope; unknown is never an empty success. */
export function useTournamentScheduleList(unionId: string | null | undefined, enabled: boolean) {
  const scope = useMemo(() => ({ unionId, enabled }), [unionId, enabled]);
  const [result, setResult] = useState<{
    scope: typeof scope;
    rows: TournamentScheduleRow[];
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (!scope.enabled || !scope.unionId) return;
    let live = true;
    const controller = new AbortController();
    void tournamentScheduleService.listForUnion(scope.unionId, controller.signal).then(
      (rows) => {
        if (live) setResult({ scope, rows, error: null });
      },
      () => {
        if (live) setResult({ scope, rows: [], error: 'Could Not Load Recurring Schedules.' });
      }
    );
    return () => {
      live = false;
      controller.abort();
    };
  }, [scope]);

  // A completed toggle belongs only to the union whose row it changed.
  const updateActive = useCallback(
    (id: string, active: boolean) => {
      setResult((previous) =>
        previous?.scope === scope && !previous.error
          ? {
              ...previous,
              rows: previous.rows.map((row) => (row.id === id ? { ...row, active } : row)),
            }
          : previous
      );
    },
    [scope]
  );
  const current = scope.enabled && scope.unionId && result?.scope === scope ? result : null;
  return {
    schedules: current?.rows ?? [],
    loading: Boolean(scope.enabled && scope.unionId && !current),
    error: current?.error ?? null,
    updateActive,
  };
}
