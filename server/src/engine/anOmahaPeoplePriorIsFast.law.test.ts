/**
 * LAW: THE PEOPLE-MEASURED BETTOR PRIOR IS CHEAP WHERE IT APPLIES (2026-11-26; option of PLO-OWNER lead-7,
 * omahaFacingBetPriorIsPeopleMeasured, which reached main in #12116 with no relative-cost law and turned the
 * option cost gate, aPricedOptionProvesItsDecisionCost.law.test.ts, red on main).
 *
 * Inside omahaFacingBetEv (PLO4/PLO5 cash, heads-up, a turn or river bet or raise) the option adds a people-prior
 * cell lookup (omahaPeoplePriorShare, with the bettor's own shown-bet cell when the mind is on) and, with telemetry
 * on, a second verdict on the old read to name omaha_people_prior_changed. So it has a decision cost, and this law
 * measures it rather than exempting it:
 *  - only the committed real facing-bet states (HorseOmahaFacingBetPriced.states.ndjson.gz, heads-up turn and
 *    river) where the option actually priced the decision (omaha_people_prior_priced fired) are measured;
 *  - the engine's own decide, the live PLO4/PLO5 switch rows of the flop raise fixture (omahaFacingBetEv on), the
 *    option on against the same decisions off, with telemetry off (the live decision) and on (the extra verdict).
 * Measured 2026-11-26 (vitest, source build, 30 applicable heads-up turn and river decisions): telemetry off 9.88 ms on
 * against 9.94 off per decision (ratio 0.99); telemetry on 10.10 against 9.70 (ratio 1.04). The limit keeps headroom
 * for a shared runner.
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
const OPTION = 'omahaFacingBetPriorIsPeopleMeasured';
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

describe('LAW: the people-measured bettor prior is cheap where it applies', () => {
  enableBrainTelemetry();
  const applicable = loadPricedStates()
    .filter((s) => s.gs.stage === 'turn' || s.gs.stage === 'river')
    .filter((s) =>
      withDecisionFireScope(() => decide(s.player, s.gs, true, true)).fired.has(
        'omaha_people_prior_priced'
      )
    )
    .slice(0, 30);

  it('the measured states are ones the option actually prices', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(10);
  });

  for (const telemetry of [false, true])
    it(`heads-up turn and river facing a bet, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
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
        `[people prior telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
