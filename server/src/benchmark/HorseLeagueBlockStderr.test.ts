/**
 * THE BLOCK STANDARD ERROR RIDES BESIDE THE PER-PAIR ONE (2026-11-13,
 * heads-up lane, HU-EVAL-006).
 *
 * `stderr` is the sample standard deviation of the per-pair differences over
 * sqrt(pairs): it treats pairs as independent while each arm's memory
 * persists across the matchup. The pooled league verdict, the daily audit
 * and the self-tuner all read that column, so its meaning is left alone. A
 * second figure, from contiguous blocks of pairs, is computed beside it and
 * stored in candidate_benchmark_components, a column no consumer of a
 * nightly card reads.
 *
 * Pins: the arithmetic; that correlated pairs widen it and independent pairs
 * do not; that a run reports it without moving bb100 or stderr; that the
 * worker boundary accepts it and refuses a malformed one; and what the
 * nightly row stores.
 */
import { describe, expect, it } from 'vitest';
import {
  LEAGUE_BLOCK_STDERR_SCENARIO,
  LEAGUE_STDERR_BLOCK_MIN_PAIRS,
  LEAGUE_STDERR_BLOCK_TARGET,
  blockStandardError,
  leagueStoredComponents,
  runMatchup,
  type LeagueResult,
} from './HorseLeague.js';
import { horseLeagueComputeResponseIsValid } from './HorseLeagueComputeWorkerClient.js';
import { HUMAN_FIELD_COMPONENT_SCENARIOS } from './HorseLeagueHumanField.js';
import { HUMAN_CALIBRATED_POPULATION_ID } from './HumanCalibratedPopulation.js';

/** Deterministic uniform draws in [0, 1). */
const lcg = (seed: number) => {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
};
const perPairStderr = (xs: readonly number[]) => {
  const m = xs.reduce((a, x) => a + x, 0) / xs.length;
  const v = xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v / xs.length);
};
const wrap = (result: unknown) => ({ type: 'MATCHUP_RESULT', jobId: 1, result });

describe('blockStandardError', () => {
  it('is the standard deviation of the block means over sqrt(blocks)', () => {
    // 50 values, 2 blocks of 25: block means 1 and 3.
    const values = [...Array(25).fill(1), ...Array(25).fill(3)];
    const r = blockStandardError(values)!;
    expect(r.blocks).toBe(2);
    expect(r.pairsPerBlock).toBe(25);
    // sd of {1, 3} is sqrt(2); over sqrt(2 blocks) is 1.
    expect(r.stderr).toBeCloseTo(1, 12);
  });

  it('uses up to the target number of blocks and never a block under the minimum', () => {
    expect(blockStandardError(Array(49).fill(0))).toBeNull();
    expect(blockStandardError([])).toBeNull();
    expect(blockStandardError(Array(60).fill(0))!.blocks).toBe(2);
    expect(blockStandardError(Array(400).fill(0))!.blocks).toBe(16);
    const long = blockStandardError(Array(12_000).fill(0))!;
    expect(long.blocks).toBe(LEAGUE_STDERR_BLOCK_TARGET);
    expect(long.pairsPerBlock).toBe(300);
    expect(long.pairsPerBlock).toBeGreaterThanOrEqual(LEAGUE_STDERR_BLOCK_MIN_PAIRS);
    expect(long.stderr).toBe(0);
  });

  it('agrees with the per-pair figure when pairs are independent', () => {
    const rand = lcg(20261113);
    const xs = Array.from({ length: 12_000 }, () => rand() - 0.5);
    const ratio = blockStandardError(xs)!.stderr / perPairStderr(xs);
    expect(ratio).toBeGreaterThan(0.7);
    expect(ratio).toBeLessThan(1.3);
  });

  it('is wider than the per-pair figure when neighbouring pairs move together', () => {
    // Each run of 100 pairs shares one draw: the per-pair figure counts 12,000
    // independent samples where there are 120.
    const rand = lcg(20261113);
    const xs: number[] = [];
    for (let g = 0; g < 120; g++) {
      const shared = rand() - 0.5;
      for (let k = 0; k < 100; k++) xs.push(shared + (rand() - 0.5) * 0.1);
    }
    const ratio = blockStandardError(xs)!.stderr / perPairStderr(xs);
    expect(ratio).toBeGreaterThan(5);
  });
});

describe('a matchup reports the block standard error beside the per-pair one', () => {
  it('a mirror run carries it, in bb/100, and bb100 and stderr are the per-pair ones', async () => {
    const r = await runMatchup({ name: 'v11', a: {}, b: { v11: false } }, 60, 20260921);
    expect(r.hands).toBe(120);
    expect(r.stderrBlocks).toBe(2);
    expect(r.blockStderr).toBeGreaterThan(0);
    expect(Number.isFinite(r.blockStderr)).toBe(true);
    // The pre-existing fields are not derived from it: an identical run cut
    // short of two blocks reports the same hands' worth without the keys.
    const short = await runMatchup({ name: 'v11', a: {}, b: { v11: false } }, 40, 20260921);
    expect('blockStderr' in short).toBe(false);
    expect('stderrBlocks' in short).toBe(false);
    expect(r.benchmarkComponents).toEqual([]);
    expect(horseLeagueComputeResponseIsValid(wrap(r))).toBe(true);
    expect(horseLeagueComputeResponseIsValid(wrap(short))).toBe(true);
  }, 300_000);

  it('a human-field run carries it and still exactly its two per-arm components', async () => {
    const r = await runMatchup(
      {
        name: 'human_probe',
        a: {},
        b: { mind: false },
        opponentPopulation: HUMAN_CALIBRATED_POPULATION_ID,
      },
      60,
      20261024
    );
    expect(r.stderrBlocks).toBe(2);
    expect(r.blockStderr).toBeGreaterThanOrEqual(0);
    expect(r.benchmarkComponents.map((c) => c.scenario)).toEqual([
      ...HUMAN_FIELD_COMPONENT_SCENARIOS,
    ]);
    expect(horseLeagueComputeResponseIsValid(wrap(r))).toBe(true);
  }, 300_000);

  it('the worker boundary refuses a malformed block standard error', async () => {
    const r = await runMatchup({ name: 'v11', a: {}, b: { v11: false } }, 60, 20260921);
    expect(horseLeagueComputeResponseIsValid(wrap(r))).toBe(true);
    const { blockStderr: _b, ...noStderr } = r;
    const { stderrBlocks: _n, ...noBlocks } = r;
    expect(horseLeagueComputeResponseIsValid(wrap(noStderr))).toBe(false);
    expect(horseLeagueComputeResponseIsValid(wrap(noBlocks))).toBe(false);
    expect(horseLeagueComputeResponseIsValid(wrap({ ...r, blockStderr: -1 }))).toBe(false);
    expect(horseLeagueComputeResponseIsValid(wrap({ ...r, blockStderr: Number.NaN }))).toBe(false);
    expect(horseLeagueComputeResponseIsValid(wrap({ ...r, blockStderr: '1' }))).toBe(false);
    expect(horseLeagueComputeResponseIsValid(wrap({ ...r, stderrBlocks: 1 }))).toBe(false);
    expect(horseLeagueComputeResponseIsValid(wrap({ ...r, stderrBlocks: 2.5 }))).toBe(false);
    expect(horseLeagueComputeResponseIsValid(wrap({ ...r, stderrBlocks: r.hands }))).toBe(false);
    const { blockStderr: _b2, stderrBlocks: _n2, ...neither } = r;
    expect(horseLeagueComputeResponseIsValid(wrap(neither))).toBe(true);
  }, 300_000);
});

describe('what the nightly row stores', () => {
  const base: LeagueResult = {
    matchup: 'x',
    hands: 24_000,
    bb100: 1.25,
    stderr: 0.5,
    durationMs: 1,
    illegalActions: 0,
    truncatedStreets: 0,
    candidatePolicyHits: 0,
    candidateExecutionMismatches: 0,
    candidateNodeRoles: [],
    benchmarkComponents: [],
  };

  it('a result without the block figure stores its components unchanged', () => {
    expect(leagueStoredComponents(base)).toBe(base.benchmarkComponents);
  });

  it('a result with it stores its own components first, then the block entry', () => {
    const component = { ...base, scenario: 'arm', hands: 12_000 };
    const { matchup: _m, benchmarkComponents: _c, ...asComponent } = component;
    const r: LeagueResult = {
      ...base,
      benchmarkComponents: [asComponent],
      blockStderr: 0.61,
      stderrBlocks: 40,
    };
    expect(leagueStoredComponents(r)).toEqual([
      asComponent,
      {
        scenario: LEAGUE_BLOCK_STDERR_SCENARIO,
        hands: 24_000,
        bb100: 1.25,
        stderr: 0.61,
        blocks: 40,
        perPairStderr: 0.5,
      },
    ]);
    // The result the worker sent is not rewritten: stderr keeps its meaning.
    expect(r.stderr).toBe(0.5);
    expect(r.benchmarkComponents).toEqual([asComponent]);
  });
});
