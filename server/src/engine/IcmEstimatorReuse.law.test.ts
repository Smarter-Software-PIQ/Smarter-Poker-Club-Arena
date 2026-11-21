/**
 * THE ICM CLOCK POPULATION IS REUSED ACROSS DECISIONS, AND REUSE CHANGES NO VALUE (TASK #8, 2026-11-20).
 *
 * createIcmEquityEstimator's Monte Carlo path (more than ten live players, a multi-place curve) is now shared
 * between decisions whose every construction input is identical (IcmModel.sharedMonteCarloEquityEstimator).
 * This law holds that a shared estimator returns exactly, bit for bit, what a freshly built one returns, for
 * every vector and trial prefix, and that any input that enters construction makes a new one.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildMonteCarloEquityEstimatorUncachedForTest,
  createIcmEquityEstimator,
  icmEstimatorCacheStats,
  ICM_MC_ESTIMATOR_CACHE_MAX,
  resetIcmEstimatorCacheForTest,
} from './IcmModel.js';

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function field(players: number, seed: number): number[] {
  const r = lcg(seed);
  return Array.from({ length: players }, (_, i) =>
    i % 37 === 5 ? 0 : Math.round(500 + r() * 40_000) / 4
  );
}

const payouts = [25, 15, 10, 8, 6, 5, 4, 3.5, 3, 2.5, 2, 2, 1.5, 1.5, 1.2, 1.2, 1, 1, 1, 1];
const local = [3, 4, 5, 6, 7, 8];

function vectors(base: number[], seed: number): number[][] {
  const r = lcg(seed);
  return Array.from({ length: 12 }, () => {
    const v = [...base];
    for (const i of local)
      v[i] = Math.max(0, Math.round((base[i] + (r() - 0.5) * 3000) * 100) / 100);
    return v;
  });
}

beforeEach(() => resetIcmEstimatorCacheForTest());

describe('the shared Monte Carlo ICM estimator', () => {
  it('returns bit-identical estimates to a fresh build, for every vector and trial prefix', () => {
    for (const [players, seed] of [
      [40, 1],
      [180, 2],
      [650, 3],
    ] as const) {
      const base = field(players, seed);
      const hero = local[1];
      const fresh = buildMonteCarloEquityEstimatorUncachedForTest(base, payouts, hero, local);
      const first = createIcmEquityEstimator(base, payouts, hero, local);
      const again = createIcmEquityEstimator([...base], [...payouts], hero, [...local]);
      expect(again).toBe(first);
      expect(first.method).toBe('plackett_luce_mc');
      for (const v of vectors(base, seed + 10)) {
        for (const prefix of [undefined, 96, 400]) {
          const want = fresh.estimate(v, prefix);
          expect(first.estimate(v, prefix)).toEqual(want);
          expect(Object.is(again.estimate(v, prefix).equity, want.equity)).toBe(true);
        }
      }
      expect(first.trials).toBe(fresh.trials);
      expect(first.randomClockDraws).toBe(fresh.randomClockDraws);
    }
  });

  it('a different hero, payout curve, trial cap, remote stack or live count builds a new estimator', () => {
    const base = field(200, 7);
    const a = createIcmEquityEstimator(base, payouts, 4, local);
    expect(createIcmEquityEstimator(base, payouts, 5, local)).not.toBe(a);
    expect(createIcmEquityEstimator(base, payouts.slice(0, 18), 4, local)).not.toBe(a);
    expect(createIcmEquityEstimator(base, payouts, 4, local, 300)).not.toBe(a);
    const remote = [...base];
    remote[100] += 1;
    expect(createIcmEquityEstimator(remote, payouts, 4, local)).not.toBe(a);
    const busted = [...base];
    busted[6] = 0; // a table-local bust changes the live count, hence the trial count
    expect(createIcmEquityEstimator(busted, payouts, 4, local)).not.toBe(a);
    expect(createIcmEquityEstimator(base, payouts, 4, [...local, 9])).not.toBe(a);
  });

  it('a table-local stack change alone reuses the estimator, with values equal to a fresh build', () => {
    const base = field(300, 11);
    const a = createIcmEquityEstimator(base, payouts, 4, local);
    const moved = [...base];
    moved[3] += 250;
    moved[4] -= 250;
    const b = createIcmEquityEstimator(moved, payouts, 4, local);
    expect(b).toBe(a);
    const fresh = buildMonteCarloEquityEstimatorUncachedForTest(moved, payouts, 4, local);
    for (const v of vectors(moved, 12)) expect(b.estimate(v)).toEqual(fresh.estimate(v));
  });

  it('stays bounded and never shares an exact or winner-take-all estimator', () => {
    for (let i = 0; i < ICM_MC_ESTIMATOR_CACHE_MAX + 5; i++)
      createIcmEquityEstimator(field(120, 100 + i), payouts, 4, local);
    expect(icmEstimatorCacheStats().size).toBe(ICM_MC_ESTIMATOR_CACHE_MAX);
    resetIcmEstimatorCacheForTest();
    const small = [1000, 2000, 3000, 4000, 5000, 6000];
    const e1 = createIcmEquityEstimator(small, [50, 30, 20], 2);
    expect(e1.method).toBe('exact_mh');
    expect(createIcmEquityEstimator(small, [50, 30, 20], 2)).not.toBe(e1);
    const wta = createIcmEquityEstimator(field(300, 9), [100], 4, local);
    expect(wta.method).toBe('exact_mh');
    expect(icmEstimatorCacheStats().builds).toBe(0);
  });
});
