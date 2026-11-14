/**
 * PER-HORSE UPGRADE EVIDENCE FLUSH (2026-11-14)
 *
 * Every minute the per-Horse upgrade cells (engine/HorseUpgradeEvidence.ts)
 * are written to horse_upgrade_evidence_daily through
 * fn_horse_upgrade_evidence_flush, in batches inside the writer's bounds.
 *
 * WHAT HAPPENS TO A BATCH (the semantics of HorseBrainTelemetryPublisher):
 * - acknowledged (recorded or replayed): done.
 * - refused by its bytes (a P0001 the same payload can never pass): dropped
 *   and counted. Never resent.
 * - the function is not installed (PGRST202 / 42883): nothing was written, so
 *   every queued row goes back into the aggregate (bounded by its cell cap) and
 *   the next tick tries again. Counted every tick, reported once per process.
 * - anything else is UNCONFIRMED: the write may have landed with only its
 *   acknowledgement lost. The exact bytes and batch id are kept and resent, so
 *   the writer's batch receipt turns a landed write into a replay instead of
 *   adding it twice. Rows are not put back into the aggregate here, because a
 *   fresh batch id would double-add them. A batch still unconfirmed after
 *   HORSE_UPGRADE_EVIDENCE_MAX_ATTEMPTS flushes is dropped and counted.
 *
 * Memory is bounded: the aggregate holds at most 8,192 cells and the queue at
 * most one drain of it. Not a disk spool: a process that dies loses what it
 * has not written (up to one interval, plus anything retained).
 */
import { createHash, randomUUID } from 'node:crypto';
import { supabase } from './supabase/client.js';
import { reportError } from './errorReporter.js';
import { resolveReleaseIdentity } from '../releaseIdentity.js';
import { noteFire } from '../engine/BrainTelemetry.js';
import {
  drainHorseUpgradeEvidence,
  enableHorseUpgradeEvidence,
  restoreHorseUpgradeEvidence,
  type HorseUpgradeEvidenceRow,
} from '../engine/HorseUpgradeEvidence.js';

/** The writer's bounds (fn_horse_upgrade_evidence_flush). */
export const HORSE_UPGRADE_EVIDENCE_MAX_ROWS = 4096;
export const HORSE_UPGRADE_EVIDENCE_MAX_BYTES = 524_288;
/** A batch unconfirmed this many flushes in a row (an hour at one a minute) is dropped. */
export const HORSE_UPGRADE_EVIDENCE_MAX_ATTEMPTS = 60;
/** Batches written per tick: one full drain (8,192 cells) splits into four or five. */
export const HORSE_UPGRADE_EVIDENCE_TICK_MAX_BATCHES = 8;
/** Shutdown writes stop when another could end past this, inside the worker's graceful stop. */
export const HORSE_UPGRADE_EVIDENCE_SHUTDOWN_BUDGET_MS = 15_000;
const FLUSH_MS = 60_000;
const WRITE_TIMEOUT_MS = 5_000;

/** Writer refusals that are a property of the bytes: the same batch can never be accepted. */
const DETERMINISTIC_REFUSALS = new Set([
  'HORSE_UPGRADE_EVIDENCE_INVALID_PAYLOAD',
  'HORSE_UPGRADE_EVIDENCE_INVALID_HEADER',
  'HORSE_UPGRADE_EVIDENCE_EXPIRED',
  'HORSE_UPGRADE_EVIDENCE_INVALID_BOUNDS',
  'HORSE_UPGRADE_EVIDENCE_INVALID_ROW',
  'HORSE_UPGRADE_EVIDENCE_DUPLICATE_ROW',
  'HORSE_UPGRADE_EVIDENCE_BATCH_COLLISION',
]);

interface SendResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}
interface Dependencies {
  drain(): HorseUpgradeEvidenceRow[];
  restore(rows: readonly HorseUpgradeEvidenceRow[]): void;
  sourceRelease(): string | null;
  send(payload: string): PromiseLike<SendResult>;
  noteFeature(feature: string): void;
  now?(): Date;
  uuid?(): string;
}
type Pending = {
  payload: string;
  batchId: string;
  digest: string;
  attempts: number;
  rows: HorseUpgradeEvidenceRow[];
};
export interface HorseUpgradeEvidenceFlushResult {
  status: 'idle' | 'written' | 'unconfirmed' | 'abandoned' | 'function_missing';
  recorded: number;
  replayed: number;
  rejected: number;
}

const functionMissing = (error: { code?: string }): boolean =>
  error.code === 'PGRST202' || error.code === '42883';

export class HorseUpgradeEvidencePublisher {
  private readonly workerId: string;
  private sequence = 0;
  private queue: Pending[] = [];
  private inFlight: Promise<HorseUpgradeEvidenceFlushResult> | null = null;
  constructor(private readonly deps: Dependencies) {
    this.workerId = (deps.uuid ?? randomUUID)();
  }

  /** Batches still waiting for a confirmed write (shutdown report and tests). */
  pendingBatches(): number {
    return this.queue.length;
  }

  /** Never rejects: every outcome is a status. One flush at a time; a second caller joins the first. */
  flush(
    maxBatches = HORSE_UPGRADE_EVIDENCE_TICK_MAX_BATCHES,
    mayStartWrite: () => boolean = () => true
  ): Promise<HorseUpgradeEvidenceFlushResult> {
    if (this.inFlight) return this.inFlight;
    const operation = this.publish(maxBatches, mayStartWrite).finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
    this.inFlight = operation;
    return operation;
  }

  private batch(day: string, collectedAt: string, rows: HorseUpgradeEvidenceRow[]): Pending {
    const batchId = (this.deps.uuid ?? randomUUID)();
    const release = this.deps.sourceRelease();
    const payload = JSON.stringify({
      version: 1,
      batchId,
      workerId: this.workerId,
      sequence: ++this.sequence,
      sourceRelease: release && /^[a-f0-9]{40}$/.test(release) ? release : null,
      day,
      collectedAt,
      rows: rows.map((row) => ({
        horseUserId: row.horseUserId,
        gameVariant: row.gameVariant,
        lane: row.lane,
        upgradeId: row.upgradeId,
        decisions: row.decisions,
        invoked: row.invoked,
      })),
    });
    return {
      payload,
      batchId,
      digest: createHash('sha256').update(payload).digest('hex'),
      attempts: 0,
      rows,
    };
  }

  /** One batch per day, each inside the row and byte bounds. */
  private split(drained: HorseUpgradeEvidenceRow[]): Pending[] {
    const collectedAt = (this.deps.now ?? (() => new Date()))().toISOString();
    const order = (row: HorseUpgradeEvidenceRow): string =>
      `${row.day}|${row.horseUserId}|${row.gameVariant}|${row.lane}|${row.upgradeId}`;
    const rows = drained
      .map((row) => ({ row, key: order(row) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((entry) => entry.row);
    const out: Pending[] = [];
    let at = 0;
    while (at < rows.length) {
      const day = rows[at]!.day;
      let end = at;
      while (
        end < rows.length &&
        end - at < HORSE_UPGRADE_EVIDENCE_MAX_ROWS &&
        rows[end]!.day === day
      )
        end++;
      let pending = this.batch(day, collectedAt, rows.slice(at, end));
      // Halve until the bytes fit. A single row is a few hundred bytes, so the loop ends well above one row.
      while (
        Buffer.byteLength(pending.payload) > HORSE_UPGRADE_EVIDENCE_MAX_BYTES &&
        end - at > 1
      ) {
        end = at + Math.ceil((end - at) / 2);
        pending = this.batch(day, collectedAt, rows.slice(at, end));
      }
      out.push(pending);
      at = end;
    }
    return out;
  }

  private async publish(
    maxBatches: number,
    mayStartWrite: () => boolean
  ): Promise<HorseUpgradeEvidenceFlushResult> {
    const result: HorseUpgradeEvidenceFlushResult = {
      status: 'idle',
      recorded: 0,
      replayed: 0,
      rejected: 0,
    };
    if (this.queue.length === 0) {
      const drained = this.deps.drain();
      if (drained.length === 0) return result;
      this.queue = this.split(drained);
    }
    result.status = 'written';
    for (let sent = 0; sent < maxBatches && this.queue.length > 0 && mayStartWrite(); sent++) {
      const pending = this.queue[0]!;
      pending.attempts++;
      let answer: SendResult;
      try {
        answer = await this.deps.send(pending.payload);
      } catch (error) {
        // A send that throws (a timeout abort, a client fault) is unconfirmed like any transport failure.
        answer = { data: null, error: { message: error instanceof Error ? error.message : '' } };
      }
      if (answer.error) {
        if (functionMissing(answer.error)) {
          // Nothing was written: give every queued row back and let the next tick ask again.
          for (const queued of this.queue) this.deps.restore(queued.rows);
          this.queue = [];
          this.deps.noteFeature('per_horse_evidence_function_missing_seen');
          result.status = 'function_missing';
          return result;
        }
        if (answer.error.code === 'P0001' && DETERMINISTIC_REFUSALS.has(answer.error.message)) {
          this.queue.shift();
          this.deps.noteFeature('per_horse_evidence_batch_rejected_seen');
          result.rejected++;
          continue;
        }
        return this.unconfirmed(pending, result);
      }
      const ack = answer.data as Record<string, unknown> | null;
      if (
        !ack ||
        typeof ack !== 'object' ||
        Array.isArray(ack) ||
        ack.version !== 1 ||
        (ack.status !== 'recorded' && ack.status !== 'replayed') ||
        ack.batchId !== pending.batchId ||
        ack.payloadSha256 !== pending.digest
      )
        return this.unconfirmed(pending, result);
      this.queue.shift();
      result[ack.status as 'recorded' | 'replayed']++;
    }
    return result;
  }

  private unconfirmed(
    pending: Pending,
    result: HorseUpgradeEvidenceFlushResult
  ): HorseUpgradeEvidenceFlushResult {
    if (pending.attempts >= HORSE_UPGRADE_EVIDENCE_MAX_ATTEMPTS) {
      this.queue.shift();
      this.deps.noteFeature('per_horse_evidence_batch_abandoned_seen');
      result.status = 'abandoned';
    } else {
      this.deps.noteFeature('per_horse_evidence_write_unconfirmed_seen');
      result.status = 'unconfirmed';
    }
    return result;
  }
}

const publisher = new HorseUpgradeEvidencePublisher({
  drain: drainHorseUpgradeEvidence,
  restore: restoreHorseUpgradeEvidence,
  sourceRelease: () => resolveReleaseIdentity().releaseSha,
  send: (payload) =>
    supabase
      .rpc('fn_horse_upgrade_evidence_flush', { p_payload: payload })
      .abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS)),
  noteFeature: noteFire,
});

let timer: NodeJS.Timeout | null = null;
let tick: Promise<void> | null = null;
let stopOperation: Promise<void> | null = null;
let functionMissingReported = false;

/** One line per outcome that loses rows; the missing function is reported once per process, not per tick. */
function report(result: HorseUpgradeEvidenceFlushResult): void {
  if (result.rejected > 0)
    reportError(
      new Error(
        `Horse upgrade evidence: ${result.rejected} batch(es) refused by the writer and dropped`
      ),
      'HorseUpgradeEvidenceFlush.rejected'
    );
  if (result.status === 'abandoned')
    reportError(
      new Error('Horse upgrade evidence batch unconfirmed for an hour and dropped'),
      'HorseUpgradeEvidenceFlush.abandoned'
    );
  if (result.status === 'function_missing' && !functionMissingReported) {
    functionMissingReported = true;
    reportError(
      new Error(
        'fn_horse_upgrade_evidence_flush is not installed: per-Horse upgrade evidence is held in memory (capped) until it is'
      ),
      'HorseUpgradeEvidenceFlush.function_missing'
    );
  }
}

async function publish(
  maxBatches?: number,
  mayStartWrite?: () => boolean
): Promise<HorseUpgradeEvidenceFlushResult['status'] | 'failed'> {
  try {
    const result = await publisher.flush(maxBatches, mayStartWrite);
    report(result);
    return result.status;
  } catch (error) {
    reportError(error, 'HorseUpgradeEvidenceFlush.flush');
    return 'failed';
  }
}

/** Diagnostics and tests: batches the publisher still retains. */
export function horseUpgradeEvidencePendingBatches(): number {
  return publisher.pendingBatches();
}

export function startHorseUpgradeEvidenceFlush(): void {
  if (timer) return;
  if (process.env.BRAIN_TELEMETRY_ENABLED === 'false') return;
  stopOperation = null;
  stopStartedAt = null;
  enableHorseUpgradeEvidence();
  timer = setInterval(() => {
    if (tick) return;
    tick = publish(HORSE_UPGRADE_EVIDENCE_TICK_MAX_BATCHES, insideStopBudget).then(() => {
      tick = null;
    });
  }, FLUSH_MS);
  timer.unref?.();
}

/** When the stop began, or null while running. A tick in flight reads it too (insideStopBudget). */
let stopStartedAt: number | null = null;
/** True unless a stop has begun and a write started now could end past its budget. */
const insideStopBudget = (): boolean =>
  stopStartedAt === null ||
  Date.now() - stopStartedAt + WRITE_TIMEOUT_MS <= HORSE_UPGRADE_EVIDENCE_SHUTDOWN_BUDGET_MS;

/**
 * Bounded shutdown write. Waits for a tick in flight, then writes the retained
 * batches and one capture of the partial interval behind them, and stops at
 * the first write that is not acknowledged. Whatever is still retained then is
 * reported by count. Never rejects: evidence cannot fail a shutdown.
 *
 * THE BOUND: the stop resolves within HORSE_UPGRADE_EVIDENCE_SHUTDOWN_BUDGET_MS
 * (15,000 ms) of being called. Every write carries a 5,000 ms abort; after the
 * stop begins no write starts unless it can end inside the budget, and that
 * applies to a tick already in flight as well as to the stop's own writes, so
 * the only write that can be running past a refused start is one that began
 * before the stop and ends within 5,000 ms of it.
 */
export function stopHorseUpgradeEvidenceFlush(): Promise<void> {
  if (stopOperation) return stopOperation;
  if (!timer) return Promise.resolve();
  clearInterval(timer);
  timer = null;
  stopOperation = (async () => {
    stopStartedAt = Date.now();
    if (tick) await tick;
    // First pass: what was retained (or, with nothing retained, the partial interval). Second pass: the partial
    // interval behind a retained queue that has now been written.
    for (let pass = 0; pass < 2; pass++)
      if ((await publish(HORSE_UPGRADE_EVIDENCE_TICK_MAX_BATCHES, insideStopBudget)) !== 'written')
        break;
    const left = publisher.pendingBatches();
    if (left > 0)
      reportError(
        new Error(`Horse upgrade evidence: ${left} batch(es) unwritten at shutdown`),
        'HorseUpgradeEvidenceFlush.shutdown_unwritten'
      );
  })();
  return stopOperation;
}
