/**
 * LAW: THE PRICED FLOP PRESSURE CAP IS CHEAP WHERE IT APPLIES (2026-11-26; PLO-OWNER lead-7, omahaFlopPressureCapIsPriced).
 *
 * Where the V40 class cap prices a weak made hand heads-up on the PLO4/PLO5 cash flop facing one bet, the option adds
 * one sampled flop count (omahaFlopEvCounts, the flop verdict's own deterministic sample, memoised by the cards) and a
 * people-prior cell lookup. So it has a decision cost, and this law measures it rather than exempting it:
 *  - only the audited heads-up flop decisions where the option priced the call (omaha_flop_pressure_cap_priced fired);
 *  - the engine's own decide, the live options of the audit, the option on against the same decisions off, telemetry
 *    off (the live decision) and on.
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): on costs at
 * most RATIO times off. The per-decision times print with the ratio.
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { flopCapDecide, loadFlopCapNodes } from './HorseOmahaFlopPressureCap.test-support.js';
import { omahaFlopEvCountsResetCache } from './HorseOmahaFlopFacingBetEv.js';

// The off decision is cheap here (about 1.3 ms: the reference check alone); the option adds one sampled flop count
// (about 5 ms cold, OMAHA_FLOP_PRESSURE_CAP_RIVERS). Measured 7.4 under vitest on a loaded machine (source build); the limit keeps headroom for a shared runner.
const RATIO = 12;
const OPTION = 'omahaFlopPressureCapIsPriced';

describe('LAW: the priced flop pressure cap is cheap where it applies', () => {
  const applicable = loadFlopCapNodes()
    .filter((n) =>
      flopCapDecide(n.player, n.gs, { ...n.opts, [OPTION]: true }).fired.has(
        'omaha_flop_pressure_cap_priced'
      )
    )
    .slice(0, 40);

  it('the measured states are ones the option actually prices', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(20);
  });

  for (const telemetry of [false, true])
    it(`heads-up flop facing one bet, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          // a cold sample every decision: the memo of the last few hands does not hide the count
          for (const n of applicable) {
            omahaFlopEvCountsResetCache();
            flopCapDecide(n.player, n.gs, { ...n.opts, [OPTION]: true }, 1, telemetry);
          }
        },
        () => {
          for (const n of applicable) {
            omahaFlopEvCountsResetCache();
            flopCapDecide(n.player, n.gs, n.opts, 1, telemetry);
          }
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[flop pressure cap telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
