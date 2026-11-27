/**
 * LAW: THE MULTIWAY RIVER BLUFF PRICE IS CHEAP WHERE IT APPLIES (PLO-OWNER lead-9 lane underbluff, 2026-11-27;
 * omahaMultiwayRiverBluffIsPricedOnBlockers, default OFF). Its work is the exact card-removal bins of the board
 * (once, the same call the heads-up river opening price makes) and one arithmetic price per opponent. Measured the
 * way theServerSuiteAssertsNoTightWallClockBound requires (src/testing/relativeCost.ts): on three-way and six-way
 * river nodes the whole rule costs at most RATIO times the bins alone on the same nodes.
 */
import { describe, expect, it } from 'vitest';
import type { HorseDecision, SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { measureRelativeCost } from '../testing/relativeCost.js';
import {
  omahaMultiwayRiverBluffRule,
  omahaMultiwayRiverBluffSpot,
} from './HorseOmahaMultiwayRiverBluff.js';
import { omahaRiverOpeningBins } from './HorseOmahaRiverOpeningBet.js';
import { RIVER_OPENING_FIXTURE } from './HorseOmahaRiverOpeningBet.test-support.js';

const RATIO = 3;
const CHECK = { action: 'check', amount: 0 } as HorseDecision;

/** A real river node with every folded seat put back in (up to five opponents), nothing to call. */
function field(i: number): { player: SeatPlayer; gs: HorseGameStateV2 } | null {
  const n = RIVER_OPENING_FIXTURE.nodes[i]!;
  const gs = structuredClone(n.gs) as HorseGameStateV2;
  for (const p of gs.players ?? [])
    if (p.seat !== n.player.seat) {
      p.is_folded = false;
      p.is_all_in = false;
      p.stack = Math.max(p.stack, gs.pot);
    }
  gs.actionHistory = (gs.actionHistory ?? []).filter((a) => String(a.stage) !== 'river');
  return omahaMultiwayRiverBluffSpot(n.player, gs) ? { player: n.player, gs } : null;
}

describe('LAW: the multiway river bluff price is cheap where it applies', () => {
  it('the whole rule costs a bounded multiple of the exact bins it shares with the heads-up river price', () => {
    const nodes = RIVER_OPENING_FIXTURE.nodes
      .map((_, i) => field(i))
      .filter((x): x is { player: SeatPlayer; gs: HorseGameStateV2 } => x !== null)
      .filter((_, i) => i < 30);
    expect(nodes.length).toBeGreaterThanOrEqual(20);
    const cost = measureRelativeCost(
      () => {
        for (const x of nodes)
          omahaMultiwayRiverBluffRule(
            CHECK,
            x.player,
            x.gs,
            true,
            0.04,
            (d) => d,
            () => null
          );
      },
      () => {
        for (const x of nodes)
          omahaRiverOpeningBins(
            x.player.cards,
            x.gs.communityCards ?? [],
            x.player.knownDeadCards ?? []
          );
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(
      `[multiway river bluff] rule ${(cost.subjectMs / nodes.length).toFixed(2)} ms, bins ${(cost.referenceMs / nodes.length).toFixed(2)} ms per decision, ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`
    );
    expect(cost.ratio).toBeLessThan(RATIO);
  }, 300_000);
});
