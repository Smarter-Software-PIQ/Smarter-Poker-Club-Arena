import { useEffect, useRef, useState } from 'react';
import { fetchMyHandCount, owedHands, type HandCount } from '../lib/hitAndRun';
import { fetchMyLightningSession, lightningAnchorSeat } from '../lightning/lightningSession';

/** The count is read once the hand's settlement has had time to land. */
export const HAND_COUNT_REFRESH_DELAY_MS = 1500;

const NONE: HandCount = { owed: null, required: null };

/**
 * HIT AND RUN (owner 2026-11-06): the hero's hands still owed in profit and
 * this countdown's total, refreshed after every completed hand so the felt
 * counts it down (and the Charles Rule's added hands can be announced).
 *
 * A classic table's engine carries both on the hero's seat (`engine`); that
 * answer is used as is. A Lightning room is not the seat's table, and its
 * count moves at every Lightning settlement, so it is read from the database
 * for the player's anchor table after each hand and while waiting between
 * hands (`engine` undefined).
 */
export function useHeroHandCount(opts: {
  enabled: boolean;
  tableId: string | null | undefined;
  lightningClusterId: string | null | undefined;
  handNumber: number;
  engine: { owed: number | null; required: number | null } | undefined;
}): HandCount {
  const { enabled, tableId, lightningClusterId, handNumber, engine } = opts;
  const [read, setRead] = useState<HandCount>(NONE);
  const anchorRef = useRef<{ clusterId: string; tableId: string } | null>(null);
  const useEngine = engine !== undefined && !lightningClusterId;

  useEffect(() => {
    if (!enabled || useEngine || !tableId) {
      setRead(NONE);
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
      const count = await fetchMyHandCount(target);
      if (!cancelled) setRead(count);
    }, HAND_COUNT_REFRESH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, useEngine, tableId, lightningClusterId, handNumber]);

  if (!enabled) return NONE;
  if (!useEngine) return read;
  const owed = owedHands(engine?.owed);
  return { owed, required: owed === null ? null : owedHands(engine?.required) };
}

/**
 * THE CHARLES RULE, announced: the countdown's total went up while hands were
 * still owed, so the player doubled up and hands were added. `onAdded` is
 * called once per increase with the hands added.
 */
export function useHandsAddedByDouble(count: HandCount, onAdded: (added: number) => void): void {
  const prev = useRef<HandCount>(NONE);
  const notify = useRef(onAdded);
  notify.current = onAdded;
  useEffect(() => {
    const before = prev.current;
    prev.current = count;
    if (
      before.owed !== null &&
      before.required !== null &&
      count.owed !== null &&
      count.required !== null &&
      count.required > before.required
    )
      notify.current(count.required - before.required);
  }, [count.owed, count.required]);
}
