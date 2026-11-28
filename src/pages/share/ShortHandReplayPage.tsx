/**
 * /h/<token>: a short shared-hand link (SharedHandLinkService).
 *
 * Resolves the token to the sender's payload and invite code, then renders the
 * same replay page the long link renders. A link the sender revoked, or one
 * that never existed, says so plainly; a server that could not be reached is
 * its own message, never "not found".
 */
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import SharedHandReplayPage from './SharedHandReplayPage';
import ArenaWorkspaceHeader from '../../components/lobby/ArenaWorkspaceHeader';
import '../../components/ops/ArenaOps.css';
import { openSharedHand, type OpenedSharedHand } from '../../services/SharedHandLinkService';
import './SharedHandReplayPage.css';

const MESSAGES: Record<'revoked' | 'missing' | 'unreachable', { title: string; body: string }> = {
  revoked: {
    title: 'This Hand Is No Longer Shared',
    body: 'The Player Who Shared It Has Stopped Sharing This Link.',
  },
  missing: {
    title: 'This Hand Link Does Not Exist',
    body: 'The Link May Have Been Typed Or Copied Incorrectly. Ask For It Again.',
  },
  unreachable: {
    title: 'Could Not Load This Hand',
    body: 'Check Your Connection And Open The Link Again.',
  },
};

export default function ShortHandReplayPage() {
  const { token = '' } = useParams<{ token: string }>();
  const [opened, setOpened] = useState<OpenedSharedHand | null>(null);

  useEffect(() => {
    let cancelled = false;
    setOpened(null);
    void openSharedHand(token)
      .then((r) => {
        if (!cancelled) setOpened(r);
      })
      .catch(() => {
        if (!cancelled) setOpened({ status: 'unreachable' });
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!opened) {
    return (
      <div className="arena-workspace shared-replay-workspace">
        <div className="shared-replay-shell">
          <ArenaWorkspaceHeader
            area="handreview"
            title="Hand Replay"
            summary="Watch A Shared Poker Hand Replay From Smarter Poker."
          />
          <section
            className="arena-case arena-ops-case shared-replay shared-replay--empty"
            aria-busy="true"
          >
            <p className="shared-replay__body">Loading The Hand</p>
          </section>
        </div>
      </div>
    );
  }
  if (opened.status === 'open') {
    return <SharedHandReplayPage encodedOverride={opened.payload} inviteOverride={opened.invite} />;
  }
  const m = MESSAGES[opened.status];
  return (
    <div className="arena-workspace shared-replay-workspace">
      <div className="shared-replay-shell">
        <ArenaWorkspaceHeader
          area="handreview"
          title="Hand Replay"
          summary="Watch A Shared Poker Hand Replay From Smarter Poker."
        />
        <section className="arena-case arena-ops-case shared-replay shared-replay--empty">
          <h2 className="arena-section-title shared-replay__title">{m.title}</h2>
          <p className="shared-replay__body">{m.body}</p>
          <div className="arena-switch arena-ops-keys arena-ops-primary shared-replay__actions">
            <Link className="shared-replay__link" to="/">
              Go To The Lobby
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
