/**
 * The board respects the daily window (owner, 2026-11-03): tournaments start
 * only from 6:00 AM to 11:00 PM Chicago; the 4 to 6 AM window and the night
 * before it hold no start. The database policy row
 * (smarter_private.daily_window_policy) holds the same bounds.
 */
import { describe, it, expect } from 'vitest';
import { FIXED_BOARD, FIXED_BOARD_TIME_ZONE } from './fixedBoard.js';

const FIRST = '06:00';
const LAST = '23:00';

describe('the board respects the daily window', () => {
  it('reads Chicago wall-clock time', () => {
    expect(FIXED_BOARD_TIME_ZONE).toBe('America/Chicago');
  });
  it('starts every event between 6:00 AM and 11:00 PM', () => {
    const outside = FIXED_BOARD.flatMap((e) =>
      e.times.filter((t) => t < FIRST || t > LAST).map((t) => `${e.name} ${t}`)
    );
    expect(outside).toEqual([]);
  });
});
