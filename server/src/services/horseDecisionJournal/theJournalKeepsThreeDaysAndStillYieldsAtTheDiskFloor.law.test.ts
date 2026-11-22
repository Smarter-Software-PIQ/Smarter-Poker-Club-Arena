/* LAW (2026-11-21): THE HORSE DECISION JOURNAL KEEPS THREE DAYS, AND STILL
   YIELDS AT THE DISK FLOOR EXACTLY AS IT DID AT 30 HOURS.

   The live writer's time guarantee is 72 h by default (config.ts, SEVENTY-TWO
   HOURS). At 30 h the hands that matter most, the few a person plays each
   day, were retired before the by-hand read the release rules allow could
   reach them. This law fixes the two halves of that change together:
     - the default is 72 h and nothing younger is retired for bytes while the
       disk keeps its floor (a segment 31 h or 71 h old stays);
     - the floor is still 32 GiB and still wins: at or under it a young
       segment is retired, oldest first, and the breach is named; a hard
       quota still never yields; readers and tools still get no guarantee.
   Lowering the default, or weakening the floor so a longer guarantee could
   fill the engine host's disk, fails here. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HorseDecisionJournalStore } from './store.js';
import { journalHash, makeHorseJournalRecord, type HorseJournalRecord } from './record.js';
import {
  HORSE_JOURNAL_MAX_MIN_RETENTION_HOURS,
  HORSE_JOURNAL_MIN_RETENTION_HOURS,
  HORSE_JOURNAL_RETENTION_DISK_FLOOR_BYTES,
  horseJournalByteQuotaVerdict,
  runtimeHorseJournalArchiveOptions,
  runtimeHorseJournalWriterArchiveOptions,
} from './config.js';

const H = 3_600_000;
const GiB = 1024 * 1024 * 1024;
const live = runtimeHorseJournalWriterArchiveOptions('/j', {});
const folders: string[] = [];
const stores: HorseDecisionJournalStore[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const s of stores.splice(0))
    try {
      s.close();
    } catch {
      /* closed */
    }
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});
const rec = (sequence: number): HorseJournalRecord =>
  makeHorseJournalRecord(
    {
      producerId: '10000000-0000-4000-8000-000000000072',
      sequence,
      atMs: 1_000 + sequence,
      sourceRelease: null,
      kind: 'decision',
      handKey: journalHash(`hand-${sequence}`),
      turnKey: journalHash(`turn-${sequence}`),
    },
    { pad: 'x'.repeat(200 + sequence) }
  );
/** A journal whose byte allocation holds about three segments, opened with
 * the live writer's own guarantee and the given disk floor. */
const journal = (diskFloorBytes: number, maxSegments = 1_000) => {
  const probeDir = mkdtempSync(join(tmpdir(), 'horse-journal-72h-probe-'));
  folders.push(probeDir);
  const probe = new HorseDecisionJournalStore(probeDir, {
    archive: {
      directory: join(probeDir, 'archive'),
      maxBytes: 1 << 30,
      maxSegments: 1_000,
      hold: null,
    },
  });
  probe.append(rec(900));
  const one = probe.storageStats().archive!.compressedBytes;
  probe.close();
  const dir = mkdtempSync(join(tmpdir(), 'horse-journal-72h-'));
  folders.push(dir);
  const make = () => {
    const s = new HorseDecisionJournalStore(dir, {
      archive: {
        directory: join(dir, 'archive'),
        maxBytes: one * 3 + Math.floor(one / 2),
        maxSegments,
        hold: null,
        minRetentionMs: live.minRetentionMs,
        diskFloorBytes,
      },
    });
    stores.push(s);
    return s;
  };
  const segments = join(dir, 'archive', 'segments');
  const age = (ageMs: number) => {
    const t = (Date.now() - ageMs) / 1000;
    for (const f of readdirSync(segments)) utimesSync(join(segments, f), t, t);
  };
  return { make, age };
};

describe('the Horse decision journal keeps three days and still yields at the disk floor', () => {
  it('the live writer guarantees 72 hours by default; the floor is 32 GiB; the ceiling is 168 h', () => {
    expect(HORSE_JOURNAL_MIN_RETENTION_HOURS).toBe(72);
    expect(live.minRetentionMs).toBe(72 * H);
    expect(HORSE_JOURNAL_RETENTION_DISK_FLOOR_BYTES).toBe(32 * GiB);
    expect(live.diskFloorBytes).toBe(32 * GiB);
    expect(HORSE_JOURNAL_MAX_MIN_RETENTION_HOURS).toBe(168);
    // Readers, tools and tests are given no guarantee: only the engine's writer keeps by time.
    const reader = runtimeHorseJournalArchiveOptions('/j', {});
    expect(reader.minRetentionMs).toBeUndefined();
    expect(reader.diskFloorBytes).toBeUndefined();
    // The environment still overrides it, both ways, exactly as before.
    const hours = (value: string) =>
      runtimeHorseJournalWriterArchiveOptions('/j', {
        HORSE_DECISION_JOURNAL_ARCHIVE_MIN_RETENTION_HOURS: value,
      }).minRetentionMs;
    expect(hours('30')).toBe(30 * H);
    expect(hours('0')).toBe(0);
  });

  it('the verdict at the live defaults: young stays above the floor, yields at it, old is retired', () => {
    const floor = live.diskFloorBytes!;
    const incoming = 4 * 1024 * 1024;
    const at = (oldestAgeMs: number, freeBytes: number | null) =>
      horseJournalByteQuotaVerdict({
        minRetentionMs: live.minRetentionMs!,
        oldestAgeMs,
        freeBytes,
        incomingBytes: incoming,
        diskFloorBytes: floor,
      });
    // What 30 h used to retire is kept now.
    expect(at(31 * H, 170 * GiB)).toBe('keep');
    expect(at(72 * H - 1, 170 * GiB)).toBe('keep');
    expect(at(72 * H, 170 * GiB)).toBe('retire');
    // The floor, to the byte, counting the batch about to be written.
    expect(at(31 * H, floor + incoming + 1)).toBe('keep');
    expect(at(31 * H, floor + incoming)).toBe('breach');
    expect(at(31 * H, floor - 1)).toBe('breach');
    expect(at(H, 0)).toBe('breach');
    // An unreadable disk is never assumed to have room.
    expect(at(31 * H, null)).toBe('breach');
    expect(at(31 * H, Number.NaN)).toBe('breach');
  });

  it('the ring keeps segments 31 h and 71 h old past its byte allocation while the disk has room', () => {
    for (const hours of [31, 71]) {
      const { make, age } = journal(1);
      const first = make();
      for (let i = 1; i <= 6; i++) first.append(rec(i));
      age(hours * H);
      first.close();
      const s = make();
      for (let i = 7; i <= 9; i++) s.append(rec(i));
      const a = s.storageStats().archive!;
      expect(a.segments).toBe(9);
      expect(a.retiredSegments).toBe(0);
      expect(a.retentionBreaches).toBe(0);
      expect(a.minRetentionMs).toBe(72 * H);
    }
  });

  it('segments older than 72 h are retired for bytes with no breach', () => {
    const { make, age } = journal(1);
    const first = make();
    for (let i = 1; i <= 6; i++) first.append(rec(i));
    age(73 * H);
    first.close();
    const s = make();
    for (let i = 7; i <= 9; i++) s.append(rec(i));
    const a = s.storageStats().archive!;
    expect(a.retiredSegments).toBeGreaterThanOrEqual(3);
    expect(a.segments).toBeGreaterThanOrEqual(3);
    expect(a.retentionBreaches).toBe(0);
  });

  it('under the disk floor the guarantee yields: young segments are retired and the breach is named', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { make } = journal(Number.MAX_SAFE_INTEGER);
    const s = make();
    for (let i = 1; i <= 8; i++) s.append(rec(i));
    const a = s.storageStats().archive!;
    // Bytes bind again, as with no guarantee at all: the disk cannot be filled by it.
    expect(a.segments).toBeLessThanOrEqual(4);
    expect(a.retiredSegments).toBeGreaterThan(0);
    expect(a.retentionBreaches).toBeGreaterThan(0);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('journal_retention_guarantee_breached'))
    ).toBe(true);
    // Capture never stopped for it.
    expect(s.readHand(journalHash('hand-8')).length).toBe(1);
  });

  it('a hard quota (segments) still never yields to the 72 hour guarantee', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { make } = journal(1, 4);
    const s = make();
    for (let i = 1; i <= 9; i++) s.append(rec(i));
    const a = s.storageStats().archive!;
    expect(a.segments).toBeLessThanOrEqual(4);
    expect(a.retiredSegments).toBeGreaterThan(0);
  });
});
