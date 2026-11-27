/**
 * LAW: THE CORRECTED PLO FACING-BET PRICE IS CHEAP WHERE IT APPLIES (lead-7
 * integration 2, 2026-11-26; options of PLO-OWNER lead-6, 2026-11-24, which shipped with no relative-cost law).
 * The engine's own decide (HorseLogic.decide, the live PLO4/PLO5 switch rows of the flop raise fixture, mind off) on
 * the committed real facing-bet states (HorseOmahaFacingBetPriced.states.ndjson.gz, heads-up turn and river) and on
 * the same states made three-way (a copy of the live opponent, no cards known, at a free seat, as HorseOmahaMultiwayValueBet.test.ts):
 *  - omahaFacingBetRangeIsMeasuredByLine (F1), omahaFacingBetIndifferenceCalls (F2), omahaFacingBetMinimumDefencePrior
 *    (F6): heads-up turn and river facing a bet, on against off;
 *  - omahaFacingBetFieldIsJoint (M1), omahaMultiwayCallNeedsNutShare (M2): three-way facing a bet with F1, on against
 *    off.
 * Measured 2026-11-26 (vitest, source build): F1+F2+F6 heads-up 7.6 ms on against 5.7 off per decision (ratio 1.3);
 * F1+M1+M2 three-way 13.0 against 5.4 (ratio 2.4). The priced multiway value bet (M3) has its own cost law,
 * anOmahaMultiwayValueBetIsFast.law.test.ts (its joint sample was made fast on 2026-11-26, the same numbers:
 * anOmahaPricedJointRowsIsUnchanged.law.test.ts).
 * Measured the way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): each set costs
 * at most RATIO times the same decisions off. The per-decision times print with the ratio.
 */
import { describe, expect, it } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../types.js';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { seedFastRandom } from './HorseEval.js';
import { loadPricedStates, type PricedState } from './HorseOmahaFacingBetPriced.test-support.js';
import { FLOP_RAISE_FIXTURE } from './HorseOmahaFlopRaisePriced.test-support.js';

const RATIO = 8;
const MODS = { tightness: 0.98, aggression: 1.18, bluffFreq: 0.91, sizingMultiplier: 0.94 };

function decide(
  player: SeatPlayer,
  gs: HorseGameStateV2,
  on: Record<string, boolean>
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
      ...on,
      mind: false,
      telemetry: false,
    } as never
  ) as HorseDecision;
}

/** A state with a copy of the live opponent (no cards known) at a free seat. */
function threeWay(s: PricedState): { player: SeatPlayer; gs: HorseGameStateV2 } | null {
  const opp = (s.gs.players ?? []).find(
    (p) => p.seat !== s.player.seat && !p.is_folded && !p.is_all_in && !p.is_sitting_out
  );
  if (!opp) return null;
  const used = new Set((s.gs.players ?? []).map((p) => p.seat));
  let seat = 1;
  while (used.has(seat)) seat++;
  const players = [
    ...(s.gs.players ?? []),
    { ...opp, seat, user_id: `p${seat}`, username: `p${seat}`, cards: [] },
  ];
  const dealtSeatIds = [...((s.gs as { dealtSeatIds?: number[] }).dealtSeatIds ?? []), seat];
  return { player: s.player, gs: { ...s.gs, players, dealtSeatIds } as HorseGameStateV2 };
}

function ratioOf(
  label: string,
  nodes: ReadonlyArray<{ player: SeatPlayer; gs: HorseGameStateV2 }>,
  on: Record<string, boolean>,
  off: Record<string, boolean>
): number {
  const cost = measureRelativeCost(
    () => {
      for (const n of nodes) decide(n.player, n.gs, on);
    },
    () => {
      for (const n of nodes) decide(n.player, n.gs, off);
    },
    { warmupRounds: 1, rounds: 3 }
  );
  console.info(
    `[facing-bet price ${label}] on ${(cost.subjectMs / nodes.length).toFixed(2)} ms, off ${(cost.referenceMs / nodes.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
  );
  return cost.ratio;
}

describe('LAW: the corrected PLO facing-bet price is cheap where it applies', () => {
  const states = loadPricedStates().filter((s) => s.gs.stage === 'turn' || s.gs.stage === 'river');

  it('heads-up turn and river facing a bet: F1, F2 and F6 on cost a bounded multiple of off', () => {
    const nodes = states.slice(0, 30);
    const on = {
      omahaFacingBetRangeIsMeasuredByLine: true,
      omahaFacingBetIndifferenceCalls: true,
      omahaFacingBetMinimumDefencePrior: true,
    };
    expect(ratioOf('F1 F2 F6 heads-up', nodes, on, {})).toBeLessThan(RATIO);
  }, 300_000);

  it('three-way facing a bet: M1 and M2 (with F1) on cost a bounded multiple of off', () => {
    const nodes = states
      .map((s) => threeWay(s))
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .slice(0, 20);
    const on = {
      omahaFacingBetRangeIsMeasuredByLine: true,
      omahaFacingBetFieldIsJoint: true,
      omahaMultiwayCallNeedsNutShare: true,
    };
    expect(ratioOf('F1 M1 M2 three-way', nodes, on, {})).toBeLessThan(RATIO);
  }, 300_000);
});
