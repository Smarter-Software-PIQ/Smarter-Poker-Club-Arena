import { useCallback, useMemo } from 'react';
import { useAuthUser } from './useAuthUser';
import { readMemberPromoPlayThrough } from '../services/PromoPlayThroughService';
import { useRequestedPromoRead } from './useRequestedPromoRead';

export function useMemberPromoPlayThrough(clubId: string | null, userIds: readonly string[]) {
  const { user } = useAuthUser();
  const ids = JSON.stringify([...new Set(userIds)].sort());
  const allowedIds = useMemo<readonly string[]>(() => JSON.parse(ids), [ids]);
  const read = useCallback(
    (requestedIds: readonly string[], signal: AbortSignal) =>
      readMemberPromoPlayThrough(clubId!, requestedIds, signal),
    [clubId]
  );
  const { result, request } = useRequestedPromoRead(
    JSON.stringify([clubId, user?.id, ids]),
    read,
    'useMemberPromoPlayThrough.read'
  );

  const checkMember = useCallback(
    (id: string) => {
      if (clubId && user?.id && allowedIds.includes(id)) return request([id]);
    },
    [clubId, user?.id, allowedIds, request]
  );
  const reload = useCallback(() => {
    if (clubId && user?.id && allowedIds.length) return request(allowedIds);
  }, [clubId, user?.id, allowedIds, request]);
  return {
    members: result?.value ?? undefined,
    requested: result !== null,
    requestedIds: result?.input ?? [],
    loading: result?.loading ?? false,
    error: result?.error ?? false,
    checkMember,
    reload,
  };
}
