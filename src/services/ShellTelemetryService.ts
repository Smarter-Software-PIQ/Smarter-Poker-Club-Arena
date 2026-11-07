/**
 * Persist bounded, signed-in shell freshness observations. A newer release
 * never reboots an open page, so automatic-reload telemetry is retired.
 * Telemetry failures are dropped and can never interrupt the player.
 */
import { masterBus } from '../core/MasterBus';
import { supabase } from '../lib/supabase';

/** Highest write rate this service will ever produce, per event kind. */
export const MIN_WRITE_INTERVAL_MS = 30 * 1000;

type Row = {
  user_id: string;
  event: 'staleness_checked';
  stale?: boolean;
  source?: string;
  running_entry?: string | null;
  deployed_entry?: string | null;
};

let started = false;
const lastWriteAt: Record<string, number> = {};

/**
 * May this event kind be written now? Producer-side throttles already exist;
 * this is the backstop that makes a pathological loop cheap rather than
 * expensive. Exported for the unit test.
 */
export function mayWrite(kind: string, now: number, last: number | undefined): boolean {
  return last === undefined || now - last >= MIN_WRITE_INTERVAL_MS;
}

async function currentUserId(): Promise<string | null> {
  try {
    /* The error is BOUND and acted on, per the discarded-error-read ratchet
       (tests/unit/discardedErrorReadRatchet.test.ts). "Acted on" here means
       logged at debug and treated as signed-out: a KPI row is not worth a
       error reporting event, but an invisible read failure is exactly how this
       service would appear to work while writing nothing. */
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.debug('[shell-telemetry] session read failed; skipping write', error.message);
      return null;
    }
    return data.session?.user?.id ?? null;
  } catch {
    return null;
  }
}

async function write(row: Omit<Row, 'user_id'>): Promise<void> {
  try {
    const userId = await currentUserId();
    if (!userId) return; // RLS would refuse it; do not generate the noise
    const { error } = await supabase
      .from('client_shell_telemetry')
      .insert({ ...row, user_id: userId });
    if (error) {
      // Dropped on purpose — never retried, never surfaced to the player.
      console.debug('[shell-telemetry] insert refused', error.message);
    }
  } catch {
    /* Telemetry must never surface to the player, and never retry. */
  }
}

/**
 * Subscribe to the shell events. Idempotent: calling twice does not
 * double-write (the app root may re-run effects in StrictMode).
 */
export function startShellTelemetry(): void {
  if (started) return;
  started = true;

  /* Subscribers receive the bus ENVELOPE ({ type, payload, timestamp }), not
     the bare payload — reading `event.stale` here would be silently undefined
     and every row would land null. */
  masterBus.subscribe('SHELL_STALENESS_CHECKED', (event) => {
    const payload = event.payload;
    const now = Date.now();
    if (!mayWrite('staleness_checked', now, lastWriteAt.staleness_checked)) return;
    lastWriteAt.staleness_checked = now;
    void write({
      event: 'staleness_checked',
      stale: payload.stale,
      source: payload.source,
      running_entry: payload.running,
      deployed_entry: payload.deployed,
    });
  });
}

/** Test seam: forget that we started, and forget the throttle. */
export function __resetShellTelemetryForTests(): void {
  started = false;
  for (const k of Object.keys(lastWriteAt)) delete lastWriteAt[k];
}
