/**
 * LAW: THE HOLD'EM OPENING PRICE IS CHEAP WHERE IT APPLIES (PLO-OWNER lead-7 2026-11-26; options of plo-lead7
 * 2026-11-25, which shipped with no relative-cost law).
 *
 * holdemOpeningValueBetIsPriced and holdemOpeningBluffIsPriced (both default OFF; NLH cash heads-up, not facing a
 * wager) read his line range twice (with and without the Horse's cards), fill the Horse's equity against it and
 * price every legal bet size against the check (HorseLogic.holdemOpeningPriced, HorseHoldemOpeningIsPriced).
 *
 * The engine's own decide (HorseLogic.decide through the complaint replay, production options of the fixture, two
 * seeds) on the real audited nodes of HorseHoldemOpeningIsPriced.fixture.json (the deciding Horse's own cards only):
 * each node with each option on, and with both on, against the same decisions with both off. Every node is one where
 * its option's receipt fires. At most RATIO_DECISION times the cost of the decisions off.
 * Measured 2026-11-26 (vitest, source build): see the printed line. Offline on the compiled build (the option cost
 * harness, scripts/ops/horse-option-time.mjs, NLH cash league states): in the PR.
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  replayAt,
  replayProfiles,
  stateAt,
  type ComplaintAction,
  type ExtractedHand,
} from './HorseComplaintReplay.js';
import { measureRelativeCost } from '../testing/relativeCost.js';

const RATIO_DECISION = 16;
const OPTIONS = ['holdemOpeningValueBetIsPriced', 'holdemOpeningBluffIsPriced'] as const;

const FIX = JSON.parse(
  readFileSync(new URL('./HorseHoldemOpeningIsPriced.fixture.json', import.meta.url), 'utf8')
) as {
  nodes: { hand: ExtractedHand; ord: number; option: string; expect: string }[];
  productionOpts: Record<string, unknown>;
};
const prof = replayProfiles('cash')[0];
const SEEDS = [1, 7];

describe('LAW: the Hold`em opening price is cheap where it applies', () => {
  it('an applicable decision with the options on costs a bounded multiple of the same decision off', () => {
    const spots = FIX.nodes.map((n) => ({
      st: stateAt(n.hand, n.hand.actions.find((a) => a.ord === n.ord) as ComplaintAction),
      option: n.option,
      expect: n.expect,
    }));
    expect(spots.length).toBeGreaterThanOrEqual(3);
    // both options are met, and each node's own option prices and bets there
    expect(new Set(spots.map((s) => s.option))).toEqual(new Set(OPTIONS));
    for (const s of spots) {
      const on = replayAt(s.st, prof, SEEDS, { ...FIX.productionOpts, [s.option]: true });
      expect(on.receipts[s.expect], s.option).toBe(SEEDS.length);
    }
    const sets: Record<string, boolean>[] = [
      { holdemOpeningValueBetIsPriced: true },
      { holdemOpeningBluffIsPriced: true },
      { holdemOpeningValueBetIsPriced: true, holdemOpeningBluffIsPriced: true },
    ];
    const cost = measureRelativeCost(
      () => {
        for (const s of spots)
          for (const on of sets) replayAt(s.st, prof, SEEDS, { ...FIX.productionOpts, ...on });
      },
      () => {
        for (const s of spots)
          for (let k = 0; k < sets.length; k++) replayAt(s.st, prof, SEEDS, FIX.productionOpts);
      },
      { warmupRounds: 1, rounds: 5 }
    );
    const n = spots.length * sets.length * SEEDS.length;
    console.info(
      `[holdem opening price] on ${(cost.subjectMs / n).toFixed(2)} ms, off ${(cost.referenceMs / n).toFixed(2)} ms ` +
        `per decision over ${n} decisions, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO_DECISION}, fastest of ${cost.rounds})`
    );
    expect(cost.ratio).toBeLessThan(RATIO_DECISION);
  }, 300_000);
});
