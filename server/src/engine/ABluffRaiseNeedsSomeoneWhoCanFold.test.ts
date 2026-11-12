/**
 * A BLUFF RAISE NEEDS SOMEONE WHO CAN FOLD.
 *
 * Finding HVH2D-TRN-001, row 8 (two-day Human vs Horse study, 2026-11-12).
 * KJo in the big blind with 59 big blinds faced an all-in for more than its
 * stack. The reference policy drew its 3-bet bluff branch and returned a
 * raise, which at that price can only be a call for the whole stack against
 * a player who cannot fold. In production the tournament utility arbiter then
 * folded it, for an unrelated and wrong reason (a mispriced rebuy). With that
 * pricing corrected the call-off would have stood.
 *
 * The 3-bet bluff branch now requires that hero can raise (the price to call
 * is less than hero's stack) and that somebody is left to fold (the lone
 * raiser is not already all in). The condition is tested after the draw, so
 * the random stream of every other decision is unchanged.
 *
 * The request is the anonymised decision-time body from the production
 * journal, replayed from the generator state the journal recorded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, type HorseGameStateV2 } from './HorseLogic.js';
import { HorseMind } from './HorseMind.js';
import { restoreFastRandom } from './HorseEval.js';
import type { SeatPlayer } from '../types.js';
import FIXTURE from './ABluffRaiseNeedsSomeoneWhoCanFold.fixture.json';

interface Decided {
  action: string;
  preflopAuthority?: {
    referenceAction: string;
    intent: { a: string };
    events: { branch: string }[];
  };
}

function decide(shape: (gs: HorseGameStateV2, player: SeatPlayer) => void = () => {}): Decided {
  const gs = structuredClone(FIXTURE.gameState) as unknown as HorseGameStateV2;
  const player = structuredClone(FIXTURE.player) as unknown as SeatPlayer;
  shape(gs, player);
  HorseMind.reset();
  restoreFastRandom(FIXTURE.rngBefore);
  return HorseLogic.decide(
    player,
    gs,
    FIXTURE.style as never,
    FIXTURE.mods as never,
    {
      decisionTimeMs: FIXTURE.decisionTimeMs,
      deepEquity: FIXTURE.deepEquity,
      telemetry: true,
    } as never
  ) as unknown as Decided;
}

describe('a bluff raise needs someone who can fold (HVH2D-TRN-001 row 8)', () => {
  afterEach(() => HorseMind.reset());

  it('is KJo facing an all-in for more than its stack', () => {
    const gs = FIXTURE.gameState;
    expect(FIXTURE.player.cards.map((c) => c.rank).sort()).toEqual(['J', 'K']);
    expect(gs.toCall).toBeGreaterThanOrEqual(FIXTURE.player.stack);
    expect(gs.players.some((p) => p.is_all_in)).toBe(true);
  });

  it('does not take the 3-bet bluff branch when the raise could only be a call', () => {
    const decision = decide();
    // Before the correction: events [three_bet_bluff], intent raiseTo, reference all_in.
    expect(decision.preflopAuthority?.events.map((e) => e.branch)).not.toContain('three_bet_bluff');
    expect(decision.preflopAuthority?.referenceAction).toBe('fold');
    expect(decision.action).toBe('fold');
  });
});
