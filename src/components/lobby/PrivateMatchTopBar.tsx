/**
 * PRIVATE MATCH TOP BAR (2026-11-23)
 *
 * Placed at the very top of the Sit & Go (Heads-Up) and Spins lobby tabs so
 * any player can create a strictly link-only Private Heads-Up Match or Private
 * Spin from the club/union's currently offered boards, share its link, or
 * unregister and permanently close their open private event at any time.
 */
import type { MyPrivateMatchInfo, PrivateMatchFormat } from '../../lib/privateSeatFirstMatch';
import './PrivateMatchTopBar.css';

export interface ActivePrivateMatchRow {
  info: MyPrivateMatchInfo;
  name: string;
  seatsLabel: string;
}

export interface PrivateMatchTopBarProps {
  format: PrivateMatchFormat;
  colSpan: number;
  canCreate: boolean;
  activeMatches: readonly ActivePrivateMatchRow[];
  closingId: string | null;
  onOpenCreate: () => void;
  onOpenMatch: (match: ActivePrivateMatchRow) => void;
  onShareLink: (match: ActivePrivateMatchRow) => void;
  onCloseMatch: (tournamentId: string) => void;
}

export function PrivateMatchTopBar({
  format,
  colSpan,
  canCreate,
  activeMatches,
  closingId,
  onOpenCreate,
  onOpenMatch,
  onShareLink,
  onCloseMatch,
}: PrivateMatchTopBarProps) {
  if (!canCreate && activeMatches.length === 0) return null;

  const isSpin = format === 'spin';

  return (
    <>
      {canCreate && (
        <tr
          className="lt-tournament-header private-match-topbar"
          data-game-heading="private-create"
          data-kind={isSpin ? 'spin' : 'sng'}
          data-testid={isSpin ? 'private-spin-topbar' : 'private-hu-topbar'}
          role="row"
        >
          <td colSpan={colSpan} role="gridcell">
            <div className="lt-tournament-heading">
              <span
                className="lt-tournament-icon"
                data-tournament-icon={isSpin ? 'spin' : 'sng'}
                aria-hidden="true"
              />
              <span className="lt-tournament-heading__name">
                {isSpin ? 'Private Spin (3-Max)' : 'Private Heads-Up Match (2-Max)'}
                <span className="lt-tournament-heading__format">Invite Link Only</span>
              </span>
              <button
                type="button"
                className="lt-tournament-heading__guarantee private-match-topbar__btn"
                data-testid={isSpin ? 'create-private-spin-btn' : 'create-private-hu-btn'}
                onClick={onOpenCreate}
              >
                {isSpin ? 'Create Private Spin' : 'Create Private Heads-Up'}
              </button>
            </div>
          </td>
        </tr>
      )}

      {activeMatches.map((match) => {
        const closing = closingId === match.info.tournamentId;
        return (
          <tr
            key={match.info.tournamentId}
            className="lt-tournament-header private-match-topbar private-match-topbar--active"
            data-game-heading="private-match"
            data-testid="active-private-match-banner"
            role="row"
          >
            <td colSpan={colSpan} role="gridcell">
              <div className="private-match-topbar__active-item">
                <div className="private-match-topbar__active-info">
                  <span className="private-match-topbar__active-tag">
                    {match.info.isCreator ? 'Your Private Event' : 'Invited Private Event'} ·{' '}
                    {match.seatsLabel}
                  </span>
                  <span className="private-match-topbar__active-name">{match.name}</span>
                </div>
                <div className="private-match-topbar__active-actions">
                  <button
                    type="button"
                    className="lt-invite-btn private-match-topbar__action"
                    onClick={() => onOpenMatch(match)}
                  >
                    Open Table
                  </button>
                  {match.info.isCreator && match.info.inviteToken && (
                    <button
                      type="button"
                      className="lt-invite-btn private-match-topbar__action"
                      data-testid="active-private-share-btn"
                      onClick={() => onShareLink(match)}
                    >
                      Invite
                    </button>
                  )}
                  {match.info.isCreator && (
                    <button
                      type="button"
                      className="lt-invite-btn private-match-topbar__action private-match-topbar__action--danger"
                      data-testid="active-private-close-btn"
                      disabled={closing}
                      onClick={() => onCloseMatch(match.info.tournamentId)}
                    >
                      {closing ? 'Closing...' : 'Unregister & Close'}
                    </button>
                  )}
                </div>
              </div>
            </td>
          </tr>
        );
      })}
    </>
  );
}
