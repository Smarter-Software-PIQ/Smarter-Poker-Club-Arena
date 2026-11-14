import { createHash, randomUUID } from 'node:crypto';
import type { drainFires, drainDecisionLatency } from '../engine/BrainTelemetry.js';

export interface HorseBrainTelemetryCapture {
  fires: ReturnType<typeof drainFires>;
  latency: ReturnType<typeof drainDecisionLatency>;
}
interface Dependencies {
  capture(): HorseBrainTelemetryCapture;
  sourceRelease(): string | null;
  send(
    payload: string
  ): Promise<{ data: unknown; error: { message: string; code?: string } | null }>;
  now?(): Date;
  uuid?(): string;
}
export type HorseBrainTelemetryPublishResult =
  | 'idle'
  | 'recorded'
  | 'replayed'
  | 'expired'
  | 'rejected'
  | 'abandoned';

/**
 * The writer's bounds (fn_horse_brain_flush_receipt, migration 20260914130422): at most 4,096 counters, 256
 * latency rows and 524,288 bytes per batch. A capture larger than that is SPLIT into several batches, each with its
 * own ID and sequence, so one large capture can never be a batch the writer must refuse.
 */
export const HORSE_TELEMETRY_MAX_FIRES = 4096;
export const HORSE_TELEMETRY_MAX_LATENCY = 256;
export const HORSE_TELEMETRY_MAX_BYTES = 524_288;
/** A batch whose write stays unconfirmed this many flushes in a row (an hour at one a minute) is abandoned. */
export const HORSE_TELEMETRY_MAX_ATTEMPTS = 60;
/** Writer refusals that are a property of the bytes: the same batch can never be accepted, so it is dropped. */
const DETERMINISTIC_REFUSALS = new Set([
  'HORSE_FLUSH_INVALID_PAYLOAD',
  'HORSE_FLUSH_INVALID_HEADER',
  'HORSE_FLUSH_INVALID_BOUNDS',
  'HORSE_FLUSH_INVALID_COUNTER',
  'HORSE_FLUSH_DUPLICATE_FEATURE',
  'HORSE_FLUSH_INVALID_LATENCY',
  'HORSE_FLUSH_INVALID_LATENCY_TOTAL',
  'HORSE_FLUSH_INVALID_BUCKET',
  'HORSE_FLUSH_BUCKET_COUNT_MISMATCH',
  'HORSE_FLUSH_DUPLICATE_SCOPE',
  'HORSE_FLUSH_BATCH_COLLISION',
  'HORSE_FLUSH_SEQUENCE_COLLISION',
]);

type Pending = { payload: string; batchId: string; digest: string; attempts: number; day: string };
/** A batch that was dropped unwritten: the UTC day whose counters are now incomplete, and whose it was. */
export interface HorseBrainTelemetryDrop {
  batchId: string;
  day: string;
  workerId: string;
}

/** Retained, immutable batches per publisher, oldest first. A transport error or malformed acknowledgement keeps
 * the exact bytes and ID of the head batch for the next attempt; newly arriving counters remain in their
 * accumulators. A refusal that the same bytes can never pass drops that batch (result 'rejected'), and a batch that
 * stays unconfirmed for HORSE_TELEMETRY_MAX_ATTEMPTS flushes is dropped (result 'abandoned'), so one batch never
 * stalls a worker's telemetry for good. This is not a disk spool or a complete decision ledger and cannot account
 * for process-crash loss. */
export class HorseBrainTelemetryPublisher {
  private readonly workerId: string;
  private sequence = 0;
  private queue: Pending[] = [];
  private inFlight: Promise<HorseBrainTelemetryPublishResult> | null = null;
  private dropped: HorseBrainTelemetryDrop | null = null;
  constructor(private readonly deps: Dependencies) {
    this.workerId = (deps.uuid ?? randomUUID)();
  }

  flush(): Promise<HorseBrainTelemetryPublishResult> {
    if (this.inFlight) return this.inFlight;
    const operation = this.publish();
    this.inFlight = operation;
    void operation
      .finally(() => {
        if (this.inFlight === operation) this.inFlight = null;
      })
      .catch(() => undefined);
    return operation;
  }

  /** Batches still waiting for a confirmed write (diagnostics and tests). */
  pendingBatches(): number {
    return this.queue.length;
  }

  /** The UTC days of the batches still retained, oldest first (what a shutdown that leaves them unwritten loses). */
  pendingDays(): string[] {
    return [...new Set(this.queue.map((pending) => pending.day))].sort();
  }

  /** This publisher's identity in every batch it writes (one per thread per process start). */
  publisherWorkerId(): string {
    return this.workerId;
  }

  /** The batch most recently dropped unwritten (results 'expired', 'rejected' and 'abandoned'). */
  lastDrop(): HorseBrainTelemetryDrop | null {
    return this.dropped;
  }

  private drop(): void {
    const pending = this.queue.shift()!;
    this.dropped = { batchId: pending.batchId, day: pending.day, workerId: this.workerId };
  }

  private batch(
    collectedAt: string,
    fires: HorseBrainTelemetryCapture['fires'],
    latency: HorseBrainTelemetryCapture['latency']
  ): Pending {
    if (!Number.isSafeInteger(this.sequence + 1)) throw Error('Horse telemetry sequence exhausted');
    const batchId = (this.deps.uuid ?? randomUUID)();
    const release = this.deps.sourceRelease();
    const payload = JSON.stringify({
      version: 1,
      batchId,
      workerId: this.workerId,
      sequence: ++this.sequence,
      sourceRelease: release && /^[a-f0-9]{40}$/.test(release) ? release : null,
      day: collectedAt.slice(0, 10),
      collectedAt,
      fires,
      latency,
    });
    return {
      payload,
      batchId,
      digest: createHash('sha256').update(payload).digest('hex'),
      attempts: 0,
      day: collectedAt.slice(0, 10),
    };
  }

  /** Split one capture into batches inside every writer bound (counters, latency rows and bytes). */
  private split(capture: HorseBrainTelemetryCapture): Pending[] {
    const collectedAt = (this.deps.now ?? (() => new Date()))().toISOString();
    const fires = [...capture.fires].sort((a, b) =>
      a.feature < b.feature ? -1 : a.feature > b.feature ? 1 : 0
    );
    const latency = [...capture.latency].sort((a, b) =>
      a.scope < b.scope ? -1 : a.scope > b.scope ? 1 : 0
    );
    const out: Pending[] = [];
    let f = 0;
    let l = 0;
    while (f < fires.length || l < latency.length) {
      let fn = Math.min(HORSE_TELEMETRY_MAX_FIRES, fires.length - f);
      let ln = Math.min(HORSE_TELEMETRY_MAX_LATENCY, latency.length - l);
      let b = this.batch(collectedAt, fires.slice(f, f + fn), latency.slice(l, l + ln));
      // halve until the bytes fit (a sequence number is spent per attempt; the writer needs only uniqueness). Every
      // step lowers fn + ln (a side of 1 goes to 0), so the loop ends at one row; a single row still above the
      // bytes bound is sent as it is and the writer's refusal drops it ('rejected').
      while (Buffer.byteLength(b.payload) > HORSE_TELEMETRY_MAX_BYTES && fn + ln > 1) {
        if (fn >= ln) fn = fn > 1 ? Math.ceil(fn / 2) : 0;
        else ln = ln > 1 ? Math.ceil(ln / 2) : 0;
        b = this.batch(collectedAt, fires.slice(f, f + fn), latency.slice(l, l + ln));
      }
      out.push(b);
      f += fn;
      l += ln;
    }
    return out;
  }

  private async publish(): Promise<HorseBrainTelemetryPublishResult> {
    if (this.queue.length === 0) {
      const capture = this.deps.capture();
      if (!capture.fires.length && !capture.latency.length) return 'idle';
      this.queue = this.split(capture);
    }
    const pending = this.queue[0]!;
    pending.attempts++;
    let result: Awaited<ReturnType<Dependencies['send']>>;
    try {
      result = await this.deps.send(pending.payload);
    } catch (error) {
      // A send that throws (a timeout abort, a client fault) is a transport failure like any other: the same bytes
      // are retried, and the batch is abandoned at the attempt cap instead of being resent forever.
      if (pending.attempts >= HORSE_TELEMETRY_MAX_ATTEMPTS) {
        this.drop();
        return 'abandoned';
      }
      throw error;
    }
    if (result.error) {
      // The writer refuses expired batches before any aggregate mutation,
      // even if their old deduplication receipt has already been pruned.
      if (result.error.code === 'P0001' && result.error.message === 'HORSE_FLUSH_EXPIRED') {
        this.drop();
        return 'expired';
      }
      if (result.error.code === 'P0001' && DETERMINISTIC_REFUSALS.has(result.error.message)) {
        this.drop();
        return 'rejected';
      }
      if (pending.attempts >= HORSE_TELEMETRY_MAX_ATTEMPTS) {
        this.drop();
        return 'abandoned';
      }
      throw Error('Horse telemetry batch write unconfirmed');
    }
    const ack = result.data as Record<string, unknown> | null;
    if (
      !ack ||
      typeof ack !== 'object' ||
      Array.isArray(ack) ||
      ack.version !== 1 ||
      !['recorded', 'replayed'].includes(ack.status as string) ||
      ack.batchId !== pending.batchId ||
      ack.payloadSha256 !== pending.digest
    ) {
      if (pending.attempts >= HORSE_TELEMETRY_MAX_ATTEMPTS) {
        this.drop();
        return 'abandoned';
      }
      throw Error('Horse telemetry batch acknowledgement invalid');
    }
    this.queue.shift();
    return ack.status as 'recorded' | 'replayed';
  }
}
