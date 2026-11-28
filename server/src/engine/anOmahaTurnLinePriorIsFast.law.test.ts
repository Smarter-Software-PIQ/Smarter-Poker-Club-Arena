/**
 * LAW: THE LINE-SPLIT TURN PRIOR IS CHEAP WHERE IT APPLIES (lead-8 lane OFB 2026-11-27,
 * omahaTurnFacingBetPriorIsLineSplit). Inside omahaFacingBetEv (PLO4/PLO5 cash, a turn first wager, heads-up or
 * multiway) the option adds one scan of the flop actions, one people-cell lookup and, with telemetry on, a second
 * verdict on the reads before it to name omaha_turn_line_prior_changed. This law measures that cost on real turn
 * decisions where the option priced the decision (omaha_turn_line_prior_priced fired), the engine's own decide on the
 * live switch rows, on against off, telemetry off (the live decision) and on. Measured the way
 * theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): on costs at most RATIO times off.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  decideTurnLine,
  loadTurnLineStates,
} from './HorseOmahaTurnLinePeoplePrior.test-support.js';

const RATIO = 4;
const LIVE = { omahaFacingBetPriorIsPeopleMeasured: true };

describe('LAW: the line-split turn prior is cheap where it applies', () => {
  enableBrainTelemetry();
  const applicable = loadTurnLineStates()
    .filter((s) =>
      withDecisionFireScope(() => decideTurnLine(s.player, s.gs, true, true, LIVE)).fired.has(
        'omaha_turn_line_prior_priced'
      )
    )
    .slice(0, 40);

  it('the measured states are ones the option actually prices', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(20);
  });

  for (const telemetry of [false, true])
    it(`turn facing a first wager, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          for (const s of applicable) decideTurnLine(s.player, s.gs, true, telemetry, LIVE);
        },
        () => {
          for (const s of applicable) decideTurnLine(s.player, s.gs, false, telemetry, LIVE);
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[turn line prior telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
