/**
 * LAW: THE RIVER FREQUENCY PRIOR IS CHEAP WHERE IT APPLIES (lead-9 lane RFQ 2026-11-27,
 * omahaRiverBetPriorReadsHisFrequency). Inside omahaFacingBetEv (PLO4/PLO5 cash, a heads-up river bet in a
 * single-raised or limped pot the people prior prices) the option adds one lifetime-record lookup, one preflop history
 * scan, a second people-prior price and, where the first verdict folds, a second verdict. This law measures that cost
 * on real river decisions where the option read the record (omaha_river_frequency_prior_read fired), the engine's own
 * decide, on against off, telemetry off (the live decision) and on, the way theServerSuiteAssertsNoTightWallClockBound
 * requires (src/testing/relativeCost.ts): on costs at most RATIO times off.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  decideRiverFreq,
  RIVER_FREQ_BASE,
  RIVER_FREQ_ON,
  RIVER_FREQ_RECEIPT,
  riverFreqStates,
} from './HorseOmahaRiverFrequencyPrior.test-support.js';

const RATIO = 4;
const MEASURED_DECISIONS = 40;
const MIN_APPLICABLE = 20;
const FREQUENT = { bets: 70, opps: 100 };

describe('LAW: the river frequency prior is cheap where it applies', () => {
  enableBrainTelemetry();
  const applicable = riverFreqStates()
    .filter((s) =>
      withDecisionFireScope(() => decideRiverFreq(s, RIVER_FREQ_ON, true, FREQUENT)).fired.has(
        RIVER_FREQ_RECEIPT
      )
    )
    .filter((_, i) => i < MEASURED_DECISIONS);

  it('the measured states are ones the option actually reads', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(MIN_APPLICABLE);
  });

  for (const telemetry of [false, true])
    it(`heads-up river bet, frequent bettor, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          for (const s of applicable) decideRiverFreq(s, RIVER_FREQ_ON, telemetry, FREQUENT);
        },
        () => {
          for (const s of applicable) decideRiverFreq(s, RIVER_FREQ_BASE, telemetry, FREQUENT);
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[river frequency prior telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
