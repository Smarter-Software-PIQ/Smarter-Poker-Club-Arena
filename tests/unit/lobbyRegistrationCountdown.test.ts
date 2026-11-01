import { describe, expect, it } from 'vitest';
import {
  formatClock,
  mttPhaseText,
  tournamentEntry,
  tournamentStatus,
  type LobbyTournamentRow,
} from '../../src/components/lobby/lobbyEntries';

const NOW = Date.parse('2026-11-01T18:00:00Z');
const HOUR = 60 * 60 * 1000;
const row = (overrides: Partial<LobbyTournamentRow> = {}): LobbyTournamentRow => ({
  id: 'countdown-event',
  name: 'Nightly 10K (NLH)',
  game_type: 'NLH',
  format_contract: 'mtt-v2',
  buy_in_amount: 35,
  buy_in_fee: 0,
  guaranteed_prize: 10000,
  start_time: new Date(NOW + 59 * HOUR + 15 * 60000 + 8000).toISOString(),
  status: 'REGISTERING',
  current_players: 1,
  max_players: null,
  starting_chips: 20000,
  ...overrides,
});

// These expectations describe the elapsed duration, independently of calendar
// dates or local DST. The exact start instant remains on the entry for details.
describe('readable long lobby countdowns', () => {
  it.each([
    [59 * HOUR + 15 * 60000 + 8000, '2d 11h'],
    [24 * HOUR, '1d 0h'],
    [24 * HOUR - 1, '23:59:59'],
    [HOUR, '1:00:00'],
    [59999, '0:59'],
    [0, '0:00'],
    [-1, '0:00'],
  ])('formats %i ms as %s', (duration, expected) => {
    expect(formatClock(duration)).toBe(expected);
  });

  it('uses the short duration without changing the exact start instant', () => {
    const source = row();
    const entry = tournamentEntry(source, 'mtt');
    expect(mttPhaseText(entry, NOW)).toBe('Starts In 2d 11h');
    expect(entry.startTime).toBe(source.start_time);
    expect(entry.startValue).toBe(Date.parse(source.start_time));
  });

  it('waits for an authoritative start at the countdown boundary', () => {
    const source = row({ start_time: new Date(NOW).toISOString() });
    const entry = tournamentEntry(source, 'mtt');
    expect(mttPhaseText(entry, NOW)).toBe('Start Pending');
    expect(mttPhaseText(entry, NOW + 1)).toBe('Start Pending');
  });

  it('never displays a frozen zero while the start is still in the future', () => {
    const source = row({ start_time: new Date(NOW + 1).toISOString() });
    expect(mttPhaseText(tournamentEntry(source, 'mtt'), NOW)).toBe('Starts In 0:01');
  });
});

describe('registration labels preserve the underlying lifecycle', () => {
  it('shows Late Reg Open only inside the authoritative entry window', () => {
    const source = row({
      status: 'RUNNING',
      started_at: new Date(NOW - 30 * 60000).toISOString(),
      late_reg_mins: 60,
    });
    expect(tournamentStatus(source, NOW)).toEqual({ key: 'late_reg', label: 'Late Reg Open' });
    expect(tournamentStatus(source, NOW + 30 * 60000)).toEqual({
      key: 'running',
      label: 'Running',
    });
    const entry = tournamentEntry(source, 'mtt');
    expect(mttPhaseText(entry, NOW)).toBe('Late Reg Ends In 30:00');
    expect(mttPhaseText(entry, NOW + 30 * 60000)).toBe('Registration Closed');
  });

  it('never advertises entry for a finalized running event', () => {
    const source = row({ status: 'RUNNING', prize_pool_finalized: true, late_reg_levels: 5 });
    expect(tournamentStatus(source, NOW)).toEqual({ key: 'running', label: 'Running' });
    expect(mttPhaseText(tournamentEntry(source, 'mtt'), NOW)).toBe('Registration Closed');
  });

  it.each([
    ['spin-v1', 3],
    ['sng-v1', 2],
    ['seat-first-satellite-v1', 6],
  ] as const)('%s distinguishes available seats from the full running game', (format, capacity) => {
    for (const players of [0, capacity - 1]) {
      expect(
        tournamentStatus(
          row({ format_contract: format, max_players: capacity, current_players: players }),
          NOW
        )
      ).toEqual({ key: 'registering', label: 'Seats Available' });
    }
    expect(
      tournamentStatus(
        row({ format_contract: format, max_players: capacity, current_players: capacity }),
        NOW
      )
    ).toEqual({ key: 'running', label: 'Running' });
  });
});
