import { describe, expect, it, vi } from 'vitest';

// The pool clamps an explicit worker request to the host's logical CPUs; pin
// the host so these tests get the shards they ask for (see lane.test.ts).
vi.mock('node:os', async (importOriginal) => {
  const os = await importOriginal<typeof import('node:os')>();
  return { ...os, availableParallelism: () => 8 };
});
import type { HorseDecisionWorkerReady, HorseDecisionWorkerResponse } from './protocol.js';
import type { WorkerLike } from './client.js';
import {
  LiveHorseDecisionWorkerPool,
  SHARD_REPLACEMENT_LIMIT,
  SHARD_REPLACEMENT_WINDOW_MS,
} from './lane.js';

/**
 * ONE SHARD'S LOSS IS ONE SHARD'S LOSS (2026-11-06).
 *
 * A decision worker that dies after boot used to restart the whole engine:
 * every table, every live hand and every shard's learned memory, to replace
 * one isolate. The pool now replaces that shard alone and stays fatal only
 * where a fresh process is the honest answer. Each case below is one branch
 * of LiveHorseDecisionWorkerPool.shardFailed.
 */

class FakeWorker implements WorkerLike {
  readonly sent: any[] = [];
  terminateCalls = 0;
  private listeners: Record<string, ((value: any) => void) | undefined> = {};
  constructor(readonly index: number) {}
  postMessage(message: unknown): void {
    this.sent.push(message);
  }
  on(event: 'message', listener: (message: HorseDecisionWorkerResponse) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number) => void): this;
  on(event: 'message' | 'error' | 'exit', listener: unknown): this {
    this.listeners[event] = listener as (value: any) => void;
    return this;
  }
  terminate(): Promise<number> {
    this.terminateCalls++;
    return Promise.resolve(0);
  }
  emit(message: unknown): void {
    this.listeners.message?.(message);
  }
  crash(): void {
    this.listeners.error?.(new Error(`isolate ${this.index} out of memory`));
  }
}

const ready = (overrides: Partial<HorseDecisionWorkerReady> = {}): HorseDecisionWorkerReady => ({
  type: 'READY',
  solverStores: {
    charts: 1,
    postflop: 2,
    postflopV31: 3,
    postflopV31Dataset: { id: '11111111-1111-4111-8111-111111111111', checksum: 'a'.repeat(64) },
  },
  solverPolicyArtifact: {
    totalPolicies: 4,
    policyVersion: 'p.1',
    schemaSha256: 'b'.repeat(64),
  } as unknown as HorseDecisionWorkerReady['solverPolicyArtifact'],
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
  ...overrides,
});

const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve));
};

function bootedPool(count = 2) {
  const workers: FakeWorker[] = [];
  const onFatal = vi.fn();
  let now = 1_000_000;
  const pool = new LiveHorseDecisionWorkerPool({
    workers: count,
    workerFactory: () => {
      const worker = new FakeWorker(workers.length);
      workers.push(worker);
      return worker;
    },
    onFatal,
    shardReplacementNow: () => now,
  });
  return {
    pool,
    workers,
    onFatal,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

async function boot(t: ReturnType<typeof bootedPool>) {
  for (const worker of t.workers) worker.emit(ready());
  await t.pool.ready();
}

describe('a horse decision shard that dies after boot', () => {
  it('is replaced alone: no fatal, the other shard keeps its worker, a new worker hydrates', async () => {
    const t = bootedPool(2);
    await boot(t);
    expect(t.workers).toHaveLength(2);

    t.workers[1]!.crash();
    await settle();

    expect(t.onFatal).not.toHaveBeenCalled();
    expect(t.workers).toHaveLength(3); // the replacement for shard 1
    expect(t.workers[0]!.terminateCalls).toBe(0);
    expect(t.workers[1]!.terminateCalls).toBeGreaterThan(0);
    expect(t.pool.status().phase).toBe('starting');
    expect(t.pool.shardReplacements().total).toBe(1);
    expect(t.pool.shardReplacements().recent[0]).toMatchObject({ shard: 1 });

    t.workers[2]!.emit(ready());
    await settle();
    expect(t.onFatal).not.toHaveBeenCalled();
    expect(t.pool.status().phase).toBe('ready');
    expect(t.pool.status().shardReplacements).toBe(1);
  });

  it(`stays fatal when one shard has already been replaced ${SHARD_REPLACEMENT_LIMIT} times inside the window`, async () => {
    const t = bootedPool(2);
    await boot(t);
    for (let i = 0; i < SHARD_REPLACEMENT_LIMIT; i++) {
      t.workers[t.workers.length - 1]!.crash();
      await settle();
      t.workers[t.workers.length - 1]!.emit(ready());
      await settle();
      t.advance(60_000);
    }
    expect(t.onFatal).not.toHaveBeenCalled();
    t.workers[t.workers.length - 1]!.crash();
    await settle();
    expect(t.onFatal).toHaveBeenCalledTimes(1);
    expect(String(t.onFatal.mock.calls[0]![0].message)).toMatch(
      new RegExp(`failed ${SHARD_REPLACEMENT_LIMIT + 1} times`)
    );
  });

  it('forgets replacements older than the window', async () => {
    const t = bootedPool(2);
    await boot(t);
    for (let i = 0; i < SHARD_REPLACEMENT_LIMIT + 2; i++) {
      t.workers[t.workers.length - 1]!.crash();
      await settle();
      t.workers[t.workers.length - 1]!.emit(ready());
      await settle();
      t.advance(SHARD_REPLACEMENT_WINDOW_MS);
    }
    expect(t.onFatal).not.toHaveBeenCalled();
    expect(t.pool.shardReplacements().total).toBe(SHARD_REPLACEMENT_LIMIT + 2);
  });

  it('stays fatal when the replacement loads a different solver corpus', async () => {
    const t = bootedPool(2);
    await boot(t);
    t.workers[0]!.crash();
    await settle();
    t.workers[2]!.emit(
      ready({
        solverPolicyArtifact: {
          totalPolicies: 4,
          policyVersion: 'p.2',
          schemaSha256: 'b'.repeat(64),
        } as unknown as HorseDecisionWorkerReady['solverPolicyArtifact'],
      })
    );
    await settle();
    expect(t.onFatal).toHaveBeenCalledTimes(1);
    expect(String(t.onFatal.mock.calls[0]![0].message)).toMatch(/different solver corpus/);
  });

  it('stays fatal for a worker that dies before the pool finished booting', async () => {
    const t = bootedPool(2);
    t.workers[0]!.emit(ready());
    t.workers[1]!.crash();
    await settle();
    expect(t.onFatal).toHaveBeenCalledTimes(1);
    expect(t.workers).toHaveLength(2); // nothing was replaced
  });

  it('never replaces a worker while the pool is stopping', async () => {
    const t = bootedPool(2);
    await boot(t);
    const stopping = t.pool.stop();
    t.workers[1]!.crash();
    await settle();
    expect(t.workers).toHaveLength(2);
    void stopping.catch(() => undefined);
  });
});
