/**
 * A REVIVE IS MEASURED, NOT JUST LOGGED (2026-11-06).
 *
 * realtimeLiveness.ts forces a dead realtime socket back the moment a player
 * returns to the page. Its only record was a console warning, so production
 * could not tell whether the fix ever fired. And the existing transport-loss
 * row cannot prove it either: a forced reconnect fans out as a visible channel
 * error exactly like an organic drop, so that rate does not fall by design.
 *
 * This tiny module (it stays in the entry chunk with realtimeTransportLoss.ts,
 * so it imports nothing) holds the one open measurement:
 *   - markForcedReconnect: the liveness probe forced a reconnect for a page
 *     that came back at `resumedAt`;
 *   - noteRevivalRejoined: a channel joined again, so the gap from the resume
 *     to the rejoin is known; the record goes to the sink the lazily loaded
 *     liveness module registers (which writes client_realtime_revivals);
 *   - REJOIN_DEADLINE_MS without a join records rejoined = false;
 *   - wasForcedByLiveness: a transport loss filed within FORCED_LOSS_WINDOW_MS
 *     of a forced reconnect is that reconnect's own fan-out, and is tagged so.
 */

/** A transport loss this soon after a forced reconnect is the reconnect's own fan-out. */
export const FORCED_LOSS_WINDOW_MS = 5_000;
/** A forced reconnect with no channel joined after this long is recorded as not rejoined. */
export const REJOIN_DEADLINE_MS = 120_000;

export type RevivalReason = 'not_connected' | 'unanswered_heartbeat';

export interface RevivalRecord {
  reason: RevivalReason;
  rejoined: boolean;
  /** Page resume to first channel joined again; null when it never rejoined. */
  gapMs: number | null;
  /** How long the resume probe waited for its heartbeat before forcing. */
  waitedMs: number | null;
}

export interface RevivalTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const defaultTimers: RevivalTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

let sink: ((record: RevivalRecord) => void) | null = null;
let lastForcedAt: number | null = null;
let pending: {
  reason: RevivalReason;
  waitedMs: number | null;
  resumedAt: number;
  deadline: unknown;
  timers: RevivalTimers;
} | null = null;

/** The liveness module registers where finished measurements go. */
export function setRevivalSink(next: ((record: RevivalRecord) => void) | null): void {
  sink = next;
}

function deliver(record: RevivalRecord): void {
  try {
    sink?.(record);
  } catch {
    /* Telemetry must never break the page. */
  }
}

/** The liveness probe just forced a reconnect for a page that came back at `resumedAt`. */
export function markForcedReconnect(
  reason: RevivalReason,
  waitedMs: number | null,
  resumedAt: number,
  now: number = Date.now(),
  timers: RevivalTimers = defaultTimers
): void {
  lastForcedAt = now;
  if (pending !== null) return; // one open measurement at a time
  const deadline = timers.setTimeout(() => {
    if (pending === null) return;
    const open = pending;
    pending = null;
    deliver({ reason: open.reason, rejoined: false, gapMs: null, waitedMs: open.waitedMs });
  }, REJOIN_DEADLINE_MS);
  pending = { reason, waitedMs, resumedAt, deadline, timers };
}

/** A channel joined: close the open measurement, if any. */
export function noteRevivalRejoined(now: number = Date.now()): void {
  if (pending === null) return;
  const open = pending;
  pending = null;
  open.timers.clearTimeout(open.deadline);
  deliver({
    reason: open.reason,
    rejoined: true,
    gapMs: Math.max(0, Math.round(now - open.resumedAt)),
    waitedMs: open.waitedMs,
  });
}

/** Was a transport loss at `now` caused by a liveness-forced reconnect? */
export function wasForcedByLiveness(now: number = Date.now()): boolean {
  return (
    lastForcedAt !== null && now >= lastForcedAt && now - lastForcedAt <= FORCED_LOSS_WINDOW_MS
  );
}

/** Test-only: forget every measurement and the sink. */
export function __resetRealtimeRevivalForTests(): void {
  if (pending !== null) pending.timers.clearTimeout(pending.deadline);
  pending = null;
  lastForcedAt = null;
  sink = null;
}
