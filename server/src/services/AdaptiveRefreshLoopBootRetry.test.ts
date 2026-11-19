import { describe, expect, it, vi } from 'vitest';
import { BOOT_RETRY_DELAYS_MS, createAdaptiveRefreshLoop } from './AdaptiveRefreshLoop.js';

/*
 * 2026-11-19 14:17Z failed engine swap: one of eight live horse decision
 * workers hit supabase_timeout on its single boot read of the solver
 * open-node cells, came up with 0 cells while its siblings loaded 7747, and
 * the lane's corpus-equality gate (correctly) failed the boot. The boot load
 * now retries inside its readiness budget; these tests pin that contract.
 */
const FULL_CORPUS = 7_747;

/** A worker-local store fed by a loader that fails `failures` times first. */
function workerStore(failures: number, mode: 'outcome' | 'throw' = 'outcome') {
  let cells = 0;
  let calls = 0;
  const load = vi.fn(async () => {
    calls += 1;
    if (calls <= failures) {
      if (mode === 'throw') throw new Error('supabase_timeout');
      return { ok: false, count: 0 };
    }
    cells = FULL_CORPUS;
    return { ok: true, count: cells };
  });
  const loop = createAdaptiveRefreshLoop({
    load,
    refreshMs: 60 * 60_000,
    retryMs: 30_000,
    maxRetryMs: 5 * 60_000,
  });
  return { loop, load, cells: () => cells };
}

const instant = () => {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
};

describe('AdaptiveRefreshLoop.runBoot (boot solver-load retry)', () => {
  it('a transient first failure then a success yields the full corpus', async () => {
    const w = workerStore(1);
    const { waits, sleep } = instant();
    const outcome = await w.loop.runBoot({ sleep, random: () => 0.5 });
    expect(outcome).toEqual({ ok: true, count: FULL_CORPUS });
    expect(w.cells()).toBe(FULL_CORPUS);
    expect(w.load).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([1_000]);
  });

  it('retries a thrown supabase_timeout the same way', async () => {
    const w = workerStore(2, 'throw');
    const { waits, sleep } = instant();
    await expect(w.loop.runBoot({ sleep, random: () => 0.5 })).resolves.toEqual({
      ok: true,
      count: FULL_CORPUS,
    });
    expect(waits).toEqual([1_000, 2_000]);
  });

  it('eight workers with one transient failure all boot on the same corpus', async () => {
    const workers = Array.from({ length: 8 }, (_, i) => workerStore(i === 2 ? 1 : 0));
    const { sleep } = instant();
    const counts = await Promise.all(workers.map((w) => w.loop.runBoot({ sleep })));
    expect(new Set(counts.map((c) => c.count))).toEqual(new Set([FULL_CORPUS]));
  });

  it('stops after 4 attempts and returns the failure, so the equality gate still decides', async () => {
    const w = workerStore(99);
    const { waits, sleep } = instant();
    await expect(w.loop.runBoot({ sleep, random: () => 0.5 })).resolves.toEqual({
      ok: false,
      count: 0,
    });
    expect(w.load).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([1_000, 2_000, 4_000]);
  });

  it('rethrows when the final attempt throws', async () => {
    const w = workerStore(99, 'throw');
    const { sleep } = instant();
    await expect(w.loop.runBoot({ sleep })).rejects.toThrow('supabase_timeout');
    expect(w.load).toHaveBeenCalledTimes(4);
  });

  it('keeps the added boot wait well under the release proof budget', () => {
    expect(BOOT_RETRY_DELAYS_MS).toHaveLength(3);
    const worstCaseWaitMs = BOOT_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0) * 1.25;
    expect(worstCaseWaitMs).toBeLessThanOrEqual(10_000);
  });

  it('jitters each wait within +/-25%', async () => {
    const lo = instant();
    await workerStore(3).loop.runBoot({ sleep: lo.sleep, random: () => 0 });
    expect(lo.waits).toEqual([750, 1_500, 3_000]);
    const hi = instant();
    await workerStore(3).loop.runBoot({ sleep: hi.sleep, random: () => 1 });
    expect(hi.waits).toEqual([1_250, 2_500, 5_000]);
  });
});
