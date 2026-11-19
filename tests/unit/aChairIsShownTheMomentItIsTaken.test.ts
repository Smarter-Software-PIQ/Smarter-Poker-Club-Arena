/**
 * A CHAIR IS SHOWN THE MOMENT IT IS TAKEN (Dan 2026-11-17): the engine's
 * per-seat `seat_arrival` reaches the seat, and the hero's own buying-in echo
 * never marks the hero seated before chips move (the hero's own tap is drawn
 * by TablePage's pendingSeat). See server/src/engine/SeatArrivalDisplay.ts.
 */
import { describe, expect, it } from 'vitest';
import { mapEngineSnapshot } from '@/utils/mapEngineSnapshot';

function snapshot(players: unknown[]) {
  return {
    table_id: 't-1',
    pot: 0,
    current_bet: 0,
    stage: 'flop',
    dealer_seat: 1,
    max_seats: 6,
    players,
    action_history: [],
    community_cards: [],
    winners: [],
    disconnect_states: {},
  } as unknown as Parameters<typeof mapEngineSnapshot>[0];
}
const chair = (user: string, seat: number, arrival?: string, stack = 0) => ({
  seat,
  user_id: user,
  username: user,
  avatar_url: `${user}.png`,
  stack,
  cards: [],
  is_sitting_out: true,
  ...(arrival ? { seat_arrival: arrival } : {}),
});

describe('mapEngineSnapshot seat arrivals', () => {
  it("draws another player's buying-in chair with their face and no stack", () => {
    const mapped = mapEngineSnapshot(snapshot([chair('woowoo', 6, 'buying_in')]), 'hero', 6);
    expect(mapped.players[5]).toMatchObject({
      id: 'woowoo',
      avatar: 'woowoo.png',
      seatArrival: 'buying_in',
      stackPending: true,
      isHero: false,
    });
  });

  it('draws a committed arrival with its stack', () => {
    const mapped = mapEngineSnapshot(snapshot([chair('woowoo', 6, 'seated', 1000)]), 'hero', 6);
    expect(mapped.players[5]).toMatchObject({ id: 'woowoo', stack: 1000, seatArrival: 'seated' });
    expect(mapped.players[5]?.stackPending).toBeUndefined();
  });

  /* Dan 2026-11-18: "WHEN A PLAYER JOINS A TABLE IN BETWEEN THE BLINDS OR ANY
     OTHER REASON, THEIR STACK SHOULD SHOW, IT SHOULD NEVER SAY ZERO." A
     tournament arrival (move, table break, late registration, re-entry) is
     the same `seated` arrival with the committed stack. */
  it('draws a tournament arrival with its real stack, for the hero too', () => {
    const mapped = mapEngineSnapshot(
      snapshot([chair('mover', 4, 'seated', 23500), chair('hero', 2, 'seated', 18000)]),
      'hero',
      6
    );
    expect(mapped.players[3]).toMatchObject({ id: 'mover', stack: 23500, seatArrival: 'seated' });
    expect(mapped.players[3]?.stackPending).toBeUndefined();
    expect(mapped.players[1]).toMatchObject({
      id: 'hero',
      stack: 18000,
      seatArrival: 'seated',
      isHero: true,
    });
  });

  it('never draws a committed arrival as zero: chips not on the row yet read as pending', () => {
    const mapped = mapEngineSnapshot(snapshot([chair('mover', 4, 'seated', 0)]), 'hero', 6);
    expect(mapped.players[3]).toMatchObject({
      id: 'mover',
      seatArrival: 'seated',
      stackPending: true,
    });
  });

  it("never reads the hero's own buying-in echo as a seat", () => {
    const mapped = mapEngineSnapshot(snapshot([chair('hero', 3, 'buying_in')]), 'hero', 6);
    expect(mapped.players[2]).toBeNull();
  });

  it('ignores an unknown arrival value from a newer engine', () => {
    const mapped = mapEngineSnapshot(snapshot([chair('woowoo', 6, 'teleporting')]), 'hero', 6);
    expect(mapped.players[5]?.seatArrival).toBeUndefined();
  });
});
