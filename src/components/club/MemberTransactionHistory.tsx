import '../../pages/MemberManagementPage.css';

import { useEffect, useState } from 'react';
import MemberTransactionReceipt from './MemberTransactionReceipt';
import { addCalendarDays, CLUB_DATA_TIME_ZONE } from '../../lib/clubDataDay';
import { supabase } from '../../lib/supabase';
import { selectTextTwins } from '../../services/ClubRosterService';
import { formatDateTime, formatWalletChips } from '../../utils/format';
import { toTitleCase } from '../../utils/titleCase';
import { runWithRequestDeadline } from '../../utils/requestDeadline';
import { reportError } from '../../utils/errorReporter';
import {
  isAgentPromoSendTransaction,
  ledgerDirection,
  ledgerRowTitle,
  walletRoute,
  presentChipTransaction,
  type ChipTransactionLike,
} from '../wallet/describeChipTransaction';

interface Entry extends ChipTransactionLike {
  id: string;
  created_at: string;
  entry_source?: 'receipt' | 'movement';
  amount_text: string;
  from_name: string | null;
  to_name: string | null;
}

interface Props {
  clubId: string;
  memberId: string | null;
  revision: number;
  scope: 'club' | 'downline' | 'mine';
}

const chicagoReceiptTime = new Intl.DateTimeFormat(undefined, {
  timeZone: CLUB_DATA_TIME_ZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

type Cursor = Pick<Entry, 'created_at' | 'id' | 'entry_source'>;

function memberTitle(row: Entry, memberId: string | null): string {
  if (memberId === null) {
    const title = ledgerRowTitle(row, row.from_name, row.to_name, null);
    if (title) return title;
    return [
      toTitleCase((row.transaction_type || 'Chip Transaction').replace(/_/g, ' ')),
      row.from_name,
      row.to_name,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  const incoming = row.to_user_id === memberId;
  if (row.entry_source === 'movement') {
    const kind = toTitleCase((row.transaction_type || 'Wallet Movement').replace(/_/g, ' '));
    if (incoming && row.from_user_id !== memberId)
      return `${kind} Received${row.from_name ? ` From ${row.from_name}` : ''}`;
    if (row.from_user_id === memberId && !incoming)
      return `${kind} Sent${row.to_name ? ` To ${row.to_name}` : ''}`;
    return kind;
  }
  const outgoing = row.from_user_id === memberId;
  const from = row.from_name || 'A Member';
  const to = row.to_name || 'A Member';
  switch (row.transaction_type) {
    case 'agent_wallet_self_stake':
      return 'Moved Chips To Player Wallet';
    case 'peer_transfer':
    case 'agent_wallet_send':
    case 'promo_wallet_send':
    case 'club_promo_send':
      if (incoming && outgoing) return 'Moved Chips Between Wallets';
      break;
    case 'club_bank_send':
      return incoming ? 'Received From Club Bank' : `Sent From Club Bank To ${to}`;
    case 'agent_wallet_claim_back':
    case 'club_bank_claim':
      return incoming ? `Claimed Back From ${from}` : `Chips Claimed Back By ${to}`;
    case 'club_bank_reversal':
      return incoming ? `Reversed Send To ${from}` : `Send Reversed By ${to}`;
    case 'admin_removal':
      return incoming ? `Removed Chips From ${from}` : `Chips Removed By ${to}`;
    case 'cashout_request_escrow':
      return outgoing ? `Requested Cash-Out From ${to}` : `Cash-Out Requested By ${from}`;
    case 'cashout_approved':
      return incoming ? `Accepted Cash-Out From ${from}` : `Cash-Out Accepted By ${to}`;
    case 'cashout_denied':
      return incoming ? `Cash-Out Cancelled By ${from}` : `Cancelled Cash-Out From ${to}`;
    case 'cashout_cancelled':
      return 'Withdrew Cash-Out';
    case 'cashout_expired_refund':
      return 'Expired Cash-Out Refunded';
  }
  return (
    ledgerRowTitle(row, from, to, memberId) ??
    toTitleCase((row.transaction_type ?? 'Chip Transaction').replace(/_/g, ' '))
  );
}

export default function MemberTransactionHistory({ clubId, memberId, revision, scope }: Props) {
  const [expanded, setExpanded] = useState(memberId === null);
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const [player, setPlayer] = useState('');
  const [wallet, setWallet] = useState('member_all');
  const [fromDay, setFromDay] = useState('');
  const [toDay, setToDay] = useState('');
  const [dateError, setDateError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const limit = expanded ? 25 : 6;
  const cursor = cursors[cursors.length - 1];
  let kind = memberId ? 'member_all' : 'all';
  if (expanded && memberId && (player || wallet !== 'member_all')) kind = wallet;
  if (!memberId && wallet !== 'member_all') kind = wallet.replace('member_', 'funded_');

  // An older cursor is a stable page even as fresh receipts arrive.
  const refreshRevision = cursor ? 0 : revision;

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const { data, error } = await runWithRequestDeadline(
          (signal) =>
            selectTextTwins(
              supabase.rpc(memberId ? 'fn_member_transaction_history' : 'fn_cashier_history_feed', {
                p_club_id: clubId,
                p_scope: scope,
                p_person: memberId,
                p_kind: kind,
                p_from: fromDay ? `${fromDay} 00:00 ${CLUB_DATA_TIME_ZONE}` : null,
                p_to: toDay ? `${addCalendarDays(toDay, 1)} 00:00 ${CLUB_DATA_TIME_ZONE}` : null,
                p_search: expanded && player ? player : null,
                p_before_at: cursor?.created_at ?? null,
                p_before_id: cursor?.id ?? null,
                ...(memberId
                  ? { p_before_source: cursor ? (cursor.entry_source ?? 'receipt') : null }
                  : {}),
                p_limit: limit + 1,
              }),
              '*,amount_text:amount::text'
            ).abortSignal(signal),
          { signal: controller.signal }
        );
        if (error) throw error;
        if (!controller.signal.aborted) {
          setFailed(false);
          setRows((data ?? []).map(presentChipTransaction));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          reportError(error, 'MemberTransactionHistory.read');
          setRows(null);
          setFailed(true);
        }
      }
    }
    void read();
    return () => controller.abort();
  }, [
    clubId,
    memberId,
    scope,
    cursor,
    limit,
    attempt,
    refreshRevision,
    expanded,
    kind,
    player,
    fromDay,
    toDay,
  ]);

  function changeView(nextExpanded: boolean, nextCursors: Cursor[]) {
    setRows(null);
    setFailed(false);
    if (!nextExpanded) {
      setPlayer('');
      setWallet('member_all');
    }
    setExpanded(nextExpanded);
    setCursors(nextCursors);
  }

  function filter(nextPlayer: string, nextWallet: string, from = '', to = '') {
    if (from && to && from > to) {
      setDateError('End Date Must Be On Or After Start Date.');
      return;
    }
    setDateError('');
    if (nextPlayer === player && nextWallet === wallet && from === fromDay && to === toDay) return;
    setFromDay(from);
    setToDay(to);
    setPlayer(nextPlayer);
    setWallet(nextWallet);
    changeView(true, []);
  }

  return (
    <section className="mm-card mm-stats mm-history" aria-label="Transaction History">
      <h2 className="mm-card__title">Transaction History</h2>
      {expanded && (
        <form
          className="mm-history__filters"
          aria-label="Filter Transaction History"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            filter(
              String(data.get('player') ?? '').trim(),
              String(data.get('wallet') ?? 'member_all'),
              String(data.get('from') ?? ''),
              String(data.get('to') ?? '')
            );
          }}
          onReset={() => filter('', 'member_all')}
        >
          <label className="mm-field">
            <span className="mm-field__label">Player Search</span>
            <input type="search" name="player" placeholder="Player Name" />
          </label>
          {!memberId && (
            <>
              <label className="mm-field">
                <span className="mm-field__label">Start Date (Chicago)</span>
                <input type="date" name="from" max="9999-12-30" />
              </label>
              <label className="mm-field">
                <span className="mm-field__label">End Date (Chicago)</span>
                <input type="date" name="to" max="9999-12-30" />
              </label>
              {dateError && <p role="alert">{dateError}</p>}
            </>
          )}
          <label className="mm-field">
            <span className="mm-field__label">Funding Wallet</span>
            <select className="mm-assign__select" name="wallet" defaultValue="member_all">
              <option value="member_all">All Wallets</option>
              <option value="member_player_wallet">Player Wallet</option>
              <option value="member_agent_wallet">Agent Wallet</option>
              <option value="member_promo_wallet">Promo Wallet</option>
              <option value="member_club_bank">Club Bank</option>
              <option value="member_club_promo_wallet">Club Promo Wallet</option>
              <option value="member_union_promo_wallet">Union Promo Wallet</option>
              <option value="member_held_cashout">Held Cash-Out</option>
            </select>
          </label>
          <button type="submit" className="mm-downline__show-more">
            Apply Filters
          </button>
          <button type="reset" className="mm-downline__show-more">
            Clear Filters
          </button>
        </form>
      )}
      {failed ? (
        <p role="alert">
          Transaction History Could Not Be Loaded.{' '}
          <button
            type="button"
            className="mm-downline__show-more"
            onClick={() => {
              setFailed(false);
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </p>
      ) : rows === null ? (
        <p role="status">Loading Transactions…</p>
      ) : rows.length === 0 ? (
        <p>
          {player || fromDay || toDay || wallet !== 'member_all'
            ? 'No Transactions Match These Filters.'
            : 'No Chip Transactions Found.'}
        </p>
      ) : (
        rows.slice(0, limit).map((row) => {
          const route = walletRoute(row);
          const used = isAgentPromoSendTransaction(row) && row.metadata?.promo_used_after_send;
          const direction = ledgerDirection(row, memberId);
          return (
            <div className="mm-stat" key={`${row.entry_source ?? 'receipt'}:${row.id}`}>
              <span className="mm-stat__label">
                {memberTitle(row, memberId)}
                <br />
                {route && (
                  <>
                    <span>From {route}</span>
                    <br />
                  </>
                )}
                {typeof used === 'string' && (
                  <>
                    <span>
                      Weekly Promo Allowance After This Send: {formatWalletChips(used)} Of 50 Used
                    </span>
                    <br />
                  </>
                )}
                <time dateTime={row.created_at}>
                  {memberId
                    ? formatDateTime(row.created_at)
                    : chicagoReceiptTime.format(new Date(row.created_at))}
                </time>
              </span>
              <strong className="mm-stat__value">
                {direction === 'in' ? '+' : direction === 'out' ? '-' : ''}
                {formatWalletChips(row.amount_text ?? row.amount)}
              </strong>
              <MemberTransactionReceipt row={row} />
            </div>
          );
        })
      )}
      {!expanded && rows && rows.length > 0 && (
        <button
          type="button"
          className="mm-downline__show-more"
          onClick={() => changeView(true, [])}
        >
          See All
        </button>
      )}
      {expanded && (
        <>
          {cursor && (
            <button
              type="button"
              className="mm-downline__show-more"
              onClick={() => changeView(true, cursors.slice(0, -1))}
            >
              Previous
            </button>
          )}
          {rows && rows.length > limit && (
            <button
              type="button"
              className="mm-downline__show-more"
              onClick={() => changeView(true, [...cursors, rows[limit - 1]])}
            >
              Next
            </button>
          )}
          {memberId && (
            <button
              type="button"
              className="mm-downline__show-more"
              onClick={() => changeView(false, [])}
            >
              Show Recent
            </button>
          )}
        </>
      )}
    </section>
  );
}
