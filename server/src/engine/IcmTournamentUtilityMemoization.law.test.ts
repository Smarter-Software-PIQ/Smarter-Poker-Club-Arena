/**
 * TOURNAMENT UTILITY & ICM CACHES ARE BIT-IDENTICAL AND STRICTLY BOUNDED (Horse SWITCH Enhancement #1, 2026-11-22).
 *
 * Production 2026-11-21 5-6 PM CT showed `phase15_node_tournament_utility` still averaging 12.79 ms across
 * shared workers (pushing sibling PLO5 tables >100 ms), driven by:
 *   1. `responseFoldProbability` calling `pairwiseBubbleFactor` (3x exact 2^n Malmuth-Harville DP) inside
 *      `settleSample` for every (candidate x sample x covered opponent) at <=10-player late-stage tables;
 *   2. Recursive exact Malmuth-Harville DP without cross-decision memoization;
 *   3. `ICM_MC_ESTIMATOR_CACHE_MAX = 8` thrashing across 2+ concurrent 8-seat tables on one worker, plus
 *      untruncated remote clock arrays and unmemoized Monte Carlo `estimate()` calls;
 *   4. Per-sample `calculatePots` / `calculateContestablePot` / full-field `vectorKey` allocations.
 *
 * This law proves that every cache and fast path is 100% bit-identical to uncached / reference math,
 * preserves `withIcmBustPaysPlace` telemetry, stays strictly bounded in both entry count and memory,
 * and never suffers stale cross-tournament pollution.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as IcmModel from './IcmModel.js';
import {
  buildMonteCarloEquityEstimatorUncachedForTest,
  createIcmEquityEstimator,
  exactIcmEquity,
  exactIcmEquityUncachedForTest,
  ICM_EXACT_EQUITY_CACHE_MAX,
  ICM_MC_ESTIMATOR_CACHE_MAX,
  ICM_MC_ESTIMATOR_CACHE_MAX_BYTES,
  icmEstimatorCacheStats,
  icmExactCacheStats,
  resetIcmEstimatorCacheForTest,
  resetIcmExactCacheForTest,
  withIcmBustPaysPlace,
} from './IcmModel.js';
import {
  evaluateTournamentUtilityDetailed,
  tournamentSampleEquity,
  type TournamentUtilityContext,
  type TournamentUtilityInput,
  type TournamentUtilityShowdownSample,
} from './HorseTournamentUtility.js';
import { calculatePots } from './PokerEngine.js';
import type { SeatPlayer } from '../types.js';

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/** Independent recursive finishing-order reference (no bitmask DP, no cache). */
function referenceExactIcm(stacks: number[], payouts: number[], heroIdx: number): number {
  const clean = stacks.map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const prizes = payouts.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  if (
    clean.length === 0 ||
    heroIdx < 0 ||
    heroIdx >= clean.length ||
    clean[heroIdx] <= 0 ||
    prizes.reduce((a, b) => a + b, 0) <= 0
  ) {
    return 0;
  }
  if (prizes[0] > 0 && prizes.slice(1).every((p) => p === 0)) {
    return (clean[heroIdx] / clean.reduce((a, b) => a + b, 0)) * prizes[0];
  }
  const live = clean.map((stack, index) => ({ stack, index })).filter((entry) => entry.stack > 0);
  if (live.length > 10) return 0;
  function step(rem: typeof live, place: number): number {
    if (place >= prizes.length) return 0;
    let total = 0;
    for (const entry of rem) total += entry.stack;
    let equity = 0;
    for (const entry of rem) {
      const prob = entry.stack / total;
      equity +=
        entry.index === heroIdx
          ? prob * prizes[place]
          : prob *
            step(
              rem.filter((other) => other !== entry),
              place + 1
            );
    }
    return equity;
  }
  return step(live, 0);
}

function makeUtilityScenario(opts: {
  fieldPlayers: number;
  tableSeats: number;
  heroRank: 'leader' | 'mid' | 'short';
  payouts: number[];
  samples: number;
  seed: number;
  satellite?: boolean;
  satelliteSeats?: number;
  isPko?: boolean;
  isMysteryBounty?: boolean;
  mysteryStage?: 'none' | 'pending' | 'active';
  hiLo?: boolean;
  boards?: number;
  stackScaledMargin?: boolean;
  format?: 'mtt' | 'sng' | 'spin' | 'hu_sng';
}): TournamentUtilityInput {
  const rand = lcg(opts.seed);
  const localStacks = Array.from({ length: opts.tableSeats }, (_, i) =>
    Math.round(6_000 + i * 3_500 + rand() * 1_500)
  ).sort((a, b) => a - b);
  const heroStackIdx =
    opts.heroRank === 'leader'
      ? opts.tableSeats - 1
      : opts.heroRank === 'mid'
        ? Math.floor(opts.tableSeats / 2)
        : 0;
  const heroTotal = localStacks.splice(heroStackIdx, 1)[0];
  const orderedLocal = [heroTotal, ...localStacks];

  const sb = 500;
  const bb = 1_000;
  const players: SeatPlayer[] = orderedLocal.map((total, idx) => {
    const invested =
      opts.tableSeats === 2
        ? idx === 0
          ? sb
          : bb
        : idx === 1
          ? sb
          : idx === 2
            ? bb
            : idx === 3
              ? bb * 2
              : 0;
    const stack = Math.max(0, total - invested);
    return {
      seat: idx + 1,
      user_id: `p${idx}`,
      username: `p${idx}`,
      stack,
      bet: invested,
      totalInvested: invested,
      cards: [],
      is_folded: false,
      is_all_in: stack <= 0,
      is_sitting_out: false,
    };
  });

  const hero = players[0];
  const pots = calculatePots(players);
  const pot = pots.reduce((s, p) => s + p.amount, 0);
  const currentBet = opts.tableSeats === 2 ? bb : bb * 2;
  const toCall = Math.min(Math.max(0, currentBet - hero.bet), hero.stack);

  const remoteCount = Math.max(0, opts.fieldPlayers - opts.tableSeats);
  const remoteStacks = Array.from({ length: remoteCount }, () =>
    Math.round(5_000 + rand() * 35_000)
  );
  const fieldStacks = [...remoteStacks, ...orderedLocal];
  const fieldStackByUser: Record<string, number> = {};
  for (let i = 0; i < players.length; i++) fieldStackByUser[players[i].user_id] = orderedLocal[i];

  const sampledOpponentIds = players.slice(1).map((p) => p.user_id);
  const opponents = sampledOpponentIds.map((userId, idx) => ({
    userId,
    range: [0.1, 0.85] as [number, number],
    foldMul: 1,
    actsAfterHero: idx >= Math.floor(sampledOpponentIds.length / 2),
  }));

  const boardCount = opts.boards ?? 1;
  const showdownSamples: TournamentUtilityShowdownSample[] = Array.from(
    { length: opts.samples },
    () => ({
      boards: Array.from({ length: boardCount }, () => ({
        heroHigh: Math.floor(rand() * 20),
        opponentHigh: sampledOpponentIds.map(() => Math.floor(rand() * 20)),
        opponentDecisionStrength: sampledOpponentIds.map(() => rand()),
        heroLow: opts.hiLo && rand() > 0.4 ? Math.floor(rand() * 10) : null,
        opponentLow: sampledOpponentIds.map(() =>
          opts.hiLo && rand() > 0.4 ? Math.floor(rand() * 10) : null
        ),
      })),
    })
  );

  const sampleEq = tournamentSampleEquity({ hero, sampledOpponentIds, showdownSamples });
  const isBounty = Boolean(opts.isPko || opts.isMysteryBounty);
  const context: TournamentUtilityContext = {
    format: opts.format ?? (opts.fieldPlayers <= 9 ? 'sng' : 'mtt'),
    playersLeft: opts.fieldPlayers,
    spotsPaid: opts.payouts.length,
    satellite: Boolean(opts.satellite),
    satelliteSeats: opts.satelliteSeats ?? 0,
    payoutPct: opts.payouts,
    fieldStacks,
    fieldStackByUser,
    isPko: Boolean(opts.isPko),
    isBounty,
    isMysteryBounty: Boolean(opts.isMysteryBounty),
    mysteryBountyStage: opts.mysteryStage ?? 'none',
    bountyFactor: isBounty ? 0.5 : 0,
    bountyByUser: Object.fromEntries(players.map((p) => [p.user_id, isBounty ? 500 : 0])),
    mysteryMeanCents: opts.isMysteryBounty ? 2_500 : 0,
    meanBountyCents: isBounty ? 500 : 0,
    prizePoolCents: 100_000,
    bountyPoolCents: isBounty ? 50_000 : 0,
    buyInCents: 1_000,
    startingStackChips: 10_000,
    rebuyOpen: false,
    reentryOpen: false,
    rebuyAffordable: false,
    reloadsUsed: 0,
    maxRebuys: 0,
    maxReentries: 0,
    rebuyChips: null,
    rebuyCostCents: null,
    rebuyPrizeContributionCents: null,
    rebuyBountyContributionCents: 0,
    addOnPeriodOpen: false,
    addOnTaken: false,
    addOnAffordable: false,
    addOnChips: null,
    addOnCostCents: null,
  };

  return {
    hero,
    players,
    pot,
    pots,
    currentBet,
    toCall,
    legalActions: ['fold', 'call', 'raise', 'all_in'],
    minRaiseTo: Math.min(hero.bet + hero.stack, currentBet + bb * 2),
    maxRaiseTo: hero.bet + hero.stack,
    bettingStructure: 'no_limit',
    street: 'preflop',
    baseline: { action: 'call', amount: toCall, thinkTime: 0 },
    heroEquity: sampleEq.equity,
    equitySampleSize: opts.samples,
    equityStandardError: sampleEq.standardError,
    opponents,
    sampledOpponentIds,
    showdownSamples,
    context,
    stackScaledMargin: opts.stackScaledMargin,
  };
}

const PAYOUTS_9 = [30, 20, 14, 10, 8, 6, 5, 4, 3];
const PAYOUTS_10 = [28, 18, 13, 9.5, 7.5, 6, 5, 4.5, 4.5, 4];
const PAYOUTS_27 = [
  20, 13, 9, 6.5, 5, 4, 3.2, 2.6, 2.2, 2, 1.8, 1.8, 1.6, 1.6, 1.5, 1.5, 1.4, 1.4, 1.3, 1.3, 1.2,
  1.2, 1.2, 1.1, 1.1, 1.1, 10.4,
];

beforeEach(() => {
  resetIcmEstimatorCacheForTest();
  resetIcmExactCacheForTest();
});

describe('exact Malmuth-Harville bottom-up DP and bounded LRU cache', () => {
  it('matches uncached DP and independent recursion bit-for-bit across sizes, edge cases and ties', () => {
    const payoutCurves = [
      [100],
      [65, 35],
      [50, 30, 20],
      [50, 0, 30, 0, 20],
      [20, 20, 20, 20, 20],
      PAYOUTS_9,
      PAYOUTS_10,
    ];
    const rand = lcg(20261122);

    for (const liveCount of [2, 3, 4, 6, 8, 9, 10]) {
      const base = Array.from({ length: liveCount }, () => Math.round(500 + rand() * 50_000));
      const tied = Array.from({ length: liveCount }, () => 10_000);
      const withZeros = [0, ...base, 0, Number.NaN, -50, Number.POSITIVE_INFINITY];
      for (const stacks of [base, tied, withZeros]) {
        for (const payouts of payoutCurves) {
          for (const heroIdx of [0, 1, Math.min(2, stacks.length - 1), stacks.length - 1]) {
            const cold = exactIcmEquity(stacks, payouts, heroIdx);
            const warm = exactIcmEquity(stacks, payouts, heroIdx);
            const uncached = exactIcmEquityUncachedForTest(stacks, payouts, heroIdx);
            expect(Object.is(cold, uncached)).toBe(true);
            expect(Object.is(warm, uncached)).toBe(true);
            if (liveCount <= 7) {
              expect(Object.is(cold, referenceExactIcm(stacks, payouts, heroIdx))).toBe(true);
            }
          }
        }
      }
    }
    expect(icmExactCacheStats().hits).toBeGreaterThan(0);
    expect(icmExactCacheStats().builds).toBeGreaterThan(0);
  });

  it('evicts cleanly at ICM_EXACT_EQUITY_CACHE_MAX and never pollutes across tournaments', () => {
    const payoutsA = [50, 30, 20];
    const payoutsB = [60, 25, 15];
    const stacks = [12_000, 8_000, 5_000, 3_000];
    const eqA = exactIcmEquity(stacks, payoutsA, 1);
    const eqB = exactIcmEquity(stacks, payoutsB, 1);
    expect(eqA).not.toBe(eqB);
    expect(Object.is(eqA, exactIcmEquityUncachedForTest(stacks, payoutsA, 1))).toBe(true);
    expect(Object.is(eqB, exactIcmEquityUncachedForTest(stacks, payoutsB, 1))).toBe(true);

    // Overflow the LRU strictly past capacity and assert exact ceiling.
    for (let i = 0; i < ICM_EXACT_EQUITY_CACHE_MAX + 128; i++) {
      exactIcmEquity([10_000 + i, 8_000, 5_000, 3_000], payoutsA, 0);
    }
    expect(icmExactCacheStats().size).toBe(ICM_EXACT_EQUITY_CACHE_MAX);
  });
});

describe('Monte Carlo flat layout, per-estimator memo, and multi-table byte-bounded LRU', () => {
  it('returns bit-identical estimates across cold/warm calls, trial prefixes, and caller mutations', () => {
    const rand = lcg(777);
    for (const players of [11, 18, 45, 180, 500]) {
      const stacks = Array.from({ length: players }, () => Math.round(2_000 + rand() * 40_000));
      const local = Array.from({ length: 8 }, (_, i) => players - 8 + i);
      const hero = local[2];
      const payouts = players < 27 ? PAYOUTS_9 : PAYOUTS_27;
      const fresh = buildMonteCarloEquityEstimatorUncachedForTest(stacks, payouts, hero, local);
      const shared = createIcmEquityEstimator(stacks, payouts, hero, local);
      expect(shared.trials).toBe(fresh.trials);
      expect(shared.randomClockDraws).toBe(fresh.randomClockDraws);

      for (let k = 0; k < 6; k++) {
        const v = stacks.slice();
        v[hero] = Math.max(0, v[hero] + (k % 2 === 0 ? 1500 * k : -1500 * k));
        v[local[0]] = Math.max(0, v[local[0]] - (k % 2 === 0 ? 1500 * k : -1500 * k));
        for (const prefix of [undefined, 96, 128, 400]) {
          const want = fresh.estimate(v, prefix);
          const gotCold = shared.estimate(v, prefix);
          expect(gotCold).toEqual(want);
          expect(Object.is(gotCold.equity, want.equity)).toBe(true);
          // Mutate returned estimate and verify memoized hit is isolated.
          gotCold.equity = -999;
          gotCold.errorBound = -999;
          const gotWarm = shared.estimate(v, prefix);
          expect(gotWarm).toEqual(want);
          expect(Object.is(gotWarm.equity, want.equity)).toBe(true);
        }
      }
    }
  });

  it('keeps 2 concurrent 8-seat MTT tables (16 seats) warm with zero thrashing and enforces byte cap', () => {
    const rand = lcg(999);
    const table1Field = Array.from({ length: 180 }, () => Math.round(5_000 + rand() * 30_000));
    const table2Field = Array.from({ length: 180 }, () => Math.round(5_000 + rand() * 30_000));
    const local = [172, 173, 174, 175, 176, 177, 178, 179];

    // Round 1: build all 16 seats across 2 tables.
    for (const field of [table1Field, table2Field]) {
      for (const seat of local) {
        createIcmEquityEstimator(field, PAYOUTS_27, seat, local);
      }
    }
    const afterRound1 = icmEstimatorCacheStats();
    expect(afterRound1.builds).toBe(16);
    expect(afterRound1.size).toBe(16);
    expect(afterRound1.bytes).toBeLessThanOrEqual(ICM_MC_ESTIMATOR_CACHE_MAX_BYTES);

    // Round 2: every seat acts again on the next street -> 100% cache hits, 0 rebuilds.
    for (const field of [table1Field, table2Field]) {
      for (const seat of local) {
        createIcmEquityEstimator(field, PAYOUTS_27, seat, local);
      }
    }
    const afterRound2 = icmEstimatorCacheStats();
    expect(afterRound2.hits - afterRound1.hits).toBe(16);
    expect(afterRound2.builds).toBe(16);

    // Stress the byte cap with wide 160-paid payout curves (each entry ~1.6 MB).
    resetIcmEstimatorCacheForTest();
    const widePayouts = Array.from({ length: 160 }, () => 100 / 160);
    for (let i = 0; i < ICM_MC_ESTIMATOR_CACHE_MAX; i++) {
      const wideField = Array.from({ length: 200 }, (_, idx) => 5_000 + idx * 10 + i);
      createIcmEquityEstimator(
        wideField,
        widePayouts,
        192,
        [192, 193, 194, 195, 196, 197, 198, 199]
      );
    }
    const wideStats = icmEstimatorCacheStats();
    expect(wideStats.size).toBeLessThanOrEqual(ICM_MC_ESTIMATOR_CACHE_MAX);
    expect(wideStats.bytes).toBeLessThanOrEqual(ICM_MC_ESTIMATOR_CACHE_MAX_BYTES);
  });
});

describe('HorseTournamentUtility action-scoped memoization and end-to-end equivalence', () => {
  it('memoizes pairwiseBubbleFactor per unique (opponent, facing) and preserves paid-bust telemetry', () => {
    const spy = vi.spyOn(IcmModel, 'pairwiseBubbleFactor');
    try {
      const ft9 = makeUtilityScenario({
        fieldPlayers: 9,
        tableSeats: 9,
        heroRank: 'leader',
        payouts: PAYOUTS_9,
        samples: 96,
        seed: 42,
      });

      let changedOnCold = false;
      const cold = withIcmBustPaysPlace(
        true,
        () => evaluateTournamentUtilityDetailed(ft9),
        () => {
          changedOnCold = true;
        }
      );
      const callsOnCold = spy.mock.calls.length;
      // 8 candidates x 8 covered opponents = at most 64 unique (opp, facing) pairs,
      // NOT 8 x 8 x 96 = 6,144 redundant calls!
      expect(cold.result).not.toBeNull();
      expect(callsOnCold).toBeGreaterThan(0);
      expect(callsOnCold).toBeLessThanOrEqual(64);

      spy.mockClear();
      let changedOnWarm = false;
      const warm = withIcmBustPaysPlace(
        true,
        () => evaluateTournamentUtilityDetailed(ft9),
        () => {
          changedOnWarm = true;
        }
      );
      expect(JSON.stringify(warm.result)).toBe(JSON.stringify(cold.result));
      expect(changedOnWarm).toBe(changedOnCold);
      expect(spy.mock.calls.length).toBe(callsOnCold);
    } finally {
      spy.mockRestore();
    }
  });

  it('produces identical cold/warm decisions across MTT, SNG, HU, Satellite, PKO, Mystery and Hi-Lo with zero cross-tournament pollution', () => {
    const scenarios: TournamentUtilityInput[] = [
      makeUtilityScenario({
        fieldPlayers: 10,
        tableSeats: 10,
        heroRank: 'leader',
        payouts: PAYOUTS_10,
        samples: 64,
        seed: 101,
      }),
      makeUtilityScenario({
        fieldPlayers: 9,
        tableSeats: 9,
        heroRank: 'mid',
        payouts: PAYOUTS_9,
        samples: 64,
        seed: 102,
      }),
      makeUtilityScenario({
        fieldPlayers: 9,
        tableSeats: 9,
        heroRank: 'leader',
        payouts: PAYOUTS_9,
        samples: 64,
        seed: 103,
        isPko: true,
      }),
      makeUtilityScenario({
        fieldPlayers: 9,
        tableSeats: 9,
        heroRank: 'leader',
        payouts: PAYOUTS_9,
        samples: 64,
        seed: 104,
        isMysteryBounty: true,
        mysteryStage: 'active',
      }),
      makeUtilityScenario({
        fieldPlayers: 8,
        tableSeats: 8,
        heroRank: 'leader',
        payouts: [20, 20, 20, 20, 20],
        samples: 64,
        seed: 105,
        satellite: true,
        satelliteSeats: 5,
      }),
      makeUtilityScenario({
        fieldPlayers: 6,
        tableSeats: 6,
        heroRank: 'leader',
        payouts: [50, 30, 20],
        samples: 48,
        seed: 106,
        hiLo: true,
        boards: 2,
      }),
      makeUtilityScenario({
        fieldPlayers: 4,
        tableSeats: 4,
        heroRank: 'short',
        payouts: [50, 30, 20],
        samples: 64,
        seed: 107,
        format: 'sng',
        stackScaledMargin: true,
      }),
      makeUtilityScenario({
        fieldPlayers: 2,
        tableSeats: 2,
        heroRank: 'leader',
        payouts: [100],
        samples: 64,
        seed: 108,
        format: 'hu_sng',
      }),
      makeUtilityScenario({
        fieldPlayers: 11,
        tableSeats: 8,
        heroRank: 'leader',
        payouts: PAYOUTS_9,
        samples: 64,
        seed: 109,
      }),
      makeUtilityScenario({
        fieldPlayers: 18,
        tableSeats: 8,
        heroRank: 'leader',
        payouts: PAYOUTS_9,
        samples: 64,
        seed: 110,
      }),
      makeUtilityScenario({
        fieldPlayers: 180,
        tableSeats: 8,
        heroRank: 'mid',
        payouts: PAYOUTS_27,
        samples: 64,
        seed: 111,
      }),
    ];

    // Cold pass (fresh caches before every single scenario).
    const coldSnapshots = scenarios.map((sc) => {
      resetIcmEstimatorCacheForTest();
      resetIcmExactCacheForTest();
      const res = evaluateTournamentUtilityDetailed(sc);
      expect(res.result).not.toBeNull();
      return JSON.stringify(res.result);
    });

    // Interleaved warm pass across ALL distinct tournaments sharing the process caches.
    resetIcmEstimatorCacheForTest();
    resetIcmExactCacheForTest();
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < scenarios.length; i++) {
        const res = evaluateTournamentUtilityDetailed(scenarios[i]);
        expect(JSON.stringify(res.result)).toBe(coldSnapshots[i]);
      }
    }
  });
});
