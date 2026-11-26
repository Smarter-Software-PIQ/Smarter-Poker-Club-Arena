/**
 * LAW: A LOST DECISION WORKER IS A horse_error_log ROW (2026-11-24).
 *
 * The real pool (lane.ts) and the real writer (services/HorseErrorLog.ts);
 * only the worker thread and the database client are replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, availableParallelism: () => 8 };
});
const db = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));
vi.mock('../../services/supabase/client.js', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table !== 'horse_error_log') throw Error(`Unexpected database access: ${table}`);
      return {
        insert: (row: Record<string, unknown>) => ({
          abortSignal: async () => {
            db.rows.push(row);
            return { error: null };
          },
        }),
      };
    }),
    rpc: vi.fn(() => {
      throw Error('Unexpected database RPC');
    }),
  },
  maintenanceSupabase: {},
}));
import type { HorseDecisionWorkerReady, HorseDecisionWorkerResponse } from './protocol.js';
import type { WorkerLike } from './client.js';
import { LiveHorseDecisionWorkerPool } from './lane.js';
import { _resetHorseErrorLogForTests, startHorseErrorLog } from '../../services/HorseErrorLog.js';

class FakeWorker implements WorkerLike {
  private listeners: Record<string, ((value: any) => void) | undefined> = {};
  constructor(readonly index: number) {}
  postMessage(): void {}
  on(event: 'message', listener: (message: HorseDecisionWorkerResponse) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  on(event: 'message' | 'error' | 'exit', listener: unknown): this {
    this.listeners[event] = listener as (value: any) => void;
    return this;
  }
  terminate(): Promise<number> {
    return Promise.resolve(0);
  }
  emit(message: unknown): void {
    this.listeners.message?.(message);
  }
  crash(message: string): void {
    this.listeners.error?.(new Error(message));
  }
}

const ready = (): HorseDecisionWorkerReady =>
  ({
    type: 'READY',
    solverStores: {
      charts: 1,
      postflop: 2,
      postflopV31: 3,
      postflopV31Dataset: { id: '11111111-1111-4111-8111-111111111111', checksum: 'a'.repeat(64) },
    },
    solverPolicyArtifact: { totalPolicies: 4, policyVersion: 'p.1', schemaSha256: 'b'.repeat(64) },
    governor: {
      enabled: true,
      scale: 1,
      p50Ms: 10,
      p99Ms: 20,
      sampledAt: 1,
      throttledForS: 0,
      stale: false,
      timerLateMs: 0,
    },
  }) as unknown as HorseDecisionWorkerReady;

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
};

beforeEach(() => {
  db.rows.length = 0;
  _resetHorseErrorLogForTests();
  startHorseErrorLog();
});
afterEach(() => _resetHorseErrorLogForTests());

describe('a decision worker that dies after boot', () => {
  it('is written as worker_failed with its shard, and is still replaced alone', async () => {
    const workers: FakeWorker[] = [];
    const onFatal = vi.fn();
    const pool = new LiveHorseDecisionWorkerPool({
      workers: 2,
      workerFactory: () => {
        const w = new FakeWorker(workers.length);
        workers.push(w);
        return w;
      },
      onFatal,
      shardReplacementNow: () => 1_000_000,
    });
    for (const w of workers) w.emit(ready());
    await pool.ready();

    workers[1]!.crash('isolate 1 out of memory while holding As Kd');
    await settle();

    expect(onFatal).not.toHaveBeenCalled();
    expect(workers).toHaveLength(3);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]).toMatchObject({ error_type: 'worker_failed', horse_id: null });
    expect(db.rows[0]!.context).toMatchObject({
      reason: 'replaced_alone',
      shard: 1,
      occurrences: 1,
    });
    expect(db.rows[0]!.error_message).toBe('isolate 1 out of memory while holding [card] [card]');
  });
});
