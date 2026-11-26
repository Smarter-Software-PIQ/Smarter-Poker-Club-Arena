/**
 * LAW: THE RE-RAISED-POT PRICE IS CHEAP WHERE IT APPLIES (PLO-OWNER lead-7, 2026-11-26).
 *
 * omahaReraisedPotCallIsPriced / omahaReraisedPotReraiseIsPriced price a re-raised-pot call on one joint sample set
 * against the re-raiser and every other player in (reraisedPotVerdict). With the out-of-position 3-bet price on card
 * ids (#12034) they took p50 12.8 / p95 27.6 / max 134.2 ms on 3,599 spots where they applied (PLO4/PLO5, 100 /
 * 300 / 800 bb, four spot shapes), 34 over the shadow stage's 50 ms slow mark (its breaker: 3 over 50 ms in 20).
 * Their multiway sampler and the defence equity now run on card ids (the same numbers, law
 * anOmahaReraisedPotEquityIsUnchanged.law.test.ts): p50 2.2 / p95 4.3 / max 19.7 ms on the same spots.
 *
 * Measured relative to other work on the same machine, as theServerSuiteAssertsNoTightWallClockBound requires
 * (src/testing/relativeCost.ts: alternating rounds, the fastest of each kept):
 *   1. the id floor sampler against the Card sampler on the same ranges: under RATIO_SAMPLER of its cost (measured 0.16);
 *   2. a fixed set of applicable decisions with both options on (24 spots: PLO4/PLO5, 100 / 300 / 800 bb, four
 *      shapes) against the same fixed Card-sampler work: under RATIO_DECISION of its cost (measured 0.58 here, 3.04 ms
 *      per decision; 3.20 before, 16.6 ms). (The decisions off are no
 *      reference here: the defence equity they run is on card ids too.)
 */
import { describe, expect, it } from 'vitest';
import type { HorseDecideOpts } from './HorseLogic.js';
import { enableBrainTelemetry } from './BrainTelemetry.js';
import {
  omahaReraisedEquityAgainst,
  omahaReraisedEquityAgainstPercentileFloors,
} from './HorseOmahaReraisedPot.js';
import {
  RERAISED_POT_PRICED_SAMPLES,
  reraisedPotFloorOf,
  reraisedPotRangeOf,
} from './HorseOmahaReraisedPotPriced.js';
import {
  RR_LIVE_OPTS,
  RR_ON,
  cards,
  rrDecide,
  rrHands,
  type RrSpotKind,
} from './HorseOmahaReraisedPotPriced.test-support.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

const RATIO_SAMPLER = 0.45;
const RATIO_DECISION = 1.5;

enableBrainTelemetry();
/** The reference work: the Card sampler (omahaReraisedEquityAgainst, untouched) on fixed hands and ranges. */
const REFERENCE_CASES = rrHands(8, 5, 31).map((h, i) => ({
  hole: cards(h),
  widths: [[0.3, 0.6], [0.05], [0.12, 0.4, 1], [0.02]][i % 4]!,
}));
const cardSampler = (): void => {
  for (const c of REFERENCE_CASES)
    omahaReraisedEquityAgainst(
      c.hole,
      [],
      c.widths.map(reraisedPotRangeOf),
      RERAISED_POT_PRICED_SAMPLES
    );
};
const ON: HorseDecideOpts = { ...RR_LIVE_OPTS, ...RR_ON } as HorseDecideOpts;

describe('LAW: the re-raised-pot price is cheap where it applies', () => {
  it('the id floor sampler costs a fraction of the Card sampler on the same ranges', () => {
    const cost = measureRelativeCost(
      () => {
        for (const c of REFERENCE_CASES)
          omahaReraisedEquityAgainstPercentileFloors(
            c.hole,
            [],
            c.widths.map(reraisedPotFloorOf),
            RERAISED_POT_PRICED_SAMPLES
          );
      },
      cardSampler,
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[re-raised pot sampler] id ${cost.subjectMs.toFixed(2)} ms, Card ${cost.referenceMs.toFixed(2)} ms, ` +
        `ratio ${cost.ratio.toFixed(3)} (limit ${RATIO_SAMPLER}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_SAMPLER);
  }, 120_000);

  it('applicable decisions with the options on cost a bounded multiple of the fixed Card-sampler work', () => {
    const spots: { hole: string; kind: RrSpotKind; variant: 'plo4' | 'plo5'; stack: number }[] = [];
    for (const variant of ['plo4', 'plo5'] as const)
      for (const stack of [200, 600, 1600])
        for (const kind of ['bbVsSbSqueezeMw', 'oopHu', 'ipHu', 'oopHuFiveBet'] as RrSpotKind[]) {
          const hand = rrHands(40, variant === 'plo4' ? 4 : 5, 500 + stack).find((h) =>
            rrDecide(h, kind, ON, 11, { variant, stack }).fires.some(
              (f) =>
                f.startsWith('omaha_reraised_pot_priced_') &&
                f !== 'omaha_reraised_pot_priced_failed'
            )
          );
          if (hand) spots.push({ hole: hand, kind, variant, stack });
        }
    expect(spots.length).toBeGreaterThanOrEqual(20);
    const cost = measureRelativeCost(
      () => {
        for (const s of spots)
          rrDecide(s.hole, s.kind, ON, 11, { variant: s.variant, stack: s.stack });
      },
      cardSampler,
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[re-raised pot decision] on ${(cost.subjectMs / spots.length).toFixed(2)} ms per decision over ` +
        `${spots.length} spots, reference ${cost.referenceMs.toFixed(2)} ms, ratio ` +
        `${cost.ratio.toFixed(2)} (limit ${RATIO_DECISION}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  }, 300_000);
});
