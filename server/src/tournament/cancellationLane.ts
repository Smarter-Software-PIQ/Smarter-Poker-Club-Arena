/**
 * THE CANCELLATION LANE IS TAKEN, NOT WAITED IN LINE FOR (2026-11-05).
 *
 * smarter_private.cancellation_lane admits a cancellation writer only with
 * pg_try_advisory_xact_lock on the global settlement lane, so it never queues
 * an exclusive request ahead of the hand settlements that hold that lane
 * shared. During play those settlements overlap almost continuously, so a
 * single attempt is refused with 55P03 CANCELLATION_GLOBAL_LANE_BUSY nearly
 * every time. Measured on 2026-11-05 against the owner-retired satellites:
 * every single-shot attempt between 16:00 and 17:30 UTC was refused, and a
 * rolled-back probe that retried every 200 ms was admitted within seconds.
 *
 * The refusal is raised before the function writes anything (the lane is the
 * first statement, and every other 55P03 in these doors is a NOWAIT lock taken
 * before the first write), so asking again inside the same request is exact,
 * never a replay. The budget sits well inside the operator request's 30 s
 * window and the attempt count is fixed: this is the live call finding a gap,
 * not a retry loop, a sweep or a timer.
 */
export const CANCELLATION_LANE_ATTEMPTS = 50;
export const CANCELLATION_LANE_PAUSE_MS = 200;

type LaneResult = { error?: { code?: string | null } | null };

export async function throughCancellationLane<T extends LaneResult>(
  call: () => PromiseLike<T>,
  pause: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): Promise<T> {
  let result = await call();
  for (
    let attempt = 1;
    attempt < CANCELLATION_LANE_ATTEMPTS && result.error?.code === '55P03';
    attempt++
  ) {
    await pause(CANCELLATION_LANE_PAUSE_MS);
    result = await call();
  }
  return result;
}
