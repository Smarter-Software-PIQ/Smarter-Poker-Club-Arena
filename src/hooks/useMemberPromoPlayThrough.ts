import { useEffect, useState } from 'react';
import { useAuthUser } from './useAuthUser';
import { useMasterBusSubscriptions } from './useMasterBusSubscription';
import {
  readMemberPromoPlayThrough,
  type PromoPlayThroughSummary,
} from '../services/PromoPlayThroughService';
import { reportError } from '../utils/errorReporter';

/** One bounded read for the visible roster, sharing its financial authority. */
export function useMemberPromoPlayThrough(
  clubId: string | null,
  userIds: readonly string[],
  revision?: string | number
) {
  const { user } = useAuthUser();
  const ids = JSON.stringify([...new Set(userIds)].sort());
  const scope = JSON.stringify([clubId, user?.id, ids]);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    scope: string;
    members: Record<string, PromoPlayThroughSummary> | null;
  } | null>(null);
  useMasterBusSubscriptions(
    ['BALANCE_UPDATED', 'WALLET_REFRESHED', 'HAND_COMPLETED', 'REALTIME_CONNECTED'],
    () => setAttempt((n) => n + 1),
    { debounce: 250 }
  );
  useEffect(() => {
    if (!clubId || !user?.id) return;
    const controller = new AbortController();
    void readMemberPromoPlayThrough(clubId, JSON.parse(ids) as string[], controller.signal).then(
      (members) => {
        if (!controller.signal.aborted) setResult({ scope, members });
      },
      (error) => {
        if (!controller.signal.aborted) {
          reportError(error, 'useMemberPromoPlayThrough.read');
          setResult({ scope, members: null });
        }
      }
    );
    return () => controller.abort();
  }, [clubId, user?.id, ids, scope, attempt, revision]);
  return {
    members: result?.scope === scope ? result.members : undefined,
    reload: () => setAttempt((n) => n + 1),
  };
}
