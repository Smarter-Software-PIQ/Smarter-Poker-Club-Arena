import { SelectionObservationDeadline } from './selectionDeadline';

/** The existing public-health request ceiling, preserved by readiness admission. */
export const READINESS_HEALTH_READ_MS = 15_000;

/**
 * Never start a readiness read that cannot receive its existing full transport
 * budget. The poll's fixed deadline is not extended, and a late callback is not
 * a successful operational read or evidence of a production transport failure.
 */
export function readinessReadCanStart(deadline: number, now = Date.now()): boolean {
  return (
    Number.isFinite(deadline) && Number.isFinite(now) && deadline - now >= READINESS_HEALTH_READ_MS
  );
}
/** Leave a useful request interval at the tail of a progress poll. A poll
 * with less than a second left cannot start a new transport observation. */
export function remainingReadTimeout(deadline: number, now = Date.now()): number {
  const remaining = Math.floor(deadline - now);
  return remaining >= 1000 ? Math.min(READINESS_HEALTH_READ_MS, remaining) : 0;
}

/** Each chained read shares the deadline and keeps the normal 15s ceiling. */
export function readinessReadTimeout(deadline = Infinity, now = Date.now()): number {
  const timeout = remainingReadTimeout(deadline, now);
  if (!timeout) throw new SelectionObservationDeadline(null);
  return timeout;
}
