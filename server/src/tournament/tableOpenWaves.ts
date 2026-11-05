/**
 * BIG TOURNAMENTS OPEN AND DEAL IN WAVES (Dan 2026-11-05, fix 4:
 * "ADD WAVE STARTS FOR BIG TOURNAMENTS").
 *
 * Deliberately import-free, like engineStartBudget.ts and
 * tournamentResumeBudget.ts: the law is arithmetic and a clock, and its test
 * must not have to half-initialise a database client to run.
 *
 * THE INCIDENT, measured from production (engine_recovery_events and
 * tournament_launch_receipts, read-only, 2026-11-05)
 *
 *   2026-10-27 13:30 UTC, the two 8:30 AM Chicago "Morning Free Buy (NLH)"
 *   events, 58 and 60 tables, launched in the same minute. Their launches took
 *   640 s and 699 s from claim to completion (a normal launch of that size
 *   takes 120-170 s), and at 13:33:31-13:34:29 the zombie sweep killed 115 of
 *   their 118 tables, every one with hand_count 0 and every one inside a
 *   start-up read: start_load_table, start_seed_hand_count,
 *   start_crash_recovery, start_time_bank_restore. 2026-10-25 13:27 UTC, the
 *   same pair (45 + 45 tables): 41 tables killed as tournament_lease_lost while
 *   the launch was still opening its tables. 2026-11-01 22:31 UTC: 23 tables
 *   of a 33-table field killed in the same second, all in their first deal.
 *
 * THE CAUSE. Every tournament manager started every one of its dealers at
 * once (startManagedTableEngine in a loop), and every dealer start is a burst
 * of database work before it can deal: the retained-hand replay, the F06
 * hand-number state RPC, then start()'s six reads (the table row, the last
 * hand number, the button, the crash snapshot, the parked presence and time
 * banks), and then the first hand's lock-sensitive writes (permit, seats,
 * funding, continuation). Nothing bounded that across managers, so two
 * 60-table fields launching together put ~120 of those bursts on the database
 * in the same second, and once at the advertised start every one of their
 * first hands wrote together too. The reads queued behind each other past the
 * 180 s zombie threshold and the sweep rebuilt the tables, which re-ran every
 * read into the same queue.
 *
 * THE PATTERN THAT ALREADY WORKS. The hourly maintenance break resumes the
 * whole fleet in waves (MaintenanceBreak.planResumeWaves: at least 25 tables a
 * wave, 1500 ms apart) and has been clean all day, e.g. "resuming 202
 * table(s) in 8 wave(s), 1500ms apart". This module applies that same
 * envelope, 25 tables per 1500 ms, to the two moments a tournament puts many
 * tables on the database at once:
 *
 *   1. OPENING (TableOpenGate): one process-wide budget for every tournament
 *      dealer start - launch, boot/resume re-adoption, late-registration
 *      capacity tables, restarts. At most TABLE_OPEN_WAVE_SIZE starts are
 *      admitted per TABLE_OPEN_WAVE_GAP_MS, and at most
 *      TABLE_OPEN_IN_FLIGHT_MAX may be inside their start-up reads at once. A
 *      start waits its turn in FIFO order before its first read; it holds its
 *      slot until its engine is ready (the reads are done) or fails, never
 *      longer than TABLE_OPEN_SLOT_HORIZON_MS. Because it is ONE budget, two
 *      big events launching together share it instead of doubling the load.
 *
 *   2. THE FIRST DEAL (FirstDealWaves): a launch seats its field before the
 *      advertised start and holds every table to that instant. The tables of
 *      every launch sharing that instant are dealt into waves of
 *      FIRST_DEAL_WAVE_SIZE, FIRST_DEAL_WAVE_GAP_MS apart: wave 0 deals AT the
 *      advertised start, and the last of 120 tables five waves (7.5 s) later.
 *      Never more than FIRST_DEAL_MAX_WAVES waves, so the whole field is
 *      dealing within 28.5 s however many events share the minute.
 *
 * WHAT IT DOES NOT CHANGE. No launch proof, receipt, cohort, funding or seat
 * proof, break-window guard or capacity admission is skipped or reordered:
 * the gate sits in front of the existing admission, which runs unchanged once
 * the slot is granted, and a wave hold is the same monotonic holdDealingUntil
 * every other hold uses (it can only lengthen a hold, never shorten one). The
 * level clock still starts at the advertised instant.
 *
 * SECTION 10.5. Nothing here knows or asks who is seated. Tables are ordered
 * by a stable hash of the table id, the same FNV-1a order the maintenance
 * resume uses, and opening order is first come, first served.
 */

/** Tournament dealer starts admitted per wave, process-wide. */
export const TABLE_OPEN_WAVE_SIZE = 25;
/** Gap between opening waves (the maintenance resume gap). */
export const TABLE_OPEN_WAVE_GAP_MS = 1500;
/**
 * Dealer starts allowed inside their start-up reads at once, process-wide.
 * Two waves: a healthy start finishes its reads in well under a wave gap, so
 * this binds only when the database is slow - which is exactly when adding
 * more readers is what turned a slow launch into a kill storm.
 */
export const TABLE_OPEN_IN_FLIGHT_MAX = 50;
/**
 * Longest one start holds its slot. The budget must never be the thing that
 * stops tables opening: a start wedged for good would otherwise keep its slot
 * for the life of the process. After this the start still runs (and still
 * answers to its own watchdogs); it just no longer holds back the others.
 */
export const TABLE_OPEN_SLOT_HORIZON_MS = 30_000;

/** Tables per first-deal wave across every launch sharing one start instant. */
export const FIRST_DEAL_WAVE_SIZE = 25;
/** Gap between first-deal waves. */
export const FIRST_DEAL_WAVE_GAP_MS = 1500;
/** Waves never exceed this: the whole field deals within (MAX - 1) * GAP. */
export const FIRST_DEAL_MAX_WAVES = 20;
/** The longest first-deal spread the waves can produce. */
export const FIRST_DEAL_MAX_SPREAD_MS = (FIRST_DEAL_MAX_WAVES - 1) * FIRST_DEAL_WAVE_GAP_MS;
/** How long a start instant's wave count is remembered after it passes. */
export const FIRST_DEAL_MEMORY_MS = 10 * 60_000;

/** FNV-1a, 32-bit: the same stable table order MaintenanceBreak resumes by. */
export function tableWaveHash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable wave order: hash of the id, ties by id. */
export function orderTablesForWaves(tableIds: Iterable<string>): string[] {
  return [...new Set(tableIds)].sort((a, b) => {
    const ha = tableWaveHash(a);
    const hb = tableWaveHash(b);
    if (ha !== hb) return ha - hb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export interface TableOpenSlot {
  /** Idempotent. Frees the slot and lets the next queued start in. */
  release(): void;
}

export interface TableOpenGateOptions {
  waveSize?: number;
  gapMs?: number;
  inFlightMax?: number;
  horizonMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  log?: (message: string) => void;
}

export interface TableOpenGateStats {
  inFlight: number;
  queued: number;
  grantedTotal: number;
  maxQueued: number;
  maxQueueWaitMs: number;
}

interface Waiter {
  stillWanted: () => boolean;
  resolve: (slot: TableOpenSlot) => void;
  queuedAt: number;
}

const NO_SLOT: TableOpenSlot = { release: () => {} };

/**
 * The process-wide opening budget. See the header for the incident and the law.
 * Timers are read from the global scope at use, so a test's fake clock drives
 * it exactly as it drives everything else.
 */
export class TableOpenGate {
  private readonly waveSize: number;
  private readonly gapMs: number;
  private readonly inFlightMax: number;
  private readonly horizonMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;
  private readonly log: (message: string) => void;

  private windowStartedAt = Number.NEGATIVE_INFINITY;
  private grantedInWindow = 0;
  private inFlight = 0;
  private queue: Waiter[] = [];
  private pumpTimer: unknown = null;
  private grantedTotal = 0;
  private maxQueued = 0;
  private maxQueueWaitMs = 0;

  constructor(options: TableOpenGateOptions = {}) {
    this.waveSize = Math.max(1, Math.floor(options.waveSize ?? TABLE_OPEN_WAVE_SIZE));
    this.gapMs = Math.max(1, options.gapMs ?? TABLE_OPEN_WAVE_GAP_MS);
    this.inFlightMax = Math.max(1, Math.floor(options.inFlightMax ?? TABLE_OPEN_IN_FLIGHT_MAX));
    this.horizonMs = Math.max(1, options.horizonMs ?? TABLE_OPEN_SLOT_HORIZON_MS);
    this.now = options.now ?? (() => Date.now());
    this.setTimer =
      options.setTimer ??
      ((callback, ms) => {
        const timer = setTimeout(callback, ms);
        (timer as { unref?: () => void }).unref?.();
        return timer;
      });
    this.clearTimer =
      options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
    this.log = options.log ?? ((message) => console.log(message));
  }

  /** A slot now, or null when the start must queue (room used, or others waiting). */
  tryAcquire(): TableOpenSlot | null {
    if (this.queue.length > 0 || !this.hasRoom()) return null;
    return this.grant();
  }

  /**
   * Wait for a slot, first come first served. `stillWanted` is asked when the
   * slot comes up: a start whose manager or dealer generation has gone by then
   * is answered with an empty slot WITHOUT spending the wave's room, and its
   * own admission check refuses it as before.
   */
  acquire(stillWanted: () => boolean = () => true): Promise<TableOpenSlot> {
    const immediate = this.tryAcquire();
    if (immediate) return Promise.resolve(immediate);
    return new Promise<TableOpenSlot>((resolve) => {
      this.queue.push({ stillWanted, resolve, queuedAt: this.now() });
      if (this.queue.length > this.maxQueued) this.maxQueued = this.queue.length;
      this.pump();
    });
  }

  stats(): TableOpenGateStats {
    return {
      inFlight: this.inFlight,
      queued: this.queue.length,
      grantedTotal: this.grantedTotal,
      maxQueued: this.maxQueued,
      maxQueueWaitMs: this.maxQueueWaitMs,
    };
  }

  private hasRoom(): boolean {
    const now = this.now();
    if (now - this.windowStartedAt >= this.gapMs) {
      this.windowStartedAt = now;
      this.grantedInWindow = 0;
    }
    return this.grantedInWindow < this.waveSize && this.inFlight < this.inFlightMax;
  }

  private grant(): TableOpenSlot {
    this.grantedInWindow++;
    this.inFlight++;
    this.grantedTotal++;
    let released = false;
    let horizon: unknown = null;
    const release = () => {
      if (released) return;
      released = true;
      if (horizon !== null) this.clearTimer(horizon);
      this.inFlight = Math.max(0, this.inFlight - 1);
      this.pump();
    };
    horizon = this.setTimer(release, this.horizonMs);
    return { release };
  }

  private pump(): void {
    // A start whose manager stood down or whose dealer was replaced while it
    // waited leaves at once, wherever it is in the line, so a manager's
    // teardown (which waits for its start jobs) is never held behind a queue.
    if (this.queue.length > 0) {
      const keep: Waiter[] = [];
      for (const waiter of this.queue) {
        let wanted = true;
        try {
          wanted = waiter.stillWanted();
        } catch {
          wanted = false;
        }
        if (wanted) keep.push(waiter);
        else waiter.resolve(NO_SLOT);
      }
      this.queue = keep;
    }
    let granted = 0;
    while (this.queue.length > 0 && this.hasRoom()) {
      const head = this.queue.shift()!;
      const waited = this.now() - head.queuedAt;
      if (waited > this.maxQueueWaitMs) this.maxQueueWaitMs = waited;
      head.resolve(this.grant());
      granted++;
    }
    if (granted > 0) {
      this.log(
        `[TableOpenWaves] opened a wave of ${granted} tournament table(s); ` +
          `${this.inFlight} opening, ${this.queue.length} waiting for the next wave ` +
          `(${this.waveSize} per ${this.gapMs}ms, ${this.inFlightMax} at once)`
      );
    }
    // Come back when the wave window turns over: that grants the next wave,
    // and it re-checks the waiters even while the in-flight cap is what
    // blocks (a release also pumps at once). The slot horizon bounds both.
    if (this.queue.length > 0 && this.pumpTimer === null) {
      const wait = Math.max(
        1,
        Math.min(this.gapMs, this.windowStartedAt + this.gapMs - this.now())
      );
      this.pumpTimer = this.setTimer(() => {
        this.pumpTimer = null;
        this.pump();
      }, wait);
    }
  }
}

/**
 * First-deal waves for launches that hold their field to an advertised start.
 * Process-wide, keyed by the exact start instant, so every launch sharing that
 * instant continues the same wave count instead of starting its own wave 0.
 *
 * Idempotent per table: a table already given a wave for an instant keeps it.
 * The launch assigns its whole field at once (stable hash order); the per-table
 * booked-start hold that every dealer start re-applies (a resume during the
 * pre-seat minute, a restarted table) then finds the same answer instead of
 * pushing the table to a later wave.
 */
export class FirstDealWaves {
  private readonly ledger = new Map<number, { next: number; at: Map<string, number> }>();

  constructor(
    private readonly waveSize = FIRST_DEAL_WAVE_SIZE,
    private readonly gapMs = FIRST_DEAL_WAVE_GAP_MS,
    private readonly maxWaves = FIRST_DEAL_MAX_WAVES
  ) {}

  /**
   * The instant each table may deal its first hand: `startMs` for wave 0,
   * `startMs + wave * gap` after it, never past the last wave.
   */
  assign(startMs: number, tableIds: Iterable<string>, nowMs = Date.now()): Map<string, number> {
    const out = new Map<string, number>();
    if (!Number.isFinite(startMs)) return out;
    for (const key of [...this.ledger.keys()]) {
      if (key < nowMs - FIRST_DEAL_MEMORY_MS) this.ledger.delete(key);
    }
    let entry = this.ledger.get(startMs);
    if (!entry) {
      entry = { next: 0, at: new Map() };
      this.ledger.set(startMs, entry);
    }
    for (const tableId of orderTablesForWaves(tableIds)) {
      let at = entry.at.get(tableId);
      if (at === undefined) {
        const wave = Math.min(this.maxWaves - 1, Math.floor(entry.next / this.waveSize));
        at = startMs + wave * this.gapMs;
        entry.at.set(tableId, at);
        entry.next++;
      }
      out.set(tableId, at);
    }
    return out;
  }
}

/** The one opening budget for every tournament dealer start in this process. */
export const tableOpenGate = new TableOpenGate();
/** The one first-deal wave ledger for every launch in this process. */
export const firstDealWaves = new FirstDealWaves();
