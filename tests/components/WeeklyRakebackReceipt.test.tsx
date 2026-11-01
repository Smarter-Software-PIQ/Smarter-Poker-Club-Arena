/**
 * WEEKLY RAKEBACK RECEIPTS IN TRANSACTION HISTORY (owner, 2026-10-31).
 * Pins: a rakeback or commission leg opens its own receipt from
 * fn_my_weekly_rakeback_receipt (keyed by the leg's chip_ledger id, never a
 * table read); the week, club, rake, rate and amount render; an unavailable
 * receipt and an RPC failure say so; nothing is fetched until it is opened.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const backend = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc: backend.rpc, from: backend.from } }));
vi.mock('../../src/utils/errorReporter', () => ({ reportError: vi.fn() }));

import {
  WeeklyRakebackReceipt,
  receiptWeek,
  WEEKLY_RECEIPT_CATEGORIES,
} from '../../src/components/wallet/WeeklyRakebackReceipt';

afterEach(() => {
  cleanup();
  backend.rpc.mockReset();
});

it('only weekly rakeback and commission legs carry a receipt', () => {
  expect([...WEEKLY_RECEIPT_CATEGORIES].sort()).toEqual(['commission', 'rakeback']);
});

it('names the last day played, not the boundary instant', () => {
  expect(receiptWeek('2026-10-19T07:00:00+00:00', '2026-10-26T07:00:00+00:00')).toMatch(/19.*25/);
});

it('opens the rakeback receipt of exactly this leg', async () => {
  backend.rpc.mockResolvedValue({
    data: {
      available: true,
      kind: 'rakeback',
      direction: 'in',
      club_name: 'Midway Club',
      period_start: '2026-10-19T07:00:00+00:00',
      period_end: '2026-10-26T07:00:00+00:00',
      rake_generated: 300,
      rate_pct: 5,
      amount: 15,
    },
    error: null,
  });
  render(<WeeklyRakebackReceipt ledgerId="0dc2c70f-e974-473d-9509-83ea51eac17f" />);
  expect(backend.rpc).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Weekly Receipt' }));
  await waitFor(() => expect(screen.getByText('Midway Club')).toBeTruthy());
  expect(backend.rpc).toHaveBeenCalledTimes(1);
  expect(backend.rpc).toHaveBeenCalledWith('fn_my_weekly_rakeback_receipt', {
    p_ledger_id: '0dc2c70f-e974-473d-9509-83ea51eac17f',
  });
  expect(backend.from).not.toHaveBeenCalled();
  expect(screen.getByText('Rake You Generated')).toBeTruthy();
  expect(screen.getByText('5%')).toBeTruthy();
  expect(screen.getByText('Paid To You')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Hide Weekly Receipt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Weekly Receipt' }));
  expect(backend.rpc).toHaveBeenCalledTimes(1);
});

it('shows an agent commission receipt with its role and own commission', async () => {
  backend.rpc.mockResolvedValue({
    data: {
      available: true,
      kind: 'commission',
      direction: 'in',
      club_name: 'The Felt Society',
      period_start: '2026-10-12T07:00:00+00:00',
      period_end: '2026-10-19T07:00:00+00:00',
      role: 'super_agent',
      own_commission: 133872.75,
      pass_through: false,
      amount: 243823.93,
    },
    error: null,
  });
  render(<WeeklyRakebackReceipt ledgerId="f3edb261-a9d3-46f2-a6ae-0b19cfbb1902" />);
  fireEvent.click(screen.getByRole('button', { name: 'Weekly Receipt' }));
  await waitFor(() => expect(screen.getByText('Super Agent')).toBeTruthy());
  expect(screen.getByText('Your Own Commission')).toBeTruthy();
});

it('says when a movement has no weekly receipt, and when it cannot be read', async () => {
  backend.rpc.mockResolvedValueOnce({ data: { available: false }, error: null });
  render(<WeeklyRakebackReceipt ledgerId="a" />);
  fireEvent.click(screen.getByRole('button', { name: 'Weekly Receipt' }));
  await waitFor(() =>
    expect(screen.getByText('No Weekly Receipt For This Movement.')).toBeTruthy()
  );
  cleanup();
  backend.rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
  render(<WeeklyRakebackReceipt ledgerId="b" />);
  fireEvent.click(screen.getByRole('button', { name: 'Weekly Receipt' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('Receipt Unavailable')
  );
});
