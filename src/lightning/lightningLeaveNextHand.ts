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

export type LightningLeaveCommand = 'stopping' | 'resuming';
type FinishStage = 'finishing' | 'confirmed';
type OwedStage = `owed:${number}`;
type LeaveStage = boolean | 'awaiting-hand' | LightningLeaveCommand | FinishStage | OwedStage;
type CommandOutcome = boolean | 'awaiting-hand' | 'unknown';

function readQueued(storage: QueueStorage | null, key: string | null): LeaveStage {
  if (!key || !storage) return false;
  try {
    const value = storage.getItem(key);
    if (value && /^owed:[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value.slice(5))))
      return value as OwedStage;
    return value === 'awaiting-hand' ||
      value === 'stopping' ||
      value === 'resuming' ||
      value === 'finishing' ||
      value === 'confirmed'
      ? value
      : value === '1';
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
  resuming?: boolean;
  connected?: boolean;
  performCommand?: (command: LightningLeaveCommand) => Promise<CommandOutcome>;
  finish?: (
    confirmed: boolean,
    stillCurrent: () => boolean
  ) => Promise<number | 'accepted' | 'unknown'>;
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

  const revision = useRef(0);
  const persistent = useRef(true);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (key && (event.key === key || event.key === null)) {
        setState({ key, queued: readQueued(storage, key) });
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key, storage]);
  const stillRequested = (expected: LeaveStage) => {
    if (!storage || !key || !persistent.current) return true;
    const current = readQueued(storage, key);
    if (current === expected) return true;
    setState({ key, queued: current });
    return false;
  };
  const activeKey = useRef(key);
  activeKey.current = key;
  const hydrated = useRef<string | null>(null);
  if (input.ready) hydrated.current = key;
  const canFinish = !!key && hydrated.current === key;
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const write = (value: LeaveStage) => {
    revision.current++;
    if (key && storage) {
      try {
        if (value) storage.setItem(key, value === true ? '1' : value);
        else storage.removeItem(key);
        persistent.current = true;
      } catch {
        persistent.current = false;
        /* Memory still holds the intent for this page. */
      }
    }
    setState({ key, queued: value });
  };
  const queue = (awaitingHand = false) => write(awaitingHand ? 'awaiting-hand' : true);
  const clear = () => write(false);
  const command = queued === 'stopping' || queued === 'resuming' ? queued : null;
  const finishing = queued === 'finishing' || queued === 'confirmed' ? queued : null;
  const owed =
    typeof queued === 'string' && queued.startsWith('owed:') ? Number(queued.slice(5)) : null;
  const decide = (leave: boolean) => {
    if (owed && stillRequested(queued)) write(leave ? 'confirmed' : 'resuming');
  };
  const request = (desired: LightningLeaveCommand) => {
    if (finishing === 'confirmed' || command === desired) setRetry((n) => n + 1);
    else write(desired);
  };
  // Write desired state before sending the idempotent RPC. An unknown reply
  // survives reload; while a cancellation is unresolved no cashout can run.
  useEffect(() => {
    const perform = latest.current.performCommand;
    const stage = finishing ?? command;
    if (!stage || !key || input.connected === false || (finishing && !canFinish)) return;
    const version = revision.current;
    let active = true;
    setBusy(true);
    const send = async () => {
      const current = () =>
        active &&
        activeKey.current === key &&
        revision.current === version &&
        stillRequested(stage);
      if (!current()) return;
      if (finishing && latest.current.finish) {
        const result = await latest.current.finish(finishing === 'confirmed', current);
        if (current() && result !== 'unknown')
          write(result === 'accepted' ? false : `owed:${result}`);
      } else if (command && perform) {
        const outcome = await perform(command);
        if (current() && outcome !== 'unknown') write(outcome);
      }
    };
    // Keep an unanswered Stop in one tab ordered ahead of Stay in another.
    // Recheck the durable selection only after acquiring this session's lock.
    void (navigator.locks ? navigator.locks.request(key, send) : send())
      .catch((error) => latest.current.onError?.(error))
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [command, finishing, key, input.connected, finishing && canFinish, retry]);
  useEffect(() => {
    if (!command && !finishing) setBusy(false);
  }, [command, finishing]);

  useEffect(() => {
    if (
      !queued ||
      command ||
      finishing ||
      owed ||
      !input.ready ||
      input.resuming ||
      !stillRequested(queued)
    )
      return;
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
    if (latest.current.finish) {
      write('finishing');
      return;
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
  }, [queued, input.ready, input.waits, input.roomClosed, input.resuming, key]);

  return { queued: Boolean(queued), queue, clear, command, request, busy, owed, decide };
}
