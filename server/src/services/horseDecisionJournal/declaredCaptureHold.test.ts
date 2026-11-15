/* A DECLARED CAPTURE KEEPS ITS WINDOW WITHOUT A RESTART (2026-11-15).
   The evidence hold was one environment variable, read when a writer opens
   and still set to the 2026-09 Phase 6A/6B window. A capture declared for a
   later release therefore had no protection from the ring: on 2026-11-14 the
   oldest journal files were retired at up to 1.3 times real time, and the
   capture owner byte-copied every segment file hourly to keep a twelve-hour
   window. A declared hold is now a small private file in the journal's
   holds/ directory. Every shard's writer reads it within its refresh
   interval, keeps the window's segments (including segments still being
   appended while the window is open) inside the existing hold budget, keeps
   the oldest when the budget is reached, and releases them at expiry. A bad
   file is refused by name and never stops capture. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as storeModule from './store.js';
import { HorseDecisionJournalStore } from './store.js';
import { journalHash, makeHorseJournalRecord, type HorseJournalRecord } from './record.js';
import * as config from './config.js';
import { horseJournalHoldBudget, type HorseJournalArchiveOptions } from './config.js';

const folders: string[] = [],
  stores: HorseDecisionJournalStore[] = [];
const folder = () => {
  const p = mkdtempSync(join(tmpdir(), 'horse-journal-declared-'));
  folders.push(p);
  return p;
};
const open = (
  dir: string,
  shard = 'archive',
  archive: Partial<HorseJournalArchiveOptions> = {}
) => {
  const s = new HorseDecisionJournalStore(dir, {
    archive: {
      directory: join(dir, shard),
      maxBytes: 1024 * 1024 * 1024,
      maxSegments: 1_000_000,
      ...archive,
    },
  });
  stores.push(s);
  return s;
};
const second = 1000;
const at = (sequence: number, atMs = sequence * second): HorseJournalRecord =>
  makeHorseJournalRecord(
    {
      producerId: '10000000-0000-4000-8000-000000000001',
      sequence,
      atMs,
      sourceRelease: null,
      kind: 'decision',
      handKey: journalHash('hand'),
      turnKey: journalHash('turn'),
    },
    { card: 'As' }
  );
const utc = (ms: number) => new Date(ms).toISOString().replace('.000Z', 'Z');
const DAY = 86_400_000;
/** Writes holds/<id>.json the way an operator would: private directory, private file. */
const declare = (
  dir: string,
  id: string,
  body: Record<string, unknown> | string,
  mode = 0o600
): string => {
  mkdirSync(join(dir, 'holds'), { recursive: true, mode: 0o700 });
  const path = join(dir, 'holds', id + '.json');
  writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body), { mode });
  chmodSync(path, mode);
  return path;
};
const window = (fromS: number, untilS: number, expiresDays = 7) => ({
  version: 1,
  fromUtc: utc(fromS * second),
  untilUtc: utc(untilS * second),
  expiresUtc: utc(untilS * second + expiresDays * DAY),
  operator: 'test capture owner',
});
const kept = (s: HorseDecisionJournalStore) =>
  s
    .readHand(journalHash('hand'))
    .map((r) => r.sequence)
    .sort((a, b) => a - b);
/** n segments at 1..n seconds, then the archive is reopened full to the byte. */
const full = (dir: string, shard: string, n: number) => {
  const w = open(dir, shard);
  for (let k = 1; k <= n; k++) expect(w.append(at(k))).toBe('recorded');
  const bytes = w.storageStats().archive!.compressedBytes;
  w.close();
  return bytes;
};
const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
afterEach(() => {
  for (const s of stores.splice(0))
    try {
      s.close();
    } catch {
      /* closed by the test */
    }
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a declared capture hold', () => {
  it('keeps its window on every shard, declared after the writers opened, with no restart', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(2 * DAY);
    const dir = folder();
    const writers = ['archive', 'archive-shard-1'].map((shard) => {
      const maxBytes = full(dir, shard, 10);
      return open(dir, shard, { maxBytes });
    });
    // The operator declares seconds 3 to 5 after both writers are running.
    declare(dir, 'capture-a', window(3, 5));
    later(31_000);
    for (const w of writers) {
      for (let k = 11; k <= 17; k++) expect(w.append(at(k))).toBe('recorded');
      const k = kept(w);
      // Unfixed, the ring retired 1 to 7 oldest first, the window with them.
      expect(k).toEqual(expect.arrayContaining([3, 4, 5]));
      expect(k).not.toContain(1);
      expect(k).not.toContain(2);
      expect(k).not.toContain(6);
      expect(w.storageStats().archive!.heldSegments).toBe(3);
    }
  });
  it('keeps segments appended while its window is still open, then releases what follows', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(2 * DAY);
    const dir = folder();
    const maxBytes = full(dir, 'archive', 10);
    const w = open(dir, 'archive', { maxBytes });
    declare(dir, 'open-window', window(11, 14));
    later(31_000);
    for (let k = 11; k <= 14; k++) expect(w.append(at(k))).toBe('recorded');
    later(31_000);
    for (let k = 15; k <= 26; k++) expect(w.append(at(k))).toBe('recorded');
    later(31_000);
    for (let k = 27; k <= 30; k++) expect(w.append(at(k))).toBe('recorded');
    const k = kept(w);
    expect(k).toEqual(expect.arrayContaining([11, 12, 13, 14]));
    // Everything before the window and the start of what followed it went.
    for (const gone of [1, 2, 3, 15, 16]) expect(k).not.toContain(gone);
    expect(k).toContain(30);
  });
  it('stays inside the hold budget, keeps the oldest of its window, and capture never stops', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(2 * DAY);
    const dir = folder();
    const maxBytes = full(dir, 'archive', 10);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = open(dir, 'archive', { maxBytes });
    declare(dir, 'everything', window(0, 100));
    later(31_000);
    for (let k = 11; k <= 20; k++) {
      expect(w.capacityRefusal([at(k)])).toBeNull();
      expect(w.append(at(k))).toBe('recorded');
    }
    const stats = w.storageStats().archive!;
    expect(stats.heldBytes).toBeLessThanOrEqual(horseJournalHoldBudget(maxBytes, 1_000_000).bytes);
    expect(stats.heldSegments).toBeGreaterThan(0);
    expect(stats.holdTrimmedSegments).toBeGreaterThan(0);
    expect(stats.compressedBytes).toBeLessThanOrEqual(maxBytes);
    const k = kept(w);
    for (let n = 1; n <= stats.heldSegments; n++) expect(k).toContain(n);
    expect(k).toContain(20);
    expect(warn.mock.calls.flat().join(' ')).toMatch(/declared capture hold exceeds its budget/);
  });
  it('refuses every malformed, unsafe, oversized, expired or surplus file by name and never stops capture', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(30 * DAY);
    const dir = folder();
    const maxBytes = full(dir, 'archive', 10);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const w = open(dir, 'archive', { maxBytes });
    declare(dir, 'not-json', '{');
    declare(dir, 'extra-key', { ...window(1, 5), note: 'x' });
    declare(dir, 'backwards', window(5, 1));
    declare(dir, 'too-long', window(0, 49 * 3600));
    declare(dir, 'forever', window(1, 5, 15));
    declare(dir, 'old-version', { ...window(1, 5), version: 2 });
    declare(dir, 'readable', window(1, 5), 0o644);
    declare(dir, 'huge', { ...window(1, 5), operator: 'x'.repeat(3000) });
    declare(dir, 'expired', window(1, 5, 1));
    const linked = declare(dir, 'linked', window(1, 5));
    linkSync(linked, join(dir, 'linked-twin'));
    declare(dir, 'Bad Name', window(1, 5));
    later(31_000);
    for (let k = 11; k <= 20; k++) expect(w.append(at(k))).toBe('recorded');
    expect(w.storageStats().archive!.heldSegments).toBe(0);
    expect(kept(w)).not.toContain(1);
    const said = warn.mock.calls.flat().join('\n');
    for (const name of [
      'not-json',
      'extra-key',
      'backwards',
      'too-long',
      'forever',
      'old-version',
      'readable',
      'huge',
      'expired',
      'linked',
    ])
      expect(said).toContain(`declared capture hold refused: ${name}.json`);
    // Five valid holds: the first four by name are kept, the fifth is refused.
    vi.setSystemTime(2 * DAY);
    const dir2 = folder();
    full(dir2, 'archive', 2);
    for (const id of ['h1', 'h2', 'h3', 'h4', 'h5']) declare(dir2, id, window(1, 2));
    open(dir2, 'archive');
    expect(warn.mock.calls.flat().join('\n')).toContain(
      'declared capture hold refused: h5.json (too_many)'
    );
  });
  it('releases its segments to the ring once it expires', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(DAY / 2);
    const dir = folder();
    const maxBytes = full(dir, 'archive', 10);
    const w = open(dir, 'archive', { maxBytes });
    declare(dir, 'short', window(3, 5, 1));
    later(31_000);
    expect(w.append(at(11))).toBe('recorded');
    expect(w.storageStats().archive!.heldSegments).toBe(3);
    vi.setSystemTime(5 * second + DAY + 60_000);
    for (let k = 12; k <= 20; k++) expect(w.append(at(k))).toBe('recorded');
    expect(w.storageStats().archive!.heldSegments).toBe(0);
    expect(kept(w)).not.toContain(3);
  });
  it('sits beside the configured evidence hold; both are kept and share one budget', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(2 * DAY);
    const dir = folder();
    const maxBytes = full(dir, 'archive', 12);
    const w = open(dir, 'archive', { maxBytes, hold: { fromMs: 2 * second, untilMs: 3 * second } });
    declare(dir, 'later-window', window(7, 8));
    later(31_000);
    for (let k = 13; k <= 24; k++) expect(w.append(at(k))).toBe('recorded');
    const k = kept(w);
    expect(k).toEqual(expect.arrayContaining([2, 3, 7, 8]));
    for (const gone of [1, 4, 5, 6, 9]) expect(k).not.toContain(gone);
    expect(w.storageStats().archive!.heldSegments).toBe(4);
  });
  it('the retirement between held runs is a rowid search, like every ring statement', () => {
    const { RING_STATEMENTS } = storeModule as unknown as { RING_STATEMENTS: readonly string[] };
    expect(RING_STATEMENTS).toContain(
      'SELECT sha,compressed_sha,bytes,decoded_bytes,records FROM archive_segments WHERE rowid>? AND rowid<? ORDER BY rowid LIMIT 1'
    );
  });
  it('a read-only reader ignores declared holds and a missing holds directory changes nothing', () => {
    const { parseHorseJournalDeclaredHold } = config as unknown as {
      parseHorseJournalDeclaredHold?: (name: string, text: string) => unknown;
    };
    expect(parseHorseJournalDeclaredHold).toBeTypeOf('function');
    const dir = folder();
    full(dir, 'archive', 3);
    declare(dir, 'any', window(1, 2));
    const r = new HorseDecisionJournalStore(dir, {
      readOnly: true,
      archive: { directory: join(dir, 'archive'), maxBytes: 1024 * 1024, maxSegments: 100 },
    });
    stores.push(r);
    expect(kept(r)).toEqual([1, 2, 3]);
  });
});
