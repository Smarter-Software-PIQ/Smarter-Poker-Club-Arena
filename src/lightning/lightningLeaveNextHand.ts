import { useEffect, useRef, useState } from 'react';

import {
  isLightningIdleSnapshot,
  lightningHandId,
  type LightningSnapshotFields,
} from './lightningHand';

/** Use the room snapshot and this hand's settlement. Presentation can still
 * show the previous hand during a reconnect or the transition between deals. */
export function lightningLeaveWaitsForHand(
  snapshot: LightningSnapshotFields | null | undefined,
  settledHandId: string | null,
  userId: string | null | undefined
): boolean {
  if (!snapshot || isLightningIdleSnapshot(snapshot)) return false;
  if (settledHandId && lightningHandId(snapshot) === settledHandId) return false;
  return (
    !Array.isArray(snapshot.players) ||
    !snapshot.players.some((player) => player?.user_id === userId && player.is_folded === true)
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

function readQueued(
  storage: QueueStorage | null,
  key: string | null
): false | true | 'awaiting-hand' {
  if (!key || !storage) return false;
  try {
    const value = storage.getItem(key);
    return value === 'awaiting-hand' ? value : value === '1';
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
  roomClosed?: boolean;
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

  const write = (value: boolean | 'awaiting-hand') => {
    if (key && storage) {
      try {
        if (value) storage.setItem(key, value === true ? '1' : value);
        else storage.removeItem(key);
      } catch {
        /* Memory still holds the intent for this page. */
      }
    }
    setState({ key, queued: value });
  };
  const queue = (awaitingHand = false) => write(awaitingHand ? 'awaiting-hand' : true);
  const clear = () => write(false);

  useEffect(() => {
    if (!queued || !input.ready) return;
    if (!input.roomClosed) {
      if (input.waits) {
        if (queued === 'awaiting-hand') write(true);
        return;
      }
      // The server can already hold a deal or reservation while this client
      // still has the previous idle snapshot. Only a subsequent live hand
      // followed by its boundary, or the closed pool, releases that receipt.
      if (queued === 'awaiting-hand') return;
    }
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
  }, [queued, input.ready, input.waits, input.roomClosed, key]);

  return { queued: Boolean(queued), queue, clear };
}
