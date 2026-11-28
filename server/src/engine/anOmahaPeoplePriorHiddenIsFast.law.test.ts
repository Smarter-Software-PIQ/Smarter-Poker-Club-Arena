/**
 * LAW: THE HIDDEN-BET PEOPLE CELLS ARE CHEAP WHERE THEY APPLY (2026-11-27; lead-8 lane OFA,
 * omahaPeoplePriorCountsHiddenBets).
 *
 * Where omahaFacingBetPriorIsPeopleMeasured prices a heads-up turn bet, the option adds one scan of the public
 * preflop / flop actions (the split key) and one keyed lookup of the split cell; the bettor's record read is the same
 * call with one more addend. Measured on the committed real facing-bet states (HorseOmahaFacingBetPriced.states)
 * where the option actually read the split cell (omaha_hidden_bets_prior_read fired): the engine's own decide with
 * both options on against the people prior alone, telemetry off and on, in alternating rounds on the same machine
 * (src/testing/relativeCost.ts, theServerSuiteAssertsNoTightWallClockBound): on costs at most RATIO times off.
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
      omahaFacingBetPriorIsPeopleMeasured: true,
      ...(on ? { omahaPeoplePriorCountsHiddenBets: true } : {}),
      mind: false,
      telemetry,
    } as never
  ) as HorseDecision;
}

describe('LAW: the hidden-bet people cells are cheap where they apply', () => {
  enableBrainTelemetry();
  const applicable = loadPricedStates()
    .filter((s) => s.gs.stage === 'turn')
    .filter((s) =>
      withDecisionFireScope(() => decide(s.player, s.gs, true, true)).fired.has(
        'omaha_hidden_bets_prior_read'
      )
    )
    .slice(0, 30);

  it('the measured states are ones the option actually reads', () => {
    expect(applicable.length).toBeGreaterThanOrEqual(10);
  });

  for (const telemetry of [false, true])
    it(`heads-up turn facing a bet, telemetry ${telemetry ? 'on' : 'off'}: on costs a bounded multiple of off`, () => {
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
        `[hidden-bet cells telemetry ${telemetry ? 'on' : 'off'}] ${applicable.length} decisions: on ${(cost.subjectMs / applicable.length).toFixed(2)} ms, off ${(cost.referenceMs / applicable.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
      );
      expect(cost.ratio).toBeLessThan(RATIO);
    }, 300_000);
});
