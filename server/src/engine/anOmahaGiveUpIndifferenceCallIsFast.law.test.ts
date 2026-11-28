/**
 * LAW: THE INDIFFERENCE CALL INSIDE THE GIVE-UP PRICE IS CHEAP WHERE IT APPLIES (lead-9 lane HU2 2026-11-27,
 * omahaGiveUpPricedTurnCallIsAtIndifference). The option adds one comparison on the verdict the give-up price
 * already computed (and one scan of the preflop actions for the pot type). This law measures that cost on real turn
 * decisions where the option decided the call (omaha_give_up_indifference_priced fired), the engine's own decide, on
 * against off, telemetry off (the live decision) and on. Measured the way theServerSuiteAssertsNoTightWallClockBound
 * requires (src/testing/relativeCost.ts): on costs at most RATIO times off.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  decideTurnLine,
  loadTurnLineStates,
} from './HorseOmahaTurnLinePeoplePrior.test-support.js';

const RATIO = 3;
const BASE = {
  omahaFacingBetPriorIsPeopleMeasured: true,
  omahaPeoplePriorCountsHiddenBets: true,
  omahaHiddenBetsArePricedAsGiveUps: true,
};
const ON = { ...BASE, omahaGiveUpPricedTurnCallIsAtIndifference: true };
const MEASURED_DECISIONS = 40;
const MIN_APPLICABLE = 20;

describe('LAW: the indifference call inside the give-up price is cheap where it applies', () => {
  enableBrainTelemetry();
  const applicable = loadTurnLineStates()
    .filter((s) =>
      withDecisionFireScope(() => decideTurnLine(s.player, s.gs, false, true, ON)).fired.has(
        'omaha_give_up_indifference_priced'
      )
    )
    .filter((_, i) => i < MEASURED_DECISIONS);

  it('the measured states are ones the option actually decides', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(MIN_APPLICABLE);
  });

  for (const telemetry of [false, true])
    it(`heads-up turn bet, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          for (const s of applicable) decideTurnLine(s.player, s.gs, false, telemetry, ON);
        },
        () => {
          for (const s of applicable) decideTurnLine(s.player, s.gs, false, telemetry, BASE);
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[give-up indifference telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
