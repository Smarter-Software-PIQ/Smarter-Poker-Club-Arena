/**
 * LAW: THE GIVE-UP PRICE IS CHEAP WHERE IT APPLIES (lead-9 lane HUOOP 2026-11-27,
 * omahaHiddenBetsArePricedAsGiveUps). Inside omahaFacingBetEv (PLO4/PLO5 cash, a heads-up turn bet the hidden-bets
 * people prior prices) the option adds one cell lookup, one threshold and three exact counts per river card (the
 * bettor's weakest pool). This law measures that cost on real turn decisions where the option priced the decision
 * (omaha_hidden_give_up_priced fired), the engine's own decide, on against off, telemetry off (the live decision)
 * and on. Measured the way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): on
 * costs at most RATIO times off.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  decideTurnLine,
  loadTurnLineStates,
} from './HorseOmahaTurnLinePeoplePrior.test-support.js';

const RATIO = 4;
const BASE = { omahaFacingBetPriorIsPeopleMeasured: true, omahaPeoplePriorCountsHiddenBets: true };
const ON = { ...BASE, omahaHiddenBetsArePricedAsGiveUps: true };
const MEASURED_DECISIONS = 40;
const MIN_APPLICABLE = 20;

describe('LAW: the give-up price is cheap where it applies', () => {
  enableBrainTelemetry();
  const applicable = loadTurnLineStates()
    .filter((s) =>
      withDecisionFireScope(() => decideTurnLine(s.player, s.gs, false, true, ON)).fired.has(
        'omaha_hidden_give_up_priced'
      )
    )
    .filter((_, i) => i < MEASURED_DECISIONS);

  it('the measured states are ones the option actually prices', () => {
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
        `[give-up price telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
