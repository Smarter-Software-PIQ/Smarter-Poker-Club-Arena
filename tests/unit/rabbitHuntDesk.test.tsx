/**
 * THE RABBIT HUNT DESK CORRECTS ONE REVEAL THROUGH THE STAFF DOOR (2026-11-02).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const rpc = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/components/common/confirmDialog', () => ({
  confirmDialog: vi.fn(async () => true),
  default: vi.fn(async () => true),
}));
vi.mock('@/components/help/PageBar', () => ({
  default: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

import RabbitHuntDeskPage, {
  correctableCharge,
  creditsFor,
  type DeskCharge,
} from '@/pages/admin/RabbitHuntDeskPage';

const PLAYER = '9b027798-9532-403f-a5c1-15554ce2959c';
const TABLE = '80d7c491-9993-4ec0-b559-758ef21f126c';
const charge = (o: Partial<DeskCharge>): DeskCharge => ({
  table_id: TABLE,
  hand_number: 54040613,
  charged_at: '2026-11-02T04:10:25Z',
  source: 'purchased',
  credit_source: 'daily_bonus',
  consumed: true,
  correction: null,
  ...o,
});
const LISTING = {
  found: true,
  player: { id: PLAYER, username: 'Danimal', player_number: 7 },
  charges: [
    charge({}),
    charge({ hand_number: 54040198, source: 'lifetime_vip', credit_source: null }),
    charge({ hand_number: 1, source: 'diamonds', credit_source: null }),
    charge({
      hand_number: 2,
      correction: {
        id: 'c',
        correction: 'credit_use_restored',
        operator: 'staff x',
        at: '2026-11-02T09:19:40Z',
      },
    }),
  ],
  credits: [
    {
      id: 'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207',
      source: 'daily_bonus',
      uses_remaining: 0,
      expires_at: '2099-11-04T21:59:46Z',
      created_at: '2026-10-28T21:59:46Z',
    },
    {
      id: 'aaaa',
      source: 'wheel',
      uses_remaining: 1,
      expires_at: null,
      created_at: '2026-10-28T21:59:46Z',
    },
  ],
};

beforeEach(() => rpc.mockReset());
afterEach(cleanup);

describe('what the desk offers', () => {
  it('only consumed, uncorrected credit or allowance charges are correctable', () => {
    expect(correctableCharge(charge({}))).toBe(true);
    expect(correctableCharge(charge({ source: 'vip_monthly' }))).toBe(true);
    expect(correctableCharge(charge({ source: 'diamonds' }))).toBe(false);
    expect(correctableCharge(charge({ consumed: false }))).toBe(false);
    expect(correctableCharge(LISTING.charges[3])).toBe(false);
  });
  it('a credit charge is offered only credits of its own source, live at the charge', () => {
    expect(creditsFor(charge({}), LISTING.credits).map((k) => k.id)).toEqual([
      'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207',
    ]);
    expect(creditsFor(charge({ source: 'lifetime_vip' }), LISTING.credits)).toEqual([]);
  });
});

describe('the staff flow', () => {
  it('finds a player, corrects one credit charge through the staff door, and reloads', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'fn_staff_rabbit_hunt_receipts'
        ? { data: LISTING, error: null }
        : { data: { ok: true, replayed: false, correction: 'credit_use_restored' }, error: null }
    );
    const ui = render(<RabbitHuntDeskPage />);
    fireEvent.change(ui.getByLabelText('Player'), { target: { value: 'Danimal' } });
    fireEvent.click(ui.getByRole('button', { name: 'Find' }));
    expect(rpc).toHaveBeenCalledWith('fn_staff_rabbit_hunt_receipts', { p_player: 'Danimal' });
    await waitFor(() => expect(ui.getAllByTestId('rh-charge')).toHaveLength(4));
    expect(ui.getByText('Diamond Charges Are Refunded Through The Diamond Desk')).toBeTruthy();
    expect(ui.getByText(/^Corrected .* By staff x$/)).toBeTruthy();
    fireEvent.click(ui.getAllByRole('button', { name: 'Correct' })[0]);
    fireEvent.change(ui.getByRole('textbox', { name: /Reason/ }), {
      target: { value: 'Test-consumed credit from rabbit hunt verification' },
    });
    fireEvent.click(ui.getByRole('button', { name: 'Correct This Charge' }));
    await waitFor(() => expect(ui.getByText('Corrected And Recorded')).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith('fn_staff_correct_rabbit_hunt_charge', {
      p_user_id: PLAYER,
      p_table_id: TABLE,
      p_hand_number: 54040613,
      p_credit_id: 'eebd7c7a-8b8b-4c1e-b7a9-04c69c396207',
      p_reason: 'Test-consumed credit from rabbit hunt verification',
    });
  });

  it('a short reason never reaches the database', async () => {
    rpc.mockResolvedValue({ data: LISTING, error: null });
    const ui = render(<RabbitHuntDeskPage />);
    fireEvent.change(ui.getByLabelText('Player'), { target: { value: 'Danimal' } });
    fireEvent.click(ui.getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(ui.getAllByTestId('rh-charge')).toHaveLength(4));
    fireEvent.click(ui.getAllByRole('button', { name: 'Correct' })[0]);
    fireEvent.click(ui.getByRole('button', { name: 'Correct This Charge' }));
    expect(
      await ui.findByText('Write A Reason Of At Least 20 Characters. It Is Kept In The Audit')
    ).toBeTruthy();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('a refusal is named, not swallowed', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'fn_staff_rabbit_hunt_receipts'
        ? { data: LISTING, error: null }
        : { data: { ok: false, reason: 'credit_has_expired' }, error: null }
    );
    const ui = render(<RabbitHuntDeskPage />);
    fireEvent.change(ui.getByLabelText('Player'), { target: { value: 'Danimal' } });
    fireEvent.click(ui.getByRole('button', { name: 'Find' }));
    await waitFor(() => expect(ui.getAllByTestId('rh-charge')).toHaveLength(4));
    fireEvent.click(ui.getAllByRole('button', { name: 'Correct' })[1]);
    fireEvent.change(ui.getByRole('textbox', { name: /Reason/ }), {
      target: { value: 'Test allowance count from rabbit hunt verification' },
    });
    fireEvent.click(ui.getByRole('button', { name: 'Correct This Charge' }));
    expect(await ui.findByText('Refused: credit has expired')).toBeTruthy();
  });
});
