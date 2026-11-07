import { useEffect, useRef, useState } from 'react';
import { fetchMyHandsOwed, owedHands } from '../lib/hitAndRun';
import { fetchMyLightningSession, lightningAnchorSeat } from '../lightning/lightningSession';

/** The count is read once the hand's settlement has had time to land. */
export const HAND_COUNT_REFRESH_DELAY_MS = 1500;

/**
 * HIT AND RUN (owner 2026-11-06): the hero's hands still owed in profit,
 * refreshed after every completed hand so the felt counts it down.
 *
 * A classic table's engine carries the count on the hero's seat
 * (`engineHands`: a number, or null for none owed); that answer is used as
 * is. A Lightning room is not the seat's table, and its count moves at every
 * Lightning settlement, so it is read from the database for the player's
 * anchor table after each hand (`engineHands` undefined).
 */
export function useHeroHandCount(opts: {
  enabled: boolean;
  tableId: string | null | undefined;
  lightningClusterId: string | null | undefined;
  handNumber: number;
  engineHands: number | null | undefined;
}): number | null {
  const { enabled, tableId, lightningClusterId, handNumber, engineHands } = opts;
  const [read, setRead] = useState<number | null>(null);
  const anchorRef = useRef<{ clusterId: string; tableId: string } | null>(null);
  const useEngine = engineHands !== undefined && !lightningClusterId;

  useEffect(() => {
    if (!enabled || useEngine || !tableId) {
      setRead(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      let target: string | null = tableId;
      if (lightningClusterId) {
        target =
          anchorRef.current?.clusterId === lightningClusterId ? anchorRef.current.tableId : null;
        if (!target) {
          try {
            const anchor = lightningAnchorSeat(await fetchMyLightningSession(lightningClusterId));
            if (anchor) {
              anchorRef.current = { clusterId: lightningClusterId, tableId: anchor.anchorTableId };
              target = anchor.anchorTableId;
            }
          } catch {
            target = null;
          }
        }
      }
      if (!target || cancelled) return;
      const owed = await fetchMyHandsOwed(target);
      if (!cancelled) setRead(owed);
    }, HAND_COUNT_REFRESH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, useEngine, tableId, lightningClusterId, handNumber]);

  if (!enabled) return null;
  return useEngine ? owedHands(engineHands) : read;
}
