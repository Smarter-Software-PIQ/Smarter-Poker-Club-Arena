import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { lightningLeaveQueueKey } from './lightningLeaveNextHand';

function restore(key: string | null): number | null {
  if (!key) return null;
  try {
    const raw = window.localStorage.getItem(key);
    const hand = Number(raw);
    return raw !== null && Number.isSafeInteger(hand) && hand >= 0 ? hand : null;
  } catch {
    return null;
  }
}

function subscribeVisibility(notify: () => void) {
  document.addEventListener('visibilitychange', notify);
  return () => document.removeEventListener('visibilitychange', notify);
}
const visible = () => document.visibilityState !== 'hidden';

/** Let the existing leave owner stop matchmaking only after a new private hand is on screen. */
export function useLightningFinalDeal(input: {
  userId: string | null | undefined;
  anchor: { tableId: string; occupancyId: string } | null;
  poolSessionId?: string | null;
  currentHand: number;
  presentedHand: number | null;
  roomClosed: boolean;
  onPresented: () => Promise<void>;
  onError: () => void;
}) {
  // A feeder seat keeps its physical occupancy through pool conversion.
  const key =
    input.userId && input.userId !== 'guest' && input.anchor?.tableId && input.anchor.occupancyId
      ? lightningLeaveQueueKey(
          input.userId,
          input.anchor.tableId + '/' + input.anchor.occupancyId
        ) +
        ':next-deal:v2:' +
        (input.poolSessionId ?? 'feeder')
      : null;
  const [saved, setSaved] = useState(() => ({ key, after: restore(key) }));
  if (saved.key !== key) setSaved({ key, after: restore(key) });
  const after = saved.key === key ? saved.after : null;
  const persistent = useRef(true);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (key && (event.key === key || event.key === null)) setSaved({ key, after: restore(key) });
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key]);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const flight = useRef<string | null>(null);
  const latest = useRef(input);
  latest.current = input;
  const pageVisible = useSyncExternalStore(subscribeVisibility, visible, () => false);

  const write = (hand: number | null) => {
    if (!key) return false;
    try {
      if (hand !== null) window.localStorage.setItem(key, String(hand));
      else window.localStorage.removeItem(key);
      persistent.current = true;
    } catch {
      persistent.current = false;
    }
    setSaved({ key, after: hand });
    return true;
  };
  useEffect(() => {
    if (key === null || after === null || flight.current === key) return;
    if (input.roomClosed) {
      write(null);
      return;
    }
    if (!pageVisible || !input.presentedHand || input.presentedHand <= after) return;
    if (persistent.current && restore(key) !== after) {
      setSaved({ key, after: restore(key) });
      return;
    }
    flight.current = key;
    setPendingKey(key);
    void latest.current
      .onPresented()
      .catch(input.onError)
      .finally(() => {
        if (!persistent.current || restore(key) === after) write(null);
        if (flight.current === key) {
          setPendingKey(null);
          flight.current = null;
        }
      });
    // One stop per scope; repeated snapshots do not start another request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, after, input.presentedHand, input.roomClosed, pageVisible]);
  return {
    queued: after !== null,
    followIntoRoom: (room: string) => {
      if (!key || input.poolSessionId || !room || !key.endsWith(':feeder')) return;
      const hand = persistent.current ? restore(key) : after;
      if (hand === null) return;
      try {
        const nextKey = key.slice(0, -'feeder'.length) + room;
        window.localStorage.setItem(nextKey, String(hand));
        write(null);
      } catch {
        input.onError();
      }
    },
    pending: key !== null && pendingKey === key,
    queue: () => write(input.currentHand),
    cancel: () => {
      if (flight.current !== key) write(null);
    },
  };
}
