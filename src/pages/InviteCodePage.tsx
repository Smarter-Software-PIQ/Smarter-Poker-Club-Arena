/**
 * /i/:code inside Club Arena - a Share & Invite short link opened in the app.
 *
 * On the web, smarter.poker/i/<CODE> is the World Hub's landing page (link
 * preview, attribution cookie, Create Account first). Inside the native app a
 * universal link or clubarena://i/<CODE> lands here instead (deepLinks.ts maps
 * both), so this page does the same job in-app: remember the code, resolve it,
 * and go to the club's join page, which sends a signed-out player to create an
 * account and claims the invite for a signed-in one.
 *
 * 2026-11-28 #SmarterDesign (player pages batch P7): wears the arena workspace
 * with ArenaWorkspaceHeader and a chrome case for loading and failed invite
 * states; InvitePage.css stays untouched for InvitePage.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PageSkeleton from '../components/common/PageSkeleton';
import ArenaWorkspaceHeader from '../components/lobby/ArenaWorkspaceHeader';
import '../components/ops/ArenaOps.css';
import { appendInviteNextParam } from '../lib/inviteCode';
import {
  normalizeInviteCode,
  rememberInviteCode,
  resolveInviteCode,
} from '../services/ClubInviteService';
import { reportError } from '../utils/errorReporter';
import './InviteCodePage.css';

const INVITE_CODE_SUMMARY =
  'Resolves A Club Invite Short Link And Takes You Straight To The Club Join Screen.';

export default function InviteCodePage() {
  const { code } = useParams();
  const [searchParams] = useSearchParams();
  const nextParam = searchParams.get('next');
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const normalized = normalizeInviteCode(code);
    if (!normalized) {
      setFailed(true);
      return;
    }
    rememberInviteCode(normalized);
    let alive = true;
    resolveInviteCode(normalized)
      .then((r) => {
        if (!alive) return;
        if (r) navigate(appendInviteNextParam(r.inAppPath, nextParam), { replace: true });
        else setFailed(true);
      })
      .catch((err) => {
        reportError(err, 'InviteCodePage.resolve');
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [code, navigate, nextParam]);

  if (failed) {
    return (
      <main className="invite-code-page arena-workspace">
        <ArenaWorkspaceHeader area="members" title="Club Invite" summary={INVITE_CODE_SUMMARY} />
        <section className="arena-case arena-ops-case invite-code-page__case">
          <p className="arena-ops-eyebrow">Club Invite</p>
          <h2 className="arena-section-title invite-code-page__title">This Invite Did Not Work</h2>
          <p className="invite-code-page__message">
            The Link May Be Mistyped Or The Club Is No Longer Available.
          </p>
          <div className="arena-switch arena-ops-primary invite-code-page__actions">
            <button onClick={() => navigate('/clubs-list', { replace: true })}>Browse Clubs</button>
          </div>
        </section>
      </main>
    );
  }
  return (
    <main className="invite-code-page arena-workspace">
      <ArenaWorkspaceHeader area="members" title="Club Invite" summary={INVITE_CODE_SUMMARY} />
      <section className="arena-case arena-ops-case invite-code-page__case">
        <PageSkeleton variant="default" />
      </section>
    </main>
  );
}
