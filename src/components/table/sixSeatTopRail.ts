/**
 * THE SIX-MAX TOP SEAT STANDS ON THE RAIL (Dan 2026-11-22, binding).
 *
 * Dan, with a phone screenshot of a watched 6-max PLO5 table: "IN THE 6 MAX
 * GAMES THE TOP VILLAIN IS TO LOW ON THE TABLE! THEY MUST 100% OF THE TIME BE
 * ON THE RAIL AND NEVER ON TOP OF THE TABLE OR OVERLAPPING THE FELT. THE TOP
 * OF THAT VILLAINS HEAD CAN BE 'CUT OFF' AT THE TOP OR 'UNDER THE ACTION BAR'
 * WITH THE ACTION BAR BEING LAYER 1 AND THE AVATAR LAYER 2."
 *
 * Until this file the phone placed that chair from the TOP DOWN: the pod was
 * raised until the portrait's crown met the tab bar, and the chair allocator
 * then pushed the whole pod back down until the crown and the reserved action
 * caption above it were clear of the bar. Whatever did not fit above the rail
 * was paid for below it, by the name plate, on the felt. Every enlargement of
 * the portrait (2.1, then 2.3 for a watched table) and every pixel reserved
 * above the crown moved the plate further onto the felt, and a shorter canvas
 * (an older phone, Safari's toolbars) moved it further still.
 *
 * The chair is now placed from the RAIL UP, from two numbers only: where the
 * table canvas is, and the chair's own rail station on the ring
 * (`seatLayoutFor(6)`, y 5). The plate's bottom edge rests on that station.
 * The portrait stands on the plate and rises as far as its approved size takes
 * it: under the tab bar, or off the top of the screen. Nothing above the chair
 * is an input, so nothing above the chair can push it onto the felt again.
 *
 * WHY THE STATION AND NOT A NEW NUMBER. The station (y 5) is the rim on every
 * shipped skin, measured down the centre column of each `skin_*.png`: the
 * painted felt begins no higher than 5.3% (ocean_blue) and at 7.2% / 8.6% on
 * the two standard skins (carbon_red, classic_green); the declared felt window
 * (`FELT_WINDOW.top`) is 8.9%. A plate whose bottom edge is at 5% is therefore
 * above the felt on all of them, at every canvas height, because it is a
 * percentage of the same canvas the art is stretched over.
 *
 * tests/the-six-max-top-seat-stands-on-the-rail.law.test.ts
 */
import { FELT_WINDOW } from './tableGeometry';

/** The phone reference layout the six-seat enlargement applies to. The same
 * condition as `inwardFans` in useProtectedCardLayout and the
 * `(min-width: 481px) and (max-width: 640px) and (orientation: portrait)`
 * blocks in SeatSlot.css. */
export function sixSeatPhoneRail(
  seats: string | null | undefined,
  viewportWidth: number,
  viewportHeight: number
): boolean {
  return (
    seats === '6' && viewportWidth > 480 && viewportWidth <= 640 && viewportHeight > viewportWidth
  );
}

/** Whether a rail station (percent of the canvas height) is above the felt. */
export function stationIsOnTheTopRail(stationPct: number): boolean {
  return Number.isFinite(stationPct) && stationPct >= 0 && stationPct < FELT_WINDOW.top;
}

/**
 * The translation (layout px) that rests the top chair's name plate on its
 * rail station: the plate's BOTTOM edge lands exactly on the station line.
 *
 * Every input is permanent geometry in viewport px, except `scale` (viewport
 * px per layout px). Nothing here is the header, the portrait, a caption, a
 * card or a wager; that is the whole point.
 */
export function sixSeatTopRailShift(input: {
  /** `.table-scaler` top edge. */
  ringTop: number;
  /** `.table-scaler` height. */
  ringHeight: number;
  /** The chair's rail station, percent of the canvas height (its wrapper's `top`). */
  stationPct: number;
  /** The plate's top edge with no shift applied. */
  plateTop: number;
  plateHeight: number;
  scale: number;
}): number {
  const { ringTop, ringHeight, stationPct, plateTop, plateHeight } = input;
  const scale = input.scale > 0 && Number.isFinite(input.scale) ? input.scale : 1;
  const floor = ringTop + (ringHeight * stationPct) / 100;
  return (floor - plateHeight - plateTop) / scale;
}

/**
 * How far (layout px) the top chair's action caption drops from its lane above
 * the crown so that it is never drawn behind the tab bar. Zero whenever the
 * lane is already clear, so a tall table keeps the caption above the artwork
 * exactly as every other chair does. The chair itself never moves for it.
 */
export function sixSeatTopCaptionDrop(input: {
  /** The seat box's top edge, viewport px. */
  seatTop: number;
  /** `--sp-art-rise`, layout px: how far the crown rises above the seat box. */
  rise: number;
  /** `--sp-tag-h`, layout px. */
  tagHeight: number;
  /** The tab bar's bottom edge (or the page top without one), viewport px. */
  headerBottom: number;
  scale: number;
}): number {
  const scale = input.scale > 0 && Number.isFinite(input.scale) ? input.scale : 1;
  // SeatSlot.css: top: calc(-1 * rise - tag-h - 6px). The lane keeps 3px above
  // the pill for its pop (crownActionReservation) and the allocator's bound is
  // half a pixel under the bar.
  const natural = input.seatTop - (input.rise + input.tagHeight + 6) * scale;
  const least = input.headerBottom + 0.5 + 3 * scale;
  return Math.max(0, (least - natural) / scale);
}
