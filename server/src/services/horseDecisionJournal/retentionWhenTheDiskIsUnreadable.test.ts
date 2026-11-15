/* RETENTION BY TIME WHEN statfs FAILS (2026-11-15, Hand Analysis N9 on
   f38ca7b7). An unreadable filesystem never lets the byte allocation yield
   (the breach is named "unreadable", not "at the floor"), and a ring draining
   far over its allocation refuses rather than accepts while it cannot read
   the disk. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fsState = vi.hoisted(() => ({ fail: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    statfsSync: (...args: Parameters<typeof actual.statfsSync>) => {
      if (fsState.fail) throw Object.assign(new Error('EIO: statfs'), { code: 'EIO' });
      return actual.statfsSync(...args);
    },
  };
});
import { HorseDecisionJournalStore } from './store.js';
import { journalHash, makeHorseJournalRecord, type HorseJournalRecord } from './record.js';

const H = 3_600_000;
const folders: string[] = [];
const stores: HorseDecisionJournalStore[] = [];
afterEach(() => {
  fsState.fail = false;
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
      producerId: '10000000-0000-4000-8000-000000000004',
      sequence,
      atMs: 1_000 + sequence,
      sourceRelease: null,
      kind: 'decision',
      handKey: journalHash(`hand-${sequence}`),
      turnKey: journalHash(`turn-${sequence}`),
    },
    { card: 'As', pad: 'x'.repeat(200 + sequence) }
  );
const store = (dir: string, extra: Record<string, number>, maxBytes: number) => {
  const s = new HorseDecisionJournalStore(dir, {
    archive: {
      directory: join(dir, 'archive'),
      maxBytes,
      maxSegments: 1_000,
      hold: null,
      ...extra,
    },
  });
  stores.push(s);
  return s;
};
const oneSegmentBytes = () => {
  const d = mkdtempSync(join(tmpdir(), 'horse-journal-unreadable-probe-'));
  folders.push(d);
  const p = store(d, {}, 1 << 30);
  p.append(rec(5));
  return p.storageStats().archive!.compressedBytes;
};

it('an unreadable disk never lets the byte allocation yield, and says so by name', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const one = oneSegmentBytes();
  const dir = mkdtempSync(join(tmpdir(), 'horse-journal-unreadable-'));
  folders.push(dir);
  const s = store(
    dir,
    { minRetentionMs: 30 * H, diskFloorBytes: 1 },
    one * 3 + Math.floor(one / 2)
  );
  fsState.fail = true;
  for (let i = 1; i <= 8; i++) s.append(rec(i));
  const a = s.storageStats().archive!;
  expect(a.segments).toBeLessThanOrEqual(4);
  expect(a.retentionBreaches).toBeGreaterThan(0);
  expect(warn.mock.calls.some((c) => String(c[0]).includes('free disk is unreadable'))).toBe(true);
  expect(warn.mock.calls.some((c) => String(c[0]).includes('free disk is at the floor'))).toBe(
    false
  );
});

it('a ring draining far over its allocation refuses the batch while the disk is unreadable, and accepts it once readable', () => {
  const one = oneSegmentBytes();
  const dir = mkdtempSync(join(tmpdir(), 'horse-journal-unreadable-drain-'));
  folders.push(dir);
  const maxBytes = one * 3 + Math.floor(one / 2);
  const first = store(dir, { minRetentionMs: 30 * H, diskFloorBytes: 1 }, maxBytes);
  for (let i = 1; i <= 40; i++) first.append(rec(i));
  first.close();
  const s = store(dir, { minRetentionMs: 0, diskFloorBytes: 1, ringRetireLimit: 8 }, maxBytes);
  fsState.fail = true;
  expect(() => s.append(rec(41))).toThrow('horse_archive_byte_capacity');
  expect(s.storageStats().archive!.retiredSegments).toBe(8);
  fsState.fail = false;
  // free space is re-read at most once a second
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_100);
  expect(() => s.append(rec(42))).not.toThrow();
});
