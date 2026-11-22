import { useFitText } from '../lobby/game-cards/useFitText';
import './WaitlistCallToAction.css';

/**
 * THE FULL-TABLE CALL TO ACTION, ON THE PAINTED SHELL (Dan 2026-10-15)
 *
 * Dan, with a screenshot of the old flat green pill: "THE 'TABLE FULL - JOIN
 * WAITING LIST' NEEDS TO BE IMPROVED, THIS IS TOO CHEAP, IT NEEDS A PREMIUM
 * LOOK AND FEEL TO IT."
 *
 * Paint what never changes, print what does (#ClubArenaConsole). The control
 * is the approved action shell (`action-primary-shell`: chrome rim, black glass
 * face, crystal end caps and a socket on the left) and nothing here draws a
 * border, a pill or a gradient. Three live strings are printed into zones
 * measured on that art at its native 1280 x 315:
 *
 *   socket  the number of players waiting, or the hero's own place in line
 *   eyebrow lit blue caps: what state the table is in
 *   title   engraved silver: the action, or where the hero stands
 *
 * Every string is fitted to its face (useFitText), so a long title shrinks
 * before it can touch the chrome.
 */
export interface WaitlistCallToActionProps {
  onClick: () => void;
  /** Lightning joins its pool through the original buy-in, never a chair queue. */
  lightning?: boolean;
  /** Players currently on this table's waiting list. */
  waitingCount: number;
  /** The hero's 1-based place on the list, or null when not on it. */
  position: number | null;
  /** Membership can be known before the queue has assigned a numbered place. */
  onList?: boolean;
  /** An unread queue must never be printed as zero people waiting. */
  queueState?: 'loading' | 'unavailable';
  /**
   * Open chairs at the game's OTHER live tables (Dan 2026-11-22: a game is
   * never "full with no waiting list"). A full Main whose feeder has a chair
   * is not a full game: with nobody waiting, the plate says where the seat is
   * instead of printing "0 Waiting" under a game a player can sit in now.
   */
  openElsewhere?: number;
}

export function WaitlistCallToAction({
  onClick,
  waitingCount,
  position,
  lightning = false,
  onList: membership,
  queueState,
  openElsewhere = 0,
}: WaitlistCallToActionProps) {
  const onList = !lightning && !queueState && (membership ?? position != null);
  /* A seat is open in this game, at another of its tables, and nobody is in
     line for it: the truthful line is the seat, never an empty waiting list. */
  const seatElsewhere =
    !lightning && !queueState && !onList && waitingCount === 0 && openElsewhere > 0;
  const socket =
    lightning || queueState
      ? ''
      : onList
        ? position != null
          ? `#${position}`
          : ''
        : seatElsewhere
          ? String(openElsewhere)
          : String(waitingCount);
  const eyebrow = lightning
    ? 'Lightning Games'
    : queueState === 'loading'
      ? 'Reading The Waiting List'
      : queueState === 'unavailable'
        ? 'Waiting List Unavailable'
        : onList
          ? 'You Are On The Waiting List'
          : seatElsewhere
            ? `Table Full · ${openElsewhere} ${openElsewhere === 1 ? 'Seat' : 'Seats'} Open In This Game`
            : `Table Full · ${waitingCount} Waiting`;
  const title = lightning
    ? 'Join Lightning'
    : queueState || (onList && position == null)
      ? 'Open Game Lobby'
      : onList
        ? `Position ${position} Of ${waitingCount}`
        : seatElsewhere
          ? 'Join The Game'
          : 'Join The Waiting List';

  const socketRef = useFitText<HTMLSpanElement>(socket, 1, 0.5);
  const eyebrowRef = useFitText<HTMLSpanElement>(eyebrow, 1, 0.5);
  const titleRef = useFitText<HTMLSpanElement>(title, 1, 0.5);

  return (
    <button
      type="button"
      className="waitlist-cta"
      data-on-list={onList ? 'true' : 'false'}
      onClick={onClick}
      aria-label={onList ? `${eyebrow}, ${title}` : `${eyebrow}. ${title}`}
    >
      <span className="waitlist-cta__socket" aria-hidden="true">
        <span ref={socketRef} className="waitlist-cta__socket-text">
          {socket}
        </span>
      </span>
      <span className="waitlist-cta__face" aria-hidden="true">
        <span className="waitlist-cta__line">
          <span ref={eyebrowRef} className="waitlist-cta__eyebrow">
            {eyebrow}
          </span>
        </span>
        <span className="waitlist-cta__line">
          <span ref={titleRef} className="waitlist-cta__title">
            {title}
          </span>
        </span>
      </span>
    </button>
  );
}
