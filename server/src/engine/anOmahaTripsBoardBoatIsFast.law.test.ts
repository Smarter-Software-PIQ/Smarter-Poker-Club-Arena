/**
 * LAW: THE TRIPS-BOARD FULL HOUSE TEST IS CHEAP (PLO-OWNER lead-7 2026-11-26). Its exact count (one pass over the
 * board's pair scores and a few holding counts) on the fixture's real river raises costs at most RATIO times the
 * engine's own river hand score of the same raises repeated 80 times (src/testing/relativeCost.ts; measured well under).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { measureRelativeCost } from '../testing/relativeCost.js';
import { scoreOmahaHiPartial } from './HorseEval.js';
import { omahaTripsBoardBoatBeatable } from './HorseOmahaTripsBoardBoat.js';

const RATIO = 4;
const FIX = JSON.parse(
  readFileSync(
    new URL('./HorseOmahaTripsBoardBoat.realHands.fixture.json', import.meta.url),
    'utf8'
  )
) as { nodes: { player: never; gs: { communityCards: never } }[] };

describe('LAW: the trips-board full house test is cheap', () => {
  it('costs a bounded multiple of scoring the hand 80 times', () => {
    const nodes = FIX.nodes.slice(0, 40);
    const cost = measureRelativeCost(
      () => {
        for (const n of nodes) omahaTripsBoardBoatBeatable(n.player, n.gs as never);
      },
      () => {
        for (const n of nodes)
          for (let i = 0; i < 80; i++)
            scoreOmahaHiPartial((n.player as { cards: never }).cards, n.gs.communityCards);
      },
      { warmupRounds: 1, rounds: 3 }
    );
    console.info(`[trips-board boat] ratio ${cost.ratio.toFixed(2)} (limit ${RATIO})`);
    expect(cost.ratio).toBeLessThan(RATIO);
  }, 120_000);
});
