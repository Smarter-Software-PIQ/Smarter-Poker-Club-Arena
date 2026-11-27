/**
 * LAW: THE RIVER BETTOR BY BOARD TEXTURE IS CHEAP WHERE IT APPLIES (2026-11-27; option of PLO-OWNER lead-8,
 * omahaRiverBettorRangeIsTextureMeasured).
 *
 * Inside omahaFacingBetEv (PLO4/PLO5 cash, heads-up, a river bet of 0.4 pot or more or a raise) the option adds one
 * count of the board alone (omahaRiverBoardBands: 1,081 two-card scores and three exact counts over 47 cards,
 * remembered per board), three exact band counts on the Horse's own hand (OmahaEvHandCounts.bandsOf) and, with
 * telemetry on, a second verdict on the read without the classes to name omaha_river_texture_classes_changed. So
 * it has a decision cost, and this law measures it rather than exempting it:
 *  - only the committed real facing-bet states (HorseOmahaFacingBetPriced.states.ndjson.gz, heads-up river) where
 *    the option actually priced the decision (omaha_river_texture_classes_priced fired) are measured;
 *  - the engine's own decide, the live PLO4/PLO5 switch rows of the flop raise fixture (omahaFacingBetEv on), the
 *    option on against the same decisions off, with telemetry off (the live decision) and on (the extra verdict).
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): on costs at
 * most RATIO times off. The per-decision times print with the ratio.
 */
import { describe, expect, it } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { enableBrainTelemetry, withDecisionFireScope } from './BrainTelemetry.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { loadPricedStates } from './HorseOmahaFacingBetPriced.test-support.js';
import { FLOP_RAISE_FIXTURE } from './HorseOmahaFlopRaisePriced.test-support.js';

const RATIO = 4;
const OPTION = 'omahaRiverBettorRangeIsTextureMeasured';
const MODS = { tightness: 0.98, aggression: 1.18, bluffFreq: 0.91, sizingMultiplier: 0.94 };

function decide(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: boolean,
  telemetry: boolean
): HorseDecision {
  HorseMind.reset();
  seedFastRandom(1);
  return HorseLogic.decide(
    structuredClone(player),
    structuredClone(gs),
    'grinder' as never,
    MODS as never,
    {
      ...FLOP_RAISE_FIXTURE.opts,
      ...(on ? { [OPTION]: true } : {}),
      mind: false,
      telemetry,
    } as never
  ) as HorseDecision;
}

describe('LAW: the river bettor by board texture is cheap where it applies', () => {
  enableBrainTelemetry();
  const applicable = loadPricedStates()
    .filter((s) => s.gs.stage === 'river')
    .filter((s) =>
      withDecisionFireScope(() => decide(s.player, s.gs, true, true)).fired.has(
        'omaha_river_texture_classes_priced'
      )
    )
    .slice(0, 30);

  it('the measured states are ones the option actually prices', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(10);
  });

  for (const telemetry of [false, true])
    it(`heads-up river facing a bet, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
      const cost = measureRelativeCost(
        () => {
          for (const s of applicable) decide(s.player, s.gs, true, telemetry);
        },
        () => {
          for (const s of applicable) decide(s.player, s.gs, false, telemetry);
        },
        { warmupRounds: 1, rounds: 3 }
      );
      console.info(
        `[river texture classes telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
