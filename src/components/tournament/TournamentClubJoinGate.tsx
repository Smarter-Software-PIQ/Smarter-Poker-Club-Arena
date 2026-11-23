import { useNavigate } from 'react-router-dom';
import { clubInviteJoinPath } from '../../lib/inviteCode';
import { SpadeConsole } from '../console/SpadeConsole';
import './TournamentClubJoinGate.css';

interface TournamentClubJoinGateProps {
  /** The club code the shared link carried (`?i=`). */
  inviteCode: string;
  /** Where the join returns to: this tournament (parseTournamentInviteParams). */
  returnPath: string | null;
}

/**
 * A TOURNAMENT LINK FROM A CLUB YOU HAVE NOT JOINED (2026-11-22,
 * #ClubArenaConsole). A tournament is readable only inside its club, so a
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

  return (
    <div className="tournament-club-join-gate" role="alert">
      <SpadeConsole
        as="div"
        eyebrow="The Tournament"
        title="Join The Club First"
        titleId="tournament-club-join-title"
        pill="Invite"
        pillInk="blue"
        plates={{
          secondary: {
            label: 'Back To Clubs',
            onClick: () => navigate('/clubs'),
          },
          primary: {
            label: 'Join Club & Open Tournament',
            ink: 'white',
            onClick: () => {
              if (joinDestination) navigate(joinDestination);
            },
          },
        }}
      >
        <p
          className="sc-copy sc-copy--center tournament-club-join-gate__body"
          data-testid="tournament-club-join-copy"
        >
          This Tournament Belongs To A Club You Have Not Joined Yet, Or It Has Closed. Join The Club
          With This Invite To Open It. Joining Charges Nothing And Registers You For Nothing.
        </p>
      </SpadeConsole>
    </div>
  );
}

export default TournamentClubJoinGate;
