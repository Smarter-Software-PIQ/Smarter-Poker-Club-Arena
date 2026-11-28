/**
 * V54 RIVER BLUFF — default-off byte-for-byte golden parity and golden
 * sensitivity (split from HorseV54RiverBluff.test.ts for balanced Vitest
 * sharding; zero dropped assertions).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { HorseDecideOpts } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
import {
  GOLDEN_SEEDS,
  GOLDEN_SPOTS,
  NLH_AIR_BLOCKER,
  PLO4_NUT_BLOCKER_AIR,
  V54_SUITE_TIMEOUT_MS,
  decideSpot,
  v54BaselineDecision,
  v54Folder,
  v54Station,
} from './HorseV54RiverBluff.test-support.js';

enableBrainTelemetry();
afterEach(() => {
  HorseMind.reset();
  drainFires();
});

describe('V54 default off reproduces the brain before it, byte for byte', () => {
  const golden = JSON.parse(
    readFileSync(new URL('./HorseV54RiverBluff.golden.json', import.meta.url), 'utf8')
  ) as Record<string, { sha256: string; actions: string[] }>;
  const digest = (lines: string[]) => createHash('sha256').update(lines.join('\n')).digest('hex');

  for (const flag of [undefined, false]) {
    it(
      `v54RiverBluff ${String(flag)}: every golden river spot decides exactly as recorded`,
      () => {
        // The golden was recorded before V54 AND before the November 6
        // baseline river bluff range, which now owns these very spots (air,
        // heads-up, checked to). This pin is about V54's flag, so the later
        // baseline is ablated here; HorseRiverBluffRange.law.test.ts pins it.
        // The November 7 multiway river bluff owns the golden's three-handed
        // spot (nlh_air_multiway) and is ablated for the same reason;
        // HorseMultiwayRiverBluff.law.test.ts pins it.
        // The November 7 decision-size timing changes think time, which the
        // golden records; it is ablated too and pinned in horseDecisionGravity.test.ts.
        const opts: HorseDecideOpts =
          flag === undefined
            ? {
                riverBluffBaseline: false,
                riverBluffMultiway: false,
                decisionGravityTiming: false,
                // Dan 2026-11-15: the Omaha one-pair river rule owns river
                // value bets later; pinned in HorseOmahaOnePair.test.ts.
                omahaOnePairDiscipline: false,
              }
            : {
                v54RiverBluff: flag,
                riverBluffBaseline: false,
                riverBluffMultiway: false,
                decisionGravityTiming: false,
                omahaOnePairDiscipline: false,
              };
        const run = (key: string, lines: string[]) =>
          expect(digest(lines), key).toBe(golden[key].sha256);
        HorseMind.reset();
        for (const spot of GOLDEN_SPOTS)
          run(
            spot.name,
            GOLDEN_SEEDS.map((s) => v54BaselineDecision(decideSpot(spot, s, opts)))
          );
        for (const spot of GOLDEN_SPOTS)
          run(
            spot.name + '_mindoff',
            GOLDEN_SEEDS.map((s) =>
              v54BaselineDecision(decideSpot(spot, s, { ...opts, mind: false }))
            )
          );
        for (const spot of [NLH_AIR_BLOCKER, PLO4_NUT_BLOCKER_AIR]) {
          v54Folder();
          run(
            spot.name + '_folder',
            GOLDEN_SEEDS.map((s) => v54BaselineDecision(decideSpot(spot, s, opts)))
          );
          v54Station();
          run(
            spot.name + '_station',
            GOLDEN_SEEDS.map((s) => v54BaselineDecision(decideSpot(spot, s, opts)))
          );
        }
        expect(Object.keys(golden).length).toBe(GOLDEN_SPOTS.length * 2 + 4);
      },
      V54_SUITE_TIMEOUT_MS
    );
  }
});

describe('V54 golden sensitivity', () => {
  it(
    'the golden comparison can see a change: with the flag ON the bluff spot no longer matches',
    () => {
      const golden = JSON.parse(
        readFileSync(new URL('./HorseV54RiverBluff.golden.json', import.meta.url), 'utf8')
      ) as Record<string, { sha256: string }>;
      v54Folder();
      const lines = GOLDEN_SEEDS.map((s) =>
        v54BaselineDecision(decideSpot(NLH_AIR_BLOCKER, s, { v54RiverBluff: true }))
      );
      const sha = createHash('sha256').update(lines.join('\n')).digest('hex');
      expect(sha).not.toBe(golden.nlh_air_blocker_folder.sha256);
    },
    V54_SUITE_TIMEOUT_MS
  );
});
