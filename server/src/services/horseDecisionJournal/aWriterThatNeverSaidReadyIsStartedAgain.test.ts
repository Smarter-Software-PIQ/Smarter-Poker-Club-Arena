/* A WRITER THAT NEVER SAID READY IS STARTED AGAIN (2026-11-07).
   A shard whose writer did not answer READY inside the five-second start
   watchdog, three writers in a row, ended capture at `start_failed`, and
   fail() re-armed only a publisher that had once been READY
   (`rearmable(reason) && ... && this.everReady`, with `start_failed` outside
   HORSE_JOURNAL_REARMABLE). So a slow disk or a CPU spike at engine boot
   turned decision journaling off until the next daily restart, logging
   `capture stopped mode=unavailable reason=start_failed` once and nothing
   after. Reproduced under CPU starvation in the throughput test
   (docs/changelog/2026-11-07-stop-is-a-shutdown-not-a-stopwatch.md).

   A start failure now gets the same restart a writer that died after READY
   gets: two in-place replacements (250 ms, 1 s), then a fresh writer every
   HORSE_JOURNAL_REARM_MS, only after the retired one has exited, for the life
   of the process. Only a publisher with no restart at all stays `unavailable`. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  HORSE_JOURNAL_REARM_MS,
  HorseDecisionJournalPublisher,
  type HorseJournalWorker,
} from '../HorseDecisionJournal.js';
import type { HorseJournalRecord } from './record.js';

class Writer implements HorseJournalWorker {
  sent: Array<Parameters<HorseJournalWorker['postMessage']>[0]> = [];
  listeners = new Map<string, (message: any) => void>();
  terminate = vi.fn(async () => 0);
  on(event: string, callback: (message: any) => void) {
    this.listeners.set(event, callback);
  }
  postMessage(message: Parameters<HorseJournalWorker['postMessage']>[0]) {
    this.sent.push(message);
  }
  emit(message: any) {
    this.listeners.get('message')?.(message);
  }
  appends() {
    return this.sent.filter((m) => m.type === 'APPEND') as Array<{ records: HorseJournalRecord[] }>;
  }
  ack() {
    const batch = this.appends().at(-1)!.records;
    this.emit({
      type: 'ACK',
      receipts: batch.map((r) => ({ eventId: r.eventId, sha256: r.sha256, status: 'recorded' })),
    });
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A publisher whose every writer is silent (never READY) until the test
 * makes one answer. `spawned` lists every writer it was handed, first included. */
const setup = () => {
  vi.useFakeTimers();
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const first = new Writer(),
    spawned: Writer[] = [first],
    spawnedAt: number[] = [Date.now()],
    notes: string[] = [];
  const restart = vi.fn(() => {
    const w = new Writer();
    spawned.push(w);
    spawnedAt.push(Date.now());
    return w;
  });
  const startFailed = vi.fn();
  const p = new HorseDecisionJournalPublisher(first, (x) => notes.push(x), {
    restart,
    now: () => Date.now(),
    wallNow: () => Date.parse('2026-11-07T09:00:00.000Z'),
    onStartFailed: startFailed,
  });
  return { p, first, spawned, spawnedAt, notes, restart, warn, startFailed };
};

describe('a writer that never said READY is started again', () => {
  it('three silent writers, then one that answers: capture comes back with the kept queue', async () => {
    const { p, first, spawned, notes, restart, warn, startFailed } = setup();
    p.record('decision', 'hand', 'turn', { n: 1 });
    // Nothing is sent to a writer that has not said READY.
    expect(first.appends()).toEqual([]);
    // The start watchdog retires each silent writer after five seconds; the
    // third is the end of the in-place budget.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(restart).toHaveBeenCalledTimes(2);
    expect(p.health()).toMatchObject({
      mode: 'failed',
      lastFailureReason: 'start_failed',
      queued: 1,
    });
    // Truthful while it waits: not "for good", and says what happens next.
    expect(p.health().capture).toBe(
      'not running: capture stopped at start_failed since 2026-11-07T09:00:00.000Z; a fresh writer is started every minute until one captures;'
    );
    expect(warn).toHaveBeenCalledWith(
      '[HorseDecisionJournal] capture stopped mode=failed reason=start_failed'
    );
    expect(notes).toContain('phase15_journal_start_failed');
    // A re-arming publisher has not given up, so the lifecycle is not told it did.
    expect(startFailed).not.toHaveBeenCalled();
    // Capture is stopped: a record now is a named gap, never queued.
    p.record('decision', 'hand', 'turn', { n: 'gap' });
    expect(notes).toContain('phase15_journal_capture_unavailable');
    expect(p.health().queued).toBe(1);

    await vi.advanceTimersByTimeAsync(HORSE_JOURNAL_REARM_MS);
    expect(restart).toHaveBeenCalledTimes(3);
    expect(notes).toContain('phase15_journal_rearm_started');
    expect(p.health().mode).toBe('starting');
    // While starting, a record queues within capacity, as on the first start.
    p.record('decision', 'hand', 'turn', { n: 2 });
    expect(p.health().queued).toBe(2);
    expect(notes.filter((n) => n === 'phase15_journal_enqueued')).toHaveLength(2);

    const fresh = spawned.at(-1)!;
    fresh.emit({ type: 'READY' });
    expect(warn).toHaveBeenCalledWith(
      '[HorseDecisionJournal] capture started mode=ready after=start_failed queued=2'
    );
    // The kept record and the new one, in order, as one batch.
    expect(fresh.appends()[0]!.records.map((r) => r.sequence)).toEqual([1, 2]);
    fresh.ack();
    expect(p.health()).toMatchObject({ mode: 'ready', queued: 0 });
    expect(p.health().capture).toMatch(/^running:/);
    expect(notes.filter((n) => n === 'phase15_journal_recorded')).toHaveLength(2);
    expect(notes).toContain('phase15_journal_retry_recovered');
    const stop = p.stop();
    fresh.emit({ type: 'STOPPED' });
    await stop;
    expect(p.health().mode).toBe('stopped');
  });

  it('a writer that keeps failing keeps being retried, with bounded backoff, never hot', async () => {
    const { p, spawned, spawnedAt, restart } = setup();
    // Half an hour of writers that never answer.
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    const cycleMs = 5_000 + 250 + 5_000 + 1_000 + 5_000 + HORSE_JOURNAL_REARM_MS;
    const cycles = Math.floor((30 * 60_000) / cycleMs);
    // Still trying at the end: three writers per cycle, no more, no fewer.
    expect(spawned.length).toBeGreaterThanOrEqual(3 * cycles);
    expect(spawned.length).toBeLessThanOrEqual(3 * (cycles + 1));
    const lastStart = spawnedAt.at(-1)!;
    expect(Date.now() - lastStart).toBeLessThan(cycleMs);
    // Never two live writers: every writer before the newest was terminated.
    for (const w of spawned.slice(0, -1)) expect(w.terminate).toHaveBeenCalled();
    // Never hot: no two writers ever started less than 250 ms apart, and each
    // re-arm waits the full minute after the previous cycle ended.
    const gaps = spawnedAt.slice(1).map((t, i) => t - spawnedAt[i]!);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(250);
    expect(gaps.filter((g) => g >= HORSE_JOURNAL_REARM_MS).length).toBeGreaterThanOrEqual(
      cycles - 1
    );
    // A writer that answers at last is still taken: wait for the next one.
    for (let i = 0; i < 70 && p.health().mode !== 'starting'; i++)
      await vi.advanceTimersByTimeAsync(1_000);
    expect(p.health().mode).toBe('starting');
    spawned.at(-1)!.emit({ type: 'READY' });
    expect(p.health().mode).toBe('ready');
    expect(restart.mock.calls.length).toBe(spawned.length - 1);
    const stop = p.stop();
    spawned.at(-1)!.emit({ type: 'STOPPED' });
    await stop;
  });

  it('a writer module that cannot load (error then exit at once) re-arms once a minute, not in a loop', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let started = 0;
    const dying = (): Writer => {
      started++;
      const w = new Writer();
      // Fails as soon as anything listens, the way a module that cannot load
      // reports itself: an 'error', then an 'exit', after construction.
      queueMicrotask(() => {
        w.listeners.get('error')?.(new Error('cannot load'));
        w.listeners.get('exit')?.(1);
      });
      return w;
    };
    const p = new HorseDecisionJournalPublisher(dying(), () => {}, {
      restart: dying,
      now: () => Date.now(),
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // About three writers a minute (one plus two in-place restarts), for ever.
    expect(started).toBeGreaterThanOrEqual(3 * 9);
    expect(started).toBeLessThanOrEqual(3 * 11);
    expect(p.health()).toMatchObject({ lastFailureReason: 'start_failed' });
    await p.stop();
  });

  it('a publisher with no restart at all still stays unavailable: nothing is pretended', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    const a = new Writer(),
      startFailed = vi.fn(),
      p = new HorseDecisionJournalPublisher(a, () => {}, { onStartFailed: startFailed });
    a.listeners.get('exit')?.(1);
    expect(p.health()).toMatchObject({ mode: 'unavailable', lastFailureReason: 'start_failed' });
    expect(p.health().capture).toBe('not running: the journal never started (start_failed)');
    expect(warn).toHaveBeenCalledWith(
      '[HorseDecisionJournal] capture stopped mode=unavailable reason=start_failed'
    );
    expect(startFailed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(p.health().mode).toBe('unavailable');
    await p.stop();
  });

  it('a stop while waiting to re-arm a start failure starts nothing', async () => {
    const { p, restart } = setup();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(p.health().lastFailureReason).toBe('start_failed');
    await p.stop();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(restart).toHaveBeenCalledTimes(2);
  });
});
