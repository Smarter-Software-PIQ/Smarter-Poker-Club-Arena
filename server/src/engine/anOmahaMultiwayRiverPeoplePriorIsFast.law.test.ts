/**
 * LAW: THE MULTIWAY RIVER PEOPLE PRIOR IS CHEAP WHERE IT APPLIES (lead-9 lanes MWR + RV + RV2 2026-11-27,
 * omahaMultiwayRiverBetPriorIsPeopleMeasured). Inside omahaFacingBetEv (PLO4/PLO5 cash, a multiway river first bet
 * outside a re-raised pot) the option adds one preflop history scan, two cell lookups and one record read. This law
 * measures that cost on river decisions where the option priced the bettor (omaha_mw_river_people_prior_priced
 * fired) with a record of his to read, the engine's own decide, on against off, telemetry off (the live decision)
 * and on. Measured the way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): on
 * costs at most RATIO times off.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  decideMwRiver,
  MW_RIVER_PRICED,
  mwRiverStates,
} from './HorseOmahaMultiwayRiverPeoplePrior.test-support.js';

const RATIO = 4;
const MEASURED_DECISIONS = 40;
const MIN_APPLICABLE = 20;
const RECORD = { n: 2, kind: 'air' as const };

describe('LAW: the multiway river people prior is cheap where it applies', () => {
  enableBrainTelemetry();
  const applicable = mwRiverStates()
    .filter((s) => s.live > 2 && s.pot !== 'reraised')
    .filter((s) =>
      withDecisionFireScope(() => decideMwRiver(s, true, true)).fired.has(MW_RIVER_PRICED)
    )
    .filter((_, i) => i < MEASURED_DECISIONS);

  it('the measured states are ones the option actually prices', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(MIN_APPLICABLE);
  });

  for (const telemetry of [false, true])
    it(`multiway river first bet, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          for (const s of applicable) decideMwRiver(s, true, telemetry, RECORD);
        },
        () => {
          for (const s of applicable) decideMwRiver(s, false, telemetry, RECORD);
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[multiway river people prior telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
