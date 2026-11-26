import { useEffect, useState } from 'react';
import { useMasterBusSubscriptions } from './useMasterBusSubscription';
import { readCashierMintScope, type CashierMintScope } from '../services/cashierMintScope';

/** A permission read belongs to the exact account and treasury being displayed. */
export function useCashierMintScope(entityId?: string | null, userId?: string | null) {
  const [result, setResult] = useState<{
    entityId: string;
    userId: string;
    scope: CashierMintScope | null;
  } | null>(null);
  const [revision, setRevision] = useState(0);
  useMasterBusSubscriptions(
    entityId && userId ? ['CLUB_UPDATED', 'UNION_UPDATED', 'MEMBER_ROLE_CHANGED'] : [],
    (payload) => {
      const event = payload as { clubId?: string; unionId?: string } | null;
      if (entityId && (event?.clubId === entityId || event?.unionId === entityId)) {
        setResult(null);
        setRevision((previous) => previous + 1);
      }
    }
  );
  useEffect(() => {
    let current = true;
    setResult(null);
    if (entityId && userId) {
      void readCashierMintScope(entityId).then((scope) => {
        if (current) setResult({ entityId, userId, scope });
      });
    }
    return () => {
      current = false;
    };
  }, [entityId, userId, revision]);
  return result && result.entityId === entityId && result.userId === userId ? result.scope : null;
}
