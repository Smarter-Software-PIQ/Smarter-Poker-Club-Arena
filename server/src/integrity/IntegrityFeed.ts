/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  INTEGRITY FEED — observe-only anti-cheat data feed (WIRE #5, anti-cheat)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * ADDITIVE wiring glue. At hand completion the live engine hands the just-logged
 * hand_history-shaped row to `integrityFeed.ingestRow(row)`. The feed:
 *   1. normalizes it via the foundation's HandEventAdapter,
 *   2. accumulates it into a bounded in-memory store (the detectors' signal), and
 *   3. periodically runs BotDetector + CollusionDetector over the store,
 *      logging any flags for human review.
 *
 * OBSERVE-ONLY. No enforcement, no auto-action, no gameplay/money effect, and
 * every path swallows its own errors — a bug here can only produce a log line.
 * Gated by the caller on INTEGRITY_FEED === 'on' (default OFF).
 */

import { fromHandHistoryRow, type HandHistoryRow } from './HandEventAdapter.js';
import { accumulateBotHand, createBotAccum, detectBots, scoreBotAccum } from './BotDetector.js';
import {
  accumulatePairsFromHand,
  detectCollusion,
  scoreCollusionPairs,
  type PairAccum,
} from './CollusionDetector.js';
import type { IntegrityFlag, NormalizedHand } from './types.js';

/** True only when the operator explicitly opts in. Default OFF. */
export const INTEGRITY_FEED_ENABLED = process.env.INTEGRITY_FEED === 'on';

/** Default hands processed per event-loop tick during periodic background scans. */
export const DEFAULT_ANALYZE_CHUNK_SIZE = 200;

export interface IntegrityFeedOptions {
  /** Max hands retained in the rolling store. */
  maxHands?: number;
  /** Run the detectors once this many hands have accumulated since the last run. */
  analyzeEvery?: number;
  /** Max hands scanned per event-loop turn during periodic async analysis. */
  analyzeChunkSize?: number;
  logger?: Pick<Console, 'warn'>;
}

function yieldEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Bounded, in-memory accumulator + periodic detector runner. One process-wide
 * instance (exported below) is shared by every table's engine.
 *
 * Uses an O(1) circular ring buffer for hand retention and yields between
 * small chunks via `setImmediate` during periodic scans triggered by
 * `ingestRow()`, so `hand_history` settlement never stalls the shared poker
 * event loop (incident 1e532243).
 */
export class IntegrityFeed {
  private readonly ring: Array<NormalizedHand | undefined>;
  private readonly maxHands: number;
  private readonly analyzeEvery: number;
  private readonly analyzeChunkSize: number;
  private readonly logger: Pick<Console, 'warn'>;
  private head = 0;
  private count = 0;
  private sinceAnalyze = 0;
  private handsIngested = 0;
  private scheduledHandle: ReturnType<typeof setImmediate> | null = null;
  private analysisRunning = false;
  private analysisQueued = false;
  private disposed = false;

  constructor(opts: IntegrityFeedOptions = {}) {
    this.maxHands = Math.max(1, Math.floor(opts.maxHands ?? 5000));
    this.analyzeEvery = Math.max(1, Math.floor(opts.analyzeEvery ?? 250));
    this.analyzeChunkSize = Math.max(
      1,
      Math.floor(opts.analyzeChunkSize ?? DEFAULT_ANALYZE_CHUNK_SIZE)
    );
    this.logger = opts.logger ?? console;
    this.ring = new Array<NormalizedHand | undefined>(this.maxHands);
  }

  /** Oldest-to-newest snapshot of retained hands. */
  snapshotHands(): NormalizedHand[] {
    const out = new Array<NormalizedHand>(this.count);
    for (let i = 0; i < this.count; i++) {
      out[i] = this.ring[(this.head + i) % this.maxHands]!;
    }
    return out;
  }

  private pushHand(normalized: NormalizedHand): void {
    if (this.count < this.maxHands) {
      this.ring[(this.head + this.count) % this.maxHands] = normalized;
      this.count++;
    } else {
      this.ring[this.head] = normalized;
      this.head = (this.head + 1) % this.maxHands;
    }
  }

  private logFlags(flags: IntegrityFlag[], handCount: number): void {
    if (flags.length === 0) return;
    this.logger.warn(
      `[IntegrityFeed] ${flags.length} integrity flag(s) across ${handCount} hands ` +
        `(observe-only, no enforcement): ` +
        flags
          .map((f) => `${f.type}:${f.severity}(${f.score.toFixed(2)})[${f.userIds.join(',')}]`)
          .join(' ')
    );
  }

  private scheduleAsyncAnalyze(): void {
    if (this.disposed) return;
    if (this.analysisRunning || this.scheduledHandle !== null) {
      this.analysisQueued = true;
      return;
    }
    this.scheduledHandle = setImmediate(() => {
      this.scheduledHandle = null;
      if (this.disposed) return;
      void this.drainScheduledAnalyze();
    });
  }

  private async drainScheduledAnalyze(): Promise<void> {
    if (this.analysisRunning || this.disposed) return;
    this.analysisRunning = true;
    try {
      do {
        this.analysisQueued = false;
        await this.analyzeAsync();
      } while (this.analysisQueued && !this.disposed);
    } catch {
      // observe-only: never surface into the runtime
    } finally {
      this.analysisRunning = false;
    }
  }

  /** Fire-and-forget ingest of one persisted hand_history-shaped row. Never throws or blocks. */
  ingestRow(row: HandHistoryRow): void {
    try {
      const normalized = fromHandHistoryRow(row);
      this.pushHand(normalized);
      this.handsIngested++;
      if (++this.sinceAnalyze >= this.analyzeEvery) {
        this.sinceAnalyze = 0;
        this.scheduleAsyncAnalyze();
      }
    } catch {
      // observe-only: never surface into the caller
    }
  }

  /** Run detectors synchronously over the current store. Observe-only — logs flags, never acts. */
  analyze(): IntegrityFlag[] {
    try {
      const snapshot = this.snapshotHands();
      const flags: IntegrityFlag[] = [...detectBots(snapshot), ...detectCollusion(snapshot)];
      this.logFlags(flags, snapshot.length);
      return flags;
    } catch {
      return [];
    }
  }

  /**
   * Run detectors across the current store in bounded chunks, yielding to the
   * event loop between chunks so table timers and settlement I/O are never
   * blocked behind a 5,000-hand scan. Produces identical flags to `analyze()`.
   */
  async analyzeAsync(chunkSize = this.analyzeChunkSize): Promise<IntegrityFlag[]> {
    try {
      const snapshot = this.snapshotHands();
      const step = Math.max(1, Math.floor(chunkSize));
      const botAccum = createBotAccum();
      const pairs = new Map<string, PairAccum>();
      for (let i = 0; i < snapshot.length; i += step) {
        if (this.disposed) return [];
        const end = Math.min(snapshot.length, i + step);
        for (let j = i; j < end; j++) {
          const hand = snapshot[j];
          accumulateBotHand(botAccum, hand);
          accumulatePairsFromHand(pairs, hand);
        }
        if (end < snapshot.length) {
          await yieldEventLoopTurn();
        }
      }
      if (this.disposed) return [];
      const flags: IntegrityFlag[] = [...scoreBotAccum(botAccum), ...scoreCollusionPairs(pairs)];
      this.logFlags(flags, snapshot.length);
      return flags;
    } catch {
      return [];
    }
  }

  /** Cancel any queued observe-only background scan. */
  dispose(): void {
    this.disposed = true;
    this.analysisQueued = false;
    if (this.scheduledHandle !== null) {
      clearImmediate(this.scheduledHandle);
      this.scheduledHandle = null;
    }
  }

  /** Diagnostics: number of hands currently retained in the store. */
  size(): number {
    return this.count;
  }

  /** Diagnostics: total hands ever ingested. */
  totalIngested(): number {
    return this.handsIngested;
  }
}

/** Process-wide singleton shared by every table engine. */
export const integrityFeed = new IntegrityFeed();
