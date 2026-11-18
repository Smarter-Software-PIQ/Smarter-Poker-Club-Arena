import { useCallback, useEffect } from 'react';
import { readMyPromoPlayThrough } from '../services/PromoPlayThroughService';
import { useRequestedPromoRead } from './useRequestedPromoRead';

export function usePromoPlayThrough(
  clubId: string | null | undefined,
  userId: string | undefined,
  cashoutRequested = false
) {
  const read = useCallback(
    (_input: undefined, signal: AbortSignal) => readMyPromoPlayThrough(clubId!, signal),
    [clubId]
  );
  const { result, request } = useRequestedPromoRead(
    JSON.stringify([clubId, userId]),
    read,
    'usePromoPlayThrough.read'
  );
  const reload = useCallback(() => {
    if (clubId && userId) return request(undefined);
  }, [clubId, userId, request]);

  useEffect(() => {
    if (!cashoutRequested) return;
    let current = true;
    queueMicrotask(() => {
      if (current) void reload();
    });
    return () => {
      current = false;
    };
  }, [cashoutRequested, reload]);

  return {
    summary: result?.value ?? null,
    requested: result !== null,
    loading: result?.loading ?? false,
    error: result?.error ?? false,
    reload,
  };
}
