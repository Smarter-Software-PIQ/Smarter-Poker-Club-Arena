/**
 * BRAIN TELEMETRY FLUSH — every minute, the day's layer-fire counters land
 * atomically with private batch/source receipts. Retries retain the same
 * immutable ID and bytes, so an uncertain acknowledgement cannot double-add. See
 * engine/BrainTelemetry.ts for what is being counted and why.
 */

import { supabase } from './supabase/client.js';
import { reportError } from './errorReporter.js';
import { HorseBrainTelemetryPublisher } from './HorseBrainTelemetryPublisher.js';
import { resolveReleaseIdentity } from '../releaseIdentity.js';
import {
  enableBrainTelemetry,
  drainFires,
  drainDecisionLatency,
  noteFire,
} from '../engine/BrainTelemetry.js';

const FLUSH_MS = 60_000;
/** The longest one write can take (the send's abort timeout). */
const BRAIN_TELEMETRY_WRITE_TIMEOUT_MS = 5_000;
let timer: NodeJS.Timeout | null = null;
let lifecycleGeneration = 0;
let lifecycleActive = false;
let stopOperation: Promise<void> | null = null;
const inFlightFlushes = new Set<Promise<void>>();
const publisher = new HorseBrainTelemetryPublisher({
  capture: () => ({ fires: drainFires(), latency: drainDecisionLatency() }),
  sourceRelease: () => resolveReleaseIdentity().releaseSha,
  send: async (payload) =>
    supabase
      .rpc('fn_horse_brain_flush_receipt', { p_payload: payload })
      .abortSignal(AbortSignal.timeout(BRAIN_TELEMETRY_WRITE_TIMEOUT_MS)),
});

async function publishBatch(): Promise<
  'idle' | 'recorded' | 'replayed' | 'expired' | 'rejected' | 'abandoned'
> {
  const result = await publisher.flush();
  if (result === 'rejected') {
    // A batch the writer refuses by its bytes is dropped, never resent forever (review 64466c83, H1).
    noteFire('phase15_telemetry_batch_rejected');
    reportError(
      new Error('Horse telemetry batch refused by the writer and dropped'),
      'BrainTelemetryFlush.rejected'
    );
  }
  if (result === 'abandoned') {
    noteFire('phase15_telemetry_batch_abandoned');
    reportError(
      new Error('Horse telemetry batch unconfirmed for an hour and dropped'),
      'BrainTelemetryFlush.abandoned'
    );
  }
  if (result === 'expired') {
    noteFire('phase15_telemetry_batch_expired');
    reportError(
      new Error('Horse telemetry batch exceeded the retained receipt window'),
      'BrainTelemetryFlush.expired'
    );
  }
  return result;
}

async function flush(generation: number): Promise<void> {
  if (!lifecycleActive || lifecycleGeneration !== generation) return;
  await publishBatch();
}

function launchFlush(context: string): void {
  const generation = lifecycleGeneration;
  if (!lifecycleActive || inFlightFlushes.size > 0) return;
  let tracked!: Promise<void>;
  tracked = flush(generation)
    .catch((err: unknown) => reportError(err, context))
    .finally(() => inFlightFlushes.delete(tracked));
  inFlightFlushes.add(tracked);
}

async function drainFlushes(): Promise<void> {
  while (inFlightFlushes.size > 0) await Promise.allSettled([...inFlightFlushes]);
}

/** At most this many batches are written at shutdown: the retained ones, then the partial interval behind them,
 * split. A capture at the full style_shadow key cap (68,600 counters) splits into 17 counter batches; the bound
 * leaves room for the retained head and latency rows. */
export const BRAIN_TELEMETRY_SHUTDOWN_MAX_BATCHES = 32;
/** Shutdown writes stop when another write could end past this budget, inside the engine's 40-second graceful
 * deadline (GameServer.ts) with room for the other owned stops. */
export const BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS = 20_000;

/** The worker calls stop only after its accepted decision FIFO has drained.
 * Finish the retained batches first (an uncertain head and any split remainder), then capture the partial interval
 * behind them and write every batch it splits into, so a split capture is not cut off after its first batch. The
 * loop is bounded by count (BRAIN_TELEMETRY_SHUTDOWN_MAX_BATCHES) and by time (no write starts unless it can end
 * inside BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS), and stops at the first unconfirmed write; whatever is still retained
 * then is reported by count, never retried in a loop. No disk durability claim. A restart takes ownership before
 * any new capture. */
async function finishFlushes(generation: number, wasActive: boolean): Promise<void> {
  const startedAt = Date.now();
  await drainFlushes();
  if (!wasActive) return;
  const reportUnwritten = (why: string) => {
    const left = publisher.pendingBatches();
    if (left > 0)
      reportError(
        new Error(`Horse telemetry: ${left} batch(es) unwritten at shutdown (${why})`),
        'BrainTelemetryFlush.shutdown_unwritten'
      );
  };
  let captured = false;
  for (let batch = 0; batch < BRAIN_TELEMETRY_SHUTDOWN_MAX_BATCHES; batch++) {
    if (lifecycleActive || lifecycleGeneration !== generation) return;
    if (publisher.pendingBatches() === 0) {
      // the retained batches are written; capture the partial interval once
      if (captured) return;
      captured = true;
    }
    if (
      Date.now() - startedAt + BRAIN_TELEMETRY_WRITE_TIMEOUT_MS >
      BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS
    ) {
      reportUnwritten('time budget');
      return;
    }
    let result: Awaited<ReturnType<typeof publishBatch>>;
    try {
      result = await publishBatch();
    } catch (error) {
      reportUnwritten('unconfirmed write');
      throw error;
    }
    if (result === 'idle') return;
  }
  reportUnwritten('batch bound');
}

/** Diagnostics and tests: batches the publisher still retains. */
export function brainTelemetryPendingBatches(): number {
  return publisher.pendingBatches();
}

export function startBrainTelemetryFlush(): void {
  if (timer) return;
  if (process.env.BRAIN_TELEMETRY_ENABLED === 'false') return;
  lifecycleActive = true;
  lifecycleGeneration += 1;
  stopOperation = null;
  enableBrainTelemetry();
  timer = setInterval(() => {
    launchFlush('BrainTelemetryFlush.tick');
  }, FLUSH_MS);
  timer.unref?.();
}

export function stopBrainTelemetryFlush(): Promise<void> {
  if (stopOperation) return stopOperation;
  const wasActive = lifecycleActive;
  lifecycleActive = false;
  lifecycleGeneration += 1;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  stopOperation = finishFlushes(lifecycleGeneration, wasActive).catch((error) => {
    reportError(error, 'BrainTelemetryFlush.stop');
    throw error;
  });
  return stopOperation;
}
