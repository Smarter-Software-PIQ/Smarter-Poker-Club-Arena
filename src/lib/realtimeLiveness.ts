import { reportWarning } from '../utils/errorReporter';
import {
  markForcedReconnect,
  setRevivalSink,
  type RevivalReason,
  type RevivalRecord,
} from './realtimeTransportLoss';

/**
 * A DEAD SOCKET IS FOUND THE MOMENT THE PLAYER COMES BACK (2026-11-05).
 *
 * Measured on production, 2026-10-30 to 2026-11-06: 1,218 "Realtime transport
 * lost (socket closed)" rows. Every one is filed only while the page is
 * visible, and the largest group is iOS Safari on table and club routes (36
 * table players). Dan watched Danimal (iPhone) lose six of them during one PKO
 * on 2026-11-05; every knockout broadcast sent while the socket was dead never
 * reached the felt.
 *
 * The mechanism: a phone that locks or switches apps freezes the page, and the
 * server closes the idle socket. When the page thaws, realtime-js still
 * believes it is connected. It finds out only from its own heartbeat timer,
 * which reports a timeout on the SECOND unanswered beat: up to two
 * intervals (50 s at the 25 s default) of a socket that drops every
 * broadcast, then the stepped reconnect backoff. On a desktop the same gap
 * comes from background tabs, whose main-thread timers the browser throttles
 * to once a minute, so the heartbeat itself goes late and the server times
 * the socket out.
 *
 * So:
 *   1. the heartbeat runs in a Web Worker (realtime-js `worker`), which the
 *      browser does not throttle like the page's own timers, at a shorter
 *      interval (REALTIME_HEARTBEAT_MS), so a dead socket is seen in seconds;
 *   2. the instant the page is shown again, online again, or restored from the
 *      back-forward cache, this probes the socket: not connected means connect
 *      now (no backoff), connected means beat now and, if that beat is not
 *      answered within RESUME_PROBE_MS, beat again - which is realtime-js's own
 *      heartbeat timeout path: it closes the socket and reconnects, and every
 *      channel rejoins and fires SUBSCRIBED, where each consumer re-reads what
 *      it missed.
 * Nothing here joins, leaves or owns a channel.
 */

/** Heartbeat interval: half the SDK default, so a dead socket shows in at most two of these. */
export const REALTIME_HEARTBEAT_MS = 12_000;
/** How long a resumed page waits for its probe beat before forcing a reconnect. */
export const RESUME_PROBE_MS = 3_000;

/** The part of realtime-js's RealtimeClient this module uses. */
export interface RealtimeLivenessClient {
  isConnected(): boolean;
  connect(): void;
  sendHeartbeat(): Promise<void> | void;
  pendingHeartbeatRef: string | null;
}

interface LivenessEnv {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  isVisible(): boolean;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

function browserEnv(): LivenessEnv | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  return {
    addEventListener: (type, listener) =>
      (type === 'visibilitychange' ? document : window).addEventListener(type, listener),
    removeEventListener: (type, listener) =>
      (type === 'visibilitychange' ? document : window).removeEventListener(type, listener),
    isVisible: () => document.visibilityState !== 'hidden',
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number),
    now: () => Date.now(),
  };
}

/** At most one durable revive row per client per window, so the proof never becomes noise. */
export const REVIVE_REPORT_WINDOW_MS = 10 * 60_000;
let lastRevivalWrittenAt: number | null = null;

/** May a revive row be written now? One per REVIVE_REPORT_WINDOW_MS. Exported for the test. */
export function mayWriteRevival(now: number, last: number | null): boolean {
  return last === null || now - last >= REVIVE_REPORT_WINDOW_MS;
}

export interface RevivalRowWriter {
  userId(): Promise<string | null>;
  insert(row: Record<string, unknown>): Promise<{ error: { message?: string } | null }>;
}

async function supabaseWriter(): Promise<RevivalRowWriter> {
  const { supabase } = await import('./supabase');
  return {
    userId: async () => {
      // Bound and acted on (discarded-error-read ratchet): a failed session
      // read is treated as signed out, never as a reason to throw.
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        console.debug('[realtime-revival] session read failed; skipping write', error.message);
        return null;
      }
      return data.session?.user?.id ?? null;
    },
    insert: async (row) => {
      const { error } = await supabase.from('client_realtime_revivals').insert(row);
      return { error };
    },
  };
}

function currentRoute(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.location.pathname.slice(0, 200);
  } catch {
    return null;
  }
}

function currentAppVersion(): string | null {
  try {
    const v = import.meta.env.VITE_APP_VERSION;
    return typeof v === 'string' && v ? v.slice(0, 64) : null;
  } catch {
    return null;
  }
}

/**
 * Persist one finished revive measurement to client_realtime_revivals:
 * fire-and-forget, signed-in only, throttled, never retried, never surfaced.
 */
export async function writeRevival(
  record: RevivalRecord,
  now: number = Date.now(),
  writer: () => Promise<RevivalRowWriter> = supabaseWriter
): Promise<boolean> {
  try {
    if (!mayWriteRevival(now, lastRevivalWrittenAt)) return false;
    lastRevivalWrittenAt = now;
    const w = await writer();
    const userId = await w.userId();
    if (!userId) return false; // RLS would refuse it; do not generate the noise
    const { error } = await w.insert({
      user_id: userId,
      reason: record.reason,
      rejoined: record.rejoined,
      gap_ms: record.gapMs,
      waited_ms: record.waitedMs === null ? null : Math.max(0, Math.round(record.waitedMs)),
      route: currentRoute(),
      app_version: currentAppVersion(),
    });
    if (error) {
      console.debug('[realtime-revival] insert refused', error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Test-only: forget the write throttle. */
export function __resetRevivalWriteForTests(): void {
  lastRevivalWrittenAt = null;
}

function reportForcedReconnect(reason: string, data: Record<string, unknown>): void {
  reportWarning(`Realtime socket revived on resume (${reason})`, 'Realtime.resume_revived', data);
  const waited = typeof data.waitedMs === 'number' ? data.waitedMs : null;
  const resumedAt = typeof data.resumedAt === 'number' ? data.resumedAt : Date.now();
  markForcedReconnect(reason as RevivalReason, waited, resumedAt);
}

/** The four moments a page comes back to the player. */
export const RESUME_EVENTS = ['visibilitychange', 'pageshow', 'online', 'focus'] as const;

/**
 * Probe the realtime socket whenever the page comes back. Returns a disposer.
 * `report` is called once per forced reconnect (telemetry proving the fix).
 */
export function installRealtimeLiveness(
  client: RealtimeLivenessClient,
  env: LivenessEnv | null = browserEnv(),
  report: (reason: string, data: Record<string, unknown>) => void = reportForcedReconnect
): () => void {
  if (!env) return () => {};
  // Finished measurements (realtimeTransportLoss.ts) are written durably from here,
  // so the entry chunk never carries the writer.
  setRevivalSink((record) => void writeRevival(record));
  let probe: unknown = null;

  const resume = () => {
    if (!env.isVisible()) return;
    if (probe !== null) return; // one probe at a time
    if (!client.isConnected()) {
      const resumedAt = env.now();
      client.connect();
      report('not_connected', { resumedAt });
      return;
    }
    const startedAt = env.now();
    void client.sendHeartbeat();
    probe = env.setTimeout(() => {
      probe = null;
      if (!env.isVisible() || !client.isConnected()) return;
      if (client.pendingHeartbeatRef === null) return; // answered: the socket is alive
      // Unanswered: a second beat with one pending is realtime-js's own
      // heartbeat timeout - it closes the socket and reconnects.
      void client.sendHeartbeat();
      report('unanswered_heartbeat', { waitedMs: env.now() - startedAt, resumedAt: startedAt });
    }, RESUME_PROBE_MS);
  };

  for (const type of RESUME_EVENTS) env.addEventListener(type, resume);
  return () => {
    for (const type of RESUME_EVENTS) env.removeEventListener(type, resume);
    setRevivalSink(null);
    if (probe !== null) env.clearTimeout(probe);
    probe = null;
  };
}
