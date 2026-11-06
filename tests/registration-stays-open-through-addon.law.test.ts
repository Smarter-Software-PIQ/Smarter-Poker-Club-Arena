import { describe, expect, it } from 'vitest';
import { isInLateRegistration } from '../src/utils/tournamentFilters';
import { lateRegEndMs } from '../src/components/lobby/lateRegWindow';
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
