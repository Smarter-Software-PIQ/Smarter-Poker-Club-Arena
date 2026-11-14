import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ rpc: vi.fn(), report: vi.fn() }));
vi.mock('./supabase/client.js', () => ({ supabase: { rpc: mocked.rpc } }));
vi.mock('./errorReporter.js', () => ({ reportError: mocked.report }));
const ack = (payload: string, status = 'recorded') => ({
  data: {
    version: 1,
    status,
    batchId: JSON.parse(payload).batchId,
    payloadSha256: createHash('sha256').update(payload).digest('hex'),
  },
  error: null,
});
let stop: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('GIT_COMMIT_SHA', 'c'.repeat(40));
  vi.stubEnv('BRAIN_TELEMETRY_ENABLED', 'true');
  mocked.rpc.mockReset();
  mocked.report.mockReset();
  mocked.rpc.mockImplementation((_name, args) => ({
    abortSignal: () => Promise.resolve(ack(args.p_payload)),
  }));
});
afterEach(async () => {
  await stop?.();
  stop = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
async function start() {
  const service = await import('./BrainTelemetryFlush.js');
  const telemetry = await import('../engine/BrainTelemetry.js');
  stop = service.stopBrainTelemetryFlush;
  service.startBrainTelemetryFlush();
  return { service, telemetry };
}
describe('actual Horse telemetry flush service', () => {
  it('writes every batch a split final capture produces at shutdown, each with its own receipt', async () => {
    const { service, telemetry } = await start();
    for (let i = 0; i < 9000; i++) telemetry.noteFire(`split_${String(i).padStart(5, '0')}`);
    await service.stopBrainTelemetryFlush();
    const batches = mocked.rpc.mock.calls.map((c) => JSON.parse(c[1].p_payload));
    expect(batches.length).toBeGreaterThanOrEqual(3);
    expect(new Set(batches.map((b) => b.batchId)).size).toBe(batches.length);
    expect(
      batches.reduce(
        (n, b) =>
          n + b.fires.filter((f: { feature: string }) => f.feature.startsWith('split_')).length,
        0
      )
    ).toBe(9000);
    expect(service.brainTelemetryPendingBatches()).toBe(0);
    expect(mocked.report).not.toHaveBeenCalled();
  });
  it('stops at the first unconfirmed shutdown write and reports the batches left unwritten', async () => {
    const { service, telemetry } = await start();
    for (let i = 0; i < 9000; i++) telemetry.noteFire(`split_${String(i).padStart(5, '0')}`);
    let calls = 0;
    mocked.rpc.mockImplementation((_name, args) => ({
      abortSignal: () =>
        calls++ === 1 ? Promise.reject(new Error('aborted')) : Promise.resolve(ack(args.p_payload)),
    }));
    await expect(service.stopBrainTelemetryFlush()).rejects.toThrow('aborted');
    stop = undefined;
    expect(calls).toBe(2);
    expect(service.brainTelemetryPendingBatches()).toBeGreaterThan(0);
    expect(mocked.report.mock.calls.map((c) => c[1])).toContain(
      'BrainTelemetryFlush.shutdown_unwritten'
    );
  });
  it('keeps shutdown inside its time budget: no write starts that could end past it, and the rest is reported', async () => {
    const { service, telemetry } = await start();
    for (let i = 0; i < 9000; i++) telemetry.noteFire(`split_${String(i).padStart(5, '0')}`);
    // every write takes 8 s: writes start at 0 s and 8 s; one at 16 s could end at 21 s, past the 20 s budget
    mocked.rpc.mockImplementation((_name, args) => ({
      abortSignal: () => {
        vi.setSystemTime(Date.now() + 8_000);
        return Promise.resolve(ack(args.p_payload));
      },
    }));
    expect(service.BRAIN_TELEMETRY_SHUTDOWN_BUDGET_MS).toBe(20_000);
    await service.stopBrainTelemetryFlush();
    expect(mocked.rpc).toHaveBeenCalledTimes(2);
    expect(service.brainTelemetryPendingBatches()).toBe(1);
    expect(mocked.report.mock.calls.map((c) => [c[1], String(c[0].message)])).toContainEqual([
      'BrainTelemetryFlush.shutdown_unwritten',
      'Horse telemetry: 1 batch(es) unwritten at shutdown (time budget)',
    ]);
  });
  it('holds the shutdown acknowledgement until the final partial batch commits', async () => {
    const { service, telemetry } = await start();
    let finish!: (value: any) => void;
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }));
    telemetry.noteFire('final_decision');
    const pending = service.stopBrainTelemetryFlush();
    let stopped = false;
    void pending.then(() => {
      stopped = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(mocked.rpc).toHaveBeenCalledOnce();
    expect(stopped).toBe(false);
    finish(ack(mocked.rpc.mock.calls[0][1].p_payload));
    await pending;
    expect(stopped).toBe(true);
    expect(mocked.rpc).toHaveBeenCalledOnce();
  });
  it('lets a restarted lifecycle own counts that arrive after the final capture', async () => {
    const { service, telemetry } = await start();
    let finish!: (value: any) => void;
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }));
    telemetry.noteFire('old_final');
    const pending = service.stopBrainTelemetryFlush();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocked.rpc).toHaveBeenCalledOnce();
    service.startBrainTelemetryFlush();
    telemetry.noteFire('new_generation');
    finish(ack(mocked.rpc.mock.calls[0][1].p_payload));
    await pending;
    expect(mocked.rpc).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(JSON.parse(mocked.rpc.mock.calls[1][1].p_payload).fires).toEqual([
      { feature: 'new_generation', fires: 1 },
    ]);
  });
  it('does not start a final write when telemetry was explicitly disabled', async () => {
    vi.stubEnv('BRAIN_TELEMETRY_ENABLED', 'false');
    const { service, telemetry } = await start();
    telemetry.noteFire('disabled');
    await service.stopBrainTelemetryFlush();
    expect(mocked.rpc).not.toHaveBeenCalled();
  });
  it('publishes the last partial interval before graceful stop resolves', async () => {
    const { service, telemetry } = await start();
    telemetry.noteFire('final_decision');
    telemetry.noteDecisionMs('nlh', 3);
    await service.stopBrainTelemetryFlush();
    expect(mocked.rpc).toHaveBeenCalledOnce();
    const batch = JSON.parse(mocked.rpc.mock.calls[0][1].p_payload);
    expect(batch.fires).toContainEqual({ feature: 'final_decision', fires: 1 });
    expect(batch.latency).toContainEqual(expect.objectContaining({ scope: 'nlh', samples: 1 }));
  });
  it('reconciles an uncertain old batch and publishes the later counters during stop', async () => {
    const { service, telemetry } = await start();
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () =>
        Promise.resolve({ data: null, error: { message: 'lost acknowledgement' } }),
    }));
    telemetry.noteFire('old_decision');
    await vi.advanceTimersByTimeAsync(60_000);
    const original = mocked.rpc.mock.calls[0][1].p_payload;
    telemetry.noteFire('final_decision');
    await service.stopBrainTelemetryFlush();
    expect(mocked.rpc).toHaveBeenCalledTimes(3);
    expect(mocked.rpc.mock.calls[1][1].p_payload).toBe(original);
    const final = JSON.parse(mocked.rpc.mock.calls[2][1].p_payload);
    expect(final.fires).toEqual([{ feature: 'final_decision', fires: 1 }]);
    expect(final.sequence).toBe(2);
  });
  it('cannot acknowledge shutdown while its final batch is unconfirmed', async () => {
    const { service, telemetry } = await start();
    mocked.rpc.mockImplementation(() => ({
      abortSignal: () => Promise.resolve({ data: null, error: { message: 'not committed' } }),
    }));
    telemetry.noteFire('final_decision');
    const pending = service.stopBrainTelemetryFlush();
    void pending.catch(() => undefined);
    let outcome = 'pending';
    void pending.then(
      () => {
        outcome = 'resolved';
      },
      () => {
        outcome = 'rejected';
      }
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    // An unconfirmed final write must never report a clean shutdown.
    expect(outcome).not.toBe('resolved');
    await expect(pending).rejects.toThrow('write unconfirmed');
    expect(service.stopBrainTelemetryFlush()).toBe(pending);
    stop = undefined;
  });

  it('atomically flushes both streams and retries the exact batch while new counts accumulate', async () => {
    const { service, telemetry } = await start();
    service.startBrainTelemetryFlush();
    mocked.rpc.mockImplementationOnce((_name, _args) => ({
      abortSignal: () => Promise.resolve({ data: null, error: { message: 'ack lost' } }),
    }));
    telemetry.noteFire('phase15_execution_intended');
    telemetry.noteDecisionMs('nlh', 2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocked.rpc).toHaveBeenCalledOnce();
    expect(mocked.rpc.mock.calls[0][0]).toBe('fn_horse_brain_flush_receipt');
    const original = mocked.rpc.mock.calls[0][1].p_payload;
    const first = JSON.parse(original);
    expect(first.sourceRelease).toBe('c'.repeat(40));
    expect(first.fires).toContainEqual({ feature: 'phase15_execution_intended', fires: 1 });
    expect(first.latency).toEqual(
      expect.arrayContaining([expect.objectContaining({ scope: 'nlh', samples: 1 })])
    );
    telemetry.noteFire('new_counter');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocked.rpc.mock.calls[1][1].p_payload).toBe(original);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(JSON.parse(mocked.rpc.mock.calls[2][1].p_payload).fires).toEqual([
      { feature: 'new_counter', fires: 1 },
    ]);
    expect(mocked.report).toHaveBeenCalledOnce();
  });
  it('drains the in-flight request on stop and cannot start a second write until it settles', async () => {
    const { service, telemetry } = await start();
    let finish!: (value: any) => void;
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    }));
    telemetry.noteFire('before_stop');
    await vi.advanceTimersByTimeAsync(60_000);
    const firstStop = service.stopBrainTelemetryFlush();
    expect(service.stopBrainTelemetryFlush()).toBe(firstStop);
    service.startBrainTelemetryFlush();
    telemetry.noteFire('after_restart');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocked.rpc).toHaveBeenCalledOnce();
    finish(ack(mocked.rpc.mock.calls[0][1].p_payload));
    await firstStop;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocked.rpc).toHaveBeenCalledTimes(2);
    expect(JSON.parse(mocked.rpc.mock.calls[1][1].p_payload).fires).toEqual([
      { feature: 'after_restart', fires: 1 },
    ]);
  });
  it('makes an explicitly expired batch visible instead of silently counting it as written', async () => {
    const { telemetry } = await start();
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () =>
        Promise.resolve({ data: null, error: { code: 'P0001', message: 'HORSE_FLUSH_EXPIRED' } }),
    }));
    telemetry.noteFire('expired_counter');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocked.report).toHaveBeenCalledWith(expect.any(Error), 'BrainTelemetryFlush.expired');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(JSON.parse(mocked.rpc.mock.calls[1][1].p_payload).fires).toEqual([
      { feature: 'phase15_telemetry_batch_expired', fires: 1 },
    ]);
  });
  it('counts and reports a batch the writer refuses by its bytes, and the counter reaches the next write', async () => {
    const { telemetry } = await start();
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () =>
        Promise.resolve({
          data: null,
          error: { code: 'P0001', message: 'HORSE_FLUSH_INVALID_BOUNDS' },
        }),
    }));
    telemetry.noteFire('refused_counter');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocked.report).toHaveBeenCalledWith(expect.any(Error), 'BrainTelemetryFlush.rejected');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(JSON.parse(mocked.rpc.mock.calls[1][1].p_payload).fires).toEqual([
      { feature: 'phase15_telemetry_batch_rejected', fires: 1 },
    ]);
  });
  it('counts and reports a batch abandoned at the attempt cap, and the counter reaches the next write', async () => {
    const { telemetry } = await start();
    const { HORSE_TELEMETRY_MAX_ATTEMPTS } = await import('./HorseBrainTelemetryPublisher.js');
    let calls = 0;
    mocked.rpc.mockImplementation((_name, args) => ({
      abortSignal: () =>
        calls++ < HORSE_TELEMETRY_MAX_ATTEMPTS
          ? Promise.resolve({ data: null, error: { message: 'network' } })
          : Promise.resolve(ack(args.p_payload)),
    }));
    telemetry.noteFire('stuck_counter');
    await vi.advanceTimersByTimeAsync(60_000 * HORSE_TELEMETRY_MAX_ATTEMPTS);
    expect(calls).toBe(HORSE_TELEMETRY_MAX_ATTEMPTS);
    expect(mocked.report).toHaveBeenCalledWith(expect.any(Error), 'BrainTelemetryFlush.abandoned');
    await vi.advanceTimersByTimeAsync(60_000);
    const last = JSON.parse(mocked.rpc.mock.calls.at(-1)![1].p_payload);
    expect(
      last.fires.find((f: { feature: string }) => f.feature === 'phase15_telemetry_batch_abandoned')
    ).toEqual({ feature: 'phase15_telemetry_batch_abandoned', fires: 1 });
    // the abandoned batch's own counter is the evidence gap: it is not resent
    expect(last.fires.some((f: { feature: string }) => f.feature === 'stuck_counter')).toBe(false);
  });
  it('does not write empty batches or schedule writes after stopping', async () => {
    const { service, telemetry } = await start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocked.rpc).not.toHaveBeenCalled();
    await service.stopBrainTelemetryFlush();
    telemetry.noteFire('still_unflushed');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(mocked.rpc).not.toHaveBeenCalled();
  });
});
