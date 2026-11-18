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
  const { rerender } = render(
    <MemberTransactionHistory clubId="club" memberId="agent" revision={0} scope="club" />
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'See All' }).then((button) => {
      expect(screen.getAllByText('-9,007,199,254,740,993.12')).toHaveLength(6);
      return button;
    })
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await screen.findByText('Sent To Player 26');
  expect(rpc).toHaveBeenLastCalledWith(
    'fn_member_transaction_history',
    expect.objectContaining({
      p_person: 'agent',
      p_club_id: 'club',
      p_scope: 'club',
      p_before_at: stamp,
      p_before_id: '25',
      p_limit: 26,
    })
  );
  const callsOnOlderPage = rpc.mock.calls.length;
  rerender(<MemberTransactionHistory clubId="club" memberId="agent" revision={1} scope="club" />);
  expect(screen.getByText('Sent To Player 26')).toBeVisible();
  expect(rpc.mock.calls.length).toBe(callsOnOlderPage);
  fireEvent.click(screen.getByRole('button', { name: 'Show Recent' }));
  await waitFor(() => expect(screen.getAllByText('-9,007,199,254,740,993.12')).toHaveLength(6));
});

it('identifies the funding wallet for otherwise identical sends in the preview and full history', async () => {
  const data = [
    ['peer_transfer', 'player_wallet'],
    ['promo_wallet_send', 'promo_wallet'],
    ['agent_wallet_send', 'agent_wallet'],
  ].map(([transaction_type, source], index) => ({
    id: String(index),
    created_at: '2026-11-14T18:26:42Z',
    from_user_id: 'agent',
    to_user_id: 'player',
    from_name: 'Sender',
    to_name: 'Recipient',
    amount_text: '50.00',
    transaction_type,
    metadata: { source, destination: 'player_wallet' },
  }));
  rpc.mockReturnValue({ abortSignal: async () => ({ data }) });
  render(<MemberTransactionHistory clubId="club" memberId="agent" revision={0} scope="club" />);
  async function expectRoutes() {
    for (const wallet of ['Player', 'Promo', 'Agent']) {
      const label = await screen.findByText('From ' + wallet + ' Wallet To Player Wallet');
      const row = label.closest('.mm-stat');
      expect(row?.textContent).toContain('Sent To Recipient');
      expect(row?.textContent).toContain('-50.00');
    }
  }
  await expectRoutes();
  fireEvent.click(screen.getByRole('button', { name: 'See All' }));
  await expectRoutes();
});

it('refreshes recent sends and claims from the member perspective and shows only recorded promo usage', async () => {
  const tx = {
    id: 'p',
    created_at: '2026-11-14T18:26:42Z',
    from_user_id: 'agent',
    to_user_id: 'other',
    from_name: 'Agent',
    to_name: 'Recipient',
    amount_text: '30.00',
    transaction_type: 'promo_wallet_send',
    metadata: { promo_used_after_send: '50.00', destination: 'player_wallet' },
  };
  const reply = (data: object[]) => ({ abortSignal: async () => ({ data }) });
  rpc.mockReturnValueOnce(reply([tx])).mockReturnValueOnce(
    reply([
      {
        ...tx,
        id: 'in',
        transaction_type: 'peer_transfer',
        from_user_id: 'other',
        from_name: 'Sender',
        to_user_id: 'agent',
      },
      { ...tx, id: 'claim', transaction_type: 'agent_wallet_claim_back', to_name: 'Manager' },
      tx,
    ])
  );
  const renderRecord = (revision: number) => (
    <MemberTransactionHistory clubId="club" memberId="agent" revision={revision} scope="club" />
  );
  const { rerender } = render(renderRecord(1));
  await screen.findByText(/50.00 Of 50 Used/);
  rerender(renderRecord(2));
  expect((await screen.findByText('Received From Sender')).closest('.mm-stat')).toHaveTextContent(
    '+30.00'
  );
  expect(screen.getByText('Chips Claimed Back By Manager').closest('.mm-stat')).toHaveTextContent(
    '-30.00'
  );
  expect(screen.getAllByText(/50.00 Of 50 Used/)).toHaveLength(1);
});

it('combines full-history filters, resets the cursor on changes and clears them for the preview', async () => {
  rpc.mockImplementation((_name, args) => ({
    abortSignal: async () => ({
      data: Array.from({ length: args.p_limit }, (_, index) => ({
        id: String(index + 1),
        created_at: '2026-11-14T18:26:42Z',
        transaction_type: 'peer_transfer',
        from_user_id: 'agent',
        to_user_id: 'other',
        to_name: 'Player',
        amount_text: '50.00',
      })),
    }),
  }));
  render(<MemberTransactionHistory clubId="club" memberId="agent" revision={0} scope="club" />);
  fireEvent.click(await screen.findByRole('button', { name: 'See All' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await screen.findByRole('button', { name: 'Previous' });
  fireEvent.change(screen.getByLabelText('Player Search'), { target: { value: ' Sliceoflife ' } });
  fireEvent.change(screen.getByLabelText('Funding Wallet'), {
    target: { value: 'member_promo_wallet' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));
  const expectQuery = (player: string | null, wallet: string, cursor: string | null) =>
    expect(rpc).toHaveBeenLastCalledWith(
      'fn_member_transaction_history',
      expect.objectContaining({
        p_search: player,
        p_kind: wallet,
        p_before_id: cursor,
        p_person: 'agent',
      })
    );
  await waitFor(() => expectQuery('Sliceoflife', 'member_promo_wallet', null));
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await waitFor(() => expectQuery('Sliceoflife', 'member_promo_wallet', '25'));
  fireEvent.change(screen.getByLabelText('Funding Wallet'), {
    target: { value: 'member_union_promo_wallet' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Apply Filters' }));
  await waitFor(() => expectQuery('Sliceoflife', 'member_union_promo_wallet', null));
  fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
  await waitFor(() => expectQuery(null, 'member_all', null));
  expect(screen.getByLabelText('Player Search')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Show Recent' }));
  await waitFor(() => expectQuery(null, 'member_all', null));
});

it('retires old receipts when a refresh fails and keeps them hidden until Retry succeeds', async () => {
  const row = {
    id: 'first',
    created_at: '2026-11-14T18:26:42Z',
    from_user_id: 'agent',
    to_user_id: 'other',
    to_name: 'First Player',
    transaction_type: 'agent_wallet_send',
    amount_text: '25.00',
  };
  let finishRetry!: () => void;
  rpc
    .mockReturnValueOnce({ abortSignal: async () => ({ data: [row] }) })
    .mockReturnValueOnce({ abortSignal: async () => ({ error: new Error('Read interrupted') }) })
    .mockReturnValueOnce({
      abortSignal: () =>
        new Promise((resolve) => {
          finishRetry = () =>
            resolve({ data: [{ ...row, id: 'second', to_name: 'Second Player' }] });
        }),
    });
  const history = (revision: number) => (
    <MemberTransactionHistory clubId="club" memberId="agent" revision={revision} scope="club" />
  );
  const { rerender } = render(history(1));
  await screen.findByText('Sent To First Player');
  rerender(history(2));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(screen.queryByText('Sent To First Player')).toBeNull();
  expect(screen.getByText('Loading Transactions…')).toBeVisible();
  await waitFor(() => expect(finishRetry).toBeTypeOf('function'));
  finishRetry();
  expect(await screen.findByText('Sent To Second Player')).toBeVisible();
});

it('pages the combined club book without a person filter and names both parties', async () => {
  rpc.mockImplementation((_name, args) => ({
    abortSignal: async () => ({
      data: Array.from({ length: 26 }, (_, i) => ({
        id: String(i + 1),
        created_at: '2026-11-15T05:00:00Z',
        from_user_id: 'agent',
        from_name: 'River',
        to_user_id: 'player',
        to_name: 'Shark',
        amount_text: '10.25',
        transaction_type: 'peer_transfer',
      })).slice(0, args.p_before_id ? 1 : 26),
    }),
  }));
  render(<MemberTransactionHistory clubId="club" memberId={null} revision={0} scope="club" />);
  expect(await screen.findAllByText('River Sent To Shark')).toHaveLength(25);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(screen.getAllByText('River Sent To Shark')).toHaveLength(1));
  expect(rpc).toHaveBeenLastCalledWith(
    'fn_cashier_history_feed',
    expect.objectContaining({
      p_club_id: 'club',
      p_scope: 'club',
      p_person: null,
      p_kind: 'all',
      p_before_id: '25',
    })
  );
});

it('applies inclusive Chicago dates with the funding wallet across combined pages and clears them', async () => {
  rpc.mockImplementation((_name, args) => ({
    abortSignal: async () => ({
      data: Array.from({ length: args.p_limit }, (_, i) => ({
        id: String(i),
        created_at: '2026-11-01T07:00:00Z',
        amount_text: '1',
        transaction_type: 'agent_wallet_send',
        from_name: 'Sender',
        to_name: 'Recipient',
      })),
    }),
  }));
  render(<MemberTransactionHistory clubId="club" memberId={null} revision={0} scope="club" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(rpc).toHaveBeenLastCalledWith(
      'fn_cashier_history_feed',
      expect.objectContaining({ p_before_id: '24' })
    )
  );
  const change = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  change('Start Date (Chicago)', '2026-11-01');
  change('End Date (Chicago)', '2026-10-31');
  change('Funding Wallet', 'member_agent_wallet');
  const apply = screen.getByRole('button', { name: 'Apply Filters' });
  const before = rpc.mock.calls.length;
  fireEvent.click(apply);
  expect(await screen.findByRole('alert')).toHaveTextContent('End Date');
  expect(rpc.mock.calls.length).toBe(before);
  change('End Date (Chicago)', '2026-11-01');
  fireEvent.click(apply);
  const selected = {
    p_from: '2026-11-01 00:00 America/Chicago',
    p_to: '2026-11-02 00:00 America/Chicago',
    p_kind: 'funded_agent_wallet',
    p_person: null,
  };
  await waitFor(() =>
    expect(rpc).toHaveBeenLastCalledWith(
      'fn_cashier_history_feed',
      expect.objectContaining({ ...selected, p_before_id: null })
    )
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(rpc).toHaveBeenLastCalledWith(
      'fn_cashier_history_feed',
      expect.objectContaining({ ...selected, p_before_id: '24' })
    )
  );
  fireEvent.click(screen.getByRole('button', { name: 'Clear Filters' }));
  await waitFor(() =>
    expect(rpc).toHaveBeenLastCalledWith(
      'fn_cashier_history_feed',
      expect.objectContaining({
        p_kind: 'all',
        p_person: null,
        p_from: null,
        p_to: null,
        p_before_id: null,
      })
    )
  );
});

it('shows incoming commission and outgoing rakeback with exact routes, receipts and a mixed-source cursor', async () => {
  rpc.mockImplementation((_name, args) => ({
    abortSignal: async () => ({
      data: [
        {
          id: 'ledger-1',
          entry_source: 'movement',
          transaction_type: 'commission',
          amount_text: '1234.56',
          created_at: '2026-11-16T01:00:00Z',
          to_user_id: 'agent',
          from_user_id: null,
          from_name: 'Club Bank',
          to_name: 'Agent',
          metadata: {
            history_source: 'movement',
            source: 'club_treasury',
            destination: 'agent_wallet',
          },
        },
        {
          id: 'ledger-2',
          entry_source: 'movement',
          transaction_type: 'rakeback',
          amount_text: '50.25',
          created_at: '2026-11-16T00:00:00Z',
          from_user_id: 'agent',
          to_user_id: 'player',
          from_name: 'Agent',
          to_name: 'Player',
          metadata: {
            history_source: 'movement',
            source: 'agent_wallet',
            destination: 'player_wallet',
          },
        },
      ],
    }),
  }));
  render(<MemberTransactionHistory clubId="club" memberId="agent" revision={0} scope="club" />);
  const incoming = (await screen.findByText('Commission Received From Club Bank')).closest(
    '.mm-stat'
  );
  expect(incoming).toHaveTextContent('+1,234.56');
  expect(incoming).toHaveTextContent('From Club Bank To Agent Wallet');
  const outgoing = screen.getByText('Rakeback Sent To Player').closest('.mm-stat');
  expect(outgoing).toHaveTextContent('-50.25');
  expect(outgoing).toHaveTextContent('From Agent Wallet To Player Wallet');
  expect(rpc).toHaveBeenLastCalledWith(
    'fn_member_transaction_history',
    expect.objectContaining({ p_kind: 'member_all', p_before_source: null })
  );
});

it('carries the source of the last displayed movement into the next page', async () => {
  rpc.mockImplementation((_name, args) => ({
    abortSignal: async () => ({
      data: Array.from({ length: args.p_limit }, (_, index) => ({
        id: String(index + 1),
        entry_source: 'movement',
        transaction_type: 'rakeback',
        created_at: '2026-11-16T00:00:00Z',
        from_user_id: 'agent',
        to_user_id: 'player',
        to_name: 'Player',
        amount_text: '1.25',
      })),
    }),
  }));
  render(<MemberTransactionHistory clubId="club" memberId="agent" revision={0} scope="club" />);
  fireEvent.click(await screen.findByRole('button', { name: 'See All' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(rpc).toHaveBeenLastCalledWith(
      'fn_member_transaction_history',
      expect.objectContaining({ p_before_id: '25', p_before_source: 'movement' })
    )
  );
});
