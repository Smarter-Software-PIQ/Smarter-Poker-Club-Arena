import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { selectTextTwins } from '../../services/ClubRosterService';
import { formatDateTime, formatWalletChips } from '../../utils/format';
import { toTitleCase } from '../../utils/titleCase';
import { runWithRequestDeadline } from '../../utils/requestDeadline';
import { reportError } from '../../utils/errorReporter';
import {
  ledgerDisplaySign,
  ledgerRowTitle,
  presentChipTransaction,
  type ChipTransactionLike,
} from '../wallet/describeChipTransaction';

interface Entry extends ChipTransactionLike {
  id: string;
  created_at: string;
  amount_text: string;
  from_name: string | null;
  to_name: string | null;
}

interface Props {
  clubId: string;
  memberId: string;
  viewerId: string;
  scope: 'club' | 'downline' | 'mine';
}

type Cursor = Pick<Entry, 'created_at' | 'id'>;

export default function MemberTransactionHistory({ clubId, memberId, viewerId, scope }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [cursors, setCursors] = useState<Cursor[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const limit = expanded ? 25 : 6;
  const cursor = cursors[cursors.length - 1];

  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const { data, error } = await runWithRequestDeadline(
          (signal) =>
            selectTextTwins(
              supabase.rpc('fn_cashier_history_feed', {
                p_club_id: clubId,
                p_scope: scope,
                p_person: memberId,
                p_kind: 'all',
                p_before_at: cursor?.created_at ?? null,
                p_before_id: cursor?.id ?? null,
                p_limit: limit + 1,
              }),
              '*,amount_text:amount::text'
            ).abortSignal(signal),
          { signal: controller.signal }
        );
        if (error) throw error;
        if (!controller.signal.aborted) setRows((data ?? []).map(presentChipTransaction));
      } catch (error) {
        if (!controller.signal.aborted) {
          reportError(error, 'MemberTransactionHistory.read');
          setFailed(true);
        }
      }
    }
    void read();
    return () => controller.abort();
  }, [clubId, memberId, scope, cursor, limit, attempt]);

  function changeView(nextExpanded: boolean, nextCursors: Cursor[]) {
    setRows(null);
    setFailed(false);
    setExpanded(nextExpanded);
    setCursors(nextCursors);
  }

  return (
    <section className="mm-card mm-stats" aria-label="Transaction History">
      <h2 className="mm-card__title">Transaction History</h2>
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
        <p>No Chip Transactions Found.</p>
      ) : (
        rows.slice(0, limit).map((row) => (
          <div className="mm-stat" key={row.id}>
            <span className="mm-stat__label">
              {ledgerRowTitle(row, row.from_name, row.to_name, viewerId) ??
                toTitleCase((row.transaction_type ?? 'Chip Transaction').replace(/_/g, ' '))}
              <br />
              <time dateTime={row.created_at}>{formatDateTime(row.created_at)}</time>
            </span>
            <strong className="mm-stat__value">
              {ledgerDisplaySign(row, memberId)}
              {formatWalletChips(row.amount_text ?? row.amount)}
            </strong>
          </div>
        ))
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
          <button
            type="button"
            className="mm-downline__show-more"
            onClick={() => changeView(false, [])}
          >
            Show Recent
          </button>
        </>
      )}
    </section>
  );
}
