import { useId, useState } from 'react';
import { copyToClipboard } from '../../lib/copyToClipboard';
import { formatWalletChips } from '../../utils/format';
import {
  thirdPartySender,
  walletRoute,
  type ChipTransactionLike,
} from '../wallet/describeChipTransaction';
import './MemberTransactionReceipt.css';

interface ReceiptRow extends ChipTransactionLike {
  id: string;
  created_at: string;
  amount_text?: string | null;
  from_name: string | null;
  to_name: string | null;
}

const recordedTime = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
});

// A cash-out request names the assigned agent before any chips reach them.
// The labels describe the recorded parties, while the route describes the funds.
const partyLabels: Record<string, [string, string]> = {
  cashout_request_escrow: ['Requested By', 'Assigned To'],
  cashout_approved: ['Requested By', 'Accepted By'],
  cashout_denied: ['Cancelled By', 'Refunded To'],
  agent_wallet_claim_back: ['Claimed From', 'Claimed By'],
  club_bank_claim: ['Claimed From', 'Claimed By'],
  club_bank_reversal: ['Reversed From', 'Returned To'],
  admin_removal: ['Removed From', 'Removed By'],
};

function ReceiptDetails({ row }: { row: ReceiptRow }) {
  const [copyMessage, setCopyMessage] = useState('');
  const [fromLabel, toLabel] = partyLabels[row.transaction_type ?? ''] ?? ['From', 'To'];
  const from =
    row.transaction_type === 'cashout_expired_refund'
      ? 'Held Cash-Out'
      : row.from_user_id && row.from_name
        ? row.from_name
        : thirdPartySender(row, row.from_name);
  const used =
    (row.transaction_type === 'promo_wallet_send' ||
      ((row.transaction_type === 'agent_wallet_send' || row.transaction_type === 'peer_transfer') &&
        row.metadata?.destination === 'promo_wallet')) &&
    row.metadata?.promo_used_after_send;
  const amount = formatWalletChips(row.amount_text ?? row.amount);

  async function copyId() {
    const copied = await copyToClipboard(row.id);
    setCopyMessage(copied ? 'Transaction ID Copied' : 'Copy Failed. Select The ID To Copy It.');
  }

  return (
    <>
      <dl>
        <dt>Recorded</dt>
        <dd>
          <time dateTime={row.created_at}>{recordedTime.format(new Date(row.created_at))}</time>
        </dd>
        <dt>{fromLabel}</dt>
        <dd>{from}</dd>
        <dt>{toLabel}</dt>
        <dd>{row.to_name || 'A Member'}</dd>
        <dt>Wallets</dt>
        <dd>{walletRoute(row) ?? 'Wallet Route Unavailable'}</dd>
        <dt>Amount</dt>
        <dd>{amount} Chips</dd>
        {typeof used === 'string' && (
          <>
            <dt>Weekly Promo Allowance</dt>
            <dd>
              {amount} Added · {formatWalletChips(used)} Of 50 Used After This Send
            </dd>
          </>
        )}
        <dt>Transaction ID</dt>
        <dd>
          <code>{row.id}</code>
        </dd>
      </dl>
      <button type="button" onClick={() => void copyId()}>
        Copy Transaction ID
      </button>
      <span role="status">{copyMessage}</span>
    </>
  );
}

export default function MemberTransactionReceipt({ row }: { row: ReceiptRow }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  return (
    <div className="mm-transaction-receipt">
      <button
        type="button"
        aria-controls={detailsId}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide Receipt' : 'View Receipt'}
      </button>
      <div id={detailsId} hidden={!open}>
        {open && <ReceiptDetails row={row} />}
      </div>
    </div>
  );
}
