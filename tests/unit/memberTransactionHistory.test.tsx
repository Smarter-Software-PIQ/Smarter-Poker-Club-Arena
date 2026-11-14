import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import MemberTransactionHistory from '../../src/components/club/MemberTransactionHistory';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../../src/lib/supabase', () => ({ supabase: { rpc } }));

it('previews six entries and pages the selected agent’s full club history using the last displayed row', async () => {
  const stamp = '2026-11-14T17:00:00Z';
  rpc.mockImplementation((_name, args) => {
    const start = args.p_before_id ? Number(args.p_before_id) + 1 : 1;
    const data = Array.from({ length: args.p_limit }, (_, index) => ({
      id: String(start + index),
      created_at: stamp,
      from_user_id: 'agent',
      to_user_id: 'other',
      from_name: 'Agent',
      to_name: 'Player ' + (start + index),
      transaction_type: 'agent_wallet_send',
      amount_text: '9007199254740993.12',
    }));
    return { abortSignal: async () => ({ data }) };
  });
  render(<MemberTransactionHistory clubId="club" memberId="agent" viewerId="staff" scope="club" />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'See All' }).then((button) => {
      expect(screen.getAllByText('-9,007,199,254,740,993.12')).toHaveLength(6);
      return button;
    })
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await screen.findByText('Agent Sent To Player 26');
  expect(rpc).toHaveBeenLastCalledWith(
    'fn_cashier_history_feed',
    expect.objectContaining({
      p_person: 'agent',
      p_club_id: 'club',
      p_scope: 'club',
      p_before_at: stamp,
      p_before_id: '25',
      p_limit: 26,
    })
  );
  fireEvent.click(screen.getByRole('button', { name: 'Show Recent' }));
  await waitFor(() => expect(screen.getAllByText('-9,007,199,254,740,993.12')).toHaveLength(6));
});
