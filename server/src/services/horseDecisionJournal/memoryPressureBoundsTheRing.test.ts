/* MEMORY PRESSURE BOUNDS THE RING (Phase 6, 2026-10-31). Over the soft RSS
   ceiling the writer bounds its archive ring to a pressure retention, and the
   next append retires the oldest published segments down to it; lifting the
   pressure restores the configured allocation. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HorseDecisionJournalStore } from './store.js';
import { journalHash, makeHorseJournalRecord, type HorseJournalRecord } from './record.js';

const folders: string[] = [];
const stores: HorseDecisionJournalStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0))
    try {
      s.close();
    } catch {
      /* closed */
    }
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true });
});
const open = () => {
  const dir = mkdtempSync(join(tmpdir(), 'horse-journal-pressure-'));
  folders.push(dir);
  const s = new HorseDecisionJournalStore(dir, {
    archive: {
      directory: join(dir, 'archive'),
      maxBytes: 1024 * 1024 * 1024,
      maxSegments: 1_000,
      hold: null,
    },
  });
  stores.push(s);
  return s;
};
const rec = (sequence: number): HorseJournalRecord =>
  makeHorseJournalRecord(
    {
      producerId: '10000000-0000-4000-8000-000000000002',
      sequence,
      atMs: 1_000 + sequence,
      sourceRelease: null,
      kind: 'decision',
      handKey: journalHash(`hand-${sequence}`),
      turnKey: journalHash(`turn-${sequence}`),
    },
    { card: 'As' }
  );

describe('the journal ring under memory pressure', () => {
  it('retires down to the pressure retention, then grows again once lifted', () => {
    const store = open();
    for (let i = 1; i <= 10; i++) store.append(rec(i));
    expect(store.storageStats().archive!.segments).toBe(10);

    store.setPressureRetention(4);
    store.append(rec(11));
    const bounded = store.storageStats().archive!;
    expect(bounded.segments).toBeLessThanOrEqual(4);
    expect(bounded.retiredSegments).toBeGreaterThanOrEqual(7);

    store.setPressureRetention(null);
    for (let i = 12; i <= 15; i++) store.append(rec(i));
    expect(store.storageStats().archive!.segments).toBe(bounded.segments + 4);
  });

  it('ignores a malformed retention instead of shrinking the ring to nothing', () => {
    const store = open();
    for (let i = 1; i <= 3; i++) store.append(rec(i));
    store.setPressureRetention(0);
    store.append(rec(4));
    expect(store.storageStats().archive!.segments).toBe(4);
  });
});
