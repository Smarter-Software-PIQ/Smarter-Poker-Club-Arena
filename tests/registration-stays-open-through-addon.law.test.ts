import { describe, expect, it } from 'vitest';
import { isInLateRegistration } from '../src/utils/tournamentFilters';
import { lateRegEndMs } from '../src/components/lobby/lateRegWindow';
import { lateRegCountdown } from '../src/components/lobby/lateRegCountdown';
import type { LobbyTournamentRow } from '../src/components/lobby/lobbyEntries';
const now = Date.parse('2026-11-06T02:44:00Z');
const row = (changes: Record<string, unknown> = {}) => ({
  name: 'Nightly',
  start_time: '2026-11-06T01:00:00Z',
  max_players: null,
  status: 'RUNNING',
  late_reg_levels: 9,
  rebuy_levels: 9,
  started_at: '2026-11-06T01:00:00Z',
  prize_pool_finalized: false,
  ...changes,
});
describe('registration remains open through the actual add-on minute', () => {
  const addon = (changes: Record<string, unknown> = {}) =>
    row({
      add_on_available: true,
      late_reg_mins: 1,
      current_level: 9,
      addon_period_triggered: false,
      addon_period_started_at: null,
      addon_period_ends_at: null,
      ...changes,
    });
  it('keeps buy-ins open while the add-on is pending despite both old cutoffs', () => {
    expect(isInLateRegistration(addon(), now)).toBe(true);
    expect(lateRegEndMs(addon() as LobbyTournamentRow)).toBeNull();
  });
  it('does not confuse an expired legacy early offer with the closing minute', () => {
    const t = addon({
      addon_from_start: true,
      addon_period_started_at: new Date(now - 120000).toISOString(),
      addon_period_ends_at: new Date(now - 1).toISOString(),
    });
    expect(isInLateRegistration(t, now)).toBe(true);
    expect(lateRegEndMs(t as LobbyTournamentRow)).toBeNull();
  });
  /* Dan 2026-11-06, "FIX IT SO IT ALWAYS SHOWS THE COUNT DOWN": the Nightly 10K
     (rebuy and add-on) said "Late Reg Open" with no clock for its whole late
     registration, because the add-on end is only stamped when the add-on
     minute begins. Before that minute the countdown runs to the level/clock
     boundary that opens it. Production row 66eb539e, 2026-11-07. */
  it('counts down to the add-on minute before it is stamped (no breaks taken)', () => {
    // No format_contract: this fixture takes no synchronized break, so the
    // walk is pure level clock. Break handling is pinned in lateRegCountdown.test.ts.
    const now = Date.parse('2026-11-07T01:40:00Z');
    const tenK = addon({
      started_at: '2026-11-07T01:00:00+00:00',
      late_reg_mins: 90,
      late_reg_levels: 9,
      current_level: 3,
      level_started_at: '2026-11-07T01:35:01.264+00:00',
      blind_structure: JSON.stringify(
        Array.from({ length: 40 }, (_, i) => ({ level: i + 1, durationMinutes: 10 }))
      ),
    });
    const end = (row: Record<string, unknown>, at = now) =>
      lateRegCountdown(row as LobbyTournamentRow, at)?.endMs ?? null;
    // The strict deadline stays unknown: Details and the table never print a guess.
    expect(lateRegEndMs(tenK as LobbyTournamentRow)).toBeNull();
    // Level 9 ends 02:35:01 and opens the 60-second add-on minute. The 90-minute
    // clock (02:30) never closes an add-on event's entry: on 2026-11-07 counting
    // to it put "Late Reg Open" back on the card at 02:30.
    expect(end(tenK)).toBe(Date.parse('2026-11-07T02:36:01.264Z'));
    // The seating gap before the first level stamp estimates nine levels from the start.
    expect(end({ ...tenK, current_level: 0, level_started_at: null })).toBe(
      Date.parse('2026-11-07T02:31:00Z')
    );
    // A non-add-on event still closes at whichever of levels and minutes comes first.
    expect(end({ ...tenK, add_on_available: false, late_reg_mins: 60 })).toBe(
      Date.parse('2026-11-07T02:00:00Z')
    );
    // Once the add-on minute is stamped, its real end takes over.
    const stamped = {
      ...tenK,
      addon_period_triggered: true,
      addon_period_started_at: '2026-11-07T02:30:05Z',
      addon_period_ends_at: '2026-11-07T02:31:05Z',
    };
    expect(lateRegCountdown(stamped as LobbyTournamentRow, now)).toEqual({
      endMs: Date.parse('2026-11-07T02:31:05Z'),
      phase: 'add_on',
    });
    expect(end({ ...tenK, prize_pool_finalized: true })).toBeNull();
    expect(end({ ...tenK, started_at: null, level_started_at: null })).toBeNull();
  });
  it('uses the actual end and closes exactly at it', () => {
    const t = addon({
      addon_period_triggered: true,
      addon_period_started_at: new Date(now - 60000).toISOString(),
      addon_period_ends_at: new Date(now).toISOString(),
    });
    expect(isInLateRegistration(t, now - 1)).toBe(true);
    expect(isInLateRegistration(t, now)).toBe(false);
    expect(isInLateRegistration(t, now + 1)).toBe(false);
    expect(lateRegEndMs(t as LobbyTournamentRow)).toBe(now);
  });
  it.each([
    { prize_pool_finalized: true },
    { status: 'COMPLETED' },
    { current_level: -1 },
    { addon_period_ends_at: 'invalid' },
  ])('preserves refusal for %j', (changes) => {
    expect(isInLateRegistration(addon(changes), now)).toBe(false);
  });
});
