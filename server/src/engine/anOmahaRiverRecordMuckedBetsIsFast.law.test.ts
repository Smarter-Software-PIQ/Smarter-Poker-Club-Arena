/**
 * LAW: THE RIVER RECORD'S MUCKED BETS ARE CHEAP WHERE THEY APPLY (2026-11-27; PLO-OWNER lead-9 lane RV,
 * omahaRiverRecordCountsMuckedBets).
 *
 * Where omahaFacingBetPriorIsPeopleMeasured prices a heads-up river bet, the option adds one scan of the public
 * preflop actions (the pot type) and, with telemetry on, one more keyed read of the bettor's record cell. Measured on
 * the committed real river facing-bet states (HorseOmahaFacingBetPriced.states) where the option actually read mucked
 * called bets (omaha_river_mucked_bets_record_read fired): the engine's own decide with both options on against the
 * people prior alone, the same record learned in both arms, telemetry off and on, in alternating rounds on the same
 * machine (src/testing/relativeCost.ts, theServerSuiteAssertsNoTightWallClockBound): on costs at most RATIO times off.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { enableBrainTelemetry } from './BrainTelemetry.js';
import {
  decideRiver,
  riverStatesTheOptionReads,
} from './HorseOmahaRiverRecordMuckedBets.test-support.js';

const RATIO = 4;

describe("LAW: the river record's mucked bets are cheap where they apply", () => {
  enableBrainTelemetry();
  const applicable = riverStatesTheOptionReads(30);

  it('the measured states are ones the option actually reads', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(10);
  });

  for (const telemetry of [false, true])
    it(`heads-up river facing a bet, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          for (const s of applicable) decideRiver(s, true, telemetry, 6);
        },
        () => {
          for (const s of applicable) decideRiver(s, false, telemetry, 6);
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[river mucked bets telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
