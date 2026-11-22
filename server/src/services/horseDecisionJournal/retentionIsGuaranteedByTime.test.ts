/* RETENTION IS GUARANTEED BY TIME (2026-11-15; config.ts says why). The byte
   allocation yields while the oldest retirable segment is younger than the
   minimum retention and the disk keeps its floor; old segments are retired
   for bytes exactly as before; a disk at the floor breaks the guarantee by
   name; hard quotas never yield. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lstatSync, mkdtempSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HorseDecisionJournalStore } from './store.js';
import { journalHash, makeHorseJournalRecord, type HorseJournalRecord } from './record.js';
import {
  HORSE_JOURNAL_MIN_RETENTION_HOURS,
  HORSE_JOURNAL_RETENTION_DISK_FLOOR_BYTES,
  horseJournalByteQuotaVerdict,
  runtimeHorseJournalArchiveOptions,
  runtimeHorseJournalWriterArchiveOptions,
} from './config.js';

const H = 3_600_000;
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
      producerId: '10000000-0000-4000-8000-000000000003',
      sequence,
      atMs: 1_000 + sequence,
      sourceRelease: null,
      kind: 'decision',
      handKey: journalHash(`hand-${sequence}`),
      turnKey: journalHash(`turn-${sequence}`),
    },
    { card: 'As', pad: 'x'.repeat(200 + sequence) }
  );
/** A store whose byte allocation holds about three segments. */
const open = (extra: {
  minRetentionMs?: number;
  diskFloorBytes?: number;
  maxSegments?: number;
  ringRetireLimit?: number;
}) => {
  const dir = mkdtempSync(join(tmpdir(), 'horse-journal-retention-'));
  folders.push(dir);
  const probeDir = mkdtempSync(join(tmpdir(), 'horse-journal-retention-probe-'));
  folders.push(probeDir);
  const probe = new HorseDecisionJournalStore(probeDir, {
    archive: {
      directory: join(probeDir, 'archive'),
      maxBytes: 1 << 30,
      maxSegments: 1_000,
      hold: null,
    },
  });
  probe.append(rec(5));
  const one = probe.storageStats().archive!.compressedBytes;
  probe.close();
  const make = (o: typeof extra = extra) =>
    new HorseDecisionJournalStore(dir, {
      archive: {
        directory: join(dir, 'archive'),
        maxBytes: one * 3 + Math.floor(one / 2),
        maxSegments: o.maxSegments ?? 1_000,
        hold: null,
        ...(o.minRetentionMs === undefined ? {} : { minRetentionMs: o.minRetentionMs }),
        ...(o.diskFloorBytes === undefined ? {} : { diskFloorBytes: o.diskFloorBytes }),
        ...(o.ringRetireLimit === undefined ? {} : { ringRetireLimit: o.ringRetireLimit }),
      },
    });
  const s = make();
  stores.push(s);
  /** A fresh writer on the same journal (the file-time cache is per writer;
   * a real segment's file time never changes after it is published). */
  const reopen = () => {
    s.close();
    const t = make();
    stores.push(t);
    return t;
  };
  /** The same journal reopened with other retention options (turning the
   * guarantee off, or a floor the disk is already under). */
  const reopenWith = (o: typeof extra) => {
    s.close();
    const t = make(o);
    stores.push(t);
    return t;
  };
  return { s, segments: join(dir, 'archive', 'segments'), reopen, reopenWith };
};
/** Age every segment file now present by `ageMs`. */
const age = (segments: string, ageMs: number) => {
  const t = (Date.now() - ageMs) / 1000;
  for (const f of readdirSync(segments)) utimesSync(join(segments, f), t, t);
};

describe('the verdict', () => {
  const base = { minRetentionMs: 30 * H, freeBytes: 100, incomingBytes: 10, diskFloorBytes: 50 };
  it('keeps a young segment while the disk keeps its floor', () =>
    expect(horseJournalByteQuotaVerdict({ ...base, oldestAgeMs: H })).toBe('keep'));
  it('retires an old segment', () =>
    expect(horseJournalByteQuotaVerdict({ ...base, oldestAgeMs: 30 * H })).toBe('retire'));
  it('breaches at the floor (incoming bytes counted)', () => {
    expect(horseJournalByteQuotaVerdict({ ...base, oldestAgeMs: H, incomingBytes: 50 })).toBe(
      'breach'
    );
    expect(horseJournalByteQuotaVerdict({ ...base, oldestAgeMs: H, freeBytes: null })).toBe(
      'breach'
    );
  });
  it('is off at 0 and with no known age', () => {
    expect(horseJournalByteQuotaVerdict({ ...base, minRetentionMs: 0, oldestAgeMs: H })).toBe(
      'retire'
    );
    expect(horseJournalByteQuotaVerdict({ ...base, oldestAgeMs: null })).toBe('retire');
  });
});

describe('the runtime allocation', () => {
  it('the live writer defaults to 72 h and a 32 GiB floor; 0 turns it off; bad values are refused', () => {
    const d = runtimeHorseJournalWriterArchiveOptions('/j', {});
    expect(d.minRetentionMs).toBe(HORSE_JOURNAL_MIN_RETENTION_HOURS * H);
    expect(HORSE_JOURNAL_MIN_RETENTION_HOURS).toBe(72);
    expect(d.diskFloorBytes).toBe(HORSE_JOURNAL_RETENTION_DISK_FLOOR_BYTES);
    expect(
      runtimeHorseJournalWriterArchiveOptions('/j', {
        HORSE_DECISION_JOURNAL_ARCHIVE_MIN_RETENTION_HOURS: '0',
      }).minRetentionMs
    ).toBe(0);
    for (const bad of ['-1', '169', '1.5', 'x'])
      expect(() =>
        runtimeHorseJournalWriterArchiveOptions('/j', {
          HORSE_DECISION_JOURNAL_ARCHIVE_MIN_RETENTION_HOURS: bad,
        })
      ).toThrow('Invalid Horse archive resource allocation');
  });
  it('readers, tools and tests keep byte-bound options unchanged', () => {
    const r = runtimeHorseJournalArchiveOptions('/j', {});
    expect(r.minRetentionMs).toBeUndefined();
    expect(r.diskFloorBytes).toBeUndefined();
  });
  it('the engine writer opens with the guarantee', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../HorseDecisionJournal.ts', import.meta.url), 'utf8');
    expect(
      src.match(/runtimeHorseJournalWriterArchiveOptions\(directory, process\.env, shard\)/g)
    ).toHaveLength(2);
  });
});

describe('the ring with a time guarantee', () => {
  it('without the guarantee, bytes bind as before', () => {
    const { s } = open({});
    for (let i = 1; i <= 8; i++) s.append(rec(i));
    const a = s.storageStats().archive!;
    expect(a.segments).toBeLessThanOrEqual(4);
    expect(a.retiredSegments).toBeGreaterThan(0);
    expect(a.minRetentionMs).toBe(0);
  });

  it('keeps every segment younger than the guarantee past the byte allocation', () => {
    const { s } = open({ minRetentionMs: 30 * H, diskFloorBytes: 1 });
    for (let i = 1; i <= 8; i++) s.append(rec(i));
    const a = s.storageStats().archive!;
    expect(a.segments).toBe(8);
    expect(a.retiredSegments).toBe(0);
    expect(a.retentionBreaches).toBe(0);
    expect(a.minRetentionMs).toBe(30 * H);
  });

  it('retires segments older than the guarantee for bytes, oldest first, and keeps the young', () => {
    const { s: first, segments, reopen } = open({ minRetentionMs: 30 * H, diskFloorBytes: 1 });
    for (let i = 1; i <= 6; i++) first.append(rec(i));
    age(segments, 31 * H);
    const s = reopen();
    for (let i = 7; i <= 9; i++) s.append(rec(i));
    const a = s.storageStats().archive!;
    // The three young segments stay; old ones went until the bytes fit or only young remained.
    expect(a.segments).toBeGreaterThanOrEqual(3);
    expect(a.retiredSegments).toBeGreaterThanOrEqual(3);
    const left = readdirSync(segments).map((f) => lstatSync(join(segments, f)));
    expect(left.filter((st) => Date.now() - st.mtimeMs < H).length).toBe(3);
    for (const st of left) expect(st.nlink).toBe(1);
  });

  it('a disk at the floor retires young segments and names the breach', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { s } = open({ minRetentionMs: 30 * H, diskFloorBytes: Number.MAX_SAFE_INTEGER });
    for (let i = 1; i <= 8; i++) s.append(rec(i));
    const a = s.storageStats().archive!;
    expect(a.segments).toBeLessThanOrEqual(4);
    expect(a.retentionBreaches).toBeGreaterThan(0);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes('journal_retention_guarantee_breached'))
    ).toBe(true);
  });

  it('a hard quota (segments) never yields to the guarantee', () => {
    const { s } = open({ minRetentionMs: 30 * H, diskFloorBytes: 1, maxSegments: 5 });
    for (let i = 1; i <= 8; i++) s.append(rec(i));
    expect(s.storageStats().archive!.segments).toBeLessThanOrEqual(5);
  });
});

/* B1 (Hand Analysis review of f38ca7b7, 2026-11-15): with the guarantee on a
   shard holds far more than its byte allocation. When the guarantee ends (0 h,
   or the disk floor), the ring retires 1,024 segments per append; it used to
   refuse the batch after that, dropping capture for the whole drain. Now the
   batch is accepted while the other quotas fit and the disk has room, and the
   following appends keep draining until the bytes fit. */
describe('draining an archive far over its byte allocation', () => {
  /** An archive `over` segments long built with the guarantee on (so nothing
   * was retired), then reopened with `next`. */
  const build = (over: number, next: Parameters<typeof open>[0]) => {
    const o = open({ minRetentionMs: 30 * H, diskFloorBytes: 1, maxSegments: 5_000 });
    for (let i = 1; i <= over; i++) o.s.append(rec(i));
    const a = o.s.storageStats().archive!;
    expect(a.segments).toBe(over);
    expect(a.retiredSegments).toBe(0);
    return o.reopenWith(next);
  };

  it('more than 1,024 segments over budget, the guarantee turned off (0 h): every batch is accepted while it drains', () => {
    const OVER = 1_100; // the real per-append bound, RING_RETIRE_LIMIT = 1,024
    const s = build(OVER, { minRetentionMs: 0, diskFloorBytes: 1, maxSegments: 5_000 });
    expect(() => s.append(rec(OVER + 1))).not.toThrow();
    let a = s.storageStats().archive!;
    expect(a.retiredSegments).toBe(1_024);
    expect(a.segments).toBe(OVER + 1 - 1_024);
    for (let i = OVER + 2; i <= OVER + 4; i++) expect(() => s.append(rec(i))).not.toThrow();
    a = s.storageStats().archive!;
    expect(a.segments).toBeLessThanOrEqual(4);
    expect(a.compressedBytes).toBeLessThanOrEqual(a.maxBytes);
    expect(a.retentionBreaches).toBe(0);
  }, 240_000);

  it('a disk under the floor drains young segments, accepts the batches and counts one breach per append', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const s = build(40, {
      minRetentionMs: 30 * H,
      diskFloorBytes: Number.MAX_SAFE_INTEGER,
      maxSegments: 5_000,
      ringRetireLimit: 8,
    });
    expect(() => s.append(rec(41))).not.toThrow();
    let a = s.storageStats().archive!;
    expect(a.retiredSegments).toBe(8);
    expect(a.retentionBreaches).toBe(1);
    for (let i = 42; i <= 46; i++) expect(() => s.append(rec(i))).not.toThrow();
    a = s.storageStats().archive!;
    expect(a.segments).toBeLessThanOrEqual(4);
    expect(a.retentionBreaches).toBe(6);
    const named = warn.mock.calls.filter((c) =>
      String(c[0]).includes('journal_retention_guarantee_breached: free disk is at the floor')
    );
    expect(named.length).toBe(1); // named at most once a minute
  });

  it('the drain never accepts a batch a hard quota refuses; it is accepted once the quota fits', () => {
    // 40 segments, bound 8 per append, segment quota 20: the first two appends
    // retire 8 each and are refused by name (32 + 1 and 24 + 1 segments exceed 20),
    // the third retires 8 more (16 + 1 fit) and is accepted.
    const s = build(40, {
      minRetentionMs: 0,
      diskFloorBytes: 1,
      maxSegments: 20,
      ringRetireLimit: 8,
    });
    expect(() => s.append(rec(41))).toThrow(/horse_archive_(byte|segment)_capacity/);
    expect(() => s.append(rec(42))).toThrow(/horse_archive_(byte|segment)_capacity/);
    expect(s.storageStats().archive!.retiredSegments).toBe(16);
    expect(() => s.append(rec(43))).not.toThrow();
    expect(s.storageStats().archive!.segments).toBeLessThanOrEqual(17);
  });

  it('a hard quota retiring a young segment is a named breach (N2)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { s } = open({ minRetentionMs: 30 * H, diskFloorBytes: 1, maxSegments: 5 });
    for (let i = 1; i <= 8; i++) s.append(rec(i));
    const a = s.storageStats().archive!;
    expect(a.segments).toBeLessThanOrEqual(5);
    expect(a.retentionBreaches).toBe(3);
    expect(
      warn.mock.calls.some((c) =>
        String(c[0]).includes('a segment, record or catalog quota is full')
      )
    ).toBe(true);
  });

  it('refuses a retirement bound outside 1 to 1,024', () => {
    expect(() => open({ ringRetireLimit: 0 })).toThrow('Invalid Horse archive configuration');
    expect(() => open({ ringRetireLimit: 1_025 })).toThrow('Invalid Horse archive configuration');
  });
});

describe('the runtime allocation, edges (N9)', () => {
  it('accepts 168 h, refuses 169 h, and reads the floor from the environment', () => {
    const env = (v: Record<string, string>) =>
      runtimeHorseJournalWriterArchiveOptions(join(tmpdir(), 'x'), { ...v });
    expect(env({ HORSE_DECISION_JOURNAL_ARCHIVE_MIN_RETENTION_HOURS: '168' }).minRetentionMs).toBe(
      168 * H
    );
    expect(() => env({ HORSE_DECISION_JOURNAL_ARCHIVE_MIN_RETENTION_HOURS: '169' })).toThrow();
    expect(
      env({ HORSE_DECISION_JOURNAL_ARCHIVE_DISK_FLOOR_BYTES: String(8 * 1024 ** 3) }).diskFloorBytes
    ).toBe(8 * 1024 ** 3);
    expect(() => env({ HORSE_DECISION_JOURNAL_ARCHIVE_DISK_FLOOR_BYTES: '0' })).toThrow();
  });
});
