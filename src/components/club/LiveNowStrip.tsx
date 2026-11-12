import { memo } from 'react';
import type { LiveSeat } from '../../lib/clubLiveSeats';
import { generateAvatarSvg, sizedStorageUrl } from '../../utils/avatarGenerator';
import { withStakes } from '../../utils/tableEyebrow';
import { titleCase } from '../../utils/titleCase';

/**
 * LIVE NOW (Dan, 2026-11-12, Player Management item 4): every member of the
 * club who is at a table right now, pinned above the roster whatever the
 * sort, page or search, so a seated player beyond the loaded page is never
 * out of sight. One chip per player (their newest seat), tap to watch.
 * Fed by src/lib/clubLiveSeats.ts, one read per club per minute.
 */
export interface LiveNowStripProps {
  seats: readonly LiveSeat[];
  onWatch: (table: LiveSeat, member: { userId: string; name: string }) => void;
}

function firstSeatPerPlayer(seats: readonly LiveSeat[]): LiveSeat[] {
  const seen = new Set<string>();
  const out: LiveSeat[] = [];
  for (const seat of seats) {
    if (seen.has(seat.user_id)) continue;
    seen.add(seat.user_id);
    out.push(seat);
  }
  out.sort((a, b) => a.alias.localeCompare(b.alias));
  return out;
}

const LiveNowStrip = memo(function LiveNowStrip({ seats, onWatch }: LiveNowStripProps) {
  const players = firstSeatPerPlayer(seats);
  if (players.length === 0) return null;
  return (
    <section className="members-live-now" aria-label="Live Now">
      <h2 className="members-live-now__title">
        Live Now
        <span className="members-live-now__count">{players.length.toLocaleString()}</span>
      </h2>
      <div className="members-live-now__chips" role="list">
        {players.map((seat) => {
          const name = seat.alias || seat.username || 'Player';
          const table = withStakes(titleCase(seat.name), titleCase(seat.stakes));
          return (
            <button
              key={seat.user_id}
              type="button"
              role="listitem"
              className="members-live-now__chip"
              onClick={() => onWatch(seat, { userId: seat.user_id, name })}
              aria-label={`Watch ${name} At Table, ${titleCase(seat.name)}`}
              title="Watch At Table"
            >
              <span className="members-live-now__avatar" aria-hidden="true">
                {seat.avatar_url ? (
                  <img
                    src={sizedStorageUrl(seat.avatar_url, 48)}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      const image = event.currentTarget;
                      image.onerror = null;
                      image.src = generateAvatarSvg(seat.user_id, name);
                    }}
                  />
                ) : (
                  <span>{name[0]?.toUpperCase() ?? '?'}</span>
                )}
              </span>
              <span className="members-live-now__text">
                <span className="members-live-now__name">{name}</span>
                <span className="members-live-now__table">{table}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
});

export default LiveNowStrip;
