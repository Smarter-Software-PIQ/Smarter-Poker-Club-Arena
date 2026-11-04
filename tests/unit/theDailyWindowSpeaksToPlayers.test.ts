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

describe('a one-off tournament keeps the daily hours', () => {
  it('refuses a timed start outside 6:00 AM to 11:00 PM Chicago and accepts one inside', async () => {
    const { tournamentRpcConfigRefusal, startsInDailyHours, TOURNAMENT_CREATE_ERRORS } =
      await import('../../src/lib/tournamentCreationRules');
    const base = {
      type: 'mtt',
      buyIn: 10,
      startingStack: 10000,
      tableSize: 9,
      gameVariant: 'NLH',
      payoutStructure: [{ place: 1, percentage: 100 }],
      lateRegistrationLevels: 8,
    };
    const nowMs = Date.parse('2030-01-14T12:00:00Z');
    expect(
      tournamentRpcConfigRefusal({ ...base, startTime: '2030-01-15T08:00:00Z' }, { nowMs })
    ).toBe('tournament_start_outside_daily_hours'); // 2:00 AM Chicago
    expect(
      tournamentRpcConfigRefusal({ ...base, startTime: '2030-01-16T02:00:00Z' }, { nowMs })
    ).toBeNull(); // 8:00 PM Chicago
    expect(
      tournamentRpcConfigRefusal({ ...base, type: 'sng', startTime: '2030-01-15T08:00:00Z' }, { nowMs })
    ).not.toBe('tournament_start_outside_daily_hours');
    expect(startsInDailyHours(Date.parse('2030-07-15T11:00:00Z'))).toBe(true); // 6:00 AM CDT
    expect(startsInDailyHours(Date.parse('2030-07-15T04:01:00Z'))).toBe(false); // 11:01 PM CDT
    expect(TOURNAMENT_CREATE_ERRORS.tournament_start_outside_daily_hours).toContain('6:00 AM To 11:00 PM');
  });
});
