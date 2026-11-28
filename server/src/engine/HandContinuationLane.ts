import type { HandEvent } from '../types.js';
import type { TimeBankEvent } from './TimeBankEngine.js';
import { carryHorseTurnClock } from './HorseTurnClockReceipt.js';
import { carryRaiseLadder } from './RaiseLadderStamp.js';
export type ContinuationEvent =
  | HandEvent
  | { type: 'CONTINUATION_TIME_BANK'; event: TimeBankEvent };

function cloneContinuationEvent(event: ContinuationEvent): ContinuationEvent {
  const copy = structuredClone(event);
  // Retention and dispatch each detach the public event. Carry live private
  // metadata by identity without adding it to the durable or public payload.
  // A deserialized original has no receipt and deliberately stays unknown.
  if (event.type === 'PLAYER_ACTION' && copy.type === 'PLAYER_ACTION' && copy.record) {
    carryHorseTurnClock(event.record, copy.record);
    carryRaiseLadder(event.record, copy.record);
  }
  return copy;
}
export interface ContinuationEventIdentity {
  sequence: number;
  index: number;
}

/** One controller's original event batch, retained before any consumer sees it. */
export interface HandContinuationBatch {
  version: 1;
  sequence: number;
  controller: string;
  events: ContinuationEvent[];
  engine: Record<string, unknown>;
}

/** Accounting-only engine subset captured after the previous batch dispatches. */
export interface HandContinuationAccounting {
  fields: unknown;
  timeBankMeta: unknown;
  timeBankDebits: unknown;
}

/**
 * Lightweight detached controller metadata captured synchronously alongside
 * `captureController()` so live retention skips `JSON.parse(batch.controller)`
 * on the main thread without altering persisted batch bytes (1e532243 Phase 5).
 */
export interface HandContinuationControllerMetadata {
  handStarted: boolean;
  publicState: unknown;
}

export interface HandContinuationLaneOptions {
  /**
   * Optional narrowed accounting capture that skips control-only fields
   * (`disconnectStates`, `timeBanks`, `waitingForButton`) on the post-dispatch
   * second capture (incident 1e532243).
   */
  captureAccounting?: () => HandContinuationAccounting;
  /**
   * Set true only when `captureEngine` (and `captureAccounting`, if supplied)
   * already return freshly detached deep copies so the lane does not repeat
   * `structuredClone` on the same snapshot tree.
   */
  engineCaptureDetached?: boolean;
  /**
   * Optional detached controller metadata captured on the same synchronous turn
   * as `captureController()` and passed alongside `batch` to `persist`.
   */
  captureControllerMetadata?: () => HandContinuationControllerMetadata;
}

/**
 * The synchronous controller emits several events per mutation. Capture its
 * stable end state at the end of that JavaScript turn, persist one immutable
 * batch, then dispatch those exact events through the existing handlers.
 * A failed or unknown write holds this original batch; it never becomes a new
 * hand or a successful acknowledgement. There is no timer or repair worker.
 */
export class HandContinuationLane {
  private pending: ContinuationEvent[] = [];
  private scheduled = false;
  private tail: Promise<void> = Promise.resolve();
  private sequence: number;
  private failure: unknown;
  private failed = false;
  private closed = false;
  private unretainedBatches = 0;
  private controlDirty = false;
  private retainedSequence: number;
  private replayingOriginal = false;

  isReplayingOriginal(): boolean {
    return this.replayingOriginal;
  }
  private retentionWaiters: Array<{
    sequence: number;
    resolve: () => void;
    reject: (error: unknown) => void;
  }> = [];

  isUnretained(): boolean {
    return (
      this.failed ||
      this.scheduled ||
      this.controlDirty ||
      this.pending.length > 0 ||
      this.unretainedBatches > 0
    );
  }

  /** Pending bytes may settle; a failed, closed or replaced owner may not. */
  canAwaitRetention(): boolean {
    return !this.failed && !this.closed && !this.replayingOriginal && this.current();
  }

  /** A bank/presence decision can change without a controller event. */
  checkpoint(): void {
    if (this.closed || this.failed || !this.current())
      throw new Error('Hand Continuation Is Fenced');
    this.controlDirty = true;
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.captureBatch());
  }

  constructor(
    sequence: number,
    private readonly captureController: () => string,
    private readonly captureEngine: () => Record<string, unknown>,
    private readonly persist: (
      batch: Readonly<HandContinuationBatch>,
      controllerMeta?: Readonly<HandContinuationControllerMetadata>
    ) => Promise<void>,
    private readonly dispatch: (
      event: ContinuationEvent,
      identity: ContinuationEventIdentity
    ) => Promise<void>,
    private readonly current: () => boolean,
    private readonly reportFailure: (error: unknown) => void,
    initialReplay?: () => Promise<void>,
    private readonly retainedInputReady?: () => Promise<void>,
    private readonly beforeFirstDispatch?: () => Promise<void>,
    private readonly options?: HandContinuationLaneOptions
  ) {
    if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Invalid Hand Sequence');
    this.sequence = sequence;
    this.retainedSequence = sequence;
    if (initialReplay) {
      this.replayingOriginal = true;
      // The saved batch already owns its sequence and bytes. Only replay its
      // consumers; later captured batches queue behind this original tail.
      this.tail = Promise.resolve()
        .then(async () => {
          if (this.closed || !this.current()) throw new Error('Hand Continuation Is Fenced');
          await initialReplay();
          if (this.closed || !this.current()) throw new Error('Hand Continuation Is Fenced');
          this.replayingOriginal = false;
          if (!this.isUnretained()) await this.retainedInputReady?.();
        })
        .catch((error) => this.fail(error));
    }
  }

  enqueue(event: ContinuationEvent): void {
    if (this.closed || this.failed || !this.current())
      throw new Error('Hand Continuation Is Fenced');
    this.pending.push(cloneContinuationEvent(event));
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => this.captureBatch());
  }

  private captureBatch(): void {
    this.scheduled = false;
    if (this.pending.length === 0 && !this.controlDirty) return;
    try {
      if (this.failed || this.closed || !this.current())
        throw new Error('Hand Continuation Is Fenced');
      const controller = this.captureController();
      const controllerMeta = this.options?.captureControllerMetadata?.();
      const rawControl = this.captureEngine();
      const control = this.options?.engineCaptureDetached
        ? rawControl
        : structuredClone(rawControl);
      const events = this.pending;
      this.pending = [];
      this.controlDirty = false;
      const sequence = ++this.sequence;
      if (!Number.isSafeInteger(sequence)) throw new Error('Hand Sequence Is Exhausted');
      this.unretainedBatches++;
      this.tail = this.tail
        .then(async () => {
          if (this.failed || this.closed || !this.current())
            throw new Error('Hand Continuation Is Fenced');
          // Engine metadata follows the PREVIOUS fully dispatched batch. The
          // stored events reconstruct only this batch after a process loss.
          // When captureAccounting is supplied, capture only the three
          // accounting fields instead of repeating disconnectStates/timeBanks/
          // waitingForButton copies, and skip redundant structuredClone when
          // the capture producer already detached every mutable field
          // (incident 1e532243).
          const accounting = this.options?.captureAccounting
            ? this.options.captureAccounting()
            : this.captureEngine();
          const detached = this.options?.engineCaptureDetached === true;
          const batch: HandContinuationBatch = {
            version: 1,
            sequence,
            controller,
            events,
            engine: {
              ...control,
              fields: detached ? accounting.fields : structuredClone(accounting.fields),
              timeBankMeta: detached
                ? accounting.timeBankMeta
                : structuredClone(accounting.timeBankMeta),
              timeBankDebits: detached
                ? accounting.timeBankDebits
                : structuredClone(accounting.timeBankDebits),
            },
          };
          await this.persist(batch, controllerMeta);
          if (this.closed || !this.current()) throw new Error('Hand Continuation Is Fenced');
          this.unretainedBatches--;
          this.retainedSequence = sequence;
          const ready = this.retentionWaiters.filter((w) => w.sequence <= sequence);
          this.retentionWaiters = this.retentionWaiters.filter((w) => w.sequence > sequence);
          for (const waiter of ready) waiter.resolve();
          if (sequence === 1 && this.beforeFirstDispatch) {
            await this.beforeFirstDispatch();
            if (this.closed || !this.current()) throw new Error('Hand Continuation Is Fenced');
          }
          for (const [index, event] of batch.events.entries()) {
            if (this.closed || !this.current()) throw new Error('Hand Continuation Is Fenced');
            await this.dispatch(cloneContinuationEvent(event), { sequence, index });
          }
          // A snapshot requested during retention deliberately has no input
          // capability. When this original lane becomes ready, let its owner
          // publish that capability without waiting for another poker action.
          if (!this.closed && !this.isUnretained() && !this.replayingOriginal && this.current())
            await this.retainedInputReady?.();
        })
        .catch((error) => this.fail(error));
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    if (this.failed) return;
    this.failed = true;
    this.failure = error;
    for (const waiter of this.retentionWaiters.splice(0)) waiter.reject(error);
    try {
      this.reportFailure(error);
    } catch {
      // Reporting cannot replace the original persistence failure or create
      // an unhandled rejection. The owner still receives it from join().
    }
  }

  async join(): Promise<void> {
    await this.drainOwnedWork();
    if (this.closed || !this.current()) throw new Error('Hand Continuation Is Fenced');
  }

  /** A terminal owner must join physical writes without demanding a live lease. */
  async drainOwnedWork(): Promise<void> {
    // Admit a controller batch still queued by this same synchronous action.
    if (this.scheduled) this.captureBatch();
    for (;;) {
      const tail = this.tail;
      await tail;
      if (this.scheduled) this.captureBatch();
      if (tail === this.tail) break;
    }
    if (this.failed) throw this.failure;
  }

  /** Network acknowledgement waits for bytes, not the next actor's animation beat. */
  async awaitRetention(): Promise<void> {
    if (this.scheduled) this.captureBatch();
    if (this.failed) throw this.failure;
    if (this.closed || !this.current()) throw new Error('Hand Continuation Is Fenced');
    const sequence = this.sequence;
    if (this.retainedSequence >= sequence) return;
    await new Promise<void>((resolve, reject) =>
      this.retentionWaiters.push({ sequence, resolve, reject })
    );
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.retentionWaiters.splice(0))
      waiter.reject(new Error('Hand Continuation Is Fenced'));
  }
}
