/**
 * LAW: THE POT-TYPE RIVER CELL IS CHEAP WHERE IT APPLIES (lead-9 lane RV2 2026-11-27,
 * omahaRiverBetPriorIsPotTypeSplit). Inside omahaFacingBetEv (PLO4/PLO5 cash, a heads-up river bet the people prior
 * prices) the option adds one preflop history scan and one keyed lookup. This law measures that cost on real river
 * decisions where the option read its cell (omaha_river_pot_prior_read fired), the engine's own decide, on against
 * off, telemetry off (the live decision) and on. Measured the way theServerSuiteAssertsNoTightWallClockBound
 * requires (src/testing/relativeCost.ts): on costs at most RATIO times off.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  decideRiverPot,
  RIVER_POT_BASE,
  RIVER_POT_ON,
  RIVER_POT_RECEIPT,
  riverPotStates,
} from './HorseOmahaRiverPotPrior.test-support.js';

const RATIO = 4;
const MEASURED_DECISIONS = 40;
const MIN_APPLICABLE = 20;

describe('LAW: the pot-type river cell is cheap where it applies', () => {
  enableBrainTelemetry();
  const applicable = riverPotStates()
    .filter((s) =>
      withDecisionFireScope(() => decideRiverPot(s, RIVER_POT_ON, true)).fired.has(
        RIVER_POT_RECEIPT
      )
    )
    .filter((_, i) => i < MEASURED_DECISIONS);

  it('the measured states are ones the option actually reads', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(MIN_APPLICABLE);
  });

  for (const telemetry of [false, true])
    it(`heads-up river bet in a re-raised pot, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          for (const s of applicable) decideRiverPot(s, RIVER_POT_ON, telemetry);
        },
        () => {
          for (const s of applicable) decideRiverPot(s, RIVER_POT_BASE, telemetry);
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[river pot prior telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
