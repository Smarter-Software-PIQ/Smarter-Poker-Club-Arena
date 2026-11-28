import { usePlayerPreference } from '../../hooks/usePlayerPreference';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AgentAssignmentService,
  type AssignmentHistoryRow,
} from '../../services/AgentAssignmentService';
import { reportError } from '../../utils/errorReporter';
import { titleCase } from '../../utils/titleCase';

/** Reads through the staff-only paginated RPC; raw operation receipts remain private. */
export default function AgentAssignmentHistory({
  clubId,
  revision,
}: {
  clubId: string;
  revision: number;
}) {
  const [search, setSearch] = usePlayerPreference('agentAssignmentHistory.search', '', clubId);
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<AssignmentHistoryRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const load = useCallback(
    async (before?: AssignmentHistoryRow) => {
      if (before && inFlight.current) return;
      const mine = ++generation.current;
      inFlight.current = true;
      setBusy(true);
      setError(false);
      if (!before) {
        setRows([]);
        setHasMore(false);
      }
      try {
        const page = await AgentAssignmentService.history(
          clubId,
          query,
          before ? { at: before.created_at, id: before.operation_id } : undefined
        );
        if (mine !== generation.current) return;
        setRows((current) =>
          before
            ? [
                ...current,
                ...page.rows.filter(
                  (row) => !current.some((old) => old.operation_id === row.operation_id)
                ),
              ]
            : page.rows
        );
        setHasMore(page.hasMore);
      } catch (cause) {
        if (mine !== generation.current) return;
        setError(true);
        reportError(cause, 'AgentAssignmentHistory.load');
      } finally {
        if (mine === generation.current) {
          inFlight.current = false;
          setBusy(false);
        }
      }
    },
    [clubId, query]
  );
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
      inFlight.current = false;
    };
  }, [load, revision]);
  return (
    <section aria-label="Assignment History" className="agent-assignment-history">
      <h3 className="agent-assignment-subtitle">Assignment History</h3>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
          if (search.trim() === query) void load();
        }}
      >
        <label className="agent-assignment-label">
          Search Transfers
          <input
            className="arena-ops-well"
            aria-label="Search Transfers"
            maxLength={100}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className="arena-switch arena-ops-keys">
          <button type="submit" disabled={busy}>
            Search History
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="arena-ops-copy agent-assignment-alert">
          Could Not Load Assignment History.
        </p>
      )}
      {busy && (
        <p role="status" className="arena-ops-copy">
          Loading Assignment History...
        </p>
      )}
      {!busy && !error && rows.length === 0 && (
        <p className="arena-ops-copy">No Matching Transfers.</p>
      )}
      <ol>
        {rows.map((row) => (
          <li key={row.operation_id} className="arena-ledger-row agent-assignment-record">
            <p>
              {titleCase(row.source_name)} To {titleCase(row.destination_name)}
            </p>
            <p>
              {row.moved.toLocaleString()} Members / {titleCase(row.actor_name)}
            </p>
            <p>
              <time dateTime={row.created_at}>{new Date(row.created_at).toLocaleString()}</time>
            </p>
            <details>
              <summary>Transfer Details</summary>
              <p className="agent-assignment-operation">{row.operation_id}</p>
              {row.review && (
                <p>
                  {row.review.affected_count.toLocaleString()} Members In The Reviewed Subtrees.
                </p>
              )}
              {row.review?.members?.map((member) => (
                <p key={member.user_id}>
                  {titleCase(member.name)} / {titleCase(member.source_name)}
                </p>
              ))}
            </details>
          </li>
        ))}
      </ol>
      <div className="arena-switch arena-ops-keys">
        <button type="button" disabled={busy} onClick={() => void load()}>
          Refresh History
        </button>
        {hasMore && (
          <button type="button" disabled={busy} onClick={() => void load(rows[rows.length - 1])}>
            Load More Transfers
          </button>
        )}
      </div>
    </section>
  );
}
