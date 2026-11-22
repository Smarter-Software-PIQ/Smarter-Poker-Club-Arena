import { describe, expect, it } from 'vitest';
import {
  resetEventLoopMonitor,
  snapshotEventLoopDelay,
  startEventLoopMonitor,
} from './eventLoopMonitor.js';

describe('eventLoopMonitor', () => {
  it('samples non-negative event-loop delay percentiles in milliseconds', async () => {
    startEventLoopMonitor();
    resetEventLoopMonitor();
    await new Promise((r) => setTimeout(r, 45));
    const snap = snapshotEventLoopDelay();
    expect(snap.p50Ms).toBeGreaterThanOrEqual(0);
    expect(snap.p95Ms).toBeGreaterThanOrEqual(snap.p50Ms);
    expect(snap.p99Ms).toBeGreaterThanOrEqual(snap.p95Ms);
    expect(snap.maxMs).toBeGreaterThanOrEqual(snap.p99Ms);
    expect(snap.sampleCount).toBeGreaterThan(0);
  });
});
