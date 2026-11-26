/**
 * LAW: THE RIVER OPENING BET IS CHEAP WHERE IT APPLIES (PLO-OWNER lead-7 2026-11-26).
 * Offline on 361 applicable real heads-up river spots (Nov 23-26, live switch rows, both options on): decide p50 2.4 /
 * p95 3.6 / max 4.8 ms with the options on against p50 1.6 / p95 2.8 ms off (added p95 1.1 ms). Measured the way
 * theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): the fixture's applicable nodes
 * decided with both options on cost at most RATIO times the same decisions off (measured about 1.5).
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import {
  RIVER_OPENING_FIXTURE,
  riverOpeningDecide,
} from './HorseOmahaRiverOpeningBet.test-support.js';

const RATIO = 6;
const ON = { omahaRiverValueBetInPositionIsPriced: true, omahaRiverBluffIsPricedOnBlockers: true };

describe('LAW: the river opening bet is cheap where it applies', () => {
  it('an applicable decision with both options on costs a bounded multiple of the same decision off', () => {
    const nodes = RIVER_OPENING_FIXTURE.nodes.slice(0, 30);
    const cost = measureRelativeCost(
      () => {
        for (const n of nodes) riverOpeningDecide(n, ON);
      },
      () => {
        for (const n of nodes) riverOpeningDecide(n, {});
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[river opening] on ${(cost.subjectMs / nodes.length).toFixed(2)} ms, off ${(cost.referenceMs / nodes.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
    );
    expect(cost.ratio).toBeLessThan(RATIO);
  }, 300_000);
});
