/* A DURABLE COPY OF THE HANDS A PERSON SAT IN (2026-11-21).

   The Horse decision journal is a ring (config.ts). The hands every
   exact-replay grade of a Horse change against persons needs are the few a
   person plays each day, and they left the ring before the by-hand read the
   release rules allow could reach them: on 2026-11-20 the whole of Nov 18 was
   gone and, of the Nov 19 hands with a person seated, 2 of 135 sampled still
   had records.

   The keep store is a second, small journal beside the first:
   <journal>/keep/archive[-shard-N], written by the SAME store code, in the
   same record format, under the same private-file rules, on the same private
   mount. So it is read by the same reader (readHorseJournalHandRecords with
   <journal>/keep as its directory) by exactly who can read the journal, and a
   record's cards are under the journal's own protection: nothing here copies
   a record anywhere else, logs a body, or adds a field or a record kind.

   WHERE IT RUNS. Only in the journal's writer thread (worker.ts), and only
   after that thread has acknowledged the normal append. The decision workers,
   the publisher and the protocol are not touched: no decision, no response
   and no message between the publisher and its writer can differ with it on.

   WHAT IS KEPT. Scope 'person': a hand is kept when one of its decision
   records names a seated person (the snapshot's savedProfileHumanIds is not
   empty) or its accepted-hand record says a person was dealt in. Its other
   records follow by hand key; records that arrive before the hand's first
   decision wait in a small bounded buffer. A hand no person sat in is never
   kept. No game is treated specially.

   IT CAN ONLY LOSE ITS OWN COPY. Everything is bounded and every failure is
   caught and counted here:
     - its own queue (HORSE_JOURNAL_KEEP_QUEUE_*), worked one batch of at most
       16 records per turn of the thread's loop, so a normal append never
       waits behind more than one keep batch; a full queue drops and counts;
     - under HORSE_JOURNAL_KEEP_DISK_FLOOR_BYTES free (above the main ring's
       own 32 GiB floor, so the copy always stops first) it drops and counts;
     - a locked catalog (a reader) is retried a few times, then dropped;
     - three failed batches in a row switch the keep store off until the
       writer restarts. The journal itself is never affected.
   Its ring is bounded by bytes per shard (HORSE_JOURNAL_KEEP_BYTES) with no
   time guarantee, so it cannot grow past 8 shards x that, plus catalogs.

   THE SETTING is the code default below, read when the writer starts. It is
   'off' in this release: off constructs nothing and opens no file. Turning
   it on is a one-line change that rides a cutover. */
import { mkdirSync, renameSync, statfsSync, writeFileSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { HORSE_JOURNAL_ARCHIVE_SEGMENTS, type HorseJournalArchiveOptions } from './config.js';
import { horseJournalFailureKind } from './failure.js';
import type { HorseJournalRecord } from './record.js';
import { HorseDecisionJournalStore } from './store.js';

export const HORSE_JOURNAL_KEEP_SCOPES = ['off', 'person'] as const;
export type HorseJournalKeepScope = (typeof HORSE_JOURNAL_KEEP_SCOPES)[number];
/** THE SETTING. 'off': nothing is constructed, no file is opened. */
export const HORSE_JOURNAL_KEEP_SCOPE: HorseJournalKeepScope = 'off';
export const HORSE_JOURNAL_KEEP_DIRECTORY = 'keep';
/** Compressed segment bytes one shard's keep ring may hold. */
export const HORSE_JOURNAL_KEEP_BYTES = 4 * 1024 * 1024 * 1024;
/** Free filesystem bytes under which nothing more is kept. Above the main
 * ring's 32 GiB floor: the copy yields before the journal's guarantee does. */
export const HORSE_JOURNAL_KEEP_DISK_FLOOR_BYTES = 48 * 1024 * 1024 * 1024;
export const HORSE_JOURNAL_KEEP_QUEUE_RECORDS = 2048;
export const HORSE_JOURNAL_KEEP_QUEUE_BYTES = 32 * 1024 * 1024;
export const HORSE_JOURNAL_KEEP_BATCH_RECORDS = 16;
/** Hands whose keep verdict is remembered (least recently touched leaves). */
export const HORSE_JOURNAL_KEEP_HANDS = 4096;
/** Records waiting for their hand's first decision. */
export const HORSE_JOURNAL_KEEP_PENDING_BYTES = 16 * 1024 * 1024;
export const HORSE_JOURNAL_KEEP_PENDING_RECORDS_PER_HAND = 64;
export const HORSE_JOURNAL_KEEP_FAILURES_TO_DISABLE = 3;
export const HORSE_JOURNAL_KEEP_LOCK_RETRIES = 8;
export const HORSE_JOURNAL_KEEP_LOCK_RETRY_MS = 250;
export const HORSE_JOURNAL_KEEP_DISK_READ_MS = 30_000;
export const HORSE_JOURNAL_KEEP_STATUS_MS = 60_000;
export const HORSE_JOURNAL_KEEP_STOP_BUDGET_MS = 500;

const SHARD_DIRECTORY = /^archive(-shard-[1-9][0-9]*)?$/;
const PERSON_IN_DECISION = '"savedProfileHumanIds":["';
const PERSON_IN_ACCEPTED_HAND = '"styleHasHuman":true';

/** Pure. Whether this record itself says a person sat in its hand. Only a
 * decision or an accepted hand can say so; anything unreadable says no. The
 * substring is a cheap refusal for the 97% of records that cannot match; the
 * parsed value is what decides. */
export function horseJournalRecordNamesAPerson(record: HorseJournalRecord): boolean {
  try {
    if (record.kind === 'decision') {
      if (!record.body.includes(PERSON_IN_DECISION)) return false;
      const ids = (JSON.parse(record.body) as { snapshot?: { savedProfileHumanIds?: unknown } })
        ?.snapshot?.savedProfileHumanIds;
      return (
        Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === 'string' && !!id)
      );
    }
    if (record.kind === 'accepted_hand') {
      if (!record.body.includes(PERSON_IN_ACCEPTED_HAND)) return false;
      return (JSON.parse(record.body) as { styleHasHuman?: unknown })?.styleHasHuman === true;
    }
    return false;
  } catch {
    return false;
  }
}

/** The part of the store the keep copy uses (tests substitute a failing one). */
export interface HorseJournalKeepStore {
  appendBatch(records: readonly HorseJournalRecord[]): unknown;
  close(): void;
}
export interface HorseJournalKeepOptions {
  scope: HorseJournalKeepScope;
  /** The journal's own directory (HORSE_DECISION_JOURNAL_DIR). */
  journalDirectory: string;
  /** This writer's archive directory name: 'archive' or 'archive-shard-N'. */
  shardDirectoryName: string;
  maxBytes?: number;
  diskFloorBytes?: number;
  queueRecords?: number;
  queueBytes?: number;
  /** TESTS ONLY from here. */
  openStore?: (directory: string, archive: HorseJournalArchiveOptions) => HorseJournalKeepStore;
  freeBytes?: (directory: string) => number | null;
  schedule?: (work: () => void) => void;
  scheduleRetry?: (work: () => void, ms: number) => void;
  now?: () => number;
  log?: (line: string) => void;
}
export interface HorseJournalKeepStatus {
  version: 1;
  scope: HorseJournalKeepScope;
  shard: string;
  mode: 'running' | 'disabled' | 'stopped';
  disabledReason: string | null;
  handsKept: number;
  handsSkipped: number;
  recordsKept: number;
  recordsDroppedQueue: number;
  recordsDroppedPending: number;
  recordsDroppedDisk: number;
  recordsDroppedStop: number;
  recordsFailed: number;
  batchesFailed: number;
  lockRetries: number;
  errors: number;
  queued: number;
  queuedBytes: number;
  pendingBytes: number;
  lastKeptAtMs: number | null;
  atMs: number;
}
interface Hand {
  verdict: 'keep' | 'skip' | 'pending';
  pending: HorseJournalRecord[];
  pendingBytes: number;
}
const cost = (record: HorseJournalRecord): number => record.bytes + 512;

/** Counts and a reason word only: never a path, a key, a body or an error text. */
export class HorseJournalKeep {
  private readonly keepDirectory: string;
  private readonly archive: HorseJournalArchiveOptions;
  private readonly diskFloorBytes: number;
  private readonly queueRecords: number;
  private readonly queueBytes: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly schedule: (work: () => void) => void;
  private readonly scheduleRetry: (work: () => void, ms: number) => void;
  private readonly hands = new Map<string, Hand>();
  private queue: HorseJournalRecord[] = [];
  private queuedBytes = 0;
  private pendingBytes = 0;
  private store: HorseJournalKeepStore | undefined;
  private scheduled = false;
  private mode: HorseJournalKeepStatus['mode'] = 'running';
  private disabledReason: string | null = null;
  private consecutiveFailures = 0;
  private lockAttempts = 0;
  private disk: { atMs: number; room: boolean } | null = null;
  private statusAtMs = 0;
  private statusDirty = false;
  private announced = false;
  private readonly lastSaid = new Map<string, number>();
  private readonly n = {
    handsKept: 0,
    handsSkipped: 0,
    recordsKept: 0,
    recordsDroppedQueue: 0,
    recordsDroppedPending: 0,
    recordsDroppedDisk: 0,
    recordsDroppedStop: 0,
    recordsFailed: 0,
    batchesFailed: 0,
    lockRetries: 0,
    errors: 0,
    lastKeptAtMs: null as number | null,
  };

  constructor(private readonly options: HorseJournalKeepOptions) {
    if (options.scope !== 'person') throw Error('Horse journal keep is off');
    if (!isAbsolute(options.journalDirectory) || !SHARD_DIRECTORY.test(options.shardDirectoryName))
      throw Error('Invalid Horse journal keep configuration');
    const positive = (value: number | undefined, fallback: number): number =>
      value !== undefined && Number.isSafeInteger(value) && value > 0 ? value : fallback;
    this.keepDirectory = join(options.journalDirectory, HORSE_JOURNAL_KEEP_DIRECTORY);
    this.archive = {
      directory: join(this.keepDirectory, options.shardDirectoryName),
      maxBytes: positive(options.maxBytes, HORSE_JOURNAL_KEEP_BYTES),
      maxSegments: HORSE_JOURNAL_ARCHIVE_SEGMENTS,
      hold: null,
    };
    this.diskFloorBytes =
      options.diskFloorBytes !== undefined &&
      Number.isSafeInteger(options.diskFloorBytes) &&
      options.diskFloorBytes >= 0
        ? options.diskFloorBytes
        : HORSE_JOURNAL_KEEP_DISK_FLOOR_BYTES;
    this.queueRecords = positive(options.queueRecords, HORSE_JOURNAL_KEEP_QUEUE_RECORDS);
    this.queueBytes = positive(options.queueBytes, HORSE_JOURNAL_KEEP_QUEUE_BYTES);
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.warn(line));
    this.schedule = options.schedule ?? ((work) => void setImmediate(work));
    this.scheduleRetry =
      options.scheduleRetry ?? ((work, ms) => void setTimeout(work, ms).unref?.());
  }

  /** Records the writer has just appended and acknowledged. Never throws. */
  offer(records: readonly HorseJournalRecord[]): void {
    if (this.mode !== 'running') return;
    try {
      for (const record of records) this.route(record);
      this.wake();
    } catch {
      this.n.errors++;
    }
  }

  /** The writer is stopping: append what a short budget allows, count the
   * rest, close. Never throws. */
  stop(budgetMs = HORSE_JOURNAL_KEEP_STOP_BUDGET_MS): void {
    try {
      if (this.mode === 'running') {
        const deadline = this.now() + Math.max(0, budgetMs);
        while (this.queue.length && this.mode === 'running' && this.now() < deadline)
          this.appendHead(false);
        this.n.recordsDroppedStop += this.queue.length;
        this.forget();
        this.mode = 'stopped';
      }
    } catch {
      this.n.errors++;
    }
    this.closeStore();
    this.writeStatus(true);
  }

  status(): HorseJournalKeepStatus {
    return {
      version: 1,
      scope: this.options.scope,
      shard: this.options.shardDirectoryName,
      mode: this.mode,
      disabledReason: this.disabledReason,
      ...this.n,
      queued: this.queue.length,
      queuedBytes: this.queuedBytes,
      pendingBytes: this.pendingBytes,
      atMs: this.now(),
    };
  }

  private route(record: HorseJournalRecord): void {
    const names = horseJournalRecordNamesAPerson(record);
    let hand = this.hands.get(record.handKey);
    if (names || hand?.verdict === 'keep') {
      if (!hand || hand.verdict !== 'keep') {
        const waiting = hand?.pending ?? [];
        this.pendingBytes -= hand?.pendingBytes ?? 0;
        hand = { verdict: 'keep', pending: [], pendingBytes: 0 };
        this.n.handsKept++;
        for (const earlier of waiting) this.enqueue(earlier);
      }
      this.touch(record.handKey, hand);
      this.enqueue(record);
      return;
    }
    if (record.kind === 'decision' || record.kind === 'accepted_hand') {
      // The hand's own record says no person: nothing of it is kept.
      if (hand?.verdict !== 'skip') this.n.handsSkipped++;
      this.pendingBytes -= hand?.pendingBytes ?? 0;
      this.touch(record.handKey, { verdict: 'skip', pending: [], pendingBytes: 0 });
      return;
    }
    if (hand?.verdict === 'skip') {
      this.touch(record.handKey, hand);
      return;
    }
    // Before the hand's first decision: wait for it, within bounds.
    hand ??= { verdict: 'pending', pending: [], pendingBytes: 0 };
    const bytes = cost(record);
    if (
      hand.pending.length >= HORSE_JOURNAL_KEEP_PENDING_RECORDS_PER_HAND ||
      bytes > HORSE_JOURNAL_KEEP_PENDING_BYTES
    ) {
      this.n.recordsDroppedPending++;
      this.touch(record.handKey, hand);
      return;
    }
    hand.pending.push(record);
    hand.pendingBytes += bytes;
    this.pendingBytes += bytes;
    this.touch(record.handKey, hand);
    while (this.pendingBytes > HORSE_JOURNAL_KEEP_PENDING_BYTES && this.evictOldest());
  }

  private touch(handKey: string, hand: Hand): void {
    this.hands.delete(handKey);
    this.hands.set(handKey, hand);
    while (this.hands.size > HORSE_JOURNAL_KEEP_HANDS && this.evictOldest());
  }

  private evictOldest(): boolean {
    const oldest = this.hands.entries().next();
    if (oldest.done) return false;
    const [key, hand] = oldest.value;
    this.hands.delete(key);
    this.pendingBytes -= hand.pendingBytes;
    this.n.recordsDroppedPending += hand.pending.length;
    return true;
  }

  private enqueue(record: HorseJournalRecord): void {
    const bytes = cost(record);
    if (this.queue.length >= this.queueRecords || this.queuedBytes + bytes > this.queueBytes) {
      this.n.recordsDroppedQueue++;
      this.statusDirty = true;
      this.say('queue_full');
      return;
    }
    this.queue.push(record);
    this.queuedBytes += bytes;
  }

  private wake(): void {
    if (this.scheduled || this.mode !== 'running' || !this.queue.length) return;
    this.scheduled = true;
    try {
      this.schedule(() => this.turn());
    } catch {
      this.scheduled = false;
      this.n.errors++;
    }
  }

  /** One batch per turn of the loop. Never throws. */
  private turn(): void {
    this.scheduled = false;
    try {
      if (this.mode !== 'running' || !this.queue.length) return;
      if (!this.diskHasRoom()) {
        this.n.recordsDroppedDisk += this.queue.length;
        this.queue = [];
        this.queuedBytes = 0;
        this.statusDirty = true;
        this.say('disk_floor');
      } else if (this.appendHead(true) === 'locked') {
        this.scheduled = true;
        this.scheduleRetry(() => this.turn(), HORSE_JOURNAL_KEEP_LOCK_RETRY_MS);
        return;
      }
    } catch {
      this.n.errors++;
    }
    this.writeStatus(false);
    this.wake();
  }

  private appendHead(mayRetry: boolean): 'done' | 'locked' {
    const batch = this.queue.slice(0, HORSE_JOURNAL_KEEP_BATCH_RECORDS);
    const take = () => {
      this.queue.splice(0, batch.length);
      for (const record of batch) this.queuedBytes -= cost(record);
      if (!this.queue.length) this.queuedBytes = 0;
      this.statusDirty = true;
    };
    try {
      this.store ??= this.open();
      this.store.appendBatch(batch);
      take();
      this.n.recordsKept += batch.length;
      this.n.lastKeptAtMs = this.now();
      this.consecutiveFailures = 0;
      this.lockAttempts = 0;
    } catch (error) {
      let locked = false;
      try {
        locked = horseJournalFailureKind(error) === 'RETRYABLE';
      } catch {
        locked = false;
      }
      if (locked && mayRetry && ++this.lockAttempts <= HORSE_JOURNAL_KEEP_LOCK_RETRIES) {
        this.n.lockRetries++;
        return 'locked';
      }
      this.lockAttempts = 0;
      take();
      this.n.batchesFailed++;
      this.n.recordsFailed += batch.length;
      this.say(locked ? 'locked' : 'append_failed');
      if (!locked && ++this.consecutiveFailures >= HORSE_JOURNAL_KEEP_FAILURES_TO_DISABLE)
        this.disable('append_failed');
    }
    return 'done';
  }

  private open(): HorseJournalKeepStore {
    const store = this.options.openStore
      ? this.options.openStore(this.keepDirectory, this.archive)
      : new HorseDecisionJournalStore(this.keepDirectory, { archive: this.archive });
    if (!this.announced) {
      this.announced = true;
      this.log(
        `[HorseDecisionJournalKeep] ${this.options.shardDirectoryName}: keeping hands with a person seated (scope ${this.options.scope})`
      );
    }
    return store;
  }

  private diskHasRoom(): boolean {
    const now = this.now();
    if (
      this.disk &&
      now - this.disk.atMs < HORSE_JOURNAL_KEEP_DISK_READ_MS &&
      now >= this.disk.atMs
    )
      return this.disk.room;
    let free: number | null = null;
    try {
      if (this.options.freeBytes) free = this.options.freeBytes(this.options.journalDirectory);
      else {
        const fs = statfsSync(this.options.journalDirectory);
        free = fs.bavail * fs.bsize;
      }
    } catch {
      free = null;
    }
    // An unreadable disk is never assumed to have room.
    const room = free !== null && Number.isFinite(free) && free > this.diskFloorBytes;
    this.disk = { atMs: now, room };
    return room;
  }

  private disable(reason: string): void {
    this.mode = 'disabled';
    this.disabledReason = reason;
    this.forget();
    this.closeStore();
    this.log(
      `[HorseDecisionJournalKeep] ${this.options.shardDirectoryName}: switched off until the writer restarts (${reason}); the journal itself is unaffected`
    );
    this.writeStatus(true);
  }

  private forget(): void {
    this.queue = [];
    this.queuedBytes = 0;
    this.hands.clear();
    this.pendingBytes = 0;
  }

  private closeStore(): void {
    try {
      this.store?.close();
    } catch {
      /* the copy's own store; nothing depends on it */
    }
    this.store = undefined;
  }

  /** At most one line per reason every ten minutes. */
  private say(reason: string): void {
    try {
      const now = this.now();
      const last = this.lastSaid.get(reason);
      if (last !== undefined && now - last < 600_000 && now >= last) return;
      this.lastSaid.set(reason, now);
      const s = this.status();
      this.log(
        `[HorseDecisionJournalKeep] ${s.shard}: ${reason} kept=${s.recordsKept} droppedQueue=${s.recordsDroppedQueue} droppedDisk=${s.recordsDroppedDisk} failed=${s.recordsFailed}`
      );
    } catch {
      /* a log line is never worth a failure */
    }
  }

  /** Counts for whoever reads the keep store, beside it. Never throws. */
  private writeStatus(force: boolean): void {
    try {
      const now = this.now();
      if (
        !force &&
        (!this.statusDirty || Math.abs(now - this.statusAtMs) < HORSE_JOURNAL_KEEP_STATUS_MS)
      )
        return;
      // Only beside a keep store this writer has already opened or made.
      if (!this.announced) return;
      this.statusAtMs = now;
      this.statusDirty = false;
      mkdirSync(this.keepDirectory, { recursive: true, mode: 0o700 });
      const path = join(this.keepDirectory, `status-${this.options.shardDirectoryName}.json`);
      writeFileSync(`${path}.tmp`, JSON.stringify(this.status()) + '\n', { mode: 0o600 });
      renameSync(`${path}.tmp`, path);
    } catch {
      /* the status file is a convenience */
    }
  }
}

/** Called once by the writer thread with its own workerData. Returns null when
 * the setting is off, the layout is not the journal's, or anything at all goes
 * wrong: the writer then runs exactly as it always has. Never throws.
 * `workerData.keep` exists for tests; the engine never passes it. */
export function startHorseJournalKeep(workerData: unknown): HorseJournalKeep | null {
  try {
    const data = (workerData ?? {}) as {
      directory?: unknown;
      archive?: { directory?: unknown } | null;
      keep?: Partial<HorseJournalKeepOptions> | null;
    };
    const overrides = data.keep ?? {};
    const scope = overrides.scope ?? HORSE_JOURNAL_KEEP_SCOPE;
    if (scope !== 'person') return null;
    if (typeof data.directory !== 'string' || typeof data.archive?.directory !== 'string')
      return null;
    return new HorseJournalKeep({
      ...overrides,
      scope,
      journalDirectory: data.directory,
      shardDirectoryName: basename(data.archive.directory),
    });
  } catch {
    return null;
  }
}
