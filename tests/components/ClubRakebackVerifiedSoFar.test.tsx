/**
 * VERIFIED SO FAR IN CLUB DATA (owner, 2026-10-31). Pins: the panel reads only
 * fn_club_rakeback_verified_so_far for its club; while the tally is still
 * counting the week it says how far it has counted and keeps asking until the
 * week is counted; viewers the server refuses see nothing; totals and players
 * are shown as estimates with the payout time.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: backend.rpc, from: backend.from } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import ClubRakebackVerifiedSoFar from '../../src/components/club/ClubRakebackVerifiedSoFar';

const answer = (complete: boolean, counted: number) => ({
  week_start: '2026-10-26T07:00:00+00:00',
  week_end: '2026-11-02T08:00:00+00:00',
  paid_at: '2026-11-02T10:00:00+00:00',
  tally: {
    complete,
    counted_through: '2026-10-27T00:00:00+00:00',
    live_through: complete ? '2026-11-01T03:30:00+00:00' : null,
    hours_counted: counted,
    hours_settled: 140,
  },
  totals: {
    players: 2,
    sources: 1200,
    cash_rake: 900,
    tournament_rake: 100,
    rake_recorded: 1000,
    estimated_player_rakeback: 700,
    last_recorded_at: '2026-11-01T03:20:00Z',
  },
  players: [
    {
      player_id: 'p1',
      player_name: 'Ace',
      rake_recorded: 600,
      cash_rake: 600,
      tournament_rake: 0,
      sources: 700,
      estimated_rakeback: 420,
      last_recorded_at: null,
    },
    {
      player_id: 'p2',
      player_name: 'Deuce',
      rake_recorded: 400,
      cash_rake: 300,
      tournament_rake: 100,
      sources: 500,
      estimated_rakeback: 280,
      last_recorded_at: null,
    },
  ],
  windows: { proved: {}, elapsed: 83, per_week: 84, proved_after: '2026-11-02T08:00:00+00:00' },
  last_close: { period_start: 'a', period_end: 'b', status: 'complete' },
  last_paid_week: {
    period_start: 'a',
    period_end: 'b',
    players: 400,
    paid: 491673.69,
    paid_at: 'c',
  },
});

afterEach(() => {
  cleanup();
  backend.rpc.mockReset();
});

it('shows the counted week, players and estimates from its own club only', async () => {
  backend.rpc.mockResolvedValue({ data: answer(true, 140), error: null });
  render(<ClubRakebackVerifiedSoFar clubId="club-1" />);
  await waitFor(() => expect(screen.getByText('Ace')).toBeTruthy());
  expect(backend.rpc).toHaveBeenCalledTimes(1);
  expect(backend.rpc).toHaveBeenCalledWith('fn_club_rakeback_verified_so_far', {
    p_club_id: 'club-1',
  });
  expect(backend.from).not.toHaveBeenCalled();
  expect(screen.getByText('Deuce')).toBeTruthy();
  expect(screen.getByText(/The Paid\s+Amount Is Computed At The Close/)).toBeTruthy();
  expect(screen.getByText(/Proved After The Week Ends/)).toBeTruthy();
  expect(screen.queryByText(/Counting The Week/)).toBeNull();
});

it('keeps asking while the tally is counting, and says how far it has counted', async () => {
  backend.rpc
    .mockResolvedValueOnce({ data: answer(false, 17), error: null })
    .mockResolvedValueOnce({ data: answer(false, 40), error: null })
    .mockResolvedValueOnce({ data: answer(true, 140), error: null });
  render(<ClubRakebackVerifiedSoFar clubId="club-1" />);
  await waitFor(() => expect(backend.rpc).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(screen.queryByText(/Counting The Week/)).toBeNull());
  expect(screen.getByText('Ace')).toBeTruthy();
});

it('shows the counting progress while not yet counted', async () => {
  let release: (v: unknown) => void = () => {};
  backend.rpc
    .mockResolvedValueOnce({ data: answer(false, 17), error: null })
    .mockReturnValueOnce(new Promise((r) => (release = r)));
  render(<ClubRakebackVerifiedSoFar clubId="club-1" />);
  await waitFor(() => expect(screen.getByText(/17 Of 140 Hours Counted/)).toBeTruthy());
  release({ data: answer(true, 140), error: null });
  await waitFor(() => expect(screen.queryByText(/Counting The Week/)).toBeNull());
});

it('shows nothing to a viewer the server refuses', async () => {
  backend.rpc.mockResolvedValue({
    data: null,
    error: { code: '42501', message: 'not authorized for this club' },
  });
  const { container } = render(<ClubRakebackVerifiedSoFar clubId="club-1" />);
  await waitFor(() => expect(backend.rpc).toHaveBeenCalled());
  await waitFor(() => expect(container.innerHTML).toBe(''));
});
