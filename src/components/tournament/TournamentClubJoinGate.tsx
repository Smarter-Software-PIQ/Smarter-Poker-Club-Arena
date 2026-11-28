import { useNavigate } from 'react-router-dom';
import { clubInviteJoinPath } from '../../lib/inviteCode';
import './TournamentClubJoinGate.css';

interface TournamentClubJoinGateProps {
  /** The club code the shared link carried (`?i=`). */
  inviteCode: string;
  /** Where the join returns to: this tournament (parseTournamentInviteParams). */
  returnPath: string | null;
}

/**
 * A TOURNAMENT LINK FROM A CLUB YOU HAVE NOT JOINED (2026-11-22; on
 * #SmarterDesign since 2026-11-28). A tournament is readable only inside its club, so a
 * signed-in friend who opened a shared link before joining used to read
 * nothing and land on "Tournament Not Found" with Back To Clubs, a dead end.
 * The link carries the sender's club code, so this offers the club's own join
 * step (the same detour a table link takes, TableLoadFailureOverlay), which
 * comes back to the tournament once the friend is in. Joining charges nothing
 * and registers for nothing; the tournament's own buttons do that.
 */
export function TournamentClubJoinGate({ inviteCode, returnPath }: TournamentClubJoinGateProps) {
  const navigate = useNavigate();
  const joinDestination = clubInviteJoinPath(inviteCode, returnPath);

  /* #SmarterDesign batch T1 (2026-11-28): a page section, so it wears the
     workspace's thin chrome case, not the painted spade console. The words,
     the order and both controls are the console's. */
  return (
    <div
      className="tournament-club-join-gate arena-case arena-ops-case"
      role="alert"
      aria-labelledby="tournament-club-join-title"
    >
      <p className="tournament-club-join-gate__eyebrow">The Tournament</p>
      <h2 className="arena-section-title" id="tournament-club-join-title">
        Join The Club First
        <small>Invite</small>
      </h2>
      <p className="tournament-club-join-gate__body" data-testid="tournament-club-join-copy">
        This Tournament Belongs To A Club You Have Not Joined Yet, Or It Has Closed. Join The Club
        With This Invite To Open It. Joining Charges Nothing And Registers You For Nothing.
      </p>
      <div className="arena-switch arena-ops-keys tournament-club-join-gate__keys">
        <button type="button" onClick={() => navigate('/clubs')}>
          Back To Clubs
        </button>
        <button
          type="button"
          className="tournament-club-join-gate__primary"
          onClick={() => {
            if (joinDestination) navigate(joinDestination);
          }}
        >
          Join Club &amp; Open Tournament
        </button>
      </div>
    </div>
  );
}

export default TournamentClubJoinGate;
