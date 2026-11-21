/**
 * Lightweight Node.js event-loop delay monitor (2026-11-21).
 *
 * Exposes p50/p95/p99/max event-loop delay in milliseconds on `/health` so
 * operators can immediately distinguish local Node.js CPU/GC pauses from
 * PostgreSQL latency whenever `nextHandGap` or action latency spikes.
 */
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

export interface EventLoopDelaySnapshot {
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  sampleCount: number;
}

const NS_PER_MS = 1_000_000;
let histogram: IntervalHistogram | null = null;

function ensureHistogram(): IntervalHistogram {
  if (!histogram) {
    histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
  }
  return histogram;
}

function toMs(ns: number): number {
  if (!Number.isFinite(ns) || ns <= 0) return 0;
  return Math.round((ns / NS_PER_MS) * 100) / 100;
}

export function startEventLoopMonitor(): void {
  ensureHistogram();
}

export function snapshotEventLoopDelay(): EventLoopDelaySnapshot {
  const h = ensureHistogram();
  return {
    p50Ms: toMs(h.percentile(50)),
    p95Ms: toMs(h.percentile(95)),
    p99Ms: toMs(h.percentile(99)),
    maxMs: toMs(h.max),
    sampleCount: h.count,
  };
}

export function resetEventLoopMonitor(): void {
  if (histogram) {
    histogram.reset();
  }
}
