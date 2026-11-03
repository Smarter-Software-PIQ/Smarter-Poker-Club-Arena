import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  DAILY_WINDOW,
  chicagoClock,
  spinSngBoardsOpen,
  tournamentStartAllowed,
} from './dailyWindow.js';

const chicago = (iso: string) => new Date(iso); // ISO with explicit offset

describe('the engine daily window', () => {
  it('equals the database policy row', () => {
    const dir = path.resolve(__dirname, '../../../supabase/migrations');
    const f = fs
      .readdirSync(dir)
      .find((x) => x.endsWith('_daily_window_policy_and_tournament_hours.sql'));
    const sql = fs.readFileSync(path.join(dir, f!), 'utf8');
    expect(sql).toContain(`time_zone text NOT NULL DEFAULT '${DAILY_WINDOW.timeZone}'`);
    expect(sql).toContain(`spin_sng_stop time NOT NULL DEFAULT '${DAILY_WINDOW.spinSngStop}'`);
    expect(sql).toContain(`window_start time NOT NULL DEFAULT '${DAILY_WINDOW.windowStart}'`);
    expect(sql).toContain(`window_end time NOT NULL DEFAULT '${DAILY_WINDOW.windowEnd}'`);
    expect(sql).toContain(
      `first_tournament_start time NOT NULL DEFAULT '${DAILY_WINDOW.firstTournamentStart}'`
    );
    expect(sql).toContain(
      `last_tournament_start time NOT NULL DEFAULT '${DAILY_WINDOW.lastTournamentStart}'`
    );
  });
  it('reads the Chicago wall clock in winter and summer', () => {
    expect(chicagoClock(chicago('2026-11-04T03:00:00-06:00'))).toBe('03:00');
    expect(chicagoClock(chicago('2026-07-01T03:00:00-05:00'))).toBe('03:00');
  });
  it('closes Spin and Sit & Go boards from 3:00 AM to 6:00 AM only', () => {
    expect(spinSngBoardsOpen(chicago('2026-11-04T02:59:00-06:00'))).toBe(true);
    expect(spinSngBoardsOpen(chicago('2026-11-04T03:00:00-06:00'))).toBe(false);
    expect(spinSngBoardsOpen(chicago('2026-11-04T05:59:00-06:00'))).toBe(false);
    expect(spinSngBoardsOpen(chicago('2026-11-04T06:00:00-06:00'))).toBe(true);
    expect(spinSngBoardsOpen(chicago('2026-07-01T04:30:00-05:00'))).toBe(false);
  });
  it('lets a tournament start from 6:00 AM to 11:00 PM Chicago only', () => {
    expect(tournamentStartAllowed(chicago('2026-11-04T05:59:00-06:00'))).toBe(false);
    expect(tournamentStartAllowed(chicago('2026-11-04T06:00:00-06:00'))).toBe(true);
    expect(tournamentStartAllowed(chicago('2026-11-04T23:00:00-06:00'))).toBe(true);
    expect(tournamentStartAllowed(chicago('2026-11-04T23:01:00-06:00'))).toBe(false);
    expect(tournamentStartAllowed(chicago('2026-11-05T02:00:00-06:00'))).toBe(false);
    // 10:30 UTC is 4:30 AM in winter and 5:30 AM in summer: closed in both.
    expect(tournamentStartAllowed(new Date('2026-01-15T10:30:00Z'))).toBe(false);
    expect(tournamentStartAllowed(new Date('2026-07-15T10:30:00Z'))).toBe(false);
    expect(tournamentStartAllowed(new Date('2026-07-15T11:30:00Z'))).toBe(true);
  });
});
