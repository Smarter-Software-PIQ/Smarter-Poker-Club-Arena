/**
 * #10741 (2026-11-13): four FLO8 .25/.50 Madness tables sat with six funded,
 * sat-in seats for hours. Their deal minimum is the full ring (six of six),
 * and seats moved in by must-move carry entry_hold 'moved', which keeps a seat
 * between the button and the big blind out until the button passes it. The
 * button only moves when a hand is dealt, so the hold could never end. A hold
 * that is the only reason the table is short now releases itself; anywhere
 * else it still holds. Seats are people and horses alike.
 */
import { describe, it, expect } from 'vitest';

const { ServerTableEngine } = await import('./ServerTableEngine.js');

const TABLE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

function engine(autoStart: number, holds: Array<'moved' | null>) {
  const e = new ServerTableEngine(TABLE) as any;
  e.tableInfo = {
    id: TABLE,
    club_id: 'club',
    cluster_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    small_blind: 0.25,
    big_blind: 0.5,
    game_variant: 'flo8',
    max_players: 6,
    game_type: 'cash',
    auto_start_players: autoStart,
  };
  e.lastButtonSeat = 1;
  e.lastBigBlindSeat = 3;
  const seats = holds.map((hold, i) => ({
    user_id: `aaaaaaaa-0000-0000-0000-00000000000${i + 1}`,
    username: `p${i + 1}`,
    stack: 50,
    seat_number: i + 1,
    is_horse: i % 2 === 1,
    entry_hold: hold,
  }));
  return { e, seats };
}

describe('a moved-seat hold on a table whose minimum is its full ring', () => {
  it('releases itself when it is the only reason the table cannot deal', () => {
    const { e, seats } = engine(6, ['moved', 'moved', 'moved', 'moved', 'moved', 'moved']);
    expect(e.minPlayersToDeal()).toBe(6);
    const admitted = e.admitMovedSeats(seats);
    expect(admitted.map((p: { seat_number: number }) => p.seat_number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(e.waitingForButton.size).toBe(0);
  });

  it('still holds the seats behind the blinds where the table can deal without them', () => {
    const { e, seats } = engine(2, ['moved', 'moved', 'moved', 'moved', 'moved', 'moved']);
    const admitted = e.admitMovedSeats(seats);
    // Seats 2 and 3 (after the button, up to the big blind) wait for the button.
    expect(admitted.map((p: { seat_number: number }) => p.seat_number)).toEqual([1, 4, 5, 6]);
    expect([...e.waitingForButton.keys()].sort()).toEqual([2, 3]);
  });

  it('never invents a seat: a table short of its minimum without any hold stays short', () => {
    const { e, seats } = engine(6, ['moved', null, 'moved', null, 'moved']);
    const admitted = e.admitMovedSeats(seats);
    // Five candidates against a minimum of six: the hold is not the reason, so it holds.
    expect(admitted.length).toBeLessThan(6);
    expect(admitted.some((p: { seat_number: number }) => p.seat_number === 3)).toBe(false);
  });
});
