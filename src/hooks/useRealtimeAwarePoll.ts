import { useEffect, useRef } from 'react';
import {
  REALTIME_SAFETY_POLL_MS,
  startRealtimeAwarePoll,
  type RealtimeAwarePoll,
} from '../lib/realtimeAwarePoll';

export interface UseRealtimeAwarePollOptions {
  /** False parks the poll entirely (closed surface, no user). */
  enabled?: boolean;
  /** Whether the realtime channel this poll backs up is SUBSCRIBED now. */
  live: boolean;
  /** Cadence while the channel is not live. */
  fastMs: number;
  /** Cadence while live; `null` stops the poll while live. */
  slowMs?: number | null;
}

/**
 * React face of `startRealtimeAwarePoll` (src/lib/realtimeAwarePoll.ts): fast
 * while the channel is down, slow (or stopped) while it is SUBSCRIBED, fast
 * again the moment it drops. The latest `poll` is always the one called, so a
 * caller may pass an inline closure without restarting the timer.
 */
export function useRealtimeAwarePoll(
  poll: () => void,
  { enabled = true, live, fastMs, slowMs = REALTIME_SAFETY_POLL_MS }: UseRealtimeAwarePollOptions
): void {
  const pollRef = useRef(poll);
  pollRef.current = poll;
  const liveRef = useRef(live);
  liveRef.current = live;
  const handleRef = useRef<RealtimeAwarePoll | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    const handle = startRealtimeAwarePoll(() => pollRef.current(), {
      fastMs,
      slowMs,
      live: liveRef.current,
    });
    handleRef.current = handle;
    return () => {
      handle.stop();
      if (handleRef.current === handle) handleRef.current = null;
    };
  }, [enabled, fastMs, slowMs]);

  useEffect(() => {
    handleRef.current?.setLive(live);
  }, [live]);
}
