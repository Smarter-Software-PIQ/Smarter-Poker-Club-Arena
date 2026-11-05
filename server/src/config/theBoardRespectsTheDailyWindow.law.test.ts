/**
 * The board respects the daily window (owner, 2026-11-03): tournaments start
 * only from 6:00 AM to 11:00 PM Chicago; the 4 to 6 AM window and the night
 * before it hold no start. The database policy row
 * (smarter_private.daily_window_policy) holds the same bounds. One carve-out
 * (owner 2026-11-04): the Midway Union's 12:30 AM Midnight Free Buy.
 */
import { describe, it, expect } from 'vitest';
import {
  FIXED_BOARD,
  FIXED_BOARD_CLUBS,
  FIXED_BOARD_TIME_ZONE,
  isRetiredMidwayBoardEvent,
} from './fixedBoard.js';
import { DAILY_WINDOW_CARVE_OUT } from '../maintenance/dailyWindow.js';

const FIRST = '06:00';
const LAST = '23:00';

describe('the board respects the daily window', () => {
  it('reads Chicago wall-clock time', () => {
    expect(FIXED_BOARD_TIME_ZONE).toBe('America/Chicago');
  });
  it('starts every event between 6:00 AM and 11:00 PM, but the one carve-out', () => {
    // Owner 2026-11-04: exactly one carve-out, the Midway Union's 12:30 AM
    // Midnight Free Buy. No other room runs it.
    const outside = FIXED_BOARD_CLUBS.flatMap((c) =>
      FIXED_BOARD.filter((e) => !isRetiredMidwayBoardEvent(c.clubId, e.name)).flatMap((e) =>
        e.times.filter((t) => t < FIRST || t > LAST).map((t) => `${c.label} ${e.name} ${t}`)
      )
    );
    expect(outside).toEqual(['Midway Union Midnight Free Buy (NLH) 00:30']);
    expect(DAILY_WINDOW_CARVE_OUT).toEqual({
      unionId: FIXED_BOARD_CLUBS[0].unionId,
      name: 'Midnight Free Buy (NLH)',
      start: '00:30',
    });
  });
});
