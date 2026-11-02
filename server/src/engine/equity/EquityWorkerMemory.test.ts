import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { EquityWorkerPool } from './EquityWorkerPool.js';
import type { Card } from '../../types.js';

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });
const hands = [
  [card('A', 'spades'), card('A', 'hearts')],
  [card('K', 'spades'), card('K', 'hearts')],
];
const board = [
  card('A', 'clubs'),
  card('7', 'diamonds'),
  card('2', 'hearts'),
  card('9', 'spades'),
  card('3', 'clubs'),
];

describe('equity memory observations use the real worker entrypoint', () => {
  it('reports actual isolate ceilings and releases queued payloads through repeated complete jobs', async () => {
    const built = buildSync({
      entryPoints: [fileURLToPath(new URL('./equityWorker.ts', import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'esm',
      write: false,
    });
    const url = new URL(
      'data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].contents).toString('base64')
    );
    const pool = new EquityWorkerPool({
      size: 1,
      workerFactory: () => new Worker(url, { workerData: { equityMemoryIndex: 7 } }),
      readyTimeoutMs: 5_000,
    });
    try {
      await pool.ready();
      const before = pool.status().workerMemory[0];
      expect(before).toMatchObject({ shardIndex: 7, source: 'node_v8_heap_statistics' });
      expect(before!.threadId).toBeGreaterThan(0);
      expect(before!.heapLimitBytes).toBeGreaterThan(before!.heapUsedBytes);
      for (let i = 0; i < 64; i++) {
        const result = await pool.estimateEquity(hands, board, [], 100, { exact: true });
        expect(result).toEqual([1, 0]);
      }
      const status = pool.status();
      expect(status).toMatchObject({
        queueDepth: 0,
        queuedBytes: 0,
        busyWorkers: 0,
        retiringWorkers: 0,
      });
      expect(status.workerMemory).toHaveLength(1);
      expect(status.workerMemory[0]!.sampledAtMs).toBeGreaterThanOrEqual(before!.sampledAtMs);
      expect(status.workerMemory[0]!.threadId).toBe(before!.threadId);
    } finally {
      await pool.shutdown();
    }
    expect(pool.status()).toMatchObject({ phase: 'stopped', workerMemory: [], retiringWorkers: 0 });
  });
});
