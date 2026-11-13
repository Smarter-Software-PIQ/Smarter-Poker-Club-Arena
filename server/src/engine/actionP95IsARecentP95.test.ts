/**
 * SLOActionLatencyDegraded 377399 (2026-11-13): one 1731 ms raise on a quiet
 * tournament table held the fleet p95 at 1731 for over an hour, because the
 * summary read every retained sample with no age limit. The p95 is now a
 * five-minute window; see ACTION_TIMING_WINDOW_MS in EngineTelemetry.ts.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION_TIMING_WINDOW_MS, EngineTelemetry } from './EngineTelemetry.js';

describe('the action p95 reads only the last five minutes', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a single slow action ages out instead of pinning the gauge', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T17:15:00Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = new EngineTelemetry();
    t.recordActionProcessingTime('feb835d5', 'u1', 'raise', 1731);
    for (let i = 0; i < 5; i++) t.recordActionProcessingTime('feb835d5', 'u1', 'call', 2);

    // Six samples: floor(6 * 0.95) = 5 is the slowest, so it is the p95 now.
    expect(t.getPerformanceSummary().p95ProcessingMs).toBe(1731);

    vi.setSystemTime(Date.now() + ACTION_TIMING_WINDOW_MS + 1);
    const later = t.getPerformanceSummary();
    expect(later.p95ProcessingMs).toBe(0);
    expect(later.actionCount).toBe(0);
  });

  it('a table that stays slow still reads slow', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T17:15:00Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = new EngineTelemetry();
    for (let minute = 0; minute < 20; minute++) {
      t.recordActionProcessingTime('slow', 'u1', 'call', 1500);
      vi.setSystemTime(Date.now() + 60_000);
    }
    expect(t.getPerformanceSummary().p95ProcessingMs).toBe(1500);
  });

  it('violation counters stay lifetime counters', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-13T17:15:00Z'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const t = new EngineTelemetry();
    t.recordActionProcessingTime('x', 'u1', 'raise', 1731);
    vi.setSystemTime(Date.now() + ACTION_TIMING_WINDOW_MS + 1);
    expect(t.getPerformanceSummary().processingViolations).toBe(1);
  });
});
