/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  THE MUST MOVE BOX (Dan 2026-09-05)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * THE BAR IS GONE (Dan 2026-09-05). This used to open with a bar across the
 * upper-right corner reading MUST MOVE / LOBBY / PLAYERS n / TABLES n, which
 * was also the button that opened the lobby. Dan moved that to the action pill
 * row - "THE LOBBY RECTANGLE, NEEDS TO MOVE TO ... WHERE THE '4 SQUARE' BOX
 * IS ... AND SAY 'LOBBY' ON IT" - where it is one word beside the 4-square
 * button (MultiTablePage, .mtp-lobby-btn) and covers no seats. Do not put a
 * readout bar back on the felt; every figure it carried is in the lobby it
 * opens, one tap away.
 *
 * What is left here is what the bar was not: a sentence that has to sit beside
 * the seats it is about, and buttons that DO something.
 *
 * The SEAT CHANGE button: "EACH AND EVERY PLAYER GETS A SEAT CHANGE
 * BUTTON WHEN THEY SIT DOWN AT ANY 'FEEDER GAME'." Shown only while the
 * database says the change is available (seated, not on Main 1, not used,
 * nothing pending); it opens the lobby, where the player picks Any Table or
 * a specific one. A player on Main 1 sees the bar and no button.
 *
 * The figures come from the same read the lobby uses (fn_cash_game_lobby),
 * every ten seconds while the table is open - two controller ticks - and at
 * once whenever the engine says a move is pending, landed or held.
 *
 * THE FELT SAYS A MOVE IS COMING (Dan 2026-09-05). The engine's
 * SEAT_MOVE_PENDING toast is shown once and gone in seconds; the hero then
 * plays a whole hand not knowing whether they are still leaving. So while the
 * database holds a pending move for the viewer, the sentence stays under the
 * bar - "Seat Open On Main 2. Moving After This Hand." - and leaves only when
 * the move has executed (the read no longer returns it). A move always runs
 * at the next hand boundary, so there is no hands-out count to show. It lives
 * in this corner column, above the seats and far from the action buttons at
 * the foot of a 375px screen.
 *
 * The available Seat Change trigger uses the same painted black/silver square
 * material as Lobby, Message and Previous Hand (Dan 2026-10-15). Queue states
 * retain their readable sentences and existing actions.
 */

import { pendingMoveNotice } from '../../services/cashGameLobby';
import { useCashGameLobby } from './useCashGameLobby';
import './CashClusterHUD.css';
import { useSeatChangeVisibility } from '../../hooks/useSeatChangeVisibility';

export const CASH_CLUSTER_HUD_POLL_MS = 10_000;

export interface CashClusterHUDProps {
  gameId: string;
  /** Bumped by the page whenever a seat-move event lands, to re-read at once. */
  refreshKey?: number;
  onOpenLobby: () => void;
  onSeatChange: () => void;
  /**
   * RETIRED 2026-11-01 (Dan: the chair-open pill is removed from the cash
   * observer view). Accepted so existing call sites keep compiling; this
   * component no longer moves the viewer itself.
   */
  onGoToTable?: (tableId: string) => void;
}

export function CashClusterHUD({
  gameId,
  refreshKey = 0,
  onOpenLobby,
  onSeatChange,
}: CashClusterHUDProps) {
  const { visible: seatChangeVisible } = useSeatChangeVisibility();
  const { lobby } = useCashGameLobby(gameId, true, CASH_CLUSTER_HUD_POLL_MS, refreshKey);

  const me = lobby?.me ?? null;
  const moveNotice = me?.seated ? pendingMoveNotice(me.pending_move) : null;
  const seatChangeAvailable = Boolean(me?.seated && me.seat_change.available);
  const listed = me?.seat_change.request ?? null;
  const onWaitlist = Boolean(me && !me.seated && me.waitlist?.on_list);
  /* NOTHING TO SAY, NOTHING DRAWN (2026-09-05). With the bar gone this column
     is only a notice and up to two buttons, and a player sitting quietly in
     the main game has none of them. An empty flex box in the corner is not
     visible, but it is still a pointer-events:auto node over the felt (see
     .hud-ur-column in TableHUD.css), so it does not get rendered at all. */
  if (!moveNotice && !seatChangeAvailable && !listed && !onWaitlist) return null;

  return (
    <div className="cch-column">
      {/* THE BAR IS GONE FROM THE FELT (Dan 2026-09-05). It read MUST MOVE /
          LOBBY / PLAYERS n / TABLES n across the upper-right corner, over two
          seats, and Dan moved it into the action pill row beside the 4-square
          button as one word: "THE LOBBY RECTANGLE, NEEDS TO MOVE TO ... WHERE
          THE '4 SQUARE' BOX IS ... AND SAY 'LOBBY' ON IT." The button lives in
          MultiTablePage now and opens this same lobby over the bus.

          What stays here is what the bar was NOT: the pending-move sentence,
          which has to be beside the seats it is about, and the seat-change /
          waitlist buttons, which are actions rather than a readout. Every
          figure the bar carried is one tap away inside the lobby. */}
      {moveNotice && (
        <div
          className="cch-move-notice"
          role="status"
          aria-live="polite"
          data-testid="cch-move-notice"
        >
          {moveNotice}
        </div>
      )}
      {seatChangeAvailable && seatChangeVisible && (
        <div className="cch-seat-change-control">
          <button
            type="button"
            className="cch-seat-change cch-seat-change--control"
            onClick={onSeatChange}
            aria-label="Seat Change - Request A Table Change"
          >
            <span className="cch-seat-change__face">
              <img
                className="cch-seat-change__art"
                src={`${import.meta.env.BASE_URL}assets/club-buttons/seat-change-black-v1.webp`}
                alt=""
                aria-hidden="true"
              />
              <span className="cch-seat-change__label">Seat Change</span>
            </span>
          </button>
        </div>
      )}
      {listed && seatChangeVisible && (
        <div className="cch-seat-change-control">
          <button
            type="button"
            className="cch-seat-change cch-seat-change--listed"
            onClick={onOpenLobby}
          >
            #{listed.position ?? '-'} On The List
          </button>
        </div>
      )}
      {onWaitlist && (
        /* ── THE CHAIR-OPEN PILL IS GONE (Dan 2026-11-01) ──────────────────
           "REMOVE THE BLUE PILL SHAPED 'CHAIR OPEN IN THE GAME TAKE A SEAT'.
            SHOULDN'T BE THERE FROM THE CASH GAME OBSERVER VIEW."

           The floating control used to flip between a lit "Chair Open In
           This Game: Take A Seat" offer and the waitlist readout. The lit
           offer is removed outright - an observer is never pitched a seat
           from this corner again. What remains is the quiet readout of the
           viewer's place in the queue; the lobby it opens, and the footer's
           own waitlist control, still carry every join action. */
        <button
          type="button"
          className="cch-seat-change cch-seat-change--listed"
          onClick={onOpenLobby}
          aria-label="Your Place On The Waitlist"
        >
          {`Waitlist: #${me?.waitlist?.position ?? '-'} Of ${me?.waitlist?.waiting ?? '-'}`}
        </button>
      )}
    </div>
  );
}

export default CashClusterHUD;
