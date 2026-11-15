/**
 * In a Horse decision worker thread the telemetry flush never touches the engine alert path itself: every gap
 * event is posted to the main thread, which owns the alert journal (2026-11-14).
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocked = vi.hoisted(() => ({ rpc: vi.fn(), report: vi.fn(), post: vi.fn(), sink: vi.fn() }));
vi.mock('node:worker_threads', async (original) => ({
  ...(await original<typeof import('node:worker_threads')>()),
  isMainThread: false,
  parentPort: { postMessage: mocked.post },
}));
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
let stop: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-14T10:00:00.000Z'));
  vi.stubEnv('BRAIN_TELEMETRY_ENABLED', 'true');
  for (const mock of Object.values(mocked)) mock.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  await stop?.().catch(() => undefined);
  stop = undefined;
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('the telemetry flush in a worker thread', () => {
  it('posts a lost batch and the written notice to the main thread and calls no sink of its own', async () => {
    const service = await import('./BrainTelemetryFlush.js');
    const telemetry = await import('../engine/BrainTelemetry.js');
    stop = service.stopBrainTelemetryFlush;
    service.setBrainTelemetryGapSink(mocked.sink); // even a sink set by mistake is never called in a worker
    service.startBrainTelemetryFlush();
    mocked.rpc.mockImplementationOnce(() => ({
      abortSignal: () =>
        Promise.resolve({
          data: null,
          error: { code: 'P0001', message: 'HORSE_FLUSH_INVALID_BOUNDS' },
        }),
    }));
    mocked.rpc.mockImplementation((_name, args) => ({
      abortSignal: () => Promise.resolve(ack(args.p_payload)),
    }));
    telemetry.noteFire('lost_counter');
    await vi.advanceTimersByTimeAsync(60_000 * 2);
    const workerId = JSON.parse(mocked.rpc.mock.calls[0][1].p_payload).workerId;
    expect(mocked.post.mock.calls.map((call) => call[0])).toEqual([
      {
        type: 'HORSE_TELEMETRY_GAP',
        gap: { kind: 'rejected', batches: 1, day: '2026-11-14', workerId, thread: 'worker' },
      },
      {
        type: 'HORSE_TELEMETRY_GAP',
        gap: { kind: 'written', day: '2026-11-14', workerId, thread: 'worker' },
      },
    ]);
    expect(mocked.sink).not.toHaveBeenCalled();
    // a relay call is the main thread's; in a worker it does nothing
    service.relayBrainTelemetryGapEvent({ kind: 'rejected' });
    expect(mocked.post).toHaveBeenCalledTimes(2);
  });

  it('keeps flushing when the port is closed', async () => {
    const service = await import('./BrainTelemetryFlush.js');
    const telemetry = await import('../engine/BrainTelemetry.js');
    stop = service.stopBrainTelemetryFlush;
    service.startBrainTelemetryFlush();
    mocked.post.mockImplementation(() => {
      throw new Error('port closed');
    });
    mocked.rpc.mockImplementation((_name, args) => ({
      abortSignal: () => Promise.resolve(ack(args.p_payload)),
    }));
    telemetry.noteFire('a_counter');
    await vi.advanceTimersByTimeAsync(60_000);
    telemetry.noteFire('a_counter');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocked.rpc).toHaveBeenCalledTimes(2);
  });
});
