import { useNavigate } from 'react-router-dom';
import { normalizeInviteCode, safeInviteNextPath } from '../../lib/inviteCode';
import { SpadeConsole } from '../console/SpadeConsole';
import './TableLoadFailureOverlay.css';

interface TableLoadFailureOverlayProps {
  tableLoadFailure: 'missing' | 'unreachable';
  exitDestination: () => string;
  inviteCode?: string | null;
  returnPath?: string | null;
}

/**
 * ON THE MASTER (2026-09-09, #ClubArenaConsole). This was 90 lines of inline
 * style - a navy box with a 14px radius and two CSS pills - shown at the worst
 * possible moment, when a table a player was trying to sit at has gone. It is
 * the spade console now, and it says the same two things it always said: a
 * closed table charged nothing and took no seat, and an unreachable one is
 * probably the connection. TRY AGAIN only appears when trying again can work.
 * When a table invite link carries a valid club invite code (?i=<CODE>), a
 * non-member sees a direct two-plate console to Join Club & Open Table.
 */
export function TableLoadFailureOverlay({
  tableLoadFailure,
  exitDestination,
  inviteCode,
  returnPath,
}: TableLoadFailureOverlayProps) {
  const navigate = useNavigate();
  const missing = tableLoadFailure === 'missing';
  const validInviteCode = normalizeInviteCode(inviteCode);
  const safeReturn = safeInviteNextPath(returnPath);
  const canJoinWithInvite = missing && Boolean(validInviteCode);
  const joinDestination = validInviteCode
    ? safeReturn
      ? `/i/${validInviteCode}?next=${encodeURIComponent(safeReturn)}`
      : `/i/${validInviteCode}`
    : null;
  const singleWayOut = missing && !canJoinWithInvite;

  return (
    <div className="table-load-failure-overlay" role="alert">
      <div className="table-load-failure-box ac-popup">
        <SpadeConsole
          as="div"
          eyebrow="The Table"
          title={missing ? 'Table Unavailable' : 'Cannot Reach It'}
          titleId="table-load-failure-title"
          pill={missing ? 'Unavailable' : 'Offline'}
          pillInk={missing ? 'muted' : 'red'}
          /* TWO ACTIONS OR NONE. The foot paints BOTH plates, so handing it
             one action leaves an empty painted button beside it - which reads
             as broken, not as spare. A surface with a single way out uses the
             flat cap and prints that one way out as a lit word on the glass,
             the same control Club Rules uses for Copy and Retry. */
          foot={singleWayOut ? 'foot' : undefined}
          plates={
            singleWayOut
              ? undefined
              : canJoinWithInvite && joinDestination
                ? {
                    secondary: {
                      label: 'Back To Lobby',
                      onClick: () => navigate(exitDestination()),
                    },
                    primary: {
                      label: 'Join Club & Open Table',
                      ink: 'white',
                      onClick: () => navigate(joinDestination),
                    },
                  }
                : {
                    secondary: {
                      label: 'Back To Lobby',
                      onClick: () => navigate(exitDestination()),
                    },
                    primary: {
                      label: 'Try Again',
                      ink: 'white',
                      onClick: () => window.location.reload(),
                    },
                  }
          }
        >
          <p className="sc-copy sc-copy--center table-load-failure__body">
            {canJoinWithInvite
              ? 'This Table Belongs To A Club You Have Not Joined Yet, Or It Has Closed. Join The Club With This Invite To Open The Table. Nothing Was Charged And No Seat Was Taken.'
              : missing
                ? 'This Table Is Closed, Finished, Or Belongs To A Club You Have Not Joined Yet. Nothing Was Charged And No Seat Was Taken.'
                : 'We Could Not Load This Table After Five Tries. Your Connection May Be Down.'}
          </p>
          {singleWayOut && (
            <button
              type="button"
              className="table-load-failure__way-out sc-ink--blue"
              onClick={() => navigate(exitDestination())}
            >
              Back To Lobby
            </button>
          )}
        </SpadeConsole>
      </div>
    </div>
  );
}

export default TableLoadFailureOverlay;
