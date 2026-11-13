/**
 * STYLE READ LIVE SWITCH, DELIVERY LEG (2026-11-13).
 *
 * HorseStyleSwitch.ts holds the per-option runtime state (off, shadow, canary, on) inside each decision worker.
 * Until now its production source was ABSENT_STYLE_SWITCH_SOURCE, so no option could ever leave off. This file
 * carries the configuration from the database to the workers:
 *
 *   main thread: fn_ca_horse_style_switch_effective  (read every STYLE_SWITCH_DELIVERY_MS)
 *     -> STYLE_SWITCH_STATE message to every decision worker
 *       -> worker inbox -> StyleSwitchSource -> StyleSwitchHolder (validates, fails safe to off)
 *
 * EVERY FAILURE READS AS OFF:
 * - nothing delivered yet: absent, the source default (off);
 * - the read failed twice in a row: an `unreadable` message, every option off at the worker's next refresh;
 * - the main thread stopped delivering: the worker's last configuration ages past STYLE_SWITCH_STALE_MS (120 s)
 *   and the holder turns every option off (strict staleness);
 * - a message that is not exactly the documented shape: invalid, every option off.
 *
 * A configuration is re-delivered on every read even when unchanged, because the holder measures freshness from
 * the moment a worker received it. No acknowledgement is needed: an undelivered message is the stale case.
 *
 * The receive time is stamped on the WORKER's monotonic clock (performance.now()), the clock the worker passes to
 * StyleSwitchHolder.refresh.
 */
import { STYLE_SWITCH_POLL_MS, type StyleSwitchSource } from '../HorseStyleSwitch.js';

export interface StyleSwitchStateMessage {
  type: 'STYLE_SWITCH_STATE';
  /** Increases by one per delivery within one engine process; a worker ignores an older one. */
  seq: number;
  status: 'ok' | 'unreadable';
  /** The database answer exactly as read when status is ok; null when unreadable. */
  config: unknown;
}

export function styleSwitchMessageValid(value: unknown): value is StyleSwitchStateMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === 'STYLE_SWITCH_STATE' &&
    Object.keys(v).sort().join(',') === 'config,seq,status,type' &&
    Number.isSafeInteger(v.seq) &&
    (v.seq as number) >= 0 &&
    (v.status === 'ok' || (v.status === 'unreadable' && v.config === null))
  );
}

type Delivered =
  | { kind: 'ok'; seq: number; raw: unknown; receivedAtMs: number }
  | { kind: 'unreadable'; seq: number }
  | { kind: 'invalid' };

/** The worker side: takes STYLE_SWITCH_STATE messages and serves the last one as a StyleSwitchSource. */
export function createStyleSwitchWorkerInbox(clock: () => number = () => performance.now()): {
  receive(input: unknown): boolean;
  source: StyleSwitchSource;
} {
  let last: Delivered | null = null;
  return {
    receive(input: unknown): boolean {
      if ((input as { type?: unknown } | null)?.type !== 'STYLE_SWITCH_STATE') return false;
      if (!styleSwitchMessageValid(input)) {
        last = { kind: 'invalid' };
        return true;
      }
      // an older delivery never replaces a newer one
      if (last && last.kind !== 'invalid' && input.seq <= last.seq) return true;
      last =
        input.status === 'ok'
          ? { kind: 'ok', seq: input.seq, raw: input.config, receivedAtMs: clock() }
          : { kind: 'unreadable', seq: input.seq };
      return true;
    },
    source: () => {
      if (!last) return { kind: 'absent' };
      if (last.kind === 'unreadable') throw new Error('style_switch_unreadable');
      // an invalid envelope is served as a present reading that cannot parse: the holder turns everything off
      if (last.kind === 'invalid') return { kind: 'present', raw: null, receivedAtMs: clock() };
      return { kind: 'present', raw: last.raw, receivedAtMs: last.receivedAtMs };
    },
  };
}

/** Half the holder's poll: a worker's configuration is at most about 30 s old when it reads it. */
export const STYLE_SWITCH_DELIVERY_MS = STYLE_SWITCH_POLL_MS / 2;
/** A read that has not answered by now counts as failed (the next tick reads again). */
export const STYLE_SWITCH_READ_TIMEOUT_MS = 10_000;
/** One failed read keeps the last delivery (still fresh); the second in a row delivers `unreadable`. */
export const STYLE_SWITCH_FAILURES_BEFORE_UNREADABLE = 2;
const REPORT_EVERY_MS = 5 * 60_000;

export interface StyleSwitchDeliveryDeps {
  /** Resolves with the raw database answer; rejects when it cannot be read. */
  read: () => Promise<unknown>;
  /** Posts one message to every decision worker; must not throw for one dead worker. */
  broadcast: (message: StyleSwitchStateMessage) => void;
  intervalMs?: number;
  readTimeoutMs?: number;
  now?: () => number;
  warn?: (message: string) => void;
}

/** The main-thread side. start() reads at once and then every intervalMs; the timer never holds the process. */
export function createStyleSwitchDelivery(deps: StyleSwitchDeliveryDeps): {
  start(): void;
  stop(): void;
  tick(): Promise<void>;
} {
  const intervalMs = deps.intervalMs ?? STYLE_SWITCH_DELIVERY_MS;
  const readTimeoutMs = deps.readTimeoutMs ?? STYLE_SWITCH_READ_TIMEOUT_MS;
  const now = deps.now ?? (() => Date.now());
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  let seq = 0;
  let failures = 0;
  let inFlight = false;
  let stopped = false;
  let lastReported = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setInterval> | null = null;

  const post = (message: StyleSwitchStateMessage): void => {
    try {
      deps.broadcast(message);
    } catch {
      // a worker that could not be reached goes stale and turns everything off on its own
    }
  };

  const tick = async (): Promise<void> => {
    if (inFlight || stopped) return;
    inFlight = true;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    try {
      const config = await Promise.race([
        deps.read(),
        new Promise<never>((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('style switch read timed out')),
            readTimeoutMs
          );
          deadline.unref?.();
        }),
      ]);
      if (stopped) return;
      failures = 0;
      post({ type: 'STYLE_SWITCH_STATE', seq: ++seq, status: 'ok', config });
    } catch (error) {
      if (stopped) return;
      failures += 1;
      if (failures >= STYLE_SWITCH_FAILURES_BEFORE_UNREADABLE)
        post({ type: 'STYLE_SWITCH_STATE', seq: ++seq, status: 'unreadable', config: null });
      const at = now();
      if (at - lastReported >= REPORT_EVERY_MS) {
        lastReported = at;
        warn(
          `[HorseStyleSwitch] the style switch could not be read (${failures} in a row); every option reads off: ` +
            (error instanceof Error ? error.message : String(error))
        );
      }
    } finally {
      if (deadline) clearTimeout(deadline);
      inFlight = false;
    }
  };

  return {
    start(): void {
      if (timer || stopped) return;
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref?.();
    },
    stop(): void {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
  };
}

/** The production read: the service-role RPC. Imported lazily so the engine module graph does not change. */
export async function readStyleSwitchFromDatabase(): Promise<unknown> {
  const { supabase } = await import('../../services/supabase/client.js');
  const { data, error } = await supabase.rpc('fn_ca_horse_style_switch_effective');
  if (error) throw new Error(error.message || 'fn_ca_horse_style_switch_effective failed');
  return data;
}
