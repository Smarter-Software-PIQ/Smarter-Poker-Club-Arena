/**
 * AN EVENT NOBODY ENTERED IS CANCELLED, NOT WAITED ON FOR EVER (2026-10-15).
 *
 * A registration-first event (an MTT and its variants) starts on its clock
 * once it has its minimum field. Short of that field past its start, the
 * discovery loop tops it up with horses and starts it on a later pass: Dan's
 * "TOURNAMENTS RUN. THEY DO NOT CANCEL" (2026-08-19), which exists so a player
 * who paid gets the game he paid for.
 *
 * That loop had no end for an event that NOBODY entered and that the horse
 * pool cannot fill. Measured on production 2026-10-15: three "Daily 25 Chip
 * Freezeout" events of a one-member pilot club with no horse in it sat
 * REGISTERING 7 to 55 hours past their start with zero entrants, a new one is
 * spawned every day, and TournamentNeverStarted paged on them every hour. The
 * same shape is what HorseTournamentsOverdue paged on 2026-10-05: zero-entrant
 * MTTs of a club under an operator hold, whose top-up is refused while the
 * club is held, cancelled by hand afterwards.
 *
 * Nothing is at stake in such an event: no entrant, so nothing to refund and
 * nobody denied a game. The rule for it is cancel and refund nothing, through
 * the platform's one cancellation authority (atomic_cancel_tournament), which
 * writes the immutable cancellation receipt and closes every bank at exact
 * zero. This predicate is the whole decision, so it is tested without a
 * database and the call site cannot drift from it.
 *
 * Every condition is required:
 *   - registration-first, never a seat-first Spin/SNG (those have their own
 *     unfilled-seat expiry and their start is bought seats, not a clock);
 *   - the prize pool is not finalized (a finalized pool has left
 *     registration; it needs the finish path, never a cancellation);
 *   - the roster read for this event SUCCEEDED and found no registered or
 *     playing entrant, and the denormalised counter agrees (an unreadable
 *     roster is not an empty one);
 *   - it is at least EMPTY_PAST_START_CANCEL_AFTER_MS past its start;
 *   - the past-start top-up has been asked at least once and added nobody,
 *     so a club whose horses CAN fill it is filled and played instead.
 */
export const EMPTY_PAST_START_CANCEL_AFTER_MS = 30 * 60 * 1000;
/** A refused cancellation is a stable answer; ask again at most this often. */
export const EMPTY_PAST_START_CANCEL_RETRY_MS = 30 * 60 * 1000;

/**
 * ONE EMPTY-EVENT CANCEL AT A TIME, AND A BUSY LANE IS "NOT NOW" (2026-11-07).
 *
 * atomic_cancel_tournament admits a cancellation through the platform's one
 * exclusive terminal-settlement lane (smarter_private.cancellation_lane): a
 * try-lock that refuses with SQLSTATE 55P03 CANCELLATION_GLOBAL_LANE_BUSY or
 * CANCELLATION_BARRIER_BUSY rather than queue ahead of hand settlement. The
 * discovery pass used to launch every eligible empty event at once, so all but
 * one were refused by construction, and every refused event then waited the
 * full EMPTY_PAST_START_CANCEL_RETRY_MS - together, so they collided again.
 * Measured 2026-11-07 20:05:12 UTC: ~30 refusals in 100 ms from the engine,
 * each reported as an error, while 41 empty Midway Union Sit & Go boards sat
 * up to eight hours past start and were cancelled about one per pass.
 *
 * Now the engine asks one cancel at a time across the process, and a busy
 * lane - a refusal that committed nothing - is asked again after
 * EMPTY_PAST_START_LANE_BUSY_RETRY_MS instead of thirty minutes, without an
 * error report. Every other refusal keeps the thirty-minute clock and its
 * report.
 */
export const EMPTY_PAST_START_LANE_BUSY_RETRY_MS = 60 * 1000;

const LANE_BUSY_REFUSALS = ['CANCELLATION_GLOBAL_LANE_BUSY', 'CANCELLATION_BARRIER_BUSY'];

/** True only for the cancellation lane's own try-lock refusal (55P03, by name). */
export function isCancellationLaneBusy(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code !== '55P03' || typeof message !== 'string') return false;
  return LANE_BUSY_REFUSALS.some((name) => message.trim() === name);
}

/**
 * The cancelAskedAt to store after a busy-lane refusal at nowMs, so the
 * thirty-minute retry gate opens EMPTY_PAST_START_LANE_BUSY_RETRY_MS later.
 */
export function laneBusyCancelAskedAt(nowMs: number): number {
  return nowMs - EMPTY_PAST_START_CANCEL_RETRY_MS + EMPTY_PAST_START_LANE_BUSY_RETRY_MS;
}

export interface EmptyPastStartEvent {
  seatFirst: boolean;
  poolFinalized: boolean;
  /** Registered or playing entrants from a COMPLETE roster read; undefined if unread. */
  rosterCount: number | undefined;
  currentPlayers: number | null | undefined;
  startTimeMs: number;
  nowMs: number;
  /** Past-start top-ups that added nobody (the discovery loop's backoff counter). */
  emptyTopUps: number;
}

export function shouldCancelEmptyPastStartEvent(event: EmptyPastStartEvent): boolean {
  if (event.seatFirst || event.poolFinalized) return false;
  if (event.rosterCount !== 0) return false;
  if ((event.currentPlayers ?? 0) !== 0) return false;
  if (!Number.isFinite(event.startTimeMs) || !Number.isFinite(event.nowMs)) return false;
  if (event.nowMs - event.startTimeMs < EMPTY_PAST_START_CANCEL_AFTER_MS) return false;
  return event.emptyTopUps >= 1;
}
