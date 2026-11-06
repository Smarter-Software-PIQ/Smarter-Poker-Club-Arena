import { reportError } from '../utils/errorReporter';

/**
 * ONE SOCKET DROP IS ONE EVENT, NOT ONE PER CHANNEL (2026-10-24).
 *
 * Every page channel shares the one Supabase Realtime socket. When that socket
 * closes or errors - a phone backgrounding the tab, Wi-Fi to cellular, a missed
 * heartbeat - realtime-js runs `_triggerChanError()`, which fires the error
 * event on EVERY channel at once with no reason attached. Each channel's
 * subscribe callback then reports `CHANNEL_ERROR` with `err === undefined`.
 * Realtime admission produces the same fan-out from its own socket listeners
 * ("Realtime transport closed before admission", "... admission timed out").
 *
 * Production, the 24 hours to 2026-10-24: 1,091 bare `Realtime CHANNEL_ERROR on
 * <channel>` rows from 48 players, every single one with a sibling from the
 * same player inside two seconds (3 to 10 channels per drop), plus 97 admission
 * transport rows - about 300 actual socket drops filed as roughly 1,200 channel
 * errors. The server refused none of them: a refused join always carries the
 * server's reason (e.g. "Unauthorized: You do not have permissions ...").
 *
 * So a transport-level failure is reported once per drop, here, and the
 * per-channel report is kept for failures that belong to one channel. Each
 * consumer's own status/error callbacks still run exactly as before, so every
 * degraded-state indicator and recovery read is unchanged.
 */

/** Messages realtimeAdmission.ts raises when the shared socket, not a channel, failed. */
const ADMISSION_TRANSPORT_MESSAGES: ReadonlySet<string> = new Set([
  'Realtime transport closed before admission',
  'Realtime transport/auth admission timed out',
]);

/** True when this channel status is the shared socket failing, not this channel. */
export function isRealtimeTransportLoss(status: string, err?: unknown): boolean {
  if (status !== 'CHANNEL_ERROR') return false;
  if (err === undefined || err === null) return true;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return ADMISSION_TRANSPORT_MESSAGES.has(message);
}

/**
 * One report per OUTAGE. The fan-out is synchronous, but an outage is not one
 * instant: while the socket stays down the MasterBus health monitor retries
 * every dead channel each 30s, and each retry fails the same way. So after a
 * report, nothing more is filed until some channel subscribes again (the
 * socket is back) - or, as a ceiling for a socket that never recovers, until
 * this long has passed, so a stuck client is still visible.
 */
export const TRANSPORT_LOSS_REPORT_CEILING_MS = 10 * 60_000;

let outageReportedAt: number | null = null;

/** Report a shared-socket failure at most once per outage (see above). */
export function noteRealtimeTransportLoss(
  channelName: string,
  source: string,
  err?: unknown,
  now: number = Date.now()
): void {
  if (outageReportedAt !== null && now - outageReportedAt < TRANSPORT_LOSS_REPORT_CEILING_MS)
    return;
  outageReportedAt = now;
  // Mobile browsers suspend WebSockets when a tab is backgrounded or when the
  // device is offline. Record the outage timestamp so channel fan-out stays
  // suppressed, but do not file a client_error_events telemetry row for OS tab
  // suspension or airplane/offline transitions.
  if (
    (typeof document !== 'undefined' && document.visibilityState === 'hidden') ||
    (typeof navigator !== 'undefined' && navigator.onLine === false)
  ) {
    return;
  }
  const reason = err instanceof Error && err.message ? err.message : 'socket closed';
  // A loss right after the liveness probe forced a reconnect is that
  // reconnect's own fan-out, not a new drop (realtimeTransportLoss.ts).
  const forcedByLiveness = wasForcedByLiveness(now);
  reportError(new Error(`Realtime transport lost (${reason})`), 'Realtime.transport_lost', {
    firstChannel: channelName,
    via: source,
    ...(forcedByLiveness ? { forcedByLiveness: true } : {}),
  });
}

/** A channel joined: the socket is up, so the next failure is a new outage. */
export function noteRealtimeTransportRecovered(): void {
  outageReportedAt = null;
  noteRevivalRejoined();
}

/**
 * The server's answer when RLS on realtime.messages refuses a private topic.
 * Unlike a transport loss this is permanent for the current identity: the
 * same join will be refused every time until the token (or the topic) changes.
 */
export function isRealtimeTopicRefusal(err?: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return /^"?Unauthorized: You do not have permissions to read from this Channel topic/i.test(
    message
  );
}

/** Test-only: forget the current outage. */
export function __resetRealtimeTransportLossForTests(): void {
  outageReportedAt = null;
}

/**
 * A REVIVE IS MEASURED, NOT JUST LOGGED (2026-11-06).
 *
 * realtimeLiveness.ts forces a dead realtime socket back the moment a player
 * returns to the page. Its only record was a console warning, so production
 * could not tell whether the fix ever fired. And the existing transport-loss
 * row cannot prove it either: a forced reconnect fans out as a visible channel
 * error exactly like an organic drop, so that rate does not fall by design.
 *
 * This tiny module (this lives in realtimeTransportLoss.ts, already in the
 * entry chunk, so measuring adds no module to first paint) holds the one open measurement:
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
