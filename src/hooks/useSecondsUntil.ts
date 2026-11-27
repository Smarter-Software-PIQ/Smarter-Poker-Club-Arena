import { useEffect, useState } from 'react';

/** How often the countdown re-reads the wall clock. */
export const SECONDS_UNTIL_TICK_MS = 250;

/**
 * Whole seconds left until `localDeadlineMs` (a local epoch-ms instant), or null
 * when there is no deadline. Re-read every quarter second against the wall
 * clock, so a throttled tab can only be late, never drift, and the shown
 * second turns within a quarter second of the true one.
 */
export function useSecondsUntil(localDeadlineMs: number | null): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (localDeadlineMs === null) {
      setSecondsLeft(null);
      return undefined;
    }
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((localDeadlineMs - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, SECONDS_UNTIL_TICK_MS);
    return () => clearInterval(timer);
  }, [localDeadlineMs]);
  return secondsLeft;
}
