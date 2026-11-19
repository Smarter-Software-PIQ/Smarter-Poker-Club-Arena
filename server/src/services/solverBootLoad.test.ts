import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadSolverStoreForBoot } from './solverBootLoad.js';

const noWait = () => Promise.resolve();

describe('a solver store is loaded completely before a worker says ready', () => {
  it('retries a timed-out first load instead of reporting an empty store', async () => {
    const attempt = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, count: 0 })
      .mockResolvedValueOnce({ ok: true, count: 7747 });
    await expect(loadSolverStoreForBoot('gto_postflop', attempt, 3, 1, noWait)).resolves.toBe(7747);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('treats a thrown attempt as incomplete and retries it', async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new Error('supabase_timeout'))
      .mockResolvedValueOnce({ ok: true, count: 240 });
    await expect(loadSolverStoreForBoot('gto_charts', attempt, 3, 1, noWait)).resolves.toBe(240);
  });

  it('refuses with a named error, never 0 cells, when no attempt completes', async () => {
    const attempt = vi.fn().mockResolvedValue({ ok: false, count: 0 });
    await expect(loadSolverStoreForBoot('gto_postflop', attempt, 3, 1, noWait)).rejects.toThrow(
      'gto_postflop_boot_load_incomplete_after_3_attempts'
    );
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('is the first load every live decision worker uses for both solver stores', () => {
    const source = readFileSync(
      new URL('../engine/horseDecision/workerRuntime.ts', import.meta.url),
      'utf8'
    );
    expect(source).toContain("step('gto_charts', () => loadGtoChartsForBoot())");
    expect(source).toContain("step('gto_postflop', () => loadGtoPostflopForBoot())");
  });
});
