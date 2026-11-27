/**
 * LAW: THE PEOPLE-MEASURED MULTIWAY FIELD IS CHEAP WHERE IT APPLIES (PLO-OWNER lead-7 2026-11-27,
 * omahaMultiwayFieldIsPeopleMeasured). Inside omahaFacingBetEv (PLO4/PLO5 cash, a multiway turn or river call) the
 * option adds two people-cell lookups, at most one more top-share count of the hand and, with telemetry on, a second
 * verdict on the stated field constants to name omaha_mw_people_field_changed. This law measures that cost on the
 * real audited multiway decisions where the option priced the decision (omaha_mw_people_field_priced fired), the
 * engine's own decide on the live switch rows, on against off, telemetry off (the live decision) and on.
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): on costs at
 * most RATIO times off. The per-decision times print with the ratio.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import {
  decideMultiway,
  loadMultiwayAuditedStates,
} from './HorseOmahaMultiwayPeopleField.test-support.js';

const RATIO = 4;

describe('LAW: the people-measured multiway field is cheap where it applies', () => {
  enableBrainTelemetry();
  const applicable = loadMultiwayAuditedStates()
    .filter((s) =>
      withDecisionFireScope(() => decideMultiway(s.player, s.gs, true, true)).fired.has(
        'omaha_mw_people_field_priced'
      )
    )
    .slice(0, 40);

  it('the measured states are ones the option actually prices', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(20);
  });

  for (const telemetry of [false, true])
    it(`multiway turn and river facing a bet, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          for (const s of applicable) decideMultiway(s.player, s.gs, true, telemetry);
        },
        () => {
          for (const s of applicable) decideMultiway(s.player, s.gs, false, telemetry);
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[multiway people field telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
