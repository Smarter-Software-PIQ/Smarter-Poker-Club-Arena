/**
 * Shared test clock helper for deterministic Horse decision comparisons.
 *
 * Why this exists (D1 prequalification flake, 2026-11-21, PR #11618):
 * `HorseLogic.decide()` still carries 4 ms wall-clock `performance.now()` budgets in
 * tournament mode (Phase 7 joint-sample utility, variant shadow utility, and Phase 13
 * joint shadow/candidate utility). Comparing two `decide()` receipts byte-for-byte after
 * stripping `*Ms` measurement fields (`withoutClocks` / `JSON.stringify` replacers) is
 * STILL non-deterministic on a loaded runner unless `performance.now()` is frozen: one
 * call can finish inside 4 ms (`phase7_evaluated`) while the paired call exceeds 4 ms
 * (`phase7_unavailable`, reason `operation_budget`).
 *
 * This helper freezes `performance.now` to a constant value (default `0`) using
 * `Object.defineProperty` and restores the exact original descriptor in `finally` /
 * `restore()`, so it works cleanly in both synchronous and async tests, requires no
 * Vitest import, and is immune to `vi.restoreAllMocks()` unfreezing the clock mid-test.
 */

export interface FrozenDecisionClock {
  readonly nowMs: number;
  /** Idempotently restore `performance.now` to its exact pre-freeze descriptor. */
  restore(): void;
}

/**
 * Freeze `performance.now()` to return `nowMs` (default `0`) until `restore()` is called.
 * Always pair with `try { ... } finally { clock.restore(); }` or `afterEach(() => clock.restore())`,
 * or prefer `withFrozenDecisionClock(fn)` for scoped cleanup.
 */
export function freezeDecisionClock(nowMs = 0): FrozenDecisionClock {
  const hadOwn = Object.prototype.hasOwnProperty.call(performance, 'now');
  const originalDescriptor = hadOwn
    ? Object.getOwnPropertyDescriptor(performance, 'now')
    : undefined;
  const originalFn = performance.now;
  let restored = false;

  Object.defineProperty(performance, 'now', {
    configurable: true,
    writable: true,
    value: () => nowMs,
  });

  return {
    nowMs,
    restore() {
      if (restored) return;
      restored = true;
      if (hadOwn && originalDescriptor) {
        Object.defineProperty(performance, 'now', originalDescriptor);
      } else {
        delete (performance as { now?: unknown }).now;
        if (performance.now !== originalFn) {
          Object.defineProperty(performance, 'now', {
            configurable: true,
            writable: true,
            value: originalFn,
          });
        }
      }
    },
  };
}

/**
 * Execute `fn` (sync or async) with `performance.now()` frozen to `nowMs` (default `0`),
 * restoring the original clock descriptor before returning or rejecting.
 */
export function withFrozenDecisionClock<T>(fn: () => T, nowMs = 0): T {
  const clock = freezeDecisionClock(nowMs);
  try {
    const result = fn();
    if (result !== null && (typeof result === 'object' || typeof result === 'function')) {
      const then = (result as unknown as { then?: unknown }).then;
      if (typeof then === 'function') {
        return Promise.resolve(result).finally(() => clock.restore()) as unknown as T;
      }
    }
    clock.restore();
    return result;
  } catch (err) {
    clock.restore();
    throw err;
  }
}
