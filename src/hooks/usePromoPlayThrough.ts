import { useCallback, useEffect, useRef, useState } from 'react';
import { useMasterBusSubscriptions } from './useMasterBusSubscription';
import {
  readMyPromoPlayThrough,
  type PromoPlayThroughSummary,
} from '../services/PromoPlayThroughService';
import { reportError } from '../utils/errorReporter';

export function usePromoPlayThrough(clubId: string | null | undefined, userId: string | undefined) {
  const scope = JSON.stringify([clubId, userId]);
  const liveScope = useRef(scope);
  liveScope.current = scope;
  const generation = useRef(0);
  const [result, setResult] = useState<{
    scope: string;
    summary: PromoPlayThroughSummary | null;
    loading: boolean;
    error: boolean;
  }>({ scope, summary: null, loading: true, error: false });
  const load = useCallback(async () => {
    const sequence = ++generation.current;
    if (!clubId || !userId) return;
    setResult({ scope, summary: null, loading: true, error: false });
    try {
      const summary = await readMyPromoPlayThrough(clubId);
      if (liveScope.current === scope && sequence === generation.current) {
        setResult({ scope, summary, loading: false, error: false });
      }
    } catch (error) {
      reportError(error, 'usePromoPlayThrough.read');
      if (liveScope.current === scope && sequence === generation.current) {
        setResult({ scope, summary: null, loading: false, error: true });
      }
    }
  }, [clubId, userId, scope]);
  useEffect(() => {
    void load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  useMasterBusSubscriptions(
    [
      'BALANCE_UPDATED',
      'WALLET_REFRESHED',
      'HAND_COMPLETED',
      'TOURNAMENT_REGISTERED',
      'REALTIME_CONNECTED',
    ],
    () => {
      void load();
    },
    { debounce: 250 }
  );
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);
  return {
    summary: result.scope === scope ? result.summary : null,
    loading: result.scope !== scope || result.loading,
    error: result.scope === scope && result.error,
    reload: load,
  };
}
