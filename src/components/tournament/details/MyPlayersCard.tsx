/**
 * MyPlayersCard - "how are my players doing", on Details, Ranking, Rewards and
 * Tables. The same inline roster appears wherever an agent has entrants in the event.
 *
 * Rendered only when `useMyPlayers` says the read settled and the viewer
 * carries a downline. Styling follows Ranking's legend (cyan rail, same type
 * sizes, same panel tokens); see MyPlayersCard.css.
 */

import { useId, useState, type ReactNode } from 'react';
import { chips, chipsCompact, ordinal, type TournamentTabProps } from './types';
import PlayerAvatar from '../../avatars/PlayerAvatar';
import WatchAtTableButton from '../../club/WatchAtTableButton';
import { myPlayerStatusText, type MyPlayersSummary } from './myPlayersSummary';
import '../../../styles/tournament-lobby-3d.css';
import './MyPlayersCard.css';

export interface MyPlayersCardProps {
  summary: MyPlayersSummary;
  tournamentId?: string;
  onWatchPlayer?: TournamentTabProps['onWatchPlayer'];
  /** Optional control at the right edge (Ranking's Mine Only / Show All). */
  action?: ReactNode;
  className?: string;
}

function headline(s: MyPlayersSummary): { line: string; sub: string | null } {
  switch (s.mode) {
    case 'none':
      return { line: 'None Of Your Players Registered For This Event', sub: null };
    case 'registered':
      return {
        line: `${chips(s.entered)} Of Your Players ${s.entered === 1 ? 'Is' : 'Are'} Registered`,
        sub: null,
      };
    case 'live':
      return {
        line: `${chips(s.alive)} Of ${chips(s.entered)} ${
          s.entered === 1 ? 'Of Your Players Is' : 'Of Your Players Are'
        } Still In`,
        sub:
          s.bestRank > 0
            ? `Best ${ordinal(s.bestRank)} - ${chipsCompact(s.totalChips)} Chips Between Them`
            : null,
      };
    case 'finished':
      return {
        line: 'None Of Your Players Are Remaining',
        sub: `${chips(s.entered)} ${s.entered === 1 ? 'Player' : 'Players'} Entered`,
      };
  }
}

export default function MyPlayersCard({
  summary,
  tournamentId,
  onWatchPlayer,
  action,
  className,
}: MyPlayersCardProps) {
  const listId = useId();
  const hasList = summary.players.length > 0;
  // Open by default once nobody is left, because then the list IS the answer.
  const defaultOpen = summary.mode === 'finished';
  const [toggled, setToggled] = useState<boolean | null>(null);
  if (summary.mode === 'none') return null;
  const open = hasList && (defaultOpen || toggled === true);
  const { line, sub } = headline(summary);

  return (
    <div
      className={['mp-card', className].filter(Boolean).join(' ')}
      data-mode={summary.mode}
      aria-label="Your Players In This Event"
    >
      <div className="mp-card__top">
        <span className="mp-card__swatch" aria-hidden="true" />
        <span className="mp-card__text">
          <span className="mp-card__line">{line}</span>
          {sub && <span className="mp-card__sub">{sub}</span>}
        </span>
        {hasList && !defaultOpen && (
          <button
            type="button"
            className="mp-card__toggle"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setToggled(!open)}
          >
            {open ? 'Hide Players' : 'Show Players'}
          </button>
        )}
        {action}
      </div>
      {open && (
        <ul id={listId} className="mp-card__list tl-scroll">
          {summary.players.map((p) => (
            <li key={p.userId} className={`mp-card__row mp-card__row--${p.state}`}>
              <span className="mp-card__player">
                <PlayerAvatar src={p.avatarUrl ?? undefined} name={p.username} size="xs" />
                <span className="mp-card__name">{p.username}</span>
                <span className="mp-card__status">
                  {myPlayerStatusText(p, ordinal, chipsCompact)}
                </span>
              </span>
              {summary.mode === 'live' &&
                p.state === 'live' &&
                p.tableId &&
                tournamentId &&
                onWatchPlayer && (
                  <span className="mp-card__watch">
                    <WatchAtTableButton
                      socket="MTT"
                      eyebrow={p.tableName || 'Table'}
                      title="Click And Watch"
                      ariaLabel={`Click And Watch ${p.username} At Their Table`}
                      onClick={() =>
                        onWatchPlayer(p.tableId!, p.tableName || undefined, {
                          tournamentId,
                          userId: p.userId,
                          username: p.username,
                        })
                      }
                    />
                  </span>
                )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
