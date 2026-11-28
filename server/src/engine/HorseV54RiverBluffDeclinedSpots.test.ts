/**
 * V54 RIVER BLUFF — declined spots (split from HorseV54RiverBluff.test.ts for
 * balanced Vitest sharding; zero dropped assertions).
 *
 * Each declined spot leaves the decision to the layers below, exactly as with
 * the flag off, and names its skip receipt reason.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  NLH_AIR_BUBBLE,
  NLH_AIR_FACING_BET,
  NLH_AIR_MULTIWAY,
  NLH_AIR_NO_BLOCKER,
  NLH_AIR_OPP_ALL_IN,
  NLH_AIR_PASSIVE,
  NLH_MIDDLE_PAIR,
  PLO4_AIR_NO_BLOCKER,
  PLO4_TWO_BARRELS_CALLED,
  PLO4_TWO_PAIR,
  V54_ON,
  V54_SEEDS,
  V54_SUITE_TIMEOUT_MS,
  decideSpot,
  v54Fires,
  v54Folder,
  v54Stable,
  v54Unknown,
  type V54Spot,
} from './HorseV54RiverBluff.test-support.js';

enableBrainTelemetry();
afterEach(() => {
  HorseMind.reset();
  drainFires();
});

describe('V54 fires only when it makes sense (declined spots)', () => {
  // Each declined spot leaves the decision to the layers below, exactly as
  // with the flag off, and names its reason.
  const DECLINED: Array<[string, V54Spot, string | null]> = [
    ['multiway', NLH_AIR_MULTIWAY, 'v54_river_bluff_skip_multiway'],
    ['showdown value (NLH middle pair)', NLH_MIDDLE_PAIR, 'v54_river_bluff_skip_showdown_value'],
    ['showdown value (PLO4 two pair)', PLO4_TWO_PAIR, 'v54_river_bluff_skip_showdown_value'],
    ['no story (hero checked behind twice)', NLH_AIR_PASSIVE, 'v54_river_bluff_skip_no_story'],
    [
      'uncapped (PLO4 range called two barrels)',
      PLO4_TWO_BARRELS_CALLED,
      'v54_river_bluff_skip_uncapped',
    ],
    ['no blocker (NLH)', NLH_AIR_NO_BLOCKER, 'v54_river_bluff_skip_no_blocker'],
    ['no blocker (PLO4)', PLO4_AIR_NO_BLOCKER, 'v54_river_bluff_skip_no_blocker'],
    ['incomplete tournament economics', NLH_AIR_BUBBLE, 'v54_river_bluff_skip_tournament_context'],
    ['illegal: the opponent is all in', NLH_AIR_OPP_ALL_IN, 'v54_river_bluff_skip_all_in'],
    ['facing a bet', NLH_AIR_FACING_BET, null],
  ];

  for (const [label, spot, reason] of DECLINED) {
    it(
      `does not fire: ${label}`,
      () => {
        for (const read of [v54Folder, v54Unknown]) {
          read();
          drainFires();
          for (const s of V54_SEEDS.slice(0, 40)) {
            const on = v54Stable(decideSpot(spot, s, V54_ON));
            const off = v54Stable(decideSpot(spot, s, { telemetry: true }));
            expect(on, `${spot.name} seed ${s}`).toBe(off);
          }
          const f = v54Fires();
          expect(f.v54_river_bluff ?? 0).toBe(0);
          if (reason) expect(f[reason]).toBe(40);
          else expect(Object.keys(f)).toEqual([]);
        }
      },
      V54_SUITE_TIMEOUT_MS
    );
  }
});
