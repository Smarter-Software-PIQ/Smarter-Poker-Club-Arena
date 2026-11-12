import { useEffect, useRef, useState } from 'react';

/**
 * LIGHTNING "LEAVE NEXT HAND" (Dan 2026-11-12): "WHEN YOU CLICK 'LEAVE NEXT
 * HAND' ... IT MEANS AFTER THE END OF THE CURRENT HAND, YOU LEAVE THE TABLE.
 * NOT AT THAT EXACT MOMENT."
 *
 * True while the leave must wait: the player is still live in the hand in
 * front of them. The hand is over for them once it settles, once they fold,
 * or once the room itself has closed; then the leave runs.
 */
export function lightningLeaveWaitsForHand(input: {
  inLightningRoom: boolean;
  roomClosed: boolean;
  handInProgress: boolean;
  handSettling: boolean;
  heroStatus: string | null | undefined;
}): boolean {
  return (
    input.inLightningRoom &&
    !input.roomClosed &&
    input.handInProgress &&
    !input.handSettling &&
    !!input.heroStatus &&
    input.heroStatus !== 'folded'
  );
}

type QueueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** One queued leave per player per pool session (stable across Lightning rooms). */
export function lightningLeaveQueueKey(userId: string, poolSessionId: string): string {
  return `ca:lightning-leave-after-hand:v1:${userId}:${poolSessionId}`;
}

function defaultStorage(): QueueStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function readQueued(storage: QueueStorage | null, key: string | null): boolean {
  if (!key || !storage) return false;
  try {
    return storage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * The queued Lightning leave, owned outside the button so it survives the
 * button, a reconnect and a page reload (Dan 2026-11-12). The intent is
 * saved per pool session; it runs `leave` exactly once, when the page is
 * ready to read the seat (`ready`) and the player's hand is over (`!waits`).
 * `clear` withdraws it (a cancel, or another door already leaving).
 */
export function useLightningLeaveAfterHand(input: {
  userId: string | null | undefined;
  poolSessionId: string | null | undefined;
  ready: boolean;
  waits: boolean;
  leave: () => unknown;
  alreadyLeaving?: () => boolean;
  onError?: (error: unknown) => void;
  storage?: QueueStorage | null;
}) {
  const storage = input.storage === undefined ? defaultStorage() : input.storage;
  const key =
    input.userId && input.userId !== 'guest' && input.poolSessionId
      ? lightningLeaveQueueKey(input.userId, input.poolSessionId)
      : null;
  const [state, setState] = useState(() => ({ key, queued: readQueued(storage, key) }));
  // A different pool session (or player) reads its own saved intent.
  const queued = state.key === key ? state.queued : readQueued(storage, key);
  if (state.key !== key) setState({ key, queued });
  const latest = useRef(input);
  latest.current = input;

  const write = (value: boolean) => {
    if (key && storage) {
      try {
        if (value) storage.setItem(key, '1');
        else storage.removeItem(key);
      } catch {
        /* Memory still holds the intent for this page. */
      }
    }
    setState({ key, queued: value });
  };
  const queue = () => write(true);
  const clear = () => write(false);

  useEffect(() => {
    if (!queued || !input.ready || input.waits) return;
    write(false);
    const { leave, alreadyLeaving, onError } = latest.current;
    if (alreadyLeaving?.()) return;
    try {
      void Promise.resolve(leave()).catch((error: unknown) => onError?.(error));
    } catch (error) {
      onError?.(error);
    }
    // write is recreated each render; the boundary itself is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, input.ready, input.waits, key]);

  return { queued, queue, clear };
}
