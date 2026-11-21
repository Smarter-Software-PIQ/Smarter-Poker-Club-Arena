import { execFile, execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, statfsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';

/** A closed window of capture time whose published segments the ring never
 * retires. Resolved once, when a writer opens with it, to the published
 * segments whose records fall inside it; segments appended later are the
 * ring's. */
export interface HorseJournalArchiveHold {
  fromMs: number;
  untilMs: number;
}

export interface HorseJournalArchiveOptions {
  directory: string;
  maxBytes: number;
  maxSegments: number;
  /** Absent or null: nothing is held and every published segment is a ring
   * candidate. */
  hold?: HorseJournalArchiveHold | null;
  /** RETENTION BY TIME (2026-11-15). Published segments younger than this are
   * not retired for the byte allocation while the filesystem keeps more than
   * diskFloorBytes free. Absent or 0: the byte allocation binds as before. */
  minRetentionMs?: number;
  /** Free filesystem bytes below which the time guarantee yields and the byte
   * allocation binds again (journal_retention_guarantee_breached). */
  diskFloorBytes?: number;
  /** TESTS ONLY (never set by the runtime options): the ring's per-append
   * retirement bound, 1 to 1,024 (store.ts RING_RETIRE_LIMIT, the default), so a
   * drain far over the allocation can be tested without thousands of appends. */
  ringRetireLimit?: number;
}

// Separate durable archive allocation; the original 64 MiB journal remains
// unchanged. These bound compressed files independently of the catalog's
// 6 GiB physical ceiling and each 4 MiB decoded batch.
//
// THE ALLOCATION IS A RING (2026-09-26). Until then a full allocation paused
// capture for good: on 2026-09-25 19:34 UTC the production archive reached
// 500,000 segments (4,139,804 records, 6.48 GB compressed, 8.3 days of play,
// 9.7 GB on disk with the catalog) and no Horse decision was journaled again.
// Now, once a batch would exceed the segment, record, byte or catalog quota,
// the writer retires the oldest PUBLISHED segments, oldest first, inside the
// same reservation transaction until the batch fits, and capture continues.
// A reserved batch that has not been published is never retired, so only
// unpublished segments can ever hold capture at a quota; the filesystem's own
// free space is not a ring quota and still pauses capture, by name, because
// the archive retires within its allocation and not for whatever else filled
// the disk. (Since 2026-11-15 the live writer's time guarantee lets the byte
// allocation yield while free space stays above a floor; see RETENTION IS
// GUARANTEED BY TIME below.) No quota describes an incomplete window as complete: a retired
// record is a missing record to every reader.
//
// THE ARCHIVE DID NOT HOLD EIGHT DAYS (measured read-only 2026-09-27). The
// 500,000 segments are two runs: rowids 1 to 262,387 from 2026-09-17 15:02 to
// 2026-09-18 09:20 UTC (16 records a segment, until the former 2 GiB catalog
// filled), nothing at all from then until the 6 GiB catalog shipped in
// 778075b419, and rowids 262,388 to 500,000 from 2026-09-25 15:47:23 to
// 19:34:05 UTC: 237,613 segments, 780,363 records and 1.49 GB in 3.8 hours.
// Current capture writes a segment per publisher batch, about 3.3 records,
// so it spends 500,000 segments in about eight hours while it spends the
// 8 GiB byte bound in about 22 and the 8,000,000-record cap in about 39. The
// segment count was the wrong limit to bind first.
//
// HORSE_DECISION_JOURNAL_ARCHIVE_MAX_SEGMENTS is the ring's length in
// segments. Default and ceiling 2,000,000, so that on the engine host the
// ring is bounded by bytes: HORSE_DECISION_JOURNAL_ARCHIVE_MAX_BYTES (default
// 8 GiB compressed) plus a catalog that stays under its 6 GiB page ceiling,
// about 12 GB of a 75 GB disk that had 21 GB free with the archive full. The
// record cap is maxSegments * 16 but never above 8,000,000, the figure the
// catalog is sized for. Lowering either knob retires the excess over the
// following appends; a segment count past the ceiling is refused at start.
//
// THE RING HOLDS THE PHASE 6A/6B EVIDENCE (decision D4, 2026-09-27). Nothing
// ships segments off the host, and the ring retires oldest first, so without
// a hold the only Phase 6A/6B decisions ever captured (the 09-25 run above,
// release 778075b419, which 6C replays and 6D's declared population covers)
// would be retired within a day of the ring's deploy. So the ring skips an
// explicit evidence hold. HORSE_DECISION_JOURNAL_ARCHIVE_HOLD is
// "<from>/<until>" (UTC, whole seconds, "Z") or "none". Its default runs from
// 2026-09-18 21:56:28 UTC, when engine release 8825af5181 first carrying
// Phase 6A began serving (engine-release-audit commit event), to 2026-09-25
// 19:34:06 UTC, one second after the last segment written before the archive
// filled. A writer resolves the window at open to the published segments
// whose records fall inside it (on the host: the 237,613 of the 09-25 run)
// and records that set; they count against every quota as before and are
// never retired, and the ring retires the oldest published segment outside
// them. Capture then runs forever inside the same fixed budget: the ring
// keeps about 18 hours of new play beside the held 1.49 GB. When only held
// or unpublished segments remain, a quota still refuses by name and /health
// says so. "none" releases the hold once the evidence is exported, and the
// ring reclaims those segments oldest first. A malformed value refuses the
// writer's start.
export const HORSE_JOURNAL_ARCHIVE_HOLD = '2026-09-18T21:56:28Z/2026-09-25T19:34:06Z';
export const HORSE_JOURNAL_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024;
/** Additional shards have no historical allocation to preserve. */
export const HORSE_JOURNAL_ADDITIONAL_ARCHIVE_BYTES = 4 * 1024 * 1024 * 1024;
export const HORSE_JOURNAL_ARCHIVE_SEGMENTS = 2_000_000;
// The record cap the catalog is sized for, whatever the segment count.
export const HORSE_JOURNAL_ARCHIVE_RECORDS = 8_000_000;
/** The writer refuses a batch once the archive would hold more records than
 * this: 16 a segment, never above the catalog's sizing. */
export const archiveRecordCap = (maxSegments: number): number =>
  Math.min(maxSegments * 16, HORSE_JOURNAL_ARCHIVE_RECORDS);
/* THE HOLD HAS ITS OWN BUDGET (2026-09-28). Held segments count against every
   quota, so a hold as large as the allocation leaves the ring nothing to
   retire and capture stops at the quota. The hold may keep at most half of
   each quota (bytes, segments and records); the other half always belongs to
   new capture. A window whose segments exceed the budget keeps its OLDEST
   segments up to the budget (for the default window, the start of the only
   Phase 6A/6B capture) and the writer says so in its log line and on
   /health (holdTrimmedSegments); the rest become the ring's, retired oldest
   first like any other segment. On production the default hold is about
   1.49 GB of the 8 GiB bound and 237,613 of 2,000,000 segments, well inside
   its budget, so nothing is trimmed there. */
export const HORSE_JOURNAL_HOLD_BUDGET_SHARE = 2;
export const horseJournalHoldBudget = (
  maxBytes: number,
  maxSegments: number
): { bytes: number; segments: number; records: number } => ({
  bytes: Math.floor(maxBytes / HORSE_JOURNAL_HOLD_BUDGET_SHARE),
  segments: Math.floor(maxSegments / HORSE_JOURNAL_HOLD_BUDGET_SHARE),
  records: Math.floor(archiveRecordCap(maxSegments) / HORSE_JOURNAL_HOLD_BUDGET_SHARE),
});
// The former 2 GiB catalog filled at 262387 segments / 4.99 GB compressed,
// before either archive allocation was reached. That catalog indexed its
// records at ~639 bytes each, so the 4 GiB that replaced it covered ~6.7M
// records while the record cap above is 8,000,000: the catalog was still the
// first limit reached, and it was reached inside SQLite rather than by a named
// refusal. Derivation of the current figure: 8,000,000 records x ~640 bytes
// ~= 5.12 GB (4.77 GiB); 6 GiB = 1,572,864 whole 4096-byte pages leaves ~26%
// margin for index growth and the transient pending batch. Workload-based
// sizing, not a guarantee every record mix fits. Keep a finite allocation,
// shared by writer enforcement and reader diagnostics; SQLite grows on demand.
export const HORSE_JOURNAL_ARCHIVE_CATALOG_BYTES = 6 * 1024 * 1024 * 1024;

/* RETENTION IS GUARANTEED BY TIME, NOT ONLY BY BYTES (2026-11-15). The byte
   allocation above was sized when one writer captured the fleet. With eight
   decision-worker shards (shards 2-7 at 4 GiB each) the ring kept what its
   bytes held, and as records grew that fell to 15-23 hours per shard (14.8 h
   on the busiest, measured read-only 2026-11-15 14:10Z; about 10 h on
   2026-11-14), shorter than one daily-break cycle. A capture window between
   two releases (up to about 24 hours) aged out before it could be read, and
   the capture owner byte-copied the journal hourly to keep it: a watcher in
   place of a fix. Now a published segment younger than the minimum retention
   (30 h at first: one daily-break cycle plus six hours to read it; 72 h
   since 2026-11-21, see SEVENTY-TWO HOURS below) is not
   retired for the byte allocation; the ring retires it only for a hard quota
   (segments, records, catalog pages), or when the filesystem's free space
   would fall below the disk floor (default 32 GiB), and then says so by name
   (journal_retention_guarantee_breached) in its log and its status, oldest
   first as before. Measured need at 30 h: about 2 GiB/h for the fleet, about
   60 GiB of segments against about 40 GiB allocated today and 170 GiB free on
   the engine host's 338 GB disk. HORSE_DECISION_JOURNAL_ARCHIVE_MIN_RETENTION_HOURS
   (0 to 168; 0 turns the guarantee off) and
   HORSE_DECISION_JOURNAL_ARCHIVE_DISK_FLOOR_BYTES override both. */
/* SEVENTY-TWO HOURS (2026-11-21). At 30 h the busiest 4 GiB shard kept exactly
   the guarantee while the others still fitted 41-44 h in their bytes, and the
   only copy off the ring is a by-hand read that the release rules forbid
   between a booking's merge and its seal. With a cutover every three hours
   the readable time was shorter than the work: by the evening of Nov 20 the
   whole of Nov 18 was gone and, of the Nov 19 hands with a person seated,
   2 of 135 sampled still had records (PLO5: 14 of 549). Every exact-replay
   grade of a Horse change against persons reads these records.
   72 h gives every shard three days. What it costs, from the engine's own
   figures on 2026-11-21 04:53Z (the least healthy shard: 4.83 GB, 408,997
   segments, 646,233 records and a 1.01 GB catalog at the 30 h guarantee) and
   the retention the other shards showed (about 1 GiB/h for the fleet): about
   35 GB of disk per added day, so about 50 GB more than at 30 h. No hard quota
   is reached by it: that shard would meet the segment count at about 146 h
   and the catalog ceiling at about 178 h. Nothing else changes: the disk floor
   below still makes the guarantee yield, by name, before the disk can fill;
   hard quotas never yield; the environment override and its 168 h ceiling are
   as before; and the decision-worker count does not depend on it (existing
   shards are always retained, horseJournalShardsAffordable). A release that
   lowers this drains as TURNING IT OFF below describes. */
export const HORSE_JOURNAL_MIN_RETENTION_HOURS = 72;
export const HORSE_JOURNAL_MAX_MIN_RETENTION_HOURS = 168;
export const HORSE_JOURNAL_RETENTION_DISK_FLOOR_BYTES = 32 * 1024 * 1024 * 1024;
/* TURNING IT OFF, LOWERING IT, OR ROLLING BACK (2026-11-15, Hand Analysis B1).
   With the guarantee on, each shard normally holds well above its byte
   allocation (about 50-57 GiB of segments for the fleet at 30 h against about
   40 GiB allocated). This release drains safely when that ends (the hours set to
   0 or lowered, or the disk floor reached): the ring retires 1,024 segments per
   append and still accepts the batch while the filesystem keeps more than
   HORSE_JOURNAL_DRAIN_MIN_FREE_BYTES (store.ts drainMayAccept), so nothing is
   dropped. A RELEASE WITHOUT THIS CHANGE does not: it retires 1,024 segments and
   refuses the batch on every append until the bytes fit, dropping capture for
   the whole drain. Before rolling back to such a release (or before turning the
   guarantee off on one that predates the drain), FIRST set
   HORSE_DECISION_JOURNAL_ARCHIVE_MAX_BYTES at least to the largest shard's
   current compressedBytes (writer status / horseJournal in /health) plus one
   hour of writes (about 2 GiB), restart once on that setting, and KEEP that
   raised value for as long as a release without the drain is serving: lowering
   it there, even in steps, refuses capture again for every step (about 3 h lost
   per GiB lowered; Hand Analysis D1 on #10996). Lower it only after rolling
   forward to a release that has this drain. */
/** The free space a draining ring always leaves on the archive filesystem
 * (or the disk floor, when a smaller floor is configured). */
export const HORSE_JOURNAL_DRAIN_MIN_FREE_BYTES = 1024 * 1024 * 1024;
export type HorseJournalByteQuotaVerdict = 'retire' | 'keep' | 'breach';
/** Pure. Whether the oldest retirable segment may be retired for the byte
 * allocation. 'keep': it is younger than the guarantee and the disk has room,
 * so the byte allocation yields. 'breach': it is younger, but the disk floor
 * would be crossed, so it is retired anyway and the breach is named.
 * 'retire': no guarantee applies (off, no candidate age, or old enough). */
export function horseJournalByteQuotaVerdict(input: {
  minRetentionMs: number;
  oldestAgeMs: number | null;
  freeBytes: number | null;
  incomingBytes: number;
  diskFloorBytes: number;
}): HorseJournalByteQuotaVerdict {
  const { minRetentionMs, oldestAgeMs, freeBytes, incomingBytes, diskFloorBytes } = input;
  if (!(minRetentionMs > 0) || oldestAgeMs === null || !Number.isFinite(oldestAgeMs))
    return 'retire';
  if (oldestAgeMs >= minRetentionMs) return 'retire';
  if (freeBytes === null || !Number.isFinite(freeBytes)) return 'breach';
  return freeBytes - Math.max(0, incomingBytes) > diskFloorBytes ? 'keep' : 'breach';
}
function retentionHours(value: string | undefined): number {
  if (value === undefined) return HORSE_JOURNAL_MIN_RETENTION_HOURS;
  if (!/^(0|[1-9][0-9]*)$/.test(value) || Number(value) > HORSE_JOURNAL_MAX_MIN_RETENTION_HOURS)
    throw Error('Invalid Horse archive resource allocation');
  return Number(value);
}

function positiveInteger(value: string | undefined, fallback: number, ceiling: number): number {
  if (value === undefined) return fallback;
  if (!/^[1-9][0-9]*$/.test(value)) throw Error('Invalid Horse archive resource allocation');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > ceiling)
    throw Error('Invalid Horse archive resource allocation');
  return parsed;
}

const HOLD_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
function evidenceHold(value: string | undefined): HorseJournalArchiveHold | null {
  const text = value ?? HORSE_JOURNAL_ARCHIVE_HOLD;
  if (text === 'none') return null;
  const parts = text.split('/');
  if (parts.length !== 2 || !parts.every((p) => HOLD_INSTANT.test(p)))
    throw Error('Invalid Horse archive evidence hold');
  const [fromMs, untilMs] = parts.map((p) => Date.parse(p));
  // Date.parse rolls an impossible calendar date over; the round trip refuses it.
  if (
    !parts.every(
      (p, i) => new Date([fromMs, untilMs][i]).toISOString() === p.replace('Z', '.000Z')
    ) ||
    !(fromMs < untilMs)
  )
    throw Error('Invalid Horse archive evidence hold');
  return { fromMs, untilMs };
}

/* A DECLARED CAPTURE HOLD (2026-11-15). The hold above is one environment
   variable, read when a writer opens, and on production it still names the
   2026-09 Phase 6A/6B window: a capture declared for a later release had no
   protection from the ring. On 2026-11-14 the oldest journal files were
   retired at up to 1.3 times real time, and the capture owner byte-copied
   every segment file of a twelve-hour window hourly to keep it.
   A declared hold is a file `<journal>/holds/<id>.json`, beside the archive
   directories, so every shard's writer sees the same declarations:
     {"version":1,"fromUtc":"2026-11-14T22:10:00Z","untilUtc":"2026-11-15T10:10:00Z",
      "expiresUtc":"2026-11-22T10:10:00Z","operator":"Human-vs-Horse capture owner"}
   Exactly those five keys; whole UTC seconds; untilUtc after fromUtc and at
   most 48 hours later; expiresUtc after untilUtc and at most 14 days later,
   so no declaration can hold anything for good. The file must be a private
   regular file of at most 2 KiB with one link, owned by the writer's user,
   in a private directory, like every other archive path. Each writer reads
   the directory at most once every HORSE_JOURNAL_DECLARED_HOLD_REFRESH_MS,
   outside its write transaction; at most four declarations apply (the first
   four valid ones by file name). A file that fails any rule is refused by
   name in the writer's log and changes nothing; capture never stops for one.
   The declared windows share the hold budget below with the configured hold
   (that one first), keep their oldest segments when it is reached, and are
   released to the ring when they expire. Read-only readers never read them. */
export const HORSE_JOURNAL_DECLARED_HOLDS_DIRECTORY = 'holds';
export const HORSE_JOURNAL_DECLARED_HOLD_REFRESH_MS = 30_000;
export const HORSE_JOURNAL_DECLARED_HOLD_MAX_WINDOW_MS = 48 * 3_600_000;
export const HORSE_JOURNAL_DECLARED_HOLD_MAX_RETENTION_MS = 14 * 86_400_000;
export const HORSE_JOURNAL_DECLARED_HOLDS_MAX = 4;
export const HORSE_JOURNAL_DECLARED_HOLD_FILE_BYTES = 2048;
export interface HorseJournalDeclaredHold {
  id: string;
  fromMs: number;
  untilMs: number;
  expiresAtMs: number;
}
const DECLARED_HOLD_NAME = /^([a-z0-9][a-z0-9-]{0,62})\.json$/;
const DECLARED_HOLD_KEYS = ['expiresUtc', 'fromUtc', 'operator', 'untilUtc', 'version'];
function holdInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !HOLD_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isSafeInteger(ms) && new Date(ms).toISOString() === value.replace('Z', '.000Z')
    ? ms
    : null;
}
/** The declared hold in one file, or the reason it is refused. Pure: no
 * clock, no filesystem; expiry and file safety are the writer's checks. */
export function parseHorseJournalDeclaredHold(
  fileName: string,
  text: string
): HorseJournalDeclaredHold | string {
  const name = DECLARED_HOLD_NAME.exec(fileName);
  if (!name) return 'name';
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return 'json';
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'schema';
  const value = body as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== DECLARED_HOLD_KEYS.join(',')) return 'schema';
  if (value.version !== 1) return 'version';
  if (typeof value.operator !== 'string' || !/^[\x20-\x7e]{1,200}$/.test(value.operator))
    return 'operator';
  const fromMs = holdInstant(value.fromUtc),
    untilMs = holdInstant(value.untilUtc),
    expiresAtMs = holdInstant(value.expiresUtc);
  if (fromMs === null || untilMs === null || expiresAtMs === null) return 'instant';
  if (!(fromMs < untilMs)) return 'window';
  if (untilMs - fromMs > HORSE_JOURNAL_DECLARED_HOLD_MAX_WINDOW_MS) return 'window_too_long';
  if (
    !(expiresAtMs > untilMs) ||
    expiresAtMs - untilMs > HORSE_JOURNAL_DECLARED_HOLD_MAX_RETENTION_MS
  )
    return 'expiry';
  return { id: name[1]!, fromMs, untilMs, expiresAtMs };
}
/** Where a shard's writer looks for declared holds: `holds` beside the shard's
 * archive directory, the journal directory every shard shares. Null for an
 * archive directory that is not one of the journal's own shard names (a
 * test or tool layout), which then has no declared holds. */
export function horseJournalDeclaredHoldsDirectory(archiveDirectory: string): string | null {
  return /^archive(-shard-[1-9][0-9]*)?$/.test(basename(archiveDirectory))
    ? join(dirname(archiveDirectory), HORSE_JOURNAL_DECLARED_HOLDS_DIRECTORY)
    : null;
}

/** ONE CATALOG PER DECISION-SHARD WRITER (2026-09-28). Every Horse decision
 * worker shard runs its own journal publisher and, until now, its own writer
 * on the SAME catalog file (one shared `archive/horse-journal-archive.sqlite`
 * for every shard). SQLite allows one writer per file: a shard's `BEGIN
 * IMMEDIATE` routinely found the other shard's commit already holding the
 * write lock, and at the archive's steady-state byte ceiling - where every
 * append also retires a segment inside that same transaction (see
 * HORSE_ARCHIVE_CATALOG_CONNECTION in store.ts) - the loser paid a 250 ms
 * busy wait plus the lock-retry ladder (HORSE_JOURNAL_LOCK_RETRY_DELAYS_MS)
 * before its batch was retried, long enough to overflow the publisher's
 * 64-record queue. Measured locally (two writers hammering one shared
 * catalog at production's byte ceiling vs one apiece): 0 lock retries and
 * +69% aggregate throughput once each shard owns its own file - see
 * docs/horse-brain-journal-retention-2026-09-26.md, "the journal keeps up
 * with the fleet" (2026-09-28).
 *
 * Shard 0 always resolves to 'archive', the one directory every deployment
 * - single-worker or the first shard of a sharded one - has ever written to,
 * so turning on a second decision-worker shard never orphans existing
 * evidence: shard 0 keeps the exact catalog and allocation it already had.
 * Later shards (1, 2, ...) get their own fresh 'archive-shard-<index>'
 * catalog. Shards 0 and 1 keep their existing full 8 GiB segment allocation:
 * lowering them would retire historical evidence. New shards 2+ default to
 * 4 GiB segments with the same 6 GiB catalog ceiling. A configured
 * HORSE_DECISION_JOURNAL_ARCHIVE_MAX_BYTES overrides both defaults for every
 * shard. Operators raising HORSE_DECISION_WORKERS should size
 * HORSE_DECISION_JOURNAL_ARCHIVE_MAX_BYTES/SEGMENTS with that in mind, or
 * watch each shard's own /health figures (now reported per shard). */
export interface HorseJournalArchiveShard {
  /** 0-based position among this engine's decision-worker shards. */
  index: number;
}
function archiveDirectoryName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0) throw Error('Invalid Horse journal shard');
  return index === 0 ? 'archive' : `archive-shard-${index}`;
}
/** Every archive directory name a shard index could ever resolve to, ordered
 * for a reader to try: shard 0's ('archive') first if it exists, then any
 * later shards' that exist, lowest index first. Empty when neither exists
 * yet (a fresh or disabled journal) - never a guess at a layout nobody wrote. */
export function horseJournalArchiveDirectoryNames(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter(
      (name) =>
        name === 'archive' ||
        (/^archive-shard-[1-9][0-9]*$/.test(name) &&
          Number.isSafeInteger(Number(name.slice('archive-shard-'.length))))
    )
    .sort((a, b) => {
      const index = (name: string) =>
        name === 'archive' ? 0 : Number(name.slice('archive-shard-'.length));
      return index(a) - index(b);
    });
}

/** This runs in the existing journal owner before its dedicated writer starts.
 * The archive stays under the already sealed persistent private bind mount. */
export function runtimeHorseJournalArchiveOptions(
  directory: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  shard: HorseJournalArchiveShard = { index: 0 }
): HorseJournalArchiveOptions {
  if (!isAbsolute(directory)) throw Error('Invalid Horse journal directory');
  return {
    directory: join(directory, archiveDirectoryName(shard.index)),
    maxBytes: positiveInteger(
      environment.HORSE_DECISION_JOURNAL_ARCHIVE_MAX_BYTES,
      shard.index < 2 ? HORSE_JOURNAL_ARCHIVE_BYTES : HORSE_JOURNAL_ADDITIONAL_ARCHIVE_BYTES,
      Number.MAX_SAFE_INTEGER
    ),
    maxSegments: positiveInteger(
      environment.HORSE_DECISION_JOURNAL_ARCHIVE_MAX_SEGMENTS,
      HORSE_JOURNAL_ARCHIVE_SEGMENTS,
      HORSE_JOURNAL_ARCHIVE_SEGMENTS
    ),
    hold: evidenceHold(environment.HORSE_DECISION_JOURNAL_ARCHIVE_HOLD),
  };
}

/** The live writer's archive options: the allocation above plus the time
 * guarantee (default 72 h, 32 GiB disk floor). Only the engine's own writer
 * (startHorseDecisionJournal / prespawnHorseDecisionJournalWriter) opens with
 * these; every reader, tool and test that builds runtimeHorseJournalArchiveOptions
 * keeps byte-bound retirement exactly as before. */
export function runtimeHorseJournalWriterArchiveOptions(
  directory: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  shard: HorseJournalArchiveShard = { index: 0 }
): HorseJournalArchiveOptions {
  return {
    ...runtimeHorseJournalArchiveOptions(directory, environment, shard),
    minRetentionMs:
      retentionHours(environment.HORSE_DECISION_JOURNAL_ARCHIVE_MIN_RETENTION_HOURS) * 3_600_000,
    diskFloorBytes: positiveInteger(
      environment.HORSE_DECISION_JOURNAL_ARCHIVE_DISK_FLOOR_BYTES,
      HORSE_JOURNAL_RETENTION_DISK_FLOOR_BYTES,
      Number.MAX_SAFE_INTEGER
    ),
  };
}

/** Historical journal-only directories stay readable. A present archive,
 * including a broken symlink or an incomplete/corrupt catalog, must reach the
 * strict store validator rather than silently returning legacy-only evidence.
 * Reading never creates a directory, opens a writer or completes pending work.
 * `archiveDirectory` selects which shard's catalog to open ('archive' by
 * default, exactly as before sharding existed); a caller iterating shards
 * passes a name from horseJournalArchiveDirectoryNames. */
export function readonlyHorseJournalStoreOptions(
  directory: string,
  archiveDirectory = 'archive'
): {
  readOnly: true;
  archive?: HorseJournalArchiveOptions;
} {
  const index =
    archiveDirectory === 'archive' ? 0 : Number(archiveDirectory.slice('archive-shard-'.length));
  if (archiveDirectory !== archiveDirectoryName(index))
    throw Error('Invalid Horse journal shard directory');
  const archive = runtimeHorseJournalArchiveOptions(directory, {}, { index });
  try {
    lstatSync(archive.directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { readOnly: true };
    throw error;
  }
  return { readOnly: true, archive };
}

/* A SHARD THE DISK CANNOT HOLD IS NEVER ADDED BY DEFAULT (2026-10-12). Each
   decision-worker shard owns a full allocation (above), so the default worker
   count (horseDecisionWorkerCount in engine/horseDecision/lane.ts) is bounded
   by how many shards the journal's filesystem can hold. A shard's worst case
   on disk is its compressed segment bytes at the small-file block overhead
   plus the catalog ceiling: measured on the engine host on 2026-10-12, 8.6 GB
   of compressed segments took 10.4 GB of blocks (1.21x) beside a 3.3 GB
   catalog, 14 GB a shard. The reserve is what every shard at its worst case
   still leaves to the rest of the host (the engine image build, logs). Existing
   archives grow on demand too: their remaining growth is charged first. */
export const HORSE_JOURNAL_SEGMENT_BLOCK_OVERHEAD = 1.25;
export const HORSE_JOURNAL_SHARD_DISK_RESERVE_BYTES = 4 * 1024 * 1024 * 1024;

/** One shard's worst-case footprint on disk at the given segment allocation. */
export function horseJournalShardDiskBytes(maxBytes: number): number {
  return (
    Math.ceil(maxBytes * HORSE_JOURNAL_SEGMENT_BLOCK_OVERHEAD) + HORSE_JOURNAL_ARCHIVE_CATALOG_BYTES
  );
}

/** du exits 1 when retention retires a segment between listing a directory
 * and stat-ing the file ("cannot access ...: No such file or directory").
 * A journal at its byte cap retires segments continuously. On the engine
 * host (2026-10-15, release 3002fe25, archives at their caps) the startup
 * walk met eleven, the reading was refused, and the lane fell back to the
 * legacy two-worker ceiling on a host whose disk budget admits three.
 *
 * Such a reading is still exact for the budget: a retired segment is unlinked
 * before statfs is read, so its blocks are counted as free, and leaving them
 * out of the allocation charges the same bytes again as remaining growth.
 * Allocated plus free is unchanged, so the result never authorizes a worker
 * the disk cannot hold. Only that one failure is accepted: any other stderr,
 * a timeout, a signal, an exit other than 1, a path outside the scanned
 * archives, or missing totals is still refused. */
function horseJournalAllocationDespiteRetiredSegments(
  error: unknown,
  directories: readonly string[]
): string {
  const failure = error as {
    status?: unknown;
    signal?: unknown;
    stdout?: unknown;
    stderr?: unknown;
  } | null;
  if (
    !failure ||
    failure.status !== 1 ||
    failure.signal ||
    typeof failure.stdout !== 'string' ||
    typeof failure.stderr !== 'string'
  )
    throw error;
  const complaints = failure.stderr.trimEnd().split('\n');
  const retired = complaints.every((line) => {
    const match = /^du: cannot access '(.+)': No such file or directory$/.exec(line);
    return (
      !!match &&
      !match[1]!.includes('\n') &&
      directories.some((directory) => match[1]!.startsWith(directory + '/'))
    );
  });
  if (!complaints.length || !retired) throw error;
  return failure.stdout;
}

/** Read actual allocated blocks once, without following symlinks. du walks the
 * potentially large archive, so cap its execution; a failed/incomplete reading
 * must never authorize an additional worker. Round down one KiB per result,
 * because du -k rounds each allocation up to a KiB. */
export const HORSE_JOURNAL_DU_TIMEOUT_MS = 15_000;
export const HORSE_JOURNAL_DU_ASYNC_TIMEOUT_MS = 90_000;

export function horseJournalArchiveAllocatedBytes(directories: readonly string[]): number[] {
  if (!directories.length) return [];
  checkArchiveDirectories(directories);
  let output: string;
  try {
    output = execFileSync('/usr/bin/du', ['-sk', ...directories], {
      encoding: 'utf8',
      timeout: HORSE_JOURNAL_DU_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    output = horseJournalAllocationDespiteRetiredSegments(error, directories);
  }
  return parseHorseJournalDu(output, directories);
}

function checkArchiveDirectories(directories: readonly string[]): void {
  for (const directory of directories) {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error('Invalid Horse journal archive directory');
  }
}

function parseHorseJournalDu(output: string, directories: readonly string[]): number[] {
  const lines = output.trimEnd().split('\n');
  if (lines.length !== directories.length) throw Error('Unreadable Horse archive allocation');
  return lines.map((line, index) => {
    const match = /^([0-9]+)\t(.*)$/.exec(line);
    if (!match || match[2] !== directories[index])
      throw Error('Unreadable Horse archive allocation');
    const bytes = Number(match[1]) * 1024;
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw Error('Unreadable Horse archive allocation');
    return Math.max(0, bytes - 1024);
  });
}

/**
 * THE WALK RUNS OFF THE EVENT LOOP, WITH TIME FOR A FULL ARCHIVE (2026-10-15).
 * The synchronous walk had 15 s. Three archives at their caps (13.9, 13.7 and
 * 5.7 GB of segments) took 9.9 s warm on the engine host read-only, two thirds
 * of that limit, and the boot walk on releases e848247e, 3002fe25 and 9970aa0c
 * (the last with the retired-segment rule) was refused each time, keeping the
 * two-worker ceiling on a host whose disk admits three. Lane start is
 * already asynchronous, so the walk now runs as a child process the event loop
 * does not wait on, with HORSE_JOURNAL_DU_ASYNC_TIMEOUT_MS. Every refusal rule
 * of the synchronous walk is unchanged.
 */
export async function horseJournalArchiveAllocatedBytesAsync(
  directories: readonly string[]
): Promise<number[]> {
  if (!directories.length) return [];
  checkArchiveDirectories(directories);
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      '/usr/bin/du',
      ['-sk', ...directories],
      {
        encoding: 'utf8',
        timeout: HORSE_JOURNAL_DU_ASYNC_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, LC_ALL: 'C' },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        try {
          resolve(
            horseJournalAllocationDespiteRetiredSegments(
              Object.assign(error, {
                status: typeof error.code === 'number' ? error.code : null,
                stdout,
                stderr,
              }),
              directories
            )
          );
        } catch (refused) {
          reject(refused);
        }
      }
    );
  });
  return parseHorseJournalDu(output, directories);
}

/**
 * THE WALK LEAVES THE BOOT PATH WHEN IT CANNOT CHANGE THE ANSWER (2026-10-24).
 * Lane construction awaits this before any table can be dealt, so the du walk
 * over every archive shard (about 3.5 million segment files on engine-01) sat
 * on the critical path of every engine start. Release c485ce7a booted with the
 * lane starting 23 s after the process; the same walk is why release e4f7
 * reached dealer readiness too late for its final database proof inside the
 * maintenance break and rolled back.
 *
 * The walk only ever matters through the default worker count, which takes the
 * minimum of the CPU default, this capacity and a fixed maximum. So the
 * capacity is first priced with every existing archive assumed EMPTY - the
 * most growth those archives could still claim, which can only lower the
 * answer - from one statfs and a directory listing. When even that lower bound
 * already admits `sufficientShards` (the lane passes its maximum worker count),
 * the measured answer could not change the worker count and the walk is
 * skipped; the published capacity is that lower bound. Otherwise, or when the
 * bound itself is unreadable, the original walk runs with every refusal rule
 * unchanged, so a full disk is still measured exactly and an unreadable
 * reading still keeps the legacy two-worker ceiling.
 */
export async function horseJournalShardCapacityMeasured(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: { sufficientShards?: number } = {}
): Promise<number | undefined> {
  const directory = environment.HORSE_DECISION_JOURNAL_DIR;
  if (!directory) return horseJournalShardCapacity(environment);
  const sufficient = options.sufficientShards;
  if (sufficient !== undefined && Number.isSafeInteger(sufficient) && sufficient >= 1) {
    const lowerBound = horseJournalShardCapacity(environment, (directories) =>
      directories.map(() => 0)
    );
    if (
      horseJournalCapacityUnreadableReason() === null &&
      lowerBound !== undefined &&
      lowerBound >= sufficient
    ) {
      return lowerBound;
    }
  }
  let measured: number[] | { error: unknown };
  try {
    const names = horseJournalArchiveDirectoryNames(directory);
    measured = await horseJournalArchiveAllocatedBytesAsync(names.map((n) => join(directory, n)));
  } catch (error) {
    measured = { error };
  }
  return horseJournalShardCapacity(environment, () => {
    if (!Array.isArray(measured)) throw measured.error;
    return measured;
  });
}

/** Existing archives consume free space as they grow towards their quotas.
 * Reserve that remaining growth before admitting fresh full-size shards.
 * (The live writer's time guarantee lets a shard grow past its byte quota
 * while free space stays above the disk floor, so this reserve understates
 * that growth; the floor, not this sizing, bounds the disk in that case.)
 * Retain existing workers when their previous allocation already exceeds the
 * disk budget; this guard never retires archives or changes their retention. */
export function horseJournalShardsAffordable(input: {
  existingShardAllocatedBytes: readonly number[];
  availableBytes: number;
  shardBytes: number;
  /** Worst-case cost for indexes 2+, defaulting to the legacy cost. */
  additionalShardBytes?: number;
  reserveBytes: number;
}): number {
  const additional = input.additionalShardBytes ?? input.shardBytes;
  if (
    ![input.availableBytes, input.shardBytes, additional, input.reserveBytes].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    ) ||
    input.shardBytes === 0 ||
    additional === 0 ||
    input.existingShardAllocatedBytes.some((value) => !Number.isSafeInteger(value) || value < 0)
  )
    throw Error('Unreadable Horse journal disk capacity');
  const remainingGrowth = input.existingShardAllocatedBytes.reduce(
    (total, bytes, index) =>
      total + Math.max(0, (index < 2 ? input.shardBytes : additional) - bytes),
    0
  );
  if (!Number.isSafeInteger(remainingGrowth)) throw Error('Unreadable Horse journal disk capacity');
  const existing = input.existingShardAllocatedBytes.length;
  const budget = Math.max(0, input.availableBytes - input.reserveBytes - remainingGrowth);
  // A fresh journal must pay for indexes 0 and 1 before cheaper later shards.
  const legacyFresh = Math.min(Math.max(0, 2 - existing), Math.floor(budget / input.shardBytes));
  const laterFresh =
    existing + legacyFresh >= 2
      ? Math.floor((budget - legacyFresh * input.shardBytes) / additional)
      : 0;
  return Math.max(1, existing + legacyFresh + laterFresh);
}

let journalCapacityUnreadable: string | null = null;

/** Why the last journal capacity reading was refused, published on /health
 * (liveHorseDecision.journalCapacityUnreadable) so the reason a host runs the
 * two-worker ceiling is visible without reading the host. Null when the last
 * reading succeeded or nothing is journaled. */
export function horseJournalCapacityUnreadableReason(): string | null {
  return journalCapacityUnreadable;
}

/** One bounded line: the error's first line, with the exit status, signal and
 * first stderr line of a failed command. Paths only; never an environment value. */
function capacityFailureText(error: unknown): string {
  const e = (error ?? {}) as {
    message?: unknown;
    status?: unknown;
    signal?: unknown;
    code?: unknown;
    stderr?: unknown;
  };
  const first = (value: unknown) =>
    typeof value === 'string' ? (value.split('\n').find((line) => line.trim()) ?? '') : '';
  const parts = [first(e.message) || 'unknown error'];
  if (e.code !== undefined) parts.push(`code=${String(e.code)}`);
  if (e.status !== undefined && e.status !== null) parts.push(`status=${String(e.status)}`);
  if (e.signal) parts.push(`signal=${String(e.signal)}`);
  const stderr = first(e.stderr);
  if (stderr) parts.push(`stderr=${stderr}`);
  return parts.join(' ').slice(0, 400);
}

/** Measure once at lane construction. No configured journal means no disk
 * limit. A configured journal whose budget cannot be read retains the legacy
 * two-worker ceiling; inability to measure must never increase the default. */
export function horseJournalShardCapacity(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  allocationReader: (directories: readonly string[]) => number[] = horseJournalArchiveAllocatedBytes
): number | undefined {
  const directory = environment.HORSE_DECISION_JOURNAL_DIR;
  journalCapacityUnreadable = null;
  if (!directory) return undefined;
  try {
    const { maxBytes } = runtimeHorseJournalArchiveOptions(directory, environment);
    let probe = directory;
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
    const names = horseJournalArchiveDirectoryNames(directory);
    if (names.some((name, index) => name !== archiveDirectoryName(index)))
      throw Error('Incomplete Horse journal archive layout');
    const directories = names.map((name) => join(directory, name));
    const allocated = allocationReader(directories);
    if (allocated.length !== directories.length) throw Error('Incomplete Horse archive allocation');
    // Read free space after the allocation walk. Lane construction precedes
    // spawning its shard writers; no publisher starts during this measurement.
    const fs = statfsSync(probe);
    const shards = horseJournalShardsAffordable({
      existingShardAllocatedBytes: allocated,
      availableBytes: fs.bavail * fs.bsize,
      shardBytes: horseJournalShardDiskBytes(maxBytes),
      additionalShardBytes: horseJournalShardDiskBytes(
        runtimeHorseJournalArchiveOptions(directory, environment, { index: 2 }).maxBytes
      ),
      reserveBytes: HORSE_JOURNAL_SHARD_DISK_RESERVE_BYTES,
    });
    journalCapacityUnreadable = null;
    return shards;
  } catch (error) {
    journalCapacityUnreadable = capacityFailureText(error);
    console.warn(
      '[HorseDecisionLane] journal disk capacity unreadable; retaining legacy two-worker ceiling',
      journalCapacityUnreadable
    );
    return 2;
  }
}
