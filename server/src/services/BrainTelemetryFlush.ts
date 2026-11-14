/**
 * BRAIN TELEMETRY FLUSH — every minute, the day's layer-fire counters land
 * atomically with private batch/source receipts. Retries retain the same
 * immutable ID and bytes, so an uncertain acknowledgement cannot double-add. See
 * engine/BrainTelemetry.ts for what is being counted and why.
 */

import { isMainThread, parentPort } from 'node:worker_threads';
import { supabase } from './supabase/client.js';
import { reportError } from './errorReporter.js';
import { HorseBrainTelemetryPublisher } from './HorseBrainTelemetryPublisher.js';
import { resolveReleaseIdentity } from '../releaseIdentity.js';
// Types only, and it must stay so. This module is in the Horse decision closure (HorseDecisionClosure.ts) and runs
// in every Horse decision worker thread: a value import here would put the engine alert files into the decision
// digest and open a second owner of the main thread's alert journal.
import type {
  HorseTelemetryGap,
  HorseTelemetryGapKind,
  HorseTelemetryWritten,
} from './horseTelemetryGapAlert.js';
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

const THREAD = isMainThread ? 'main' : 'worker';
let mainSink: ((event: unknown) => void) | null = null;

/** The main process wires what happens to a telemetry gap event (index.ts: the engine alert path). This module is
 * part of the Horse decision closure, so it never imports the alert module itself: the sink is injected, and
 * without one an event is only what it already was, a counter and a log line. */
export function setBrainTelemetryGapSink(sink: ((event: unknown) => void) | null): void {
  mainSink = sink;
}

/** The engine alert journal has one owner, the main thread. A Horse decision worker thread posts its event to the
 * main thread (horseDecision/client.ts hands it to relayBrainTelemetryGapEvent there); the main thread calls the
 * injected sink. Never throws. */
function deliver(event: unknown): void {
  try {
    if (!isMainThread) parentPort?.postMessage({ type: 'HORSE_TELEMETRY_GAP', gap: event });
    else mainSink?.(event);
  } catch {
    // An alarm never breaks the flush or the shutdown it reports on.
  }
}

/** Main thread: an event a worker thread posted. */
export function relayBrainTelemetryGapEvent(event: unknown): void {
  if (isMainThread) deliver(event);
}

// The day of this thread's last 'written' notice.
let writtenNoticeDay: string | null = null;

/** Every lost batch is alerted through the existing engine alert path (horseTelemetryGapAlert.ts), at most once
 * per kind per day. */
function reportGap(
  kind: HorseTelemetryGapKind,
  batches: number,
  day: string | undefined,
  shutdown?: { reason: string; intervalUncaptured: boolean }
): void {
  const gap: HorseTelemetryGap = {
    kind,
    batches,
    day: day ?? new Date().toISOString().slice(0, 10),
    workerId: publisher.publisherWorkerId(),
    thread: THREAD,
    ...(shutdown ? { reason: shutdown.reason } : {}),
    ...(shutdown?.intervalUncaptured ? { intervalUncaptured: true } : {}),
  };
  deliver(gap);
}

/** AN ALERT CLOSES ITSELF. A batch confirmed written for a LATER day than an open alert's day proves telemetry is
 * flowing again, and the main thread then resolves every gap alert of an earlier day. Said when the written day
 * changes, so once per UTC day per thread and never on every flush. That is enough for every kind: batches are
 * written oldest first, so a lost batch's day is never before this thread's last notice, and the first batch
 * written for a later day than the loss is always a new day here. A process started today knows no notice at all,
 * so its first written batch closes what a process that stopped yesterday left open. */
function noteWritten(day: string | null): void {
  if (day === null || day === writtenNoticeDay) return;
  writtenNoticeDay = day;
  const written: HorseTelemetryWritten = {
    kind: 'written',
    day,
    workerId: publisher.publisherWorkerId(),
    thread: THREAD,
  };
  deliver(written);
}

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
    reportGap('rejected', 1, publisher.lastDrop()?.day);
  }
  if (result === 'abandoned') {
    noteFire('phase15_telemetry_batch_abandoned');
    reportError(
      new Error('Horse telemetry batch unconfirmed for an hour and dropped'),
      'BrainTelemetryFlush.abandoned'
    );
    reportGap('abandoned', 1, publisher.lastDrop()?.day);
  }
  if (result === 'expired') {
    noteFire('phase15_telemetry_batch_expired');
    reportError(
      new Error('Horse telemetry batch exceeded the retained receipt window'),
      'BrainTelemetryFlush.expired'
    );
    reportGap('expired', 1, publisher.lastDrop()?.day);
  }
  if (result === 'recorded' || result === 'replayed') noteWritten(publisher.lastWrittenDay());
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
  const drainedAt = Date.now();
  let written = 0;
  let dropped = 0;
  let outcome: 'complete' | 'superseded' | 'time_budget' | 'batch_bound' | 'unconfirmed_write' =
    'complete';
  let captured = false;
  // True once the write that captures the last partial interval has started. A stop that ends before it leaves
  // that interval's counters in memory, lost with the process and in no batch: said, never passed over.
  let captureStarted = false;
  const reportUnwritten = (why: string) => {
    const left = publisher.pendingBatches();
    if (left > 0)
      reportError(
        new Error(`Horse telemetry: ${left} batch(es) unwritten at shutdown (${why})`),
        'BrainTelemetryFlush.shutdown_unwritten'
      );
    else if (!captureStarted)
      reportError(
        new Error(
          `Horse telemetry: the last partial interval was not captured at shutdown (${why})`
        ),
        'BrainTelemetryFlush.shutdown_unwritten'
      );
    if (left > 0 || !captureStarted)
      reportGap('shutdown_unwritten', left, publisher.pendingDays()[0], {
        reason: why,
        intervalUncaptured: !captureStarted,
      });
  };
  try {
    for (let batch = 0; batch < BRAIN_TELEMETRY_SHUTDOWN_MAX_BATCHES; batch++) {
      if (lifecycleActive || lifecycleGeneration !== generation) {
        outcome = 'superseded';
        return;
      }
      if (publisher.pendingBatches() === 0) {
        // the retained batches are written; capture the partial interval once
        if (captured) return;
        captured = true;
      }
      if (
        Date.now() - startedAt + BRAIN_TELEMETRY_WRITE_TIMEOUT_MS >
        BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS
      ) {
        outcome = 'time_budget';
        reportUnwritten('time budget');
        return;
      }
      if (captured) captureStarted = true;
      let result: Awaited<ReturnType<typeof publishBatch>>;
      try {
        result = await publishBatch();
      } catch (error) {
        outcome = 'unconfirmed_write';
        reportUnwritten('unconfirmed write');
        throw error;
      }
      if (result === 'idle') return;
      if (result === 'recorded' || result === 'replayed') written++;
      else dropped++;
    }
    // Exactly the bound written and nothing pending still leaves the last interval uncaptured: not a complete stop.
    if (publisher.pendingBatches() > 0 || !captureStarted) outcome = 'batch_bound';
    reportUnwritten('batch bound');
  } finally {
    // SHUTDOWN EVIDENCE (2026-11-14). The fit of this stop inside the engine's 40,000 ms graceful deadline was
    // arithmetic, never measured. One line per stopping thread, printed with the other shutdown lines
    // ("[GameServer] shutdown service ... took ...ms to stop"), says what the stop really took and left behind.
    const endedAt = Date.now();
    try {
      console.log(
        `[BrainTelemetryFlush] shutdown stop thread=${THREAD} worker_id=${publisher.publisherWorkerId()}` +
          ` outcome=${outcome} duration_ms=${endedAt - startedAt} drain_ms=${drainedAt - startedAt}` +
          ` batches_written=${written} batches_dropped=${dropped}` +
          ` batches_unwritten=${publisher.pendingBatches()} interval_captured=${captureStarted}` +
          ` budget_ms=${BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS} max_batches=${BRAIN_TELEMETRY_SHUTDOWN_MAX_BATCHES}`
      );
    } catch {
      // A closed stdout must not turn a clean stop into a failed one.
    }
  }
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
