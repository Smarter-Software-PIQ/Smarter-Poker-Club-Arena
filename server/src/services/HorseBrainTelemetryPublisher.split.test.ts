/**
 * Review 64466c83 H1 (2026-11-13): one oversized capture never stalls a worker's telemetry. The publisher splits a
 * capture into batches inside every writer bound, drops a batch the writer refuses by its bytes (with a result the
 * flush receipts), and abandons a batch that stays unconfirmed for HORSE_TELEMETRY_MAX_ATTEMPTS flushes.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  HORSE_TELEMETRY_MAX_ATTEMPTS,
  HORSE_TELEMETRY_MAX_BYTES,
  HORSE_TELEMETRY_MAX_FIRES,
  HorseBrainTelemetryPublisher,
} from './HorseBrainTelemetryPublisher.js';

const ack = (payload: string) => ({
  data: {
    version: 1,
    status: 'recorded',
    batchId: JSON.parse(payload).batchId,
    payloadSha256: createHash('sha256').update(payload).digest('hex'),
  },
  error: null,
});
const fires = (n: number, width = 20) =>
  Array.from({ length: n }, (_, i) => ({
    feature: `k_${String(i).padStart(width, '0')}_seen`,
    fires: 1,
  }));

describe('telemetry publisher: bounded batches, no permanent stall', () => {
  it('splits a capture above the counter bound into batches inside every bound', async () => {
    const sent: string[] = [];
    let captures = 0;
    const p = new HorseBrainTelemetryPublisher({
      capture: () =>
        captures++ === 0 ? { fires: fires(9000), latency: [] } : { fires: [], latency: [] },
      send: vi.fn(async (payload: string) => {
        sent.push(payload);
        return ack(payload);
      }),
      sourceRelease: () => null,
    });
    for (let i = 0; i < 3; i++) expect(await p.flush()).toBe('recorded');
    expect(await p.flush()).toBe('idle');
    expect(sent).toHaveLength(3);
    const sizes = sent.map((s) => JSON.parse(s).fires.length);
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(9000);
    for (const s of sent) {
      expect(JSON.parse(s).fires.length).toBeLessThanOrEqual(HORSE_TELEMETRY_MAX_FIRES);
      expect(Buffer.byteLength(s)).toBeLessThanOrEqual(HORSE_TELEMETRY_MAX_BYTES);
    }
    // every batch has its own id and sequence
    expect(new Set(sent.map((s) => JSON.parse(s).batchId)).size).toBe(3);
  });

  it('splits by bytes too', async () => {
    const sent: string[] = [];
    let captures = 0;
    const p = new HorseBrainTelemetryPublisher({
      capture: () =>
        captures++ === 0 ? { fires: fires(4000, 110), latency: [] } : { fires: [], latency: [] },
      send: vi.fn(async (payload: string) => {
        sent.push(payload);
        return ack(payload);
      }),
      sourceRelease: () => null,
    });
    while ((await p.flush()) !== 'idle');
    expect(sent.length).toBeGreaterThan(1);
    for (const s of sent)
      expect(Buffer.byteLength(s)).toBeLessThanOrEqual(HORSE_TELEMETRY_MAX_BYTES);
    expect(sent.map((s) => JSON.parse(s).fires.length).reduce((a, b) => a + b, 0)).toBe(4000);
  });

  it('drops a batch the writer refuses by its bytes, then publishes fresh counters', async () => {
    let n = 0;
    const p = new HorseBrainTelemetryPublisher({
      capture: () => ({ fires: [{ feature: `a_${n}_seen`, fires: 1 }], latency: [] }),
      send: vi.fn(async (payload: string) =>
        n++ === 0
          ? { data: null, error: { code: 'P0001', message: 'HORSE_FLUSH_INVALID_BOUNDS' } }
          : ack(payload)
      ),
      sourceRelease: () => null,
    });
    expect(await p.flush()).toBe('rejected');
    expect(p.pendingBatches()).toBe(0);
    expect(await p.flush()).toBe('recorded');
  });

  it('keeps retrying a transient failure with the same bytes, then abandons it after the attempt cap', async () => {
    const sent: string[] = [];
    const p = new HorseBrainTelemetryPublisher({
      capture: () => ({ fires: [{ feature: 'x_seen', fires: 1 }], latency: [] }),
      send: vi.fn(async (payload: string) => {
        sent.push(payload);
        return { data: null, error: { message: 'network' } };
      }),
      sourceRelease: () => null,
    });
    for (let i = 1; i < HORSE_TELEMETRY_MAX_ATTEMPTS; i++)
      await expect(p.flush()).rejects.toThrow('unconfirmed');
    expect(new Set(sent).size).toBe(1);
    expect(await p.flush()).toBe('abandoned');
    expect(p.pendingBatches()).toBe(0);
  });

  it('a send that throws is retried with the same bytes and abandoned at the attempt cap, never resent forever', async () => {
    const sent: string[] = [];
    const p = new HorseBrainTelemetryPublisher({
      capture: () => ({ fires: [{ feature: 'x_seen', fires: 1 }], latency: [] }),
      send: vi.fn(async (payload: string) => {
        sent.push(payload);
        throw new Error('The operation was aborted due to timeout');
      }),
      sourceRelease: () => null,
    });
    for (let i = 1; i < HORSE_TELEMETRY_MAX_ATTEMPTS; i++)
      await expect(p.flush()).rejects.toThrow('aborted');
    expect(new Set(sent).size).toBe(1);
    expect(await p.flush()).toBe('abandoned');
    expect(p.pendingBatches()).toBe(0);
  });

  it('the byte halving ends at one row: two oversized rows go as two single-row batches, never a hang', async () => {
    const sent: string[] = [];
    let captures = 0;
    const big = 'x'.repeat(300_000);
    const p = new HorseBrainTelemetryPublisher({
      capture: () =>
        captures++ === 0
          ? {
              fires: [{ feature: big, fires: 1 }],
              latency: [{ scope: big, count: 1, totalMs: 1, maxMs: 1, buckets: [1] } as never],
            }
          : { fires: [], latency: [] },
      send: vi.fn(async (payload: string) => {
        sent.push(payload);
        return ack(payload);
      }),
      sourceRelease: () => null,
    });
    while ((await p.flush()) !== 'idle');
    expect(sent).toHaveLength(2);
    expect(sent.map((s) => [JSON.parse(s).fires.length, JSON.parse(s).latency.length])).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });
});
