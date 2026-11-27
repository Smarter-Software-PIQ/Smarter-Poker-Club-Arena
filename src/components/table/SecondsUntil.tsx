import { useEffect, useState, type ReactNode } from 'react';

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

/**
 * THE CLOCK LIVES WHERE IT IS READ (2026-11-27). The bust rebuy countdown used
 * to tick in LiveTablePage itself, so every second of a rebuy window
 * re-rendered the whole table (one LiveTablePage per open table when
 * multi-tabling) to change one number on one sheet. The deadline is handed
 * down instead, and only this wrapper and what it renders re-render as the
 * seconds turn. The value it passes is computed exactly as before.
 */
export function SecondsUntil({
  localDeadlineMs,
  children,
}: {
  localDeadlineMs: number | null;
  children: (secondsLeft: number | null) => ReactNode;
}) {
  const secondsLeft = useSecondsUntil(localDeadlineMs);
  return <>{children(secondsLeft)}</>;
}
