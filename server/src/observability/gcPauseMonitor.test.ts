/**
 * GC PAUSE MONITOR (2026-11-27): a stop-the-world pause past the threshold is
 * counted every time and written at most once per window, and nothing under
 * the threshold is reported at all.
 */
import { describe, expect, it, vi } from 'vitest';
import { constants } from 'node:perf_hooks';
import {
  GC_PAUSE_THRESHOLD_MS,
  GcPauseMonitor,
  gcKindName,
  isLongGcPause,
  type GcPauseReport,
} from './gcPauseMonitor.js';
import { alwaysOnRegistry } from './engineInstruments.js';

const major = (duration: number) => ({
  duration,
  detail: { kind: constants.NODE_PERFORMANCE_GC_MAJOR },
});

function harness(windowMs = 60_000, thresholdMs?: number) {
  let now = 0;
  const counted: Array<[string, number]> = [];
  const reports: GcPauseReport[] = [];
  const monitor = new GcPauseMonitor({
    thresholdMs,
    windowMs,
    now: () => now,
    count: (kind, ms) => counted.push([kind, ms]),
    report: (r) => reports.push(r),
  });
  return {
    monitor,
    counted,
    reports,
    at: (ms: number) => {
      now = ms;
    },
  };
}

describe('the long-pause threshold', () => {
  it('defaults to 500 ms and is inclusive', () => {
    expect(GC_PAUSE_THRESHOLD_MS).toBe(500);
    expect(isLongGcPause(499.99)).toBe(false);
    expect(isLongGcPause(500)).toBe(true);
    expect(isLongGcPause(1_200)).toBe(true);
  });

  it('never calls a non-finite or zero-threshold reading long', () => {
    expect(isLongGcPause(Number.NaN)).toBe(false);
    expect(isLongGcPause(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isLongGcPause(900, 0)).toBe(false);
    expect(isLongGcPause(900, Number.NaN)).toBe(false);
  });

  it('honours a configured threshold', () => {
    const h = harness(60_000, 100);
    expect(h.monitor.observe(major(99))).toBe(false);
    expect(h.monitor.observe(major(100))).toBe(true);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0].thresholdMs).toBe(100);
  });
});

describe('the monitor', () => {
  it('ignores ordinary pauses entirely', () => {
    const h = harness();
    for (const ms of [0.4, 3, 40, 250, 499]) expect(h.monitor.observe(major(ms))).toBe(false);
    expect(h.counted).toEqual([]);
    expect(h.reports).toEqual([]);
  });

  it('reports the first long pause at once and names its collector', () => {
    const h = harness();
    expect(h.monitor.observe(major(812.345))).toBe(true);
    expect(h.counted).toEqual([['major', 812.345]]);
    expect(h.reports).toEqual([
      {
        durationMs: 812.35,
        kind: 'major',
        thresholdMs: 500,
        heldSinceLastReport: 0,
        longestHeldMs: 0,
      },
    ]);
  });

  it('counts every long pause but writes one report per window, carrying the held ones', () => {
    const h = harness(60_000);
    h.at(0);
    h.monitor.observe(major(600));
    h.at(10_000);
    h.monitor.observe(major(900));
    h.at(20_000);
    h.monitor.observe(major(700));
    expect(h.counted).toHaveLength(3);
    expect(h.reports).toHaveLength(1);

    h.at(61_000);
    h.monitor.observe(major(550));
    expect(h.reports).toHaveLength(2);
    expect(h.reports[1]).toMatchObject({
      durationMs: 550,
      heldSinceLastReport: 2,
      longestHeldMs: 900,
    });
  });

  it('never throws, even when a reporter does', () => {
    const monitor = new GcPauseMonitor({
      count: () => {
        throw new Error('metrics broke');
      },
      report: () => {},
    });
    expect(() => monitor.observe(major(2_000))).not.toThrow();
    expect(monitor.observe({ duration: Number.NaN })).toBe(false);
  });

  it('maps every perf_hooks gc kind and tolerates a missing one', () => {
    expect(gcKindName(constants.NODE_PERFORMANCE_GC_MINOR)).toBe('minor');
    expect(gcKindName(constants.NODE_PERFORMANCE_GC_MAJOR)).toBe('major');
    expect(gcKindName(constants.NODE_PERFORMANCE_GC_INCREMENTAL)).toBe('incremental');
    expect(gcKindName(constants.NODE_PERFORMANCE_GC_WEAKCB)).toBe('weakcb');
    expect(gcKindName(undefined)).toBe('unknown');
    const h = harness();
    h.monitor.observe({ duration: 700 });
    expect(h.counted).toEqual([['unknown', 700]]);
  });
});

describe('the exposed series', () => {
  it('exist at boot on the always-on registry, so zero is not absent', () => {
    const snap = alwaysOnRegistry.snapshot();
    const long = snap.counters.filter((c) => c.name === 'poker_engine_gc_pause_long_total');
    expect(long.map((c) => c.labels.kind).sort()).toEqual(
      ['incremental', 'major', 'minor', 'unknown', 'weakcb'].sort()
    );
    expect(snap.gauges.some((g) => g.name === 'poker_engine_gc_pause_longest_ms')).toBe(true);
  });

  it('startGcPauseMonitor wires a real perf_hooks observer without throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('./gcPauseMonitor.js');
    expect(() => mod.startGcPauseMonitor()).not.toThrow();
    expect(() => mod.startGcPauseMonitor()).not.toThrow(); // idempotent
    mod._stopGcPauseMonitorForTests();
    expect(warn).not.toHaveBeenCalledWith(
      '[GcPauseMonitor] could not observe gc entries:',
      expect.anything()
    );
    warn.mockRestore();
  });
});
