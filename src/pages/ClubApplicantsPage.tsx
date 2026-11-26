import { useCallback, useEffect, useRef, useState } from 'react';
import PageBar from '../components/help/PageBar';
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
    <section className="club-applicants-page">
      <PageBar title="Applicants" summary="Review Requests To Join This Club.">
        <Link to={`/clubs/${clubId}/members`}>Back To Players</Link>
      </PageBar>
      {access.loading ? (
        <p role="status">Confirming Club Access...</p>
      ) : access.error ? (
        <div role="alert">
          <p>{access.error}</p>
          <button onClick={access.reload}>Retry Access</button>
        </div>
      ) : !user || !access.canControlClub ? (
        <p role="note">Club Owner, CO Owner Or Admin Access Is Required.</p>
      ) : (
        <ApplicantQueue key={`${clubId}:${user.id}`} clubId={clubId} />
      )}
    </section>
  );
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
    <>
      <div className="applicants-toolbar">
        <h2>
          Pending Requests
          {!queue.loading && !queue.error ? ` (${queue.rows.length})` : ''}
        </h2>
        <button disabled={queue.loading || !!busy} onClick={() => void load()}>
          Refresh Applicants
        </button>
      </div>
      {queue.loading ? (
        <p role="status">Loading Applicants...</p>
      ) : queue.error ? (
        <div role="alert">
          <p>{queue.error}</p>
          <button onClick={() => void load()}>Retry Applicant Queue</button>
        </div>
      ) : queue.rows.length === 0 ? (
        <p>No Pending Applicants. New Join Requests Will Appear Here.</p>
      ) : (
        <ul className="applicants-list">
          {queue.rows.map((applicant) => (
            <li key={applicant.user_id}>
              <div>
                <h3>{titleCase(applicant.display_name || 'Player')}</h3>
                <p>Requested {new Date(applicant.created_at).toLocaleDateString()}</p>
              </div>
              <div className="applicant-actions">
                <button disabled={!!busy} onClick={() => void review(applicant, false)}>
                  {busy?.userId === applicant.user_id && !busy.approve
                    ? 'Processing...'
                    : 'Decline'}
                </button>
                <button disabled={!!busy} onClick={() => void review(applicant, true)}>
                  {busy?.userId === applicant.user_id && busy.approve ? 'Processing...' : 'Approve'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
