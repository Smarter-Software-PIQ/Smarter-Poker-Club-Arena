/**
 * V54 RIVER BLUFF (2026-10-24): a river big bet or shove bluff, ONLY WHEN IT
 * MAKES SENSE.
 *
 * Dan, 2026-10-24 16:21 Chicago: "a player just said to me, i've never once
 * seen a player bluff on the river, the bluff shove or big bet bluff needed
 * to be implemented ONLY WHEN IT MAKES SENSE."
 *
 * Split cleanly across three Vitest shards (zero dropped assertions):
 *  - HorseV54RiverBluff.test.ts (this file): eligibility fires, calling
 *    station, sizing, frequency, determinism, wiring, boundary refusals, and
 *    PLO5/PLO6 candidate paths.
 *  - HorseV54RiverBluffDeclinedSpots.test.ts: all 10 declined spots.
 *  - HorseV54RiverBluffGoldenBaseline.test.ts: default-off golden parity and
 *    golden sensitivity.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  HorseLogic,
  v54BluffProbability,
  v54BluffShare,
  V54_PROFILE_FACTOR,
} from './HorseLogic.js';
import {
  estimateRiverRangeComposition,
  restoreFastRandom,
  saveFastRandom,
  seedFastRandom,
  variantInfo,
} from './HorseEval.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import { HORSE_DATA_LEDGER } from './HorseDataLedger.js';
import { LEAGUE_MATCHUPS } from '../benchmark/HorseLeague.js';
import {
  NLH_AIR_BLOCKER,
  NLH_AIR_BUBBLE,
  NLH_AIR_SHALLOW,
  PLO4_NUT_BLOCKER_AIR,
  V54_ON,
  V54_POT,
  V54_SEEDS,
  V54_SUITE_TIMEOUT_MS,
  c,
  decideSpot,
  spotState,
  v54Fires,
  v54Folder,
  v54Stable,
  v54Station,
  v54Unknown,
  type V54Spot,
} from './HorseV54RiverBluff.test-support.js';

enableBrainTelemetry();
afterEach(() => {
  HorseMind.reset();
  drainFires();
});

describe('V54 fires only when it makes sense', () => {
  it(
    'fires in a capped heads-up river spot with a blocker against a folding opponent',
    () => {
      v54Folder();
      drainFires();
      const bets = V54_SEEDS.map((s) => decideSpot(NLH_AIR_BLOCKER, s, V54_ON)).filter(
        (d) => d.action === 'bet' || d.action === 'all_in'
      );
      const f = v54Fires();
      expect(bets.length).toBeGreaterThan(V54_SEEDS.length * 0.25);
      expect(f.v54_river_bluff).toBe(bets.length);
      // every non-bluff in the owned spot is a check, counted as frequency
      expect(f.v54_river_bluff_skip_frequency).toBe(V54_SEEDS.length - bets.length);
    },
    V54_SUITE_TIMEOUT_MS
  );

  it(
    'fires in PLO4 when hero holds the nut-flush blocker after one called barrel',
    () => {
      v54Folder();
      drainFires();
      const bets = V54_SEEDS.map((s) => decideSpot(PLO4_NUT_BLOCKER_AIR, s, V54_ON)).filter(
        (d) => d.action === 'bet' || d.action === 'all_in'
      );
      expect(bets.length).toBeGreaterThan(V54_SEEDS.length * 0.25);
      expect(v54Fires().v54_river_bluff).toBe(bets.length);
    },
    V54_SUITE_TIMEOUT_MS
  );

  it(
    'never bluffs a calling station: it checks every time',
    () => {
      for (const spot of [NLH_AIR_BLOCKER, NLH_AIR_SHALLOW, PLO4_NUT_BLOCKER_AIR]) {
        v54Station();
        drainFires();
        for (const s of V54_SEEDS) expect(decideSpot(spot, s, V54_ON).action).toBe('check');
        const f = v54Fires();
        expect(f.v54_river_bluff ?? 0).toBe(0);
        expect(f.v54_river_bluff_skip_station).toBe(V54_SEEDS.length);
      }
    },
    V54_SUITE_TIMEOUT_MS
  );
});

describe('V54 sizing', () => {
  it(
    'Hold’em deep: a big bet between three quarters and one and a half pots',
    () => {
      v54Folder();
      const sizes = V54_SEEDS.map((s) => decideSpot(NLH_AIR_BLOCKER, s, V54_ON))
        .filter((d) => d.action === 'bet')
        .map((d) => d.amount! / V54_POT);
      expect(sizes.length).toBeGreaterThan(0);
      for (const f of sizes) {
        expect(f).toBeGreaterThanOrEqual(0.74);
        expect(f).toBeLessThanOrEqual(1.5);
      }
    },
    V54_SUITE_TIMEOUT_MS
  );

  it(
    'Hold’em shallow (50 behind into 68): the bluff is the shove',
    () => {
      v54Folder();
      const acts = new Set(
        V54_SEEDS.map((s) => decideSpot(NLH_AIR_SHALLOW, s, V54_ON).action).filter(
          (a) => a !== 'check'
        )
      );
      expect([...acts]).toEqual(['all_in']);
    },
    V54_SUITE_TIMEOUT_MS
  );

  it(
    'pot limit: the pot, never more',
    () => {
      v54Folder();
      const bets = V54_SEEDS.map((s) => decideSpot(PLO4_NUT_BLOCKER_AIR, s, V54_ON)).filter(
        (d) => d.action === 'bet'
      );
      expect(bets.length).toBeGreaterThan(0);
      for (const d of bets) expect(d.amount).toBe(V54_POT);
    },
    V54_SUITE_TIMEOUT_MS
  );
});

describe('V54 frequency', () => {
  it('the reference bluff share is s/(1+2s), and the cap keeps bluffs inside it', () => {
    expect(v54BluffShare(1)).toBeCloseTo(1 / 3, 12);
    expect(v54BluffShare(0.75)).toBeCloseTo(0.3, 12);
    expect(v54BluffShare(1.5)).toBeCloseTo(0.375, 12);
    for (const s of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
      for (const value of [0.05, 0.2, 0.4, 0.6]) {
        for (const air of [0.02, 0.1, 0.3, 0.6]) {
          const p = v54BluffProbability(s, value, air);
          expect(p).toBeGreaterThanOrEqual(0);
          // never more often than with as much air as value
          expect(p).toBeLessThanOrEqual(s / (1 + s) + 1e-12);
          // bluffs / (bluffs + value) never exceeds the reference share
          const bluffs = p * air;
          expect(bluffs / (bluffs + value)).toBeLessThanOrEqual(v54BluffShare(s) + 1e-12);
        }
      }
    }
    expect(v54BluffProbability(1, 0, 0.5)).toBe(0);
  });

  it(
    'does not bluff every eligible spot, and stays under the cap by opponent read',
    () => {
      const seeds = Array.from({ length: 400 }, (_, i) => 101 + i * 104729);
      for (const [read, factor] of [
        [v54Folder, V54_PROFILE_FACTOR.folder],
        [v54Unknown, V54_PROFILE_FACTOR.unknown],
      ] as const) {
        read();
        const fired = seeds.filter((s) => decideSpot(NLH_AIR_BLOCKER, s, V54_ON).action === 'bet');
        const rate = fired.length / seeds.length;
        // The biggest size V54 takes is 1.5 pot, where s/(1+s) = 0.6, so no
        // read can push an air combo past 0.6 x its read factor.
        const cap = 0.6 * factor;
        const se = Math.sqrt((cap * (1 - cap)) / seeds.length);
        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThan(1);
        expect(rate).toBeLessThanOrEqual(cap + 3 * se);
      }
    },
    V54_SUITE_TIMEOUT_MS
  );
});

describe('V54 determinism', () => {
  it(
    'the same seed gives the same decision',
    () => {
      v54Folder();
      for (const spot of [NLH_AIR_BLOCKER, NLH_AIR_SHALLOW, PLO4_NUT_BLOCKER_AIR]) {
        for (const s of V54_SEEDS.slice(0, 30)) {
          expect(v54Stable(decideSpot(spot, s, V54_ON))).toBe(
            v54Stable(decideSpot(spot, s, V54_ON))
          );
        }
      }
    },
    V54_SUITE_TIMEOUT_MS
  );

  it('the range-composition read is reproducible and consumes no decision RNG', () => {
    const board = [
      c('9', 'hearts'),
      c('8', 'spades'),
      c('5', 'diamonds'),
      c('K', 'clubs'),
      c('2', 'hearts'),
    ];
    for (const variant of ['nlh', 'plo4', 'plo6']) {
      seedFastRandom(424242);
      const before = saveFastRandom();
      const a = estimateRiverRangeComposition(board, [0.55, 1], [0.3, 0.9], variantInfo(variant));
      expect(saveFastRandom()).toBe(before);
      const b = estimateRiverRangeComposition(board, [0.55, 1], [0.3, 0.9], variantInfo(variant));
      expect(a).not.toBeNull();
      expect(b).toEqual(a);
      expect(a!.valueShare + a!.airShare).toBeLessThanOrEqual(1);
      restoreFastRandom(before);
    }
    // not a river, or a game it does not model: no read
    expect(
      estimateRiverRangeComposition(board.slice(0, 4), [0.5, 1], [0.3, 0.9], variantInfo('nlh'))
    ).toBeNull();
    expect(
      estimateRiverRangeComposition(board, [0.5, 1], [0.3, 0.9], variantInfo('plo8'))
    ).toBeNull();
  });
});

describe('V54 wiring', () => {
  it('is registered in the data ledger as a flag, a receipt and a skip family', () => {
    const keys = new Map(HORSE_DATA_LEDGER.map((e) => [`${e.kind}:${e.key}`, e]));
    expect(keys.get('flag:v54RiverBluff')).toBeDefined();
    expect(keys.get('receipt:v54_river_bluff')).toBeDefined();
    expect(keys.get('receipt:v54_river_bluff_skip_*')).toBeDefined();
  });

  it('has nlh/plo4/plo5/plo6 league cards with the flag ON in arm A, and is off in the legacy arm', () => {
    for (const [name, variant] of [
      ['v54_river_bluff', undefined],
      ['plo4_v54_river_bluff', 'plo4'],
      ['plo5_v54_river_bluff', 'plo5'],
      ['plo6_v54_river_bluff', 'plo6'],
    ] as const) {
      const card = LEAGUE_MATCHUPS.find((m) => m.name === name);
      expect(card, name).toBeDefined();
      expect(card!.variant).toBe(variant);
      expect(card!.pairs).toBe(6000);
      expect(card!.a).toEqual({ v54RiverBluff: true });
      expect(card!.b).toEqual({});
    }
    const legacy = LEAGUE_MATCHUPS.find((x) => x.name === 'full_vs_v2_legacy')!.b as Record<
      string,
      unknown
    >;
    expect(legacy.v54RiverBluff).toBe(false);
  });
});

// Recovery hardening: an unavailable sampled domain or prize context cannot
// silently receive the fallback bluff prior.
describe('V54 recovered boundary refusals', () => {
  it('does not estimate hi-lo or invalid probability bars', () => {
    const board = NLH_AIR_BLOCKER.board;
    expect(
      estimateRiverRangeComposition(board, [0.5, 1], [0.3, 0.9], variantInfo('plo8'))
    ).toBeNull();
    for (const [value, air] of [
      [NaN, 0.2],
      [0.6, Infinity],
      [0.2, 0.6],
      [-1, -2],
      [1.1, 0.2],
    ])
      expect(
        estimateRiverRangeComposition(board, [0.5, 1], [0.3, 0.9], variantInfo('nlh'), value, air)
      ).toBeNull();
  });
  it('names missing tournament economics and leaves the pre-existing decision intact', () => {
    v54Folder();
    const { hero, gs } = spotState(NLH_AIR_BUBBLE);
    for (const seed of V54_SEEDS.slice(0, 40)) {
      seedFastRandom(seed);
      const on = HorseLogic.decide(
        hero,
        gs,
        'balanced',
        {},
        { ...V54_ON, observeMind: false, decisionTimeMs: 1770000000000 }
      );
      seedFastRandom(seed);
      const off = HorseLogic.decide(
        hero,
        gs,
        'balanced',
        {},
        { telemetry: true, observeMind: false, decisionTimeMs: 1770000000000 }
      );
      expect(v54Stable(on)).toBe(v54Stable(off));
    }
    const f = v54Fires();
    expect(f.v54_river_bluff ?? 0).toBe(0);
    expect(f.v54_river_bluff_skip_tournament_context).toBe(40);
  });
});

describe('V54 larger Omaha holdings reach the actual candidate', () => {
  it.each(['plo5', 'plo6'] as const)(
    '%s uses its own legal physical holding and pot-limit bet',
    (variant) => {
      const spot: V54Spot = {
        ...PLO4_NUT_BLOCKER_AIR,
        variant,
        name: variant + '_nut_blocker_air',
        hole: [
          ...PLO4_NUT_BLOCKER_AIR.hole,
          c('5', 'hearts'),
          ...(variant === 'plo6' ? [c('7', 'clubs')] : []),
        ],
      };
      v54Folder();
      drainFires();
      const bets = V54_SEEDS.map((seed) => decideSpot(spot, seed, V54_ON)).filter(
        (d) => d.action === 'bet'
      );
      const f = v54Fires();
      expect(f.v54_river_bluff ?? 0).toBeGreaterThan(0);
      expect(f.v54_river_bluff).toBe(bets.length);
      for (const d of bets) expect(d.amount).toBe(V54_POT);
    },
    V54_SUITE_TIMEOUT_MS
  );
});
