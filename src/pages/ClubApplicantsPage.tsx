import { useCallback, useEffect, useRef, useState } from 'react';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import { ArenaState } from '../components/ops/ArenaOps';
import '../components/lobby/ArenaWorkspace.css';
import '../components/ops/ArenaOps.css';
import { Link, useParams } from 'react-router-dom';
import { useIsMounted } from '../hooks/useIsMounted';
import { useAuthUser } from '../hooks/useAuthUser';
import { useClubNavigationAccess } from '../hooks/useClubNavigationAccess';
import { useToast } from '../components/common/Toast';
import { confirmDialog } from '../components/common/confirmDialog';
import { supabase } from '../lib/supabase';
import { masterBus } from '../core/MasterBus';
import { resolveClubUUIDStrict } from '../utils/clubIdResolver';
import { reportError } from '../utils/errorReporter';
import { safeErrorMessage } from '../utils/safeErrorMessage';
import { titleCase } from '../utils/titleCase';
import './ClubApplicantsPage.css';

interface Applicant {
  user_id: string;
  display_name: string;
  created_at: string;
}
interface Queue {
  rows: Applicant[];
  error: string | null;
  loading: boolean;
}

export default function ClubApplicantsPage() {
  const { clubId = '' } = useParams();
  const { user } = useAuthUser();
  const access = useClubNavigationAccess(clubId);
  return (
    <section className="club-applicants-page arena-workspace">
      <nav className="arena-switch applicants-back" aria-label="Applicants Navigation">
        <Link to={`/clubs/${clubId}/members`}>Back To Players</Link>
      </nav>
      <ArenaWorkspaceHeader
        area="operations"
        title="Applicants"
        context={clubContext(clubId)}
        summary="Review Requests To Join This Club."
      />
      {access.loading ? (
        <ArenaState tone="loading" title="Confirming Club Access..." />
      ) : access.error ? (
        <ArenaState
          tone="error"
          title="Club Access Unavailable"
          message={access.error}
          actions={<button onClick={access.reload}>Retry Access</button>}
        />
      ) : !user || !access.canControlClub ? (
        <div role="note">
          <ArenaState tone="empty" title="Club Owner, CO Owner Or Admin Access Is Required." />
        </div>
      ) : (
        <ApplicantQueue key={`${clubId}:${user.id}`} clubId={clubId} />
      )}
    </section>
  );
}

/** The club's name as the route spells it; a raw UUID names nothing. */
function clubContext(clubId: string): string | undefined {
  if (!clubId || /^[0-9a-f]{8}-/i.test(clubId)) return undefined;
  return clubId.replace(/[-_]/g, ' ');
}

function ApplicantQueue({ clubId }: { clubId: string }) {
  const toast = useToast();
  const mounted = useIsMounted();
  const request = useRef(0);
  const operation = useRef(false);
  const [busy, setBusy] = useState<{ userId: string; approve: boolean } | null>(null);
  const [queue, setQueue] = useState<Queue>({ rows: [], error: null, loading: true });

  const load = useCallback(async () => {
    const version = ++request.current;
    const current = () => mounted.current && request.current === version;
    setQueue((previous) => ({
      rows: previous.rows,
      error: null,
      loading: true,
    }));
    try {
      const uuid = await resolveClubUUIDStrict(clubId);
      if (!current()) return;
      const { data, error } = await supabase.rpc('fn_list_pending_members', { p_club_id: uuid });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('The Club Did Not Return An Applicant Queue');
      if (current()) setQueue({ rows: data, error: null, loading: false });
    } catch (error) {
      reportError(error, 'ClubApplicantsPage.load');
      if (current())
        setQueue({
          rows: [],
          error: safeErrorMessage(error, 'Applicants Could Not Be Loaded'),
          loading: false,
        });
    }
  }, [clubId, mounted]);

  useEffect(() => {
    void load();
    const unsubscribe = masterBus.subscribeDebounced('CLUB_UPDATED', () => void load(), 300);
    return () => {
      request.current += 1;
      unsubscribe();
    };
  }, [load]);
  const review = async (applicant: Applicant, approve: boolean) => {
    if (operation.current || !mounted.current) return;
    operation.current = true;
    try {
      const confirmed = await confirmDialog({
        title: approve ? 'Approve Applicant' : 'Decline Applicant',
        message: approve
          ? `Admit ${titleCase(applicant.display_name || 'This Player')} To This Club?`
          : `Decline ${titleCase(applicant.display_name || 'This Player')}'s Join Request?`,
        confirmText: approve ? 'Approve' : 'Decline',
      });
      if (!confirmed || !mounted.current) return;
      setBusy({ userId: applicant.user_id, approve });
      const uuid = await resolveClubUUIDStrict(clubId);
      if (!mounted.current) return;
      const { data, error } = await supabase.rpc('fn_review_join_request', {
        p_club_id: uuid,
        p_user_id: applicant.user_id,
        p_approve: approve,
      });
      if (error) throw error;
      if (data?.success !== true)
        throw new Error(data?.error || 'The Club Did Not Confirm This Decision');
      masterBus.emit('CLUB_UPDATED', { clubId: uuid });
      if (!mounted.current) return;
      toast.success(approve ? 'Applicant Approved' : 'Applicant Declined');
      await load();
    } catch (error) {
      reportError(error, 'ClubApplicantsPage.review');
      if (mounted.current) {
        toast.error(
          safeErrorMessage(error, 'Decision Could Not Be Confirmed. Refresh Before Trying Again.')
        );
        await load();
      }
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(null);
    }
  };
  return (
    <section className="arena-case arena-ops-case" aria-label="Pending Requests">
      <h2 className="arena-section-title">
        Pending Requests
        {!queue.loading && !queue.error ? ` (${queue.rows.length})` : ''}
      </h2>
      <div className="arena-switch arena-ops-keys">
        <button disabled={queue.loading || !!busy} onClick={() => void load()}>
          Refresh Applicants
        </button>
      </div>
      {queue.loading ? (
        <ArenaState tone="loading" title="Loading Applicants..." />
      ) : queue.error ? (
        <ArenaState
          tone="error"
          title="Applicants Unavailable"
          message={queue.error}
          actions={<button onClick={() => void load()}>Retry Applicant Queue</button>}
        />
      ) : queue.rows.length === 0 ? (
        <ArenaState
          tone="empty"
          title="Queue Clear"
          message="No Pending Applicants. New Join Requests Will Appear Here."
        />
      ) : (
        <ul className="arena-ops-rows arena-ops-rows--single">
          {queue.rows.map((applicant) => (
            <li key={applicant.user_id}>
              <div className="arena-ledger-row arena-ops-row applicant-row">
                <span className="arena-ops-row__copy">
                  <strong>{titleCase(applicant.display_name || 'Player')}</strong>
                  <small>Requested {new Date(applicant.created_at).toLocaleDateString()}</small>
                </span>
                <div className="arena-switch arena-ops-keys applicant-actions">
                  <button disabled={!!busy} onClick={() => void review(applicant, false)}>
                    {busy?.userId === applicant.user_id && !busy.approve
                      ? 'Processing...'
                      : 'Decline'}
                  </button>
                  <button disabled={!!busy} onClick={() => void review(applicant, true)}>
                    {busy?.userId === applicant.user_id && busy.approve
                      ? 'Processing...'
                      : 'Approve'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
