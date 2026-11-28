/**
 * LAW: THE PEOPLE-PRICED FLOP FACING-BET EQUITY IS CHEAP WHERE IT APPLIES (PLO-OWNER lead-10 2026-11-28,
 * omahaFlopFacingBetEquityIsPeoplePriced). Inside the priced flop pressure cap's spot the option adds one scope check
 * and one scan of the flop actions, and reads the number the cap has already computed (no new sample). This law
 * measures that cost on the audited flop decisions where the option lifted the check equity
 * (omaha_flop_people_priced_equity fired), the engine's own decide, on against off, telemetry off (the live decision)
 * and on. Measured the way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): on costs
 * at most RATIO times off.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { omahaFlopEvCountsResetCache } from './HorseOmahaFlopFacingBetEv.js';
import { flopCapDecide, loadFlopCapNodes } from './HorseOmahaFlopPressureCap.test-support.js';

const RATIO = 3;
const BASE = { omahaFlopPressureCapIsPriced: true, omahaPeoplePriorCountsHiddenBets: true };
const OPTION = 'omahaFlopFacingBetEquityIsPeoplePriced';
const MEASURED_DECISIONS = 40;
const MIN_APPLICABLE = 10;

describe('LAW: the people-priced flop facing-bet equity is cheap where it applies', () => {
  const applicable = loadFlopCapNodes()
    .filter((n) =>
      flopCapDecide(n.player, n.gs, { ...n.opts, ...BASE, [OPTION]: true }).fired.has(
        'omaha_flop_people_priced_equity'
      )
    )
    .slice(0, MEASURED_DECISIONS);

  it('the measured states are ones the option actually lifts', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(MIN_APPLICABLE);
  });

  for (const telemetry of [false, true])
    it(`heads-up single-raised flop, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          for (const n of applicable) {
            omahaFlopEvCountsResetCache();
            flopCapDecide(n.player, n.gs, { ...n.opts, ...BASE, [OPTION]: true }, 1, telemetry);
          }
        },
        () => {
          for (const n of applicable) {
            omahaFlopEvCountsResetCache();
            flopCapDecide(n.player, n.gs, { ...n.opts, ...BASE }, 1, telemetry);
          }
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[flop people-priced equity telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
