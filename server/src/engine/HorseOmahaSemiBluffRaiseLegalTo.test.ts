/**
 * AUDIT-B item 10 (EMERG lane RULES-FIX-1 2026-11-21): the priced semi-bluff raise is moved up to the minimum raise
 * only heads-up and only when the state carries the minimum; otherwise it stands aside (omahaSemiBluffRaiseLegalTo).
 */
import { describe, expect, it } from 'vitest';
import type { SeatPlayer } from '../types.js';
import type { HorseGameStateV2 } from './HorseLogic.js';
import { omahaSemiBluffRaiseLegalTo } from './HorseOmahaPricedWiring.js';

const seat = (n: number, extra: Partial<SeatPlayer> = {}): SeatPlayer =>
  ({
    seat: n,
    user_id: `u${n}`,
    stack: 1000,
    bet: 0,
    is_folded: false,
    is_sitting_out: false,
    ...extra,
  }) as SeatPlayer;
const hero = seat(1);
const state = (players: SeatPlayer[], extra: Partial<HorseGameStateV2> = {}): HorseGameStateV2 =>
  ({ players, currentBet: 96, minRaiseTo: 192, maxRaiseTo: 600, ...extra }) as HorseGameStateV2;

describe('omahaSemiBluffRaiseLegalTo (the R1 minimum-raise clamp)', () => {
  it('heads-up: a size under the minimum (he covers 191) is made at the minimum; a legal size is kept', () => {
    const hu = state([hero, seat(2)]);
    expect(omahaSemiBluffRaiseLegalTo(191, hero, hu)).toBe(192);
    expect(omahaSemiBluffRaiseLegalTo(300, hero, hu)).toBe(300);
  });
  it('multiway: a size under the minimum is not made (the minimum is an unpriced size for the deeper opponents)', () => {
    const three = state([hero, seat(2, { stack: 95 }), seat(3, { stack: 5000 })]);
    expect(omahaSemiBluffRaiseLegalTo(191, hero, three)).toBeNull();
    expect(omahaSemiBluffRaiseLegalTo(300, hero, three)).toBe(300);
    // a folded or sitting-out seat is not an opponent
    const huAgain = state([
      hero,
      seat(2),
      seat(3, { is_folded: true }),
      seat(4, { is_sitting_out: true }),
    ]);
    expect(omahaSemiBluffRaiseLegalTo(191, hero, huAgain)).toBe(192);
  });
  it('no minimum on the state: no size can be proved legal, so none is made (before: 191 passed unclamped)', () => {
    const noMin = state([hero, seat(2)], { minRaiseTo: undefined });
    expect(omahaSemiBluffRaiseLegalTo(191, hero, noMin)).toBeNull();
    expect(omahaSemiBluffRaiseLegalTo(300, hero, noMin)).toBeNull();
  });
  it('above the pot-limit maximum, or not a number: not made', () => {
    expect(omahaSemiBluffRaiseLegalTo(601, hero, state([hero, seat(2)]))).toBeNull();
    expect(omahaSemiBluffRaiseLegalTo(Number.NaN, hero, state([hero, seat(2)]))).toBeNull();
  });
});
