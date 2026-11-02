/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  DEADLINE-FLOOR TIMER HELPER (2026-11-02)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Node's libuv `setTimeout(fn, ms)` can fire 1–2ms before the requested
 * duration has elapsed due to integer tick rounding (`uv__hrtime` vs
 * `Date.now()`). For a maintenance schedule or release-boundary timer that
 * computes `msUntil = targetEpochMs - now()`, a -1ms wakeup means `now()` at
 * callback execution is `targetEpochMs - 1`.
 *
 * Without a deadline floor:
 *   - `scheduleNextAnnouncement()` fires at `:57:59.999` instead of `:58:00.000`,
 *     shifting `intendedStartMinute` by 1 minute and throwing
 *     `scheduled_maintenance_announcement_expired`.
 *   - `startScheduledCountdown()` fires 1ms before `countdownAt` (`12:00:05.532`
 *     instead of `12:00:05.533`), shifting `breakStartedAt` and `breakEndsAt`
 *     1ms short of the announced `420,000ms` window.
 *   - `armEndTimer()` and `armSecondBreakReport()` fire before their target
 *     deadlines.
 *
 * `scheduleAtExactEpochMs` guarantees that `onDue()` is never invoked while
 * `now() < targetEpochMs`: if a timer callback wakes up early (`remaining > 0`),
 * it re-arms for `remaining` milliseconds and updates the caller's timer handle
 * via `onHandle`.
 */
export function scheduleAtExactEpochMs<THandle = NodeJS.Timeout>(
  targetEpochMs: number,
  now: () => number,
  setTimer: (fn: () => void, ms: number) => THandle,
  onHandle: (handle: THandle | null) => void,
  onDue: () => void,
  shouldContinue?: () => boolean
): THandle {
  const tick = (): void => {
    if (shouldContinue && !shouldContinue()) {
      onHandle(null);
      return;
    }
    const remaining = targetEpochMs - now();
    if (remaining > 0) {
      const nextHandle = setTimer(tick, remaining);
      onHandle(nextHandle);
      return;
    }
    onHandle(null);
    onDue();
  };
  const initialDelay = Math.max(0, targetEpochMs - now());
  const initialHandle = setTimer(tick, initialDelay);
  onHandle(initialHandle);
  return initialHandle;
}
