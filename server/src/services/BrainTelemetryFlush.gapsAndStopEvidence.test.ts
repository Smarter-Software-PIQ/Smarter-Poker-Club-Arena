/**
 * The real telemetry flush service (2026-11-14):
 *  1. every way a batch is lost hands one gap to the sink the main process injects (index.ts: the engine alert
 *     path), naming the day that batch belonged to, and a later written day says so once, so the alert closes;
 *  2. the shutdown stop prints what it really took, wrote and left behind, and never runs past its budget plus one
 *     write timeout however slow the writer is.
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ rpc: vi.fn(), report: vi.fn(), raise: vi.fn() }));
vi.mock('./supabase/client.js', () => ({ supabase: { rpc: mocked.rpc } }));
vi.mock('./errorReporter.js', () => ({ reportError: mocked.report }));
const ack = (payload: string) => ({
  data: {
    version: 1,
    status: 'recorded',
    batchId: JSON.parse(payload).batchId,
    payloadSha256: createHash('sha256').update(payload).digest('hex'),
  },
  error: null,
});
const refusal = (message: string) => ({ data: null, error: { code: 'P0001', message } });
const WRITE_TIMEOUT_MS = 5_000;
let stop: (() => Promise<void>) | undefined;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
  vi.stubEnv('GIT_COMMIT_SHA', 'c'.repeat(40));
  vi.stubEnv('BRAIN_TELEMETRY_ENABLED', 'true');
  mocked.rpc.mockReset();
  mocked.report.mockReset();
  mocked.raise.mockReset();
  mocked.raise.mockResolvedValue(undefined);
  mocked.rpc.mockImplementation((_name, args) => ({
    abortSignal: () => Promise.resolve(ack(args.p_payload)),
  }));
  log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  await stop?.().catch(() => undefined);
  stop = undefined;
  log.mockRestore();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function start() {
  const service = await import('./BrainTelemetryFlush.js');
  const telemetry = await import('../engine/BrainTelemetry.js');
  stop = service.stopBrainTelemetryFlush;
  // what index.ts does in the main process, with a recorder in place of the alert handler
  service.setBrainTelemetryGapSink(mocked.raise);
  service.startBrainTelemetryFlush();
  return { service, telemetry };
}
const events = () => mocked.raise.mock.calls.map((call) => call[0]);
/** The losses handed to the sink, without the 'written' notices. */
const gaps = () => events().filter((event) => event.kind !== 'written');
const written = () => events().filter((event) => event.kind === 'written');
/** A writer that answers after `ms`, or is cut off by the send's abort at the write timeout. */
function slowWriter(ms: number) {
  mocked.rpc.mockImplementation((_name, args) => ({
    abortSignal: () =>
      new Promise((resolve, reject) => {
        if (ms >= WRITE_TIMEOUT_MS)
          setTimeout(() => reject(new Error('aborted')), WRITE_TIMEOUT_MS);
        else setTimeout(() => resolve(ack(args.p_payload)), ms);
      }),
  }));
}
const workerIdOf = (call = 0) => JSON.parse(mocked.rpc.mock.calls[call][1].p_payload).workerId;
/** The one shutdown evidence line, parsed. */
function stopLine(): Record<string, string> {
  const lines = log.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith('[BrainTelemetryFlush] shutdown stop '));
  expect(lines).toHaveLength(1);
  return Object.fromEntries(
    lines[0]!
      .slice('[BrainTelemetryFlush] shutdown stop '.length)
      .split(' ')
      .map((pair) => pair.split('=') as [string, string])
  );
}
const fill = (telemetry: { noteFire(key: string): void }, keys: number) => {
  for (let i = 0; i < keys; i++) telemetry.noteFire(`split_${String(i).padStart(5, '0')}`);
};

describe('a lost Horse telemetry batch is handed to the engine alert path', () => {
  it.each([
    ['rejected', 'HORSE_FLUSH_INVALID_BOUNDS'],
    ['expired', 'HORSE_FLUSH_EXPIRED'],
  ] as const)('alerts a %s batch with its day and worker', async (kind, message) => {
    const { telemetry } = await start();
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () => Promise.resolve(refusal(message)),
    }));
    telemetry.noteFire('lost_counter');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(gaps()).toEqual([
      { kind, batches: 1, day: '2026-11-14', workerId: workerIdOf(), thread: 'main' },
    ]);
    // the existing log line and counter are unchanged
    expect(mocked.report).toHaveBeenCalledWith(expect.any(Error), `BrainTelemetryFlush.${kind}`);
  });

  it('alerts an abandoned batch for the day the batch belonged to, not the day it was given up', async () => {
    vi.setSystemTime(new Date('2026-11-14T23:30:00.000Z'));
    const { telemetry } = await start();
    const { HORSE_TELEMETRY_MAX_ATTEMPTS } = await import('./HorseBrainTelemetryPublisher.js');
    mocked.rpc.mockImplementation(() => ({
      abortSignal: () => Promise.resolve({ data: null, error: { message: 'network' } }),
    }));
    telemetry.noteFire('stuck_counter');
    await vi.advanceTimersByTimeAsync(60_000 * HORSE_TELEMETRY_MAX_ATTEMPTS);
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-11-15');
    expect(gaps()).toEqual([
      { kind: 'abandoned', batches: 1, day: '2026-11-14', workerId: workerIdOf(), thread: 'main' },
    ]);
  });

  it('hands every drop to the alert path; the alert system, not this service, keeps it to one a day', async () => {
    const { telemetry } = await start();
    mocked.rpc.mockImplementation(() => ({
      abortSignal: () => Promise.resolve(refusal('HORSE_FLUSH_INVALID_COUNTER')),
    }));
    telemetry.noteFire('lost_counter');
    await vi.advanceTimersByTimeAsync(60_000 * 3);
    expect(gaps().map((gap) => gap.kind)).toEqual(['rejected', 'rejected', 'rejected']);
  });

  it('raises nothing when every batch is written', async () => {
    const { service, telemetry } = await start();
    telemetry.noteFire('written_counter');
    await vi.advanceTimersByTimeAsync(60_000);
    telemetry.noteFire('written_counter');
    await service.stopBrainTelemetryFlush();
    expect(gaps()).toEqual([]);
  });

  it('is only a counter and a log line when the main process injected no sink', async () => {
    const { service, telemetry } = await start();
    service.setBrainTelemetryGapSink(null);
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () => Promise.resolve(refusal('HORSE_FLUSH_DUPLICATE_FEATURE')),
    }));
    telemetry.noteFire('lost_counter');
    await vi.advanceTimersByTimeAsync(60_000 * 2);
    expect(events()).toEqual([]);
    expect(mocked.report).toHaveBeenCalledWith(expect.any(Error), 'BrainTelemetryFlush.rejected');
    expect(JSON.parse(mocked.rpc.mock.calls[1][1].p_payload).fires).toEqual([
      { feature: 'phase15_telemetry_batch_rejected', fires: 1 },
    ]);
  });

  it('hands an event a worker thread posted to the same injected sink', async () => {
    const { service } = await start();
    const posted = {
      kind: 'expired',
      batches: 1,
      day: '2026-10-01',
      workerId: 'w',
      thread: 'worker',
    };
    service.relayBrainTelemetryGapEvent(posted);
    expect(events()).toEqual([posted]);
  });

  it('keeps flushing when the sink throws', async () => {
    const { service, telemetry } = await start();
    service.setBrainTelemetryGapSink(() => {
      throw new Error('port closed');
    });
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () => Promise.resolve(refusal('HORSE_FLUSH_INVALID_HEADER')),
    }));
    telemetry.noteFire('lost_counter');
    await vi.advanceTimersByTimeAsync(60_000 * 2);
    expect(JSON.parse(mocked.rpc.mock.calls[1][1].p_payload).fires).toEqual([
      { feature: 'phase15_telemetry_batch_rejected', fires: 1 },
    ]);
  });

  it('alerts the batches a shutdown leaves unwritten, with their count, day and reason', async () => {
    const { service, telemetry } = await start();
    fill(telemetry, 20_000);
    slowWriter(4_900);
    const stopping = service.stopBrainTelemetryFlush();
    await vi.advanceTimersByTimeAsync(30_000);
    await stopping;
    expect(gaps()).toEqual([
      {
        kind: 'shutdown_unwritten',
        batches: service.brainTelemetryPendingBatches(),
        day: '2026-11-14',
        workerId: workerIdOf(),
        thread: 'main',
        reason: 'time budget',
      },
    ]);
    expect(service.brainTelemetryPendingBatches()).toBeGreaterThan(0);
  });

  it('says so when a shutdown ran out of time before the last partial minute was captured', async () => {
    const { service, telemetry } = await start();
    // four retained batches from a tick whose writes are slow, then counters behind them
    fill(telemetry, 4_096 * 4);
    slowWriter(4_900);
    await vi.advanceTimersByTimeAsync(60_000); // the tick captures four batches and starts writing the first
    telemetry.noteFire('behind_the_retained_batches');
    const stopping = service.stopBrainTelemetryFlush();
    await vi.advanceTimersByTimeAsync(30_000);
    await stopping;
    // tick write 4.9 s, then stop writes at 4.9, 9.8 and 14.7 s: all four retained batches are written, and at
    // 19.6 s there is no time left to capture the counters behind them
    expect(service.brainTelemetryPendingBatches()).toBe(0);
    expect(gaps()).toEqual([
      {
        kind: 'shutdown_unwritten',
        batches: 0,
        day: '2026-11-14',
        workerId: workerIdOf(),
        thread: 'main',
        reason: 'time budget',
        intervalUncaptured: true,
      },
    ]);
    expect(mocked.report.mock.calls.at(-1)![0].message).toBe(
      'Horse telemetry: the last partial interval was not captured at shutdown (time budget)'
    );
    expect(stopLine()).toMatchObject({
      outcome: 'time_budget',
      batches_unwritten: '0',
      interval_captured: 'false',
    });
  });
});

describe('a written batch of a later day says so, so the alert closes itself', () => {
  const notice = (day: string) => ({
    kind: 'written',
    day,
    workerId: workerIdOf(),
    thread: 'main',
  });

  it('says written once per UTC day, not on every flush', async () => {
    const { telemetry } = await start();
    for (let minute = 0; minute < 5; minute++) {
      telemetry.noteFire('a_counter');
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(mocked.rpc).toHaveBeenCalledTimes(5);
    expect(events()).toEqual([notice('2026-11-14')]);
    // the next UTC day: one more
    vi.setSystemTime(new Date('2026-11-15T00:00:30.000Z'));
    for (let minute = 0; minute < 3; minute++) {
      telemetry.noteFire('a_counter');
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(events()).toEqual([notice('2026-11-14'), notice('2026-11-15')]);
  });

  it('a process started today says written on its first batch, which closes what yesterday left open', async () => {
    vi.setSystemTime(new Date('2026-11-15T03:00:00.000Z'));
    const { telemetry } = await start(); // a fresh module: nothing remembered from the day before
    telemetry.noteFire('first_counter_after_restart');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events()).toEqual([notice('2026-11-15')]);
  });

  it('does not say written again for a loss on the same day: today stays open until tomorrow', async () => {
    const { telemetry } = await start();
    telemetry.noteFire('a_counter');
    await vi.advanceTimersByTimeAsync(60_000); // written notice for the 14th
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () => Promise.resolve(refusal('HORSE_FLUSH_INVALID_BOUNDS')),
    }));
    telemetry.noteFire('lost_counter');
    await vi.advanceTimersByTimeAsync(60_000 * 3); // the loss, then two written batches the same day
    expect(written()).toEqual([notice('2026-11-14')]);
    expect(gaps().map((gap) => [gap.kind, gap.day])).toEqual([['rejected', '2026-11-14']]);
    vi.setSystemTime(new Date('2026-11-15T00:00:30.000Z'));
    telemetry.noteFire('a_counter');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(written()).toEqual([notice('2026-11-14'), notice('2026-11-15')]);
  });

  it('an expired batch closes by the same rule: its day is before the day of the next written batch', async () => {
    vi.setSystemTime(new Date('2026-11-13T23:58:30.000Z'));
    const { telemetry } = await start();
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () => Promise.resolve(refusal('HORSE_FLUSH_EXPIRED')),
    }));
    telemetry.noteFire('old_counter');
    await vi.advanceTimersByTimeAsync(60_000); // collected 23:59:30 on the 13th, refused as expired
    await vi.advanceTimersByTimeAsync(60_000 * 2); // 00:00:30 and 00:01:30 on the 14th: written
    expect(events().map((event) => [event.kind, event.day])).toEqual([
      ['expired', '2026-11-13'],
      ['written', '2026-11-14'],
    ]);
  });

  it('says nothing when no batch is confirmed', async () => {
    const { telemetry } = await start();
    mocked.rpc.mockImplementation(() => ({
      abortSignal: () => Promise.resolve({ data: null, error: { message: 'network' } }),
    }));
    telemetry.noteFire('stuck_counter');
    await vi.advanceTimersByTimeAsync(60_000 * 5);
    expect(events()).toEqual([]);
  });
});

describe('the telemetry stop records how long it really took', () => {
  it('calls a stop that wrote exactly the batch bound and never captured the last interval batch_bound, as its alert does', async () => {
    const { service, telemetry } = await start();
    const { BRAIN_TELEMETRY_SHUTDOWN_MAX_BATCHES: bound } = service;
    // one capture that splits into bound + 1 batches by its latency rows (256 a batch)
    for (let i = 0; i < 256 * (bound + 1); i++)
      telemetry.noteDecisionMs(`scope_${String(i).padStart(5, '0')}`, 2);
    await vi.advanceTimersByTimeAsync(60_000); // the tick writes the first; exactly `bound` stay retained
    expect(service.brainTelemetryPendingBatches()).toBe(bound);
    telemetry.noteFire('behind_the_retained_batches');
    await service.stopBrainTelemetryFlush();
    expect(service.brainTelemetryPendingBatches()).toBe(0);
    expect(stopLine()).toMatchObject({
      outcome: 'batch_bound',
      batches_written: String(bound),
      batches_unwritten: '0',
      interval_captured: 'false',
    });
    expect(gaps()).toEqual([
      {
        kind: 'shutdown_unwritten',
        batches: 0,
        day: '2026-11-14',
        workerId: workerIdOf(),
        thread: 'main',
        reason: 'batch bound',
        intervalUncaptured: true,
      },
    ]);
  });

  it('prints one line with the real duration and counts for a slow writer cut off by the budget', async () => {
    const { service, telemetry } = await start();
    fill(telemetry, 20_000); // 20,000 counters split into five batches of at most 4,096
    slowWriter(4_900);
    const stopping = service.stopBrainTelemetryFlush();
    await vi.advanceTimersByTimeAsync(30_000);
    await stopping;
    // writes start at 0, 4.9, 9.8 and 14.7 s; at 19.6 s another write could end past the 20 s budget
    expect(mocked.rpc).toHaveBeenCalledTimes(4);
    expect(stopLine()).toEqual({
      thread: 'main',
      worker_id: workerIdOf(),
      outcome: 'time_budget',
      duration_ms: '19600',
      drain_ms: '0',
      batches_written: '4',
      batches_dropped: '0',
      batches_unwritten: '1',
      interval_captured: 'true',
      budget_ms: String(service.BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS),
      max_batches: String(service.BRAIN_TELEMETRY_SHUTDOWN_MAX_BATCHES),
    });
  });

  it('prints a complete stop with nothing left behind', async () => {
    const { service, telemetry } = await start();
    fill(telemetry, 9_000);
    slowWriter(100);
    const stopping = service.stopBrainTelemetryFlush();
    await vi.advanceTimersByTimeAsync(30_000);
    await stopping;
    expect(stopLine()).toMatchObject({
      outcome: 'complete',
      duration_ms: '300',
      batches_written: '3',
      batches_dropped: '0',
      batches_unwritten: '0',
      interval_captured: 'true',
    });
    expect(gaps()).toEqual([]);
  });

  it('counts a batch dropped during the stop apart from the written ones', async () => {
    const { service, telemetry } = await start();
    fill(telemetry, 9_000);
    let calls = 0;
    mocked.rpc.mockImplementation((_name, args) => ({
      abortSignal: () =>
        Promise.resolve(
          calls++ === 1 ? refusal('HORSE_FLUSH_INVALID_BOUNDS') : ack(args.p_payload)
        ),
    }));
    await service.stopBrainTelemetryFlush();
    expect(stopLine()).toMatchObject({
      outcome: 'complete',
      batches_written: '2',
      batches_dropped: '1',
      batches_unwritten: '0',
    });
  });

  it('includes the wait for a write already in flight when the stop began', async () => {
    const { service, telemetry } = await start();
    slowWriter(3_000);
    telemetry.noteFire('tick_counter');
    await vi.advanceTimersByTimeAsync(60_000); // the tick's write is now in flight
    telemetry.noteFire('final_counter');
    const stopping = service.stopBrainTelemetryFlush();
    await vi.advanceTimersByTimeAsync(30_000);
    await stopping;
    expect(stopLine()).toMatchObject({
      outcome: 'complete',
      drain_ms: '3000',
      duration_ms: '6000',
      batches_written: '1', // the tick's own write is the tick's, not the stop's
      batches_unwritten: '0',
    });
  });

  it('prints the line when the stop fails on an unconfirmed write', async () => {
    const { service, telemetry } = await start();
    fill(telemetry, 9_000);
    slowWriter(WRITE_TIMEOUT_MS); // every write hangs until its abort
    const stopping = service.stopBrainTelemetryFlush();
    const settled = expect(stopping).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(30_000);
    await settled;
    stop = undefined;
    expect(stopLine()).toMatchObject({
      outcome: 'unconfirmed_write',
      duration_ms: '5000',
      batches_written: '0',
      batches_unwritten: '3',
    });
  });

  it('prints nothing for a service that was never started', async () => {
    vi.stubEnv('BRAIN_TELEMETRY_ENABLED', 'false');
    const { service } = await start();
    await service.stopBrainTelemetryFlush();
    expect(log).not.toHaveBeenCalled();
  });

  it.each([1, 1_000, 2_500, 3_333, 4_900, 4_999, WRITE_TIMEOUT_MS])(
    'never runs past its budget plus one write timeout with a writer that takes %i ms, tick write in flight',
    async (ms) => {
      const { service, telemetry } = await start();
      slowWriter(ms);
      fill(telemetry, 4_096 * 3);
      await vi.advanceTimersByTimeAsync(60_000); // a tick write is in flight when the stop begins
      fill(telemetry, 68_600); // the full style_shadow key cap behind it
      const began = Date.now();
      const stopping = service
        .stopBrainTelemetryFlush()
        .catch(() => undefined)
        .then(() => Date.now());
      await vi.advanceTimersByTimeAsync(60_000);
      const ended = await stopping;
      stop = undefined;
      const line = stopLine();
      const duration = Number(line.duration_ms);
      // the reported duration is the real one, measured from outside the service
      expect(duration).toBe(ended - began);
      expect(duration).toBeGreaterThan(0);
      expect(duration).toBeLessThanOrEqual(
        service.BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS + WRITE_TIMEOUT_MS
      );
      // and the tighter truth: no write starts unless it can end inside the budget
      expect(duration).toBeLessThanOrEqual(service.BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS);
      expect(Number(line.batches_written)).toBeLessThanOrEqual(
        service.BRAIN_TELEMETRY_SHUTDOWN_MAX_BATCHES
      );
      expect(Number(line.batches_unwritten)).toBe(service.brainTelemetryPendingBatches());
    }
  );
});
