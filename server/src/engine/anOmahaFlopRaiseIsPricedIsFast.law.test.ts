/**
 * LAW: THE FLOP RAISE PRICE IS CHEAP WHERE IT APPLIES (PLO-OWNER lead-7 2026-11-26). Offline on 585 applicable real
 * heads-up flop raises (Nov 23-26, live switch rows): decide p50 3.3 / p95 4.3 ms on (added p95 1.8, max 2.4 ms). The
 * fixture's nodes decided with the option on cost at most RATIO times the same decisions off (relativeCost.ts).
 */
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { FLOP_RAISE_FIXTURE, flopRaiseDecide } from './HorseOmahaFlopRaisePriced.test-support.js';

const RATIO = 8;
describe('LAW: the flop raise price is cheap where it applies', () => {
  it('an applicable decision with the option on costs a bounded multiple of the same decision off', () => {
    const nodes = FLOP_RAISE_FIXTURE.nodes.slice(0, 30);
    const cost = measureRelativeCost(
      () => {
        for (const n of nodes) flopRaiseDecide(n, { omahaFlopRaiseIsPriced: true });
      },
      () => {
        for (const n of nodes) flopRaiseDecide(n, {});
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[flop raise] on ${(cost.subjectMs / nodes.length).toFixed(2)} ms, off ${(cost.referenceMs / nodes.length).toFixed(2)} ms, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
    );
    expect(cost.ratio).toBeLessThan(RATIO);
  }, 300_000);
});
