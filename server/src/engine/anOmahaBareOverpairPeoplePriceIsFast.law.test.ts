/**
 * LAW: THE PEOPLE-PRICED BARE-OVERPAIR CONTINUATION IS CHEAP WHERE IT APPLIES (lead-9 lane HU2 2026-11-27,
 * omahaBareOverpairContinuationIsPeoplePriced). In the continuation's heads-up flop spot the option replaces up to
 * four sampler equities by one sampled flop count (the flop pressure cap's own, memoised by the cards) and a people
 * cell lookup. This law measures that cost on the audited flop decisions where the option priced the continuation
 * (omaha_bare_overpair_people_priced fired), the engine's own decide, on against off, telemetry off (the live
 * decision) and on. Measured the way theServerSuiteAssertsNoTightWallClockBound requires
 * (src/testing/relativeCost.ts): on costs at most RATIO times off.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { omahaFlopEvCountsResetCache } from './HorseOmahaFlopFacingBetEv.js';
import { flopCapDecide, loadFlopCapNodes } from './HorseOmahaFlopPressureCap.test-support.js';

const RATIO = 4;
const BASE = {
  omahaBareOverpairOopFlopCheck: true,
  omahaFlopPressureCapIsPriced: true,
  omahaPeoplePriorCountsHiddenBets: true,
};
const OPTION = 'omahaBareOverpairContinuationIsPeoplePriced';
const MEASURED_DECISIONS = 40;
const MIN_APPLICABLE = 20;

describe('LAW: the people-priced bare-overpair continuation is cheap where it applies', () => {
  const applicable = loadFlopCapNodes()
    .filter((n) =>
      flopCapDecide(n.player, n.gs, { ...n.opts, ...BASE, [OPTION]: true }).fired.has(
        'omaha_bare_overpair_people_priced'
      )
    )
    .slice(0, MEASURED_DECISIONS);

  it('the measured states are ones the option actually prices', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(MIN_APPLICABLE);
  });

  for (const telemetry of [false, true])
    it(`heads-up flop continuation, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          // a cold sample every decision: the memo of the last few hands does not hide the count
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
        `[bare-overpair people price telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
