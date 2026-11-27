/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  GC PAUSE MONITOR: a long stop-the-world pause is named when it happens
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * A garbage-collection pause stops every table on the box at once: no timer
 * fires, no action is read, no broadcast goes out. The event-loop histogram
 * (eventLoopMonitor.ts) shows that the loop was late; it cannot say that V8
 * was collecting. This monitor watches V8's own `gc` performance entries
 * (node:perf_hooks PerformanceObserver) and, when one pause runs past the
 * threshold (500 ms by default), reports it through the engine's existing
 * paths:
 *
 *   - the always-on metrics registry (`poker_engine_gc_pause_long_total` by
 *     collector kind, and `poker_engine_gc_pause_longest_ms`), which /metrics
 *     exposes unconditionally;
 *   - `engine_lifecycle_logs` (recordEngineLifecycleLog, event
 *     `gc_pause_long`), which operators read without a shell on the host;
 *   - one console line.
 *
 * The durable log and the console are throttled to one line per window per
 * process (the first long pause of a quiet window is written at once, later
 * ones in the same window are counted into the next line), so a GC storm is a
 * count, not a flood that rotates the log away. The counter is never
 * throttled.
 *
 * It changes no heap size or GC flag; it only observes.
 */
import { PerformanceObserver, constants } from 'node:perf_hooks';
import { recordEngineLifecycleLog } from '../services/engineLifecycleLog.js';
import { alwaysOnRegistry } from './engineInstruments.js';

export const GC_PAUSE_THRESHOLD_MS = 500;
export const GC_PAUSE_REPORT_WINDOW_MS = 60_000;

export type GcKind = 'minor' | 'major' | 'incremental' | 'weakcb' | 'unknown';

export function gcKindName(kind: number | undefined): GcKind {
  switch (kind) {
    case constants.NODE_PERFORMANCE_GC_MINOR:
      return 'minor';
    case constants.NODE_PERFORMANCE_GC_MAJOR:
      return 'major';
    case constants.NODE_PERFORMANCE_GC_INCREMENTAL:
      return 'incremental';
    case constants.NODE_PERFORMANCE_GC_WEAKCB:
      return 'weakcb';
    default:
      return 'unknown';
  }
}

/** True when one pause is at or past the threshold. Non-finite input never is. */
export function isLongGcPause(durationMs: number, thresholdMs = GC_PAUSE_THRESHOLD_MS): boolean {
  return (
    Number.isFinite(durationMs) &&
    Number.isFinite(thresholdMs) &&
    thresholdMs > 0 &&
    durationMs >= thresholdMs
  );
}

export interface GcPauseReport {
  durationMs: number;
  kind: GcKind;
  thresholdMs: number;
  /** Long pauses counted, not reported, since the previous report. */
  heldSinceLastReport: number;
  /** Longest pause among the held ones (0 when none were held). */
  longestHeldMs: number;
}

/** Minimal shape of a perf_hooks `gc` entry (Node 22: kind is in `detail`). */
export interface GcEntryLike {
  duration: number;
  detail?: unknown;
}

export interface GcPauseMonitorOptions {
  thresholdMs?: number;
  windowMs?: number;
  now?: () => number;
  /** Every long pause, never throttled (metrics). */
  count: (kind: GcKind, durationMs: number) => void;
  /** At most one per window (durable log + console). */
  report: (report: GcPauseReport) => void;
}

export class GcPauseMonitor {
  private readonly thresholdMs: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private windowStartedAt: number | null = null;
  private held = 0;
  private longestHeldMs = 0;

  constructor(private readonly options: GcPauseMonitorOptions) {
    this.thresholdMs = options.thresholdMs ?? GC_PAUSE_THRESHOLD_MS;
    this.windowMs = options.windowMs ?? GC_PAUSE_REPORT_WINDOW_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** Feed one `gc` entry. Returns true when it was a long pause. Never throws. */
  observe(entry: GcEntryLike): boolean {
    try {
      const durationMs = Number(entry.duration);
      if (!isLongGcPause(durationMs, this.thresholdMs)) return false;
      const detail = entry.detail as { kind?: unknown } | undefined;
      const kind = gcKindName(typeof detail?.kind === 'number' ? detail.kind : undefined);
      this.options.count(kind, durationMs);

      const at = this.now();
      if (this.windowStartedAt !== null && at - this.windowStartedAt < this.windowMs) {
        this.held++;
        this.longestHeldMs = Math.max(this.longestHeldMs, durationMs);
        return true;
      }
      const report: GcPauseReport = {
        durationMs: Math.round(durationMs * 100) / 100,
        kind,
        thresholdMs: this.thresholdMs,
        heldSinceLastReport: this.held,
        longestHeldMs: Math.round(this.longestHeldMs * 100) / 100,
      };
      this.windowStartedAt = at;
      this.held = 0;
      this.longestHeldMs = 0;
      this.options.report(report);
      return true;
    } catch {
      // A monitor must never break the process it is watching.
      return false;
    }
  }
}

const longPauses = alwaysOnRegistry.counter(
  'poker_engine_gc_pause_long_total',
  'V8 garbage-collection pauses at or past the long-pause threshold (label: kind)'
);
const longestPauseMs = alwaysOnRegistry.gauge(
  'poker_engine_gc_pause_longest_ms',
  'Longest V8 garbage-collection pause seen at or past the threshold since boot, in ms'
);
// The series exist at boot, so a rule can tell zero from absent.
for (const kind of ['minor', 'major', 'incremental', 'weakcb', 'unknown'] as const) {
  longPauses.inc(0, { kind });
}
longestPauseMs.set(0);

let observer: PerformanceObserver | null = null;
let longestSeenMs = 0;

/** Start watching V8 `gc` entries for the life of the process. Idempotent. */
export function startGcPauseMonitor(thresholdMs = GC_PAUSE_THRESHOLD_MS): void {
  if (observer) return;
  const monitor = new GcPauseMonitor({
    thresholdMs,
    count: (kind, durationMs) => {
      longPauses.inc(1, { kind });
      if (durationMs > longestSeenMs) {
        longestSeenMs = durationMs;
        longestPauseMs.set(Math.round(durationMs));
      }
    },
    report: (report) => {
      const message =
        `V8 ${report.kind} GC paused the engine for ${Math.round(report.durationMs)} ms ` +
        `(threshold ${report.thresholdMs} ms)` +
        (report.heldSinceLastReport > 0
          ? `; ${report.heldSinceLastReport} more long pause(s) since the last report, ` +
            `longest ${Math.round(report.longestHeldMs)} ms`
          : '');
      try {
        console.warn(`[GcPauseMonitor] ${message}`);
      } catch {
        /* a broken stderr pipe must not matter */
      }
      void recordEngineLifecycleLog({
        level: 'warn',
        event: 'gc_pause_long',
        message,
        detail: { ...report },
      });
    },
  });
  try {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) monitor.observe(entry);
    });
    observer.observe({ entryTypes: ['gc'] });
  } catch (error) {
    observer = null;
    try {
      console.warn('[GcPauseMonitor] could not observe gc entries:', error);
    } catch {
      /* ignore */
    }
  }
}

/** Test seam. */
export function _stopGcPauseMonitorForTests(): void {
  observer?.disconnect();
  observer = null;
  longestSeenMs = 0;
}
