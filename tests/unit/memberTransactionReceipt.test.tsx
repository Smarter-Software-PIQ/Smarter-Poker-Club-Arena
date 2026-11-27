import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import MemberTransactionReceipt from '../../src/components/club/MemberTransactionReceipt';
import { copyToClipboard } from '../../src/lib/copyToClipboard';

vi.mock('../../src/lib/copyToClipboard', () => ({ copyToClipboard: vi.fn() }));

it('opens the selected receipt with its exact ledger ID, amount, timestamp, parties, wallets and historical allowance', async () => {
  const row = {
    id: '10000000-0000-4000-8000-000000000001',
    created_at: '2026-11-14T18:26:42Z',
    transaction_type: 'promo_wallet_send',
    amount_text: '30.123',
    from_name: 'Sender',
    to_name: 'Recipient',
    metadata: { destination: 'player_wallet', promo_used_after_send: '50.00' },
  };
  render(
    <>
      <MemberTransactionReceipt row={row} />
      <MemberTransactionReceipt
        row={{
          ...row,
          id: 'second',
          transaction_type: 'peer_transfer',
          amount_text: '9007199254740993.12',
        }}
      />
    </>
  );
  const [first, second] = screen.getAllByRole('button', { name: 'View Receipt' });
  fireEvent.click(first);
  const receipt = within(document.getElementById(first.getAttribute('aria-controls')!)!);
  expect(receipt.getByText('Sender')).toBeVisible();
  expect(receipt.getByText('Recipient')).toBeVisible();
  expect(receipt.getByText('Promo Wallet To Player Wallet')).toBeVisible();
  expect(receipt.getByText(/:26:42/)).toHaveAttribute('dateTime', row.created_at);
  expect(receipt.getByText('30.12 Chips')).toBeVisible();
  expect(receipt.getByText('30.12 Added · 50.00 Of 50 Used After This Send')).toBeVisible();
  expect(receipt.getByText(row.id)).toBeVisible();
  vi.mocked(copyToClipboard).mockResolvedValueOnce(true);
  fireEvent.click(receipt.getByRole('button', { name: 'Copy Transaction ID' }));
  expect(copyToClipboard).toHaveBeenCalledWith(row.id);
  expect(await receipt.findByText('Transaction ID Copied')).toBeVisible();

  fireEvent.click(first);
  fireEvent.click(second);
  expect(screen.getByText('9,007,199,254,740,993.12 Chips')).toBeVisible();
  expect(screen.getByText('Wallet Route Unavailable')).toBeVisible();
  expect(screen.queryByText('Weekly Promo Allowance')).toBeNull();
  vi.mocked(copyToClipboard).mockResolvedValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: 'Copy Transaction ID' }));
  expect(copyToClipboard).toHaveBeenLastCalledWith('second');
  expect(await screen.findByText('Copy Failed. Select The ID To Copy It.')).toBeVisible();
  expect(screen.getByText('second')).toBeVisible();
});

it.each([
  ['club_promo_send', 'Club Promo Wallet'],
  ['promo_wallet_send', 'Promo Wallet'],
])('names the funding wallet for a %s tournament ticket', (transaction_type, source) => {
  render(
    <MemberTransactionReceipt
      row={{
        id: 'ticket',
        created_at: '2026-11-14T18:26:42Z',
        transaction_type,
        amount_text: '25',
        from_name: 'Sender',
        to_name: 'Recipient',
        metadata: { destination: 'tournament_ticket' },
      }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'View Receipt' }));
  expect(screen.getByText(source + ' To Tournament Ticket')).toBeVisible();
});

it.each([
  ['union_promo_send', { destination: 'promo_float' }, 'Union Promo Wallet To Promo Wallet'],
  ['union_promo_send', { destination: 'player_wallet' }, 'Union Promo Wallet To Player Wallet'],
  [
    'union_promo_to_club',
    { destination: 'club_promo_wallet' },
    'Union Promo Wallet To Club Promo Wallet',
  ],
  [
    'tournament_ticket_issue',
    { issuer_id: 'issuer', issuer_balance_after: 0 },
    'Player Wallet To Tournament Ticket',
  ],
  [
    'tournament_ticket_issue',
    { source_satellite_id: 'satellite', payout_id: 'award' },
    'Wallet Route Unavailable',
  ],
  [
    'tournament_ticket_issue',
    { issuer_id: 'issuer', issuer_balance_after: 0, payout_id: 'award' },
    'Wallet Route Unavailable',
  ],
  [
    'promo_disbursement',
    { source_kind: 'union', target_kind: 'player', lands_as: 'ordinary_chips' },
    'Union Promo Wallet To Player Wallet',
  ],
  [
    'promo_disbursement',
    { source_kind: 'union', target_kind: 'club', lands_as: 'club_promo_wallet' },
    'Union Promo Wallet To Club Promo Wallet',
  ],
  [
    'promo_disbursement',
    { source_kind: 'union', target_kind: 'club', lands_as: 'ordinary_chips' },
    'Union Promo Wallet To Club Bank',
  ],
] as const)(
  'shows the recorded %s funding route for %o',
  (transaction_type, metadata, expected) => {
    render(
      <MemberTransactionReceipt
        row={{
          id: 'receipt',
          created_at: '2026-11-14T18:26:42Z',
          amount_text: '5.00',
          from_name: 'Sender',
          to_name: 'Recipient',
          transaction_type,
          metadata,
        }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'View Receipt' }));
    expect(screen.getByText(expected)).toBeVisible();
  }
);
