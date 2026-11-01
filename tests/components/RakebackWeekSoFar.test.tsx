/**
 * THIS WEEK SO FAR / SUNDAY PREVIEW (owner, 2026-10-31). Pins: the card reads
 * only fn_my_rakeback_week_so_far (bound to the caller), labels the figure an
 * estimate with the Monday payout time, and says so when there is nothing yet
 * or the read fails.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: backend.rpc, from: backend.from } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import RakebackWeekSoFar from '../../src/components/wallet/RakebackWeekSoFar';

afterEach(() => {
  cleanup();
  backend.rpc.mockReset();
});

it('shows each club with recorded rake, the rate now and an estimate', async () => {
  backend.rpc.mockResolvedValue({
    data: {
      week_start: '2026-10-26T07:00:00+00:00',
      week_end: '2026-11-02T08:00:00+00:00',
      paid_at: '2026-11-02T10:00:00+00:00',
      clubs: [
        {
          club_id: 'c1',
          club_name: 'Kings Club',
          rake_recorded: 4137.13,
          cash_rake: 3935.01,
          tournament_rake: 202.12,
          estimated_rakeback: 2895.99,
          current_rate_pct: 70,
          last_recorded_at: '2026-11-01T02:18:20Z',
        },
      ],
    },
    error: null,
  });
  render(<RakebackWeekSoFar />);
  await waitFor(() => expect(screen.getByText('Kings Club')).toBeTruthy());
  expect(backend.rpc).toHaveBeenCalledWith('fn_my_rakeback_week_so_far');
  expect(backend.from).not.toHaveBeenCalled();
  expect(screen.getByText('Rate Now 70%')).toBeTruthy();
  expect(screen.getByText(/Estimated Rakeback/)).toBeTruthy();
  expect(screen.getByText(/The Paid Amount Is Computed Then/)).toBeTruthy();
});

it('says when nothing is recorded yet, and when the week cannot be read', async () => {
  backend.rpc.mockResolvedValueOnce({
    data: { week_start: 'a', week_end: 'b', paid_at: '2026-11-02T10:00:00Z', clubs: [] },
    error: null,
  });
  render(<RakebackWeekSoFar />);
  await waitFor(() =>
    expect(screen.getByText('No Raked Hands Recorded For You This Week Yet.')).toBeTruthy()
  );
  cleanup();
  backend.rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
  render(<RakebackWeekSoFar />);
  await waitFor(() => expect(screen.getByText('This Week Is Unavailable Right Now.')).toBeTruthy());
});
