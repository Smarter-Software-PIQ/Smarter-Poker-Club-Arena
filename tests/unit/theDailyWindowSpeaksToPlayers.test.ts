/**
 * The daily window speaks to players in words, not codes (owner, 2026-11-03).
 * Every registration door answers daily_maintenance_window (4:00 to 6:00 AM)
 * or spin_sng_closed_until_reopen (Spins and Sit & Gos from 3:00 AM), and the
 * schedule writer answers tournament_start_outside_daily_hours.
 */
import { describe, it, expect } from 'vitest';
import {
  registerReasonText,
  seatFirstBuyInReasonIsKnown,
  seatFirstBuyInRefusalText,
  DAILY_WINDOW_CLOSED_MESSAGE,
  SPIN_SNG_CLOSED_MESSAGE,
} from '../../src/services/TournamentService';
import { scheduleErrorText } from '../../src/services/TournamentScheduleService';
import { DAILY_WINDOW } from '../../server/src/maintenance/dailyWindow';

const hour = (hhmm: string) => `${Number(hhmm.slice(0, 2))}:${hhmm.slice(3)}`;

describe('the daily window speaks to players', () => {
  it('names the closed hours and the reopening at the lobby door', () => {
    expect(registerReasonText('daily_maintenance_window')).toBe(DAILY_WINDOW_CLOSED_MESSAGE);
    expect(registerReasonText('spin_sng_closed_until_reopen')).toBe(SPIN_SNG_CLOSED_MESSAGE);
    expect(DAILY_WINDOW_CLOSED_MESSAGE).toContain(`${hour(DAILY_WINDOW.windowStart)} To ${hour(DAILY_WINDOW.windowEnd)} AM Chicago`);
    expect(DAILY_WINDOW_CLOSED_MESSAGE).toContain(`Open Again At ${hour(DAILY_WINDOW.firstTournamentStart)} AM`);
    expect(SPIN_SNG_CLOSED_MESSAGE).toContain(`Close At ${hour(DAILY_WINDOW.spinSngStop)} AM Chicago`);
    expect(SPIN_SNG_CLOSED_MESSAGE).toContain(`Open Again At ${hour(DAILY_WINDOW.windowEnd)} AM`);
  });

  it('answers the seat-first door with the same words, never a generic retry', () => {
    for (const [code, text] of [
      ['daily_maintenance_window', DAILY_WINDOW_CLOSED_MESSAGE],
      ['spin_sng_closed_until_reopen', SPIN_SNG_CLOSED_MESSAGE],
    ] as const) {
      expect(seatFirstBuyInReasonIsKnown(code)).toBe(true);
      expect(seatFirstBuyInRefusalText(code)).toBe(text);
    }
  });

  it('tells a club owner the allowed start hours', () => {
    const text = scheduleErrorText('tournament_start_outside_daily_hours');
    expect(text).toContain('6:00 AM To 11:00 PM Chicago');
    expect(DAILY_WINDOW.firstTournamentStart).toBe('06:00');
    expect(DAILY_WINDOW.lastTournamentStart).toBe('23:00');
  });
});
