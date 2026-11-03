import { describe, expect, it, vi } from 'vitest';

const owned = vi.hoisted(() => ({
  finish: undefined as undefined | ((code: number) => void),
  created: 0,
}));
vi.mock('node:os', () => ({ availableParallelism: () => 3 }));
vi.mock('node:worker_threads', async (original) => {
  const actual = await original<typeof import('node:worker_threads')>();
  const { EventEmitter } = await import('node:events');
  return {
    ...actual,
    Worker: class extends EventEmitter {
      constructor() {
        super();
        owned.created++;
        queueMicrotask(() => this.emit('message', { type: 'READY' }));
      }
      unref() {}
      postMessage() {}
      terminate() {
        return new Promise<number>((resolve) => {
          owned.finish = resolve;
        });
      }
    },
  };
});
import { getEquityPool, startEquityWorkerPool, stopEquityWorkerPool } from './EquityWorkerPool.js';

describe('process-wide equity pool retains shutdown ownership', () => {
  it('does not construct a second pool while the original workers are stopping', async () => {
    await startEquityWorkerPool();
    const original = getEquityPool();
    const stopping = stopEquityWorkerPool();
    expect(getEquityPool()).toBe(original);
    await expect(startEquityWorkerPool()).rejects.toThrow('stopped');
    expect(owned.created).toBe(1);
    await Promise.resolve();
    expect(owned.finish).toBeDefined();
    owned.finish!(0);
    await stopping;
    expect(getEquityPool()).not.toBe(original);
    await stopEquityWorkerPool();
  });
});
