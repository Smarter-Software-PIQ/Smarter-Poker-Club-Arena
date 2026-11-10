/**
 * WHY A HORSE DECISION FELL BACK, AS A CLOSED SET (2026-11-09).
 *
 * `poker_horse_decision_fallbacks_total` counted every rejected FAST decision
 * as one number. HorseDecisionFallbacks fired at 91 a minute while the worker
 * health read expiredJobs 0, queueDepth 0 and recoverableRequestErrors 0, and
 * nothing on `/metrics` said which rejection path the seats were taking.
 *
 * The counter now carries `reason`, one of the fixed values below. A rejection
 * is named where it is produced (a non-enumerable stamp on the error, first
 * stamp wins) and read back by `horseDecisionFallbackReason`, a pure function
 * that never looks at a message. An error nobody stamped is `unknown`; the
 * label set cannot grow at runtime.
 *
 * This module is observability only. It does not change which decisions fall
 * back, what the seat does when one does, or what is reported to telemetry.
 */
import { HorseRequestCapacityError } from './requestRetentionBudget.js';

export const HORSE_DECISION_FALLBACK_REASONS = [
  /** The job used its whole queue-plus-compute deadline (HorseDecisionExpiredError). */
  'expired',
  /** Request size or retention allowance refused (HorseRequestCapacityError). */
  'capacity_refused',
  /** The shard failed terminally: its queued and in-flight jobs, and any later enqueue. */
  'shard_failed',
  /** Enqueued while the shard was stopping or stopped. */
  'shard_stopping',
  /** A throw before the job was queued: lane not started, snapshot or request clone. */
  'enqueue_failed',
  /** The worker answered a recoverable ERROR for this request alone. */
  'validation_failed',
  /** The client refused the worker's result (response validation, unmirrored authority). */
  'result_refused',
  /** A throw in the client or lane continuation after a validated result. */
  'post_result_failed',
  /** No stamp and no recognized class. */
  'unknown',
] as const;

export type HorseDecisionFallbackReason = (typeof HORSE_DECISION_FALLBACK_REASONS)[number];

const STAMP = 'horseDecisionRejection';
const KNOWN: ReadonlySet<string> = new Set(HORSE_DECISION_FALLBACK_REASONS);

/**
 * Name the rejection path on the error itself. The first stamp wins, so the
 * site closest to the cause is the one reported. Never throws: a frozen or
 * primitive value stays unstamped and classifies as `unknown`.
 */
export function markHorseDecisionRejection<T>(
  error: T,
  reason: Exclude<HorseDecisionFallbackReason, 'unknown'>
): T {
  if ((typeof error !== 'object' && typeof error !== 'function') || error === null) return error;
  try {
    if (!Object.prototype.hasOwnProperty.call(error, STAMP)) {
      Object.defineProperty(error, STAMP, { value: reason, enumerable: false });
    }
  } catch {
    /* naming a rejection must never replace it */
  }
  return error;
}

/** Pure: an error in, one of the fixed reasons out. Never reads the message. */
export function horseDecisionFallbackReason(error: unknown): HorseDecisionFallbackReason {
  try {
    if (error instanceof HorseRequestCapacityError) return 'capacity_refused';
    if ((typeof error !== 'object' && typeof error !== 'function') || error === null)
      return 'unknown';
    const descriptor = Object.getOwnPropertyDescriptor(error, STAMP);
    const stamped: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
    return typeof stamped === 'string' && KNOWN.has(stamped)
      ? (stamped as HorseDecisionFallbackReason)
      : 'unknown';
  } catch {
    return 'unknown';
  }
}
