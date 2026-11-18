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
 * A bluff 3-bet or squeeze now requires that the hero can raise (the price to
 * call is less than the hero's stack) and that at least one opponent still in
 * the hand has chips, so somebody can fold. Raising over a short all-in to
 * fold the players behind, or to build a side pot against a caller with
 * chips, is unchanged. The condition is tested after the draw, so the random
 * stream of every other decision is unchanged.
 *
 * The request is the anonymised decision-time body from the production
 * journal, replayed from the generator state the journal recorded.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { HorseLogic, everyLiveOpponentIsAllIn, type HorseGameStateV2 } from './HorseLogic.js';
import { bluffRaiseCanFoldSomeone } from './HorsePreflop.js';
import { HorseMind } from './HorseMind.js';
import { restoreFastRandom } from './HorseEval.js';
import { drainFires, enableBrainTelemetry } from './BrainTelemetry.js';
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

  it('counts the refused bluff raise once, so the fix can be read from telemetry', () => {
    enableBrainTelemetry();
    drainFires();
    decide();
    const fired = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(fired.bluff_raise_refused_no_fold_equity_seen).toBe(1);
  });

  it('counts nothing when somebody can fold, and decides the same either way', () => {
    // The same hand with the all-in player given chips behind: the bluff
    // branch is free to raise, so nothing was refused.
    enableBrainTelemetry();
    drainFires();
    const shape = (gs: HorseGameStateV2, player: SeatPlayer) => {
      gs.players.find((p) => p.seat === player.seat)!.stack = 6_000;
      player.stack = 6_000;
      gs.legalActions = ['fold', 'call', 'raise', 'all_in'];
      for (const p of gs.players) if (p.is_all_in) p.is_all_in = false;
    };
    const decision = decide(shape);
    const fired = Object.fromEntries(drainFires().map((r) => [r.feature, r.fires]));
    expect(fired.bluff_raise_refused_no_fold_equity_seen).toBeUndefined();
    expect(decision.preflopAuthority?.events.map((e) => e.branch)).toContain('three_bet_bluff');
  });
});

describe('the hero has more chips than the all-in, and nobody else is in', () => {
  afterEach(() => HorseMind.reset());

  it('does not re-raise as a bluff over a lone all-in that nobody else can fold to', () => {
    // 120 big blinds against the same 61 big blind all-in: a raise is now
    // legal, but the only opponent is all in. Before the correction this
    // returned the bluff raise.
    const decision = decide((gs, player) => {
      gs.players.find((p) => p.seat === player.seat)!.stack = 6_000;
      player.stack = 6_000;
      gs.legalActions = ['fold', 'call', 'raise', 'all_in'];
    });
    expect(decision.preflopAuthority?.events.map((e) => e.branch)).not.toContain('three_bet_bluff');
  });
});

describe('who can still fold', () => {
  const seat = (n: number, over: Partial<{ is_folded: boolean; is_all_in: boolean }> = {}) => ({
    seat: n,
    is_folded: false,
    is_all_in: false,
    ...over,
  });

  it('nobody, when every opponent still in the hand is all in', () => {
    expect(everyLiveOpponentIsAllIn([seat(1), seat(2, { is_all_in: true })], 1)).toBe(true);
    expect(
      everyLiveOpponentIsAllIn(
        [
          seat(1),
          seat(2, { is_all_in: true }),
          seat(3, { is_all_in: true }),
          seat(4, { is_folded: true }),
        ],
        1
      )
    ).toBe(true);
  });

  it('a player behind with chips, so isolating a short all-in keeps its fold equity', () => {
    expect(everyLiveOpponentIsAllIn([seat(1), seat(2, { is_all_in: true }), seat(3)], 1)).toBe(
      false
    );
  });

  it('a caller with chips, so a side pot can still be contested', () => {
    expect(
      everyLiveOpponentIsAllIn(
        [seat(1), seat(2, { is_all_in: true }), seat(3), seat(4, { is_folded: true })],
        1
      )
    ).toBe(false);
  });

  it('is false with no live opponent at all', () => {
    expect(everyLiveOpponentIsAllIn([seat(1), seat(2, { is_folded: true })], 1)).toBe(false);
  });

  it('a bluff raise is allowed only when the hero can raise and somebody can fold', () => {
    expect(bluffRaiseCanFoldSomeone(300, 3_000, false)).toBe(true);
    expect(bluffRaiseCanFoldSomeone(300, 3_000, undefined)).toBe(true);
    expect(bluffRaiseCanFoldSomeone(300, 3_000, true)).toBe(false);
    expect(bluffRaiseCanFoldSomeone(3_025, 2_950, false)).toBe(false);
    expect(bluffRaiseCanFoldSomeone(3_000, 3_000, false)).toBe(false);
  });
});
