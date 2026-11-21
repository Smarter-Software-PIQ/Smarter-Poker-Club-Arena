/* LAW (2026-11-21): THE HANDS A PERSON SAT IN ARE KEPT, AND THE KEEP COPY CAN
   ONLY EVER LOSE ITSELF.

   keep.ts says why the copy exists. This law holds the promises it was built
   under:
     1. The setting is a code default and it is OFF; off constructs nothing
        and opens no file.
     2. In scope 'person' a hand is kept, whole, when its own records name a
        seated person, and a hand no person sat in is never kept.
     3. The copy is the journal's own records, byte for byte, read back by the
        journal's own reader.
     4. No failure of the copy (a store that throws anything, an unwritable
        directory, a disk under its floor or unreadable, a record the store
        refuses, a locked catalog) reaches the writer: it is counted, and
        after three failed batches the copy switches itself off.
     5. Offering records does no storage work and a full queue drops and
        counts; at most one batch of 16 is appended per turn.
     6. The writer thread posts the identical messages and writes the
        identical journal with the copy on and off; the decision workers and
        the publisher do not know it exists. */
import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { runtimeHorseJournalArchiveOptions } from './config.js';
import {
  HORSE_JOURNAL_KEEP_BATCH_RECORDS,
  HORSE_JOURNAL_KEEP_BYTES,
  HORSE_JOURNAL_KEEP_DISK_FLOOR_BYTES,
  HORSE_JOURNAL_KEEP_FAILURES_TO_DISABLE,
  HORSE_JOURNAL_KEEP_LOCK_RETRIES,
  HORSE_JOURNAL_KEEP_SCOPE,
  HorseJournalKeep,
  horseJournalRecordNamesAPerson,
  startHorseJournalKeep,
  type HorseJournalKeepOptions,
  type HorseJournalKeepStore,
} from './keep.js';
import {
  journalHash,
  makeHorseJournalRecord,
  type HorseJournalKind,
  type HorseJournalRecord,
} from './record.js';
import { readHorseJournalHandRecords } from './review.js';
import { HorseDecisionJournalStore } from './store.js';

const GiB = 1024 * 1024 * 1024;
const dirs: string[] = [];
const closers: Array<() => void> = [];
afterEach(async () => {
  for (const close of closers.splice(0))
    try {
      close();
    } catch {
      /* closed */
    }
  for (const d of dirs.splice(0)) {
    try {
      chmodSync(d, 0o700);
    } catch {
      /* gone */
    }
    rmSync(d, { recursive: true, force: true });
  }
});
const fresh = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'horse-journal-keep-'));
  dirs.push(d);
  return d;
};
let sequence = 0;
const PRODUCER = '10000000-0000-4000-8000-00000000beef';
const record = (
  kind: HorseJournalKind,
  hand: string,
  payload: unknown,
  seq = ++sequence
): HorseJournalRecord =>
  makeHorseJournalRecord(
    {
      producerId: PRODUCER,
      sequence: seq,
      atMs: 1_000 + seq,
      sourceRelease: null,
      kind,
      handKey: journalHash(hand),
      turnKey: journalHash(`${hand}-turn-${seq}`),
    },
    payload
  );
const personDecision = (hand: string, seq?: number) =>
  record(
    'decision',
    hand,
    { snapshot: { savedProfileHumanIds: ['person-1'], gameState: { gameVariant: 'plo5' } } },
    seq
  );
const horseDecision = (hand: string, seq?: number) =>
  record(
    'decision',
    hand,
    { snapshot: { savedProfileHumanIds: [], gameState: { gameVariant: 'plo5' } } },
    seq
  );
const lifecycle = (hand: string, seq?: number) =>
  record('request_lifecycle', hand, { lifecycleVersion: 1, stage: 'queued' }, seq);
const execution = (hand: string, seq?: number) =>
  record('execution', hand, { accepted: true }, seq);

/** A keep copy whose loop the test turns by hand. */
const keepOn = (overrides: Partial<HorseJournalKeepOptions> = {}, journal = fresh()) => {
  const turns: Array<() => void> = [];
  const retries: Array<() => void> = [];
  const lines: string[] = [];
  const keep = new HorseJournalKeep({
    scope: 'person',
    journalDirectory: journal,
    shardDirectoryName: 'archive-shard-3',
    freeBytes: () => 500 * GiB,
    schedule: (work) => void turns.push(work),
    scheduleRetry: (work) => void retries.push(work),
    log: (line) => void lines.push(line),
    ...overrides,
  });
  closers.push(() => keep.stop(0));
  const run = (limit = 1_000) => {
    let ran = 0;
    while ((turns.length || retries.length) && ran++ < limit) (turns.shift() ?? retries.shift())!();
    return ran;
  };
  return { keep, journal, turns, retries, lines, run };
};
const kept = (journal: string, hand: string) =>
  readHorseJournalHandRecords(join(journal, 'keep'), journalHash(hand));

describe('the setting', () => {
  it('is a code default, and it is off', () => {
    expect(HORSE_JOURNAL_KEEP_SCOPE).toBe('off');
    expect(HORSE_JOURNAL_KEEP_BYTES).toBe(4 * GiB);
    // Above the main ring's 32 GiB floor: the copy yields first.
    expect(HORSE_JOURNAL_KEEP_DISK_FLOOR_BYTES).toBe(48 * GiB);
  });

  it('off constructs nothing and opens no file; the engine passes no override', () => {
    const journal = fresh();
    const archive = runtimeHorseJournalArchiveOptions(journal, {}, { index: 3 });
    expect(startHorseJournalKeep({ directory: journal, archive })).toBeNull();
    expect(
      startHorseJournalKeep({ directory: journal, archive, keep: { scope: 'off' } })
    ).toBeNull();
    expect(readdirSync(journal)).toEqual([]);
    const on = startHorseJournalKeep({ directory: journal, archive, keep: { scope: 'person' } });
    expect(on).toBeInstanceOf(HorseJournalKeep);
    // Constructing it still opens nothing: the store is opened by the first kept record.
    expect(readdirSync(journal)).toEqual([]);
    on!.stop(0);
    expect(readdirSync(journal)).toEqual([]);
  });

  it('anything that is not the journal layout, or not a scope, is off and never throws', () => {
    const journal = fresh();
    for (const data of [
      null,
      undefined,
      42,
      'x',
      {},
      { directory: journal },
      { directory: journal, archive: null, keep: { scope: 'person' } },
      { directory: 7, archive: { directory: join(journal, 'archive') }, keep: { scope: 'person' } },
      {
        directory: 'relative',
        archive: { directory: 'relative/archive' },
        keep: { scope: 'person' },
      },
      {
        directory: journal,
        archive: { directory: join(journal, 'elsewhere') },
        keep: { scope: 'person' },
      },
      {
        directory: journal,
        archive: { directory: join(journal, 'archive') },
        keep: { scope: 'everything' },
      },
      { directory: journal, archive: { directory: join(journal, 'archive') }, keep: 'person' },
    ])
      expect(startHorseJournalKeep(data)).toBeNull();
  });
});

describe('which record names a person', () => {
  it('a decision whose snapshot lists a seated person; an accepted hand a person was dealt into', () => {
    expect(horseJournalRecordNamesAPerson(personDecision('a'))).toBe(true);
    expect(horseJournalRecordNamesAPerson(horseDecision('a'))).toBe(false);
    expect(horseJournalRecordNamesAPerson(record('decision', 'a', { snapshot: {} }))).toBe(false);
    expect(
      horseJournalRecordNamesAPerson(record('accepted_hand', 'a', { styleHasHuman: true }))
    ).toBe(true);
    expect(
      horseJournalRecordNamesAPerson(record('accepted_hand', 'a', { styleHasHuman: false }))
    ).toBe(false);
    expect(horseJournalRecordNamesAPerson(record('accepted_hand', 'a', {}))).toBe(false);
  });

  it('the parsed value decides, not a look-alike elsewhere in the record', () => {
    for (const payload of [
      { other: { savedProfileHumanIds: ['person-1'] }, snapshot: { savedProfileHumanIds: [] } },
      { snapshot: { nested: { savedProfileHumanIds: ['person-1'] } } },
      { snapshot: { savedProfileHumanIds: [''] } },
      { note: '"savedProfileHumanIds":["person-1"]' },
    ])
      expect(horseJournalRecordNamesAPerson(record('decision', 'a', payload))).toBe(false);
    expect(
      horseJournalRecordNamesAPerson(
        record('accepted_hand', 'a', { inner: { styleHasHuman: true } })
      )
    ).toBe(false);
    // Only a decision or an accepted hand can say so.
    for (const kind of ['request_lifecycle', 'execution', 'plan_receipt'] as const)
      expect(
        horseJournalRecordNamesAPerson(
          record(kind, 'a', {
            snapshot: { savedProfileHumanIds: ['person-1'] },
            styleHasHuman: true,
          })
        )
      ).toBe(false);
  });

  it('a body that cannot be read says no, and never throws', () => {
    const good = personDecision('a');
    for (const body of ['', '{', '"savedProfileHumanIds":["', 'null', '[]'])
      expect(horseJournalRecordNamesAPerson({ ...good, body })).toBe(false);
    expect(horseJournalRecordNamesAPerson({ ...good, body: undefined as never })).toBe(false);
    expect(horseJournalRecordNamesAPerson(null as never)).toBe(false);
  });
});

describe('scope person', () => {
  it('keeps the whole hand a person sat in, with what came before its first decision, byte for byte', () => {
    const { keep, journal, run } = keepOn();
    const hand = [
      lifecycle('person-hand'),
      lifecycle('person-hand'),
      personDecision('person-hand'),
      execution('person-hand'),
      record('plan_receipt', 'person-hand', { receipt: 1 }),
      record('accepted_hand', 'person-hand', { styleHasHuman: true }),
    ];
    const other = [
      lifecycle('horse-hand'),
      horseDecision('horse-hand'),
      execution('horse-hand'),
      record('accepted_hand', 'horse-hand', { styleHasHuman: false }),
    ];
    // Interleaved, as two tables on one shard are.
    keep.offer([hand[0]!, other[0]!, hand[1]!]);
    keep.offer([other[1]!, hand[2]!, hand[3]!, other[2]!]);
    keep.offer([hand[4]!, other[3]!, hand[5]!]);
    run();
    const s = keep.status();
    expect(s).toMatchObject({ handsKept: 1, handsSkipped: 1, recordsKept: 6, queued: 0 });
    keep.stop();
    const back = kept(journal, 'person-hand');
    expect(back.map((r) => r.sha256)).toEqual(hand.map((r) => r.sha256));
    expect(back).toEqual(hand);
    expect(kept(journal, 'horse-hand')).toEqual([]);
    // Under the journal's own private-file rules, beside the journal.
    expect(statSync(join(journal, 'keep')).mode & 0o077).toBe(0);
    expect(statSync(join(journal, 'keep', 'archive-shard-3')).mode & 0o077).toBe(0);
    const status = join(journal, 'keep', 'status-archive-shard-3.json');
    expect(statSync(status).mode & 0o077).toBe(0);
    // The status file is counts only.
    const text = readFileSync(status, 'utf8');
    expect(JSON.parse(text)).toMatchObject({ version: 1, recordsKept: 6, mode: 'stopped' });
    expect(text).not.toContain('person-1');
    expect(text).not.toContain(hand[0]!.handKey);
  });

  it('a hand no person sat in is never kept, whatever its records are', () => {
    const { keep, journal, run } = keepOn();
    const records = [
      lifecycle('h'),
      horseDecision('h'),
      execution('h'),
      horseDecision('h'),
      record('plan_receipt', 'h', {}),
      record('discard_decision', 'h', {}),
      record('accepted_hand', 'h', { styleHasHuman: false }),
      lifecycle('never-decided'),
      execution('never-decided'),
    ];
    keep.offer(records);
    expect(run()).toBe(0);
    expect(keep.status()).toMatchObject({ handsKept: 0, recordsKept: 0, queued: 0 });
    keep.stop();
    expect(existsSync(join(journal, 'keep'))).toBe(false);
  });

  it('a person named later in the hand keeps the hand from there on', () => {
    const { keep, journal, run } = keepOn();
    const early = horseDecision('late');
    const later = [personDecision('late'), execution('late')];
    keep.offer([early, ...later]);
    run();
    keep.stop();
    expect(kept(journal, 'late').map((r) => r.sha256)).toEqual(later.map((r) => r.sha256));
  });

  it('a record replayed to the writer is kept once', () => {
    const { keep, journal, run } = keepOn();
    const d = personDecision('twice');
    keep.offer([d]);
    run();
    keep.offer([d]);
    run();
    keep.stop();
    expect(kept(journal, 'twice')).toEqual([d]);
    expect(keep.status().batchesFailed).toBe(0);
  });
});

describe('the keep copy can only lose itself', () => {
  const failing = (thrown: unknown): HorseJournalKeepStore => ({
    appendBatch: () => {
      throw thrown;
    },
    close: () => {
      throw thrown;
    },
  });

  it.each([
    ['an Error', Error('disk full')],
    ['ENOSPC', Object.assign(Error('ENOSPC'), { code: 'ENOSPC' })],
    ['EACCES', Object.assign(Error('EACCES'), { code: 'EACCES' })],
    ['a refused record', Error('Invalid Horse journal record')],
    ['a string', 'corrupt segment'],
    ['null', null],
    ['undefined', undefined],
  ])('a store that throws %s on every call is counted, then switched off', (_name, thrown) => {
    const { keep, run, lines } = keepOn({ openStore: () => failing(thrown) });
    for (let i = 0; i < HORSE_JOURNAL_KEEP_FAILURES_TO_DISABLE; i++) {
      expect(() => keep.offer([personDecision(`f-${i}`)])).not.toThrow();
      expect(() => run()).not.toThrow();
    }
    expect(keep.status()).toMatchObject({
      mode: 'disabled',
      disabledReason: 'append_failed',
      batchesFailed: HORSE_JOURNAL_KEEP_FAILURES_TO_DISABLE,
      recordsFailed: HORSE_JOURNAL_KEEP_FAILURES_TO_DISABLE,
      recordsKept: 0,
      queued: 0,
    });
    // Off until the writer restarts: later offers are ignored, quietly.
    expect(() => keep.offer([personDecision('after')])).not.toThrow();
    expect(run()).toBe(0);
    expect(() => keep.stop()).not.toThrow();
    expect(lines.some((l) => l.includes('switched off'))).toBe(true);
    // A log line is a reason word and counts: never an error's own text.
    for (const l of lines) expect(l).not.toMatch(/disk full|ENOSPC|EACCES|corrupt/);
  });

  it('a store that cannot even be opened is the same', () => {
    const { keep, run } = keepOn({
      openStore: () => {
        throw Error('no');
      },
    });
    for (let i = 0; i < 3; i++) {
      keep.offer([personDecision(`o-${i}`)]);
      run();
    }
    expect(keep.status().mode).toBe('disabled');
  });

  it('an unwritable place (the real store): counted, switched off, nothing thrown', () => {
    const base = fresh();
    // The journal "directory" is a regular file: nothing can be made under it.
    const journal = join(base, 'not-a-directory');
    writeFileSync(journal, 'x');
    const { keep, run } = keepOn({}, journal);
    for (let i = 0; i < 3; i++) {
      expect(() => keep.offer([personDecision(`u-${i}`)])).not.toThrow();
      expect(() => run()).not.toThrow();
    }
    expect(keep.status()).toMatchObject({ mode: 'disabled', recordsKept: 0, batchesFailed: 3 });
    expect(() => keep.stop()).not.toThrow();
  });

  it('a record the real store refuses (a kind it does not know) fails its batch only', () => {
    const { keep, journal, run } = keepOn();
    const good = personDecision('known');
    keep.offer([good]);
    run();
    // It follows its hand into the queue; the store's own validation refuses it.
    const unknown = { ...execution('unknown'), kind: 'a_kind_from_the_future' as never };
    expect(() => keep.offer([personDecision('unknown'), unknown])).not.toThrow();
    expect(() => run()).not.toThrow();
    expect(keep.status()).toMatchObject({
      mode: 'running',
      batchesFailed: 1,
      recordsFailed: 2,
      recordsKept: 1,
    });
    const next = personDecision('after-unknown');
    keep.offer([next]);
    run();
    keep.stop();
    expect(kept(journal, 'known')).toEqual([good]);
    expect(kept(journal, 'after-unknown')).toEqual([next]);
  });

  it('under its disk floor, or with a disk it cannot read, it keeps nothing and opens nothing', () => {
    for (const freeBytes of [
      () => HORSE_JOURNAL_KEEP_DISK_FLOOR_BYTES,
      () => 0,
      () => null,
      () => Number.NaN,
      () => {
        throw Error('statfs');
      },
    ]) {
      let opened = 0;
      const { keep, journal, run } = keepOn({
        freeBytes: freeBytes as never,
        openStore: () => {
          opened++;
          return failing(Error('must not be reached'));
        },
      });
      keep.offer([personDecision('d1'), execution('d1')]);
      expect(() => run()).not.toThrow();
      expect(keep.status()).toMatchObject({ mode: 'running', recordsDroppedDisk: 2, queued: 0 });
      expect(opened).toBe(0);
      expect(existsSync(join(journal, 'keep'))).toBe(false);
    }
  });

  it('one byte above the floor is room', () => {
    const { keep, journal, run } = keepOn({
      freeBytes: () => HORSE_JOURNAL_KEEP_DISK_FLOOR_BYTES + 1,
    });
    const d = personDecision('room');
    keep.offer([d]);
    run();
    keep.stop();
    expect(kept(journal, 'room')).toEqual([d]);
  });

  it('a locked catalog is retried, then kept; locked for good, it is dropped and the copy stays on', () => {
    const locked = Object.assign(Error('locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
    let failures = 2;
    const appended: HorseJournalRecord[][] = [];
    const store: HorseJournalKeepStore = {
      appendBatch: (records) => {
        if (failures-- > 0) throw locked;
        appended.push([...records]);
      },
      close: () => undefined,
    };
    const a = keepOn({ openStore: () => store });
    const d = personDecision('locked');
    a.keep.offer([d]);
    a.run();
    expect(appended).toEqual([[d]]);
    expect(a.keep.status()).toMatchObject({ lockRetries: 2, recordsKept: 1, batchesFailed: 0 });

    const b = keepOn({ openStore: () => failing(locked) });
    b.keep.offer([personDecision('locked-for-good')]);
    b.run();
    expect(b.keep.status()).toMatchObject({
      mode: 'running',
      lockRetries: HORSE_JOURNAL_KEEP_LOCK_RETRIES,
      batchesFailed: 1,
      recordsFailed: 1,
      queued: 0,
    });
  });

  it('a scheduler that throws is counted and nothing escapes', () => {
    const { keep } = keepOn({
      schedule: () => {
        throw Error('no loop');
      },
    });
    expect(() => keep.offer([personDecision('s')])).not.toThrow();
    expect(keep.status().errors).toBe(1);
    expect(() => keep.stop()).not.toThrow();
  });
});

describe('it never makes the writer wait', () => {
  it('offering does no storage work; a full queue drops and counts', () => {
    let opened = 0;
    const { keep, turns } = keepOn({
      queueRecords: 4,
      openStore: () => {
        opened++;
        return { appendBatch: () => undefined, close: () => undefined };
      },
    });
    const many = Array.from({ length: 10 }, (_, i) => personDecision(`q-${i}`));
    keep.offer(many);
    expect(opened).toBe(0);
    expect(turns.length).toBe(1);
    expect(keep.status()).toMatchObject({ queued: 4, recordsDroppedQueue: 6, recordsKept: 0 });
  });

  it('the byte bound drops too', () => {
    const one = personDecision('b-0');
    const { keep } = keepOn({ queueBytes: (one.bytes + 512) * 2 + 1 });
    keep.offer([one, personDecision('b-1'), personDecision('b-2')]);
    expect(keep.status()).toMatchObject({ queued: 2, recordsDroppedQueue: 1 });
  });

  it('one batch of at most 16 records per turn of the loop', () => {
    const sizes: number[] = [];
    const { keep, turns } = keepOn({
      openStore: () => ({
        appendBatch: (records) => void sizes.push(records.length),
        close: () => undefined,
      }),
    });
    keep.offer(Array.from({ length: 40 }, (_, i) => personDecision(`t-${i}`)));
    expect(turns.length).toBe(1);
    turns.shift()!();
    expect(sizes).toEqual([HORSE_JOURNAL_KEEP_BATCH_RECORDS]);
    expect(turns.length).toBe(1);
    turns.shift()!();
    turns.shift()!();
    expect(sizes).toEqual([16, 16, 8]);
    expect(turns.length).toBe(0);
  });

  it('stopping appends what a short budget allows, counts the rest, and ends', () => {
    const sizes: number[] = [];
    let clock = 0;
    const { keep } = keepOn({
      now: () => clock,
      openStore: () => ({
        appendBatch: (records) => {
          sizes.push(records.length);
          clock += 300;
        },
        close: () => undefined,
      }),
    });
    keep.offer(Array.from({ length: 48 }, (_, i) => personDecision(`x-${i}`)));
    keep.stop(500);
    expect(sizes).toEqual([16, 16]);
    expect(keep.status()).toMatchObject({
      mode: 'stopped',
      recordsKept: 32,
      recordsDroppedStop: 16,
    });
    keep.offer([personDecision('after-stop')]);
    expect(keep.status().queued).toBe(0);
  });

  it('what it remembers is bounded', () => {
    const { keep } = keepOn({
      openStore: () => ({ appendBatch: () => undefined, close: () => undefined }),
    });
    for (let i = 0; i < 6_000; i++) keep.offer([lifecycle(`undecided-${i}`)]);
    const s = keep.status();
    expect(s.recordsDroppedPending).toBe(6_000 - 4_096);
    expect(s.pendingBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
    for (let i = 0; i < 100; i++) keep.offer([lifecycle('one-hand')]);
    expect(keep.status().recordsDroppedPending).toBeGreaterThanOrEqual(6_000 - 4_096 + 36);
  });
});

/* The real writer thread, as the engine runs it (the tsImport bootstrap is
   legacyBootstrapIsRaceFree.test.ts's: a worker thread does not inherit
   vitest's transform). */
const isTs = import.meta.url.endsWith('.ts');
const workerEntryUrl = new URL(isTs ? './worker.ts' : './worker.js', import.meta.url).href;
const tsxApiUrl = isTs
  ? pathToFileURL(createRequire(import.meta.url).resolve('tsx/esm/api')).href
  : undefined;
function spawnJournalWorker(workerData: unknown): Worker {
  if (!isTs) return new Worker(new URL(workerEntryUrl), { workerData });
  const code = `import { tsImport } from ${JSON.stringify(tsxApiUrl)}; await tsImport(${JSON.stringify(workerEntryUrl)}, ${JSON.stringify(import.meta.url)});`;
  return new Worker(new URL('data:text/javascript,' + encodeURIComponent(code)), { workerData });
}
/** Drive one writer through the same script; return every message it posted. */
async function writerSession(
  journal: string,
  batches: HorseJournalRecord[][],
  keep: unknown
): Promise<unknown[]> {
  const archive = runtimeHorseJournalArchiveOptions(journal, {}, { index: 3 });
  const worker = spawnJournalWorker(
    keep === undefined ? { directory: journal, archive } : { directory: journal, archive, keep }
  );
  const messages: unknown[] = [];
  let wake: (() => void) | undefined;
  worker.on('message', (m) => {
    messages.push(m);
    wake?.();
  });
  const failed = new Promise<never>((_, reject) => worker.on('error', reject));
  const next = async (count: number) => {
    while (messages.length < count)
      await Promise.race([new Promise<void>((resolve) => (wake = resolve)), failed]);
  };
  try {
    await next(1);
    let expected = 1;
    for (const records of batches) {
      worker.postMessage({ type: 'APPEND', records });
      await next(++expected);
    }
    worker.postMessage({ type: 'PROBE', records: batches[0] });
    await next(++expected);
    worker.postMessage({ type: 'APPEND', records: 'not a batch' });
    await next(++expected);
    worker.postMessage({ type: 'STOP' });
    await next(++expected);
  } finally {
    await worker.terminate();
  }
  return messages;
}

describe('the writer thread with the copy on and off', () => {
  it('posts the identical messages and writes the identical journal; only the keep store differs', async () => {
    const batches = [
      [lifecycle('p', 9001), lifecycle('h', 9002), personDecision('p', 9003)],
      [horseDecision('h', 9004), execution('p', 9005), execution('h', 9006)],
      [
        record('accepted_hand', 'p', { styleHasHuman: true }, 9007),
        record('accepted_hand', 'h', { styleHasHuman: false }, 9008),
      ],
      // A replayed batch: the writer answers 'replayed', with the copy on or off.
      [horseDecision('h', 9004), execution('p', 9005), execution('h', 9006)],
    ];
    const off = fresh();
    const on = fresh();
    const offMessages = await writerSession(off, batches, undefined);
    const onMessages = await writerSession(on, batches, { scope: 'person', diskFloorBytes: 0 });
    expect(onMessages).toEqual(offMessages);
    expect(offMessages.map((m) => (m as { type: string }).type)).toEqual([
      'READY',
      'ACK',
      'ACK',
      'ACK',
      'ACK',
      'CAPACITY',
      'UNAVAILABLE',
      'STOPPED',
    ]);
    for (const hand of ['p', 'h'])
      expect(readHorseJournalHandRecords(on, journalHash(hand))).toEqual(
        readHorseJournalHandRecords(off, journalHash(hand))
      );
    // Off: no keep store at all. On: the person's hand, whole; the other, never.
    expect(existsSync(join(off, 'keep'))).toBe(false);
    expect(kept(on, 'p')).toEqual(readHorseJournalHandRecords(on, journalHash('p')));
    expect(kept(on, 'p').length).toBe(4);
    expect(kept(on, 'h')).toEqual([]);
  }, 60_000);

  it('a keep store that cannot be written leaves the writer exactly as it is with the copy off', async () => {
    const batches = [
      [lifecycle('p', 9101), personDecision('p', 9102)],
      [execution('p', 9103)],
      [personDecision('p', 9104)],
      [record('accepted_hand', 'p', { styleHasHuman: true }, 9105)],
    ];
    const off = fresh();
    const on = fresh();
    // Where the keep store would go there is a regular file.
    writeFileSync(join(on, 'keep'), 'x');
    const offMessages = await writerSession(off, batches, undefined);
    const onMessages = await writerSession(on, batches, { scope: 'person', diskFloorBytes: 0 });
    expect(onMessages).toEqual(offMessages);
    expect(readHorseJournalHandRecords(on, journalHash('p'))).toEqual(
      readHorseJournalHandRecords(off, journalHash('p'))
    );
    expect(readHorseJournalHandRecords(on, journalHash('p')).length).toBe(5);
    expect(readFileSync(join(on, 'keep'), 'utf8')).toBe('x');
  }, 60_000);
});

describe('nothing outside the writer thread knows the copy exists', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = (...parts: string[]) => readFileSync(join(here, ...parts), 'utf8');
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.name === 'node_modules'
        ? []
        : entry.isDirectory()
          ? walk(join(dir, entry.name))
          : /\.(ts|js|mjs)$/.test(entry.name)
            ? [join(dir, entry.name)]
            : []
    );

  it('only worker.ts imports keep.ts, and the publisher still spawns its writer with the same two fields', () => {
    const src = join(here, '..', '..');
    const importers = walk(src).filter(
      (file) =>
        !/\.test\.ts$/.test(file) &&
        !file.endsWith(join('horseDecisionJournal', 'keep.ts')) &&
        /horseDecisionJournal\/keep(\.js)?['"]|from '\.\/keep\.js'/.test(readFileSync(file, 'utf8'))
    );
    expect(importers.map((f) => f.slice(src.length + 1))).toEqual([
      join('services', 'horseDecisionJournal', 'worker.ts'),
    ]);
    const publisher = source('..', 'HorseDecisionJournal.ts');
    expect(publisher).toContain(
      'new Worker(journalWriterEntry(), { workerData: { directory, archive } })'
    );
    expect(publisher).not.toMatch(/keep\.js|HorseJournalKeep|JOURNAL_KEEP/);
    // No decision-side file names it either.
    for (const file of walk(join(src, 'engine')))
      if (!/\.test\.ts$/.test(file))
        expect(readFileSync(file, 'utf8'), file).not.toMatch(/HorseJournalKeep|JOURNAL_KEEP/);
  });

  it('the writer hands it records only after the acknowledgement, and guards every call', () => {
    const worker = source('worker.ts');
    const ack = worker.indexOf("type: 'ACK'");
    const offer = worker.indexOf('keep?.offer(records)');
    expect(ack).toBeGreaterThan(0);
    expect(offer).toBeGreaterThan(ack);
    expect(worker).toMatch(/try \{\s*keep\?\.offer\(records\);\s*\} catch \{/);
    expect(worker).toMatch(/try \{\s*keep\?\.stop\(\);\s*\} catch \{/);
    // Exactly these uses, and one construction.
    expect(worker.match(/keep\?\./g)?.length).toBe(2);
    expect(worker.match(/startHorseJournalKeep\(workerData\)/g)?.length).toBe(1);
    expect(worker).not.toMatch(/keep\.(offer|stop|status)\(/);
  });

  it('keep.ts adds no record kind and no field: it only copies records the journal already wrote', () => {
    const keep = source('keep.ts');
    expect(keep).not.toMatch(/makeHorseJournalRecord|HorseJournalKind/);
    expect(keep).not.toMatch(/console\.(log|warn|error)\([^)]*body/);
    expect(source('record.ts')).toContain("| 'plan_receipt';");
  });
});
