import { describe, expect, it, vi } from 'vitest';
import { freezeDecisionClock, withFrozenDecisionClock } from './frozenDecisionClock.js';

describe('frozenDecisionClock', () => {
  it('freezes performance.now() to 0 by default and restores it idempotently', () => {
    const before = performance.now();
    expect(before).toBeGreaterThan(0);

    const clock = freezeDecisionClock();
    expect(clock.nowMs).toBe(0);
    expect(performance.now()).toBe(0);
    expect(performance.now()).toBe(0);

    clock.restore();
    expect(performance.now()).toBeGreaterThanOrEqual(before);

    // Calling restore() a second time is a safe no-op.
    clock.restore();
    expect(performance.now()).toBeGreaterThanOrEqual(before);
  });

  it('supports custom fixed timestamps and nested scopes in LIFO order', () => {
    const before = performance.now();
    const out = withFrozenDecisionClock(() => {
      expect(performance.now()).toBe(123);
      const inner = withFrozenDecisionClock(() => {
        expect(performance.now()).toBe(456);
        return 'inner-ok';
      }, 456);
      expect(performance.now()).toBe(123);
      return inner;
    }, 123);

    expect(out).toBe('inner-ok');
    expect(performance.now()).toBeGreaterThanOrEqual(before);
  });

  it('restores performance.now() when a synchronous callback throws', () => {
    const before = performance.now();
    expect(() =>
      withFrozenDecisionClock(() => {
        expect(performance.now()).toBe(0);
        throw new Error('sync boom');
      })
    ).toThrow('sync boom');
    expect(performance.now()).toBeGreaterThanOrEqual(before);
  });

  it('freezes across async awaits and restores on both resolve and reject', async () => {
    const before = performance.now();
    const resolved = await withFrozenDecisionClock(async () => {
      expect(performance.now()).toBe(0);
      await Promise.resolve();
      expect(performance.now()).toBe(0);
      return 42;
    });
    expect(resolved).toBe(42);
    expect(performance.now()).toBeGreaterThanOrEqual(before);

    await expect(
      withFrozenDecisionClock(async () => {
        expect(performance.now()).toBe(0);
        await Promise.resolve();
        throw new Error('async boom');
      })
    ).rejects.toThrow('async boom');
    expect(performance.now()).toBeGreaterThanOrEqual(before);
  });

  it('stays frozen across vi.restoreAllMocks() inside a scoped callback', () => {
    const before = performance.now();
    withFrozenDecisionClock(() => {
      expect(performance.now()).toBe(0);
      vi.restoreAllMocks();
      expect(performance.now()).toBe(0);
    });
    expect(performance.now()).toBeGreaterThanOrEqual(before);
  });
});
