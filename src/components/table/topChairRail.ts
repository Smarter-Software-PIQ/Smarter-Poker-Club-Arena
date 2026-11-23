/**
 * EVERY TOP CHAIR STANDS ON THE RAIL (Dan 2026-11-22, binding).
 *
 * Dan, with a phone screenshot of a watched 6-max PLO5 table: "IN THE 6 MAX
 * GAMES THE TOP VILLAIN IS TO LOW ON THE TABLE! THEY MUST 100% OF THE TIME BE
 * ON THE RAIL AND NEVER ON TOP OF THE TABLE OR OVERLAPPING THE FELT. THE TOP
 * OF THAT VILLAINS HEAD CAN BE 'CUT OFF' AT THE TOP OR 'UNDER THE ACTION BAR'
 * WITH THE ACTION BAR BEING LAYER 1 AND THE AVATAR LAYER 2." Then, of the
 * other table sizes that drew the same chair on the felt: "FULLY BUILD, FIX
 * AND ENHANCE ALL OF THESE".
 *
 * A top chair is any chair whose ring station is in the top cap (y < 20 of
 * the canvas: `.seat-wrapper--cap`, plus `--top` on cash tables): the top
 * centre of the 2, 4, 6 and 8 seat rings (y 5) and the two top diagonals of
 * the 3, 5, 7, 9 and 10 seat rings (y 6).
 *
 * Until 2026-11-22 the phone placed those chairs from the TOP DOWN. The pod
 * was raised until the portrait's crown kept 8px below the jackpot plate (or,
 * on six-max, met the tab bar), and the chair allocator then pushed it back
 * down until the crown and any caption lane above it cleared the bar.
 * Whatever did not fit above the rail was paid for below it, by the name
 * plate, on the felt: measured on the real components the plate's bottom edge
 * sat 11-22% down the canvas on every ring and every portrait phone and
 * tablet width, against a felt window that starts at 8.9%. Tournament tables
 * were never placed at all (their top chairs carry no `--top` tag) and sat on
 * the felt by CSS alone.
 *
 * Every top chair is now placed from the RAIL UP, from two numbers only: where
 * the table canvas is, and the chair's own rail station (its wrapper's `top`,
 * `seatLayoutFor(n)`). The plate's bottom edge rests on that station. The
 * portrait stands on the plate and rises as far as its size takes it: under
 * the jackpot plaque and the tab bar, which paint above it, or off the top of
 * the screen. Nothing above the chair is an input, so nothing above the chair
 * can push it onto the felt again. Two chairs on one rail line share one
 * station, so they sit level by construction, whatever character either one
 * wears.
 *
 * The one placement that is not "bottom on the station" is the nine-seat
 * phone ring (481-640 portrait), whose plates were already centred on their
 * stations and on the rail (2026-10-25, "a phone lays the table out like
 * desktop"). It keeps that placement exactly, and only gains a floor: the
 * plate's bottom edge never passes the felt window, which a centred plate
 * could on the shortest canvases (Safari with its toolbars showing).
 *
 * WHY THE STATION AND NOT A NEW NUMBER. The stations (y 5 and y 6) are on the
 * rim on every shipped skin: measured down the centre column of each
 * `skin_*.png`, the painted felt begins no higher than 5.3% (ocean_blue) and
 * at 7.2% / 8.6% on the two standard skins, and at the diagonals' columns the
 * felt's top curve is lower still. The declared felt window
 * (`FELT_WINDOW.top`) is 8.9%. A plate whose bottom edge is on its station is
 * therefore above the felt on all of them, at every canvas height, because
 * both are percentages of the same canvas the art is stretched over.
 *
 * tests/every-top-chair-stands-on-the-rail.law.test.tsx
 * tests/the-six-max-top-seat-stands-on-the-rail.law.test.tsx
 * tests/two-top-chairs-sit-level.law.test.tsx
 */
import { FELT_WINDOW } from './tableGeometry';

/** Every viewport whose top chairs stand on their rail: the phone reference
 * layout, portrait, 481-640px wide, which every phone lays its table out at
 * (600px). That layout's top lane was built for a rail-standing chair: a hand
 * the top chair tables rises over its portrait, so the felt in front of it
 * stays free for its wager and the pot.
 *
 * A page narrower than 481px is not a phone's table; it is a multi-table mini
 * tile or a desktop window squeezed narrow, whose ring keeps its approved
 * placement: moving those top chairs collided with the minis' tabled hands and
 * crown clearances (CSS Beat, 2026-11-22). A portrait tablet (641-768px) keeps
 * its approved placement too: its canvas starts just under the tab bar, so a
 * chair on the rail leaves no room above it for a tabled hand, the hand then
 * lands on the felt in front of the chair, and the chair's ALL IN marker had
 * nowhere left to stand but on those cards and the pot (CSS Beat, 768x1024
 * six-max PLO5, 2026-11-22). Landscape and wider layouts keep theirs. */
export function topChairRailViewport(viewportWidth: number, viewportHeight: number): boolean {
  return phoneReferenceLayout(viewportWidth, viewportHeight);
}

/** The phone reference layout (481-640px, portrait): the
 * `(min-width: 481px) and (max-width: 640px) and (orientation: portrait)`
 * blocks in SeatSlot.css and `inwardFans` in useProtectedCardLayout. */
export function phoneReferenceLayout(viewportWidth: number, viewportHeight: number): boolean {
  return viewportWidth > 480 && viewportWidth <= 640 && viewportHeight > viewportWidth;
}

/** How a top chair's plate rests on its station. Bottom edge on the station,
 * except the nine-seat phone ring, which keeps its approved centred plates. */
export type TopChairRest = 'bottom' | 'centre';
export function topChairRest(
  seats: string | null | undefined,
  viewportWidth: number,
  viewportHeight: number
): TopChairRest {
  return seats === '9' && phoneReferenceLayout(viewportWidth, viewportHeight) ? 'centre' : 'bottom';
}

/** The six-max phone ring: its top chair's action caption rides above the
 * crown (SeatSlot.css), so where the crown has gone behind the tab bar the
 * caption is dropped to just under it (topChairCaptionDrop). Every other top
 * chair's caption hangs below its plate. */
export function sixSeatPhoneRail(
  seats: string | null | undefined,
  viewportWidth: number,
  viewportHeight: number
): boolean {
  return seats === '6' && phoneReferenceLayout(viewportWidth, viewportHeight);
}

/** Whether a rail station (percent of the canvas height) is above the felt. */
export function stationIsOnTheTopRail(stationPct: number): boolean {
  return Number.isFinite(stationPct) && stationPct >= 0 && stationPct < FELT_WINDOW.top;
}

/**
 * The translation (layout px) that rests a top chair's name plate on its rail
 * station: the plate's BOTTOM edge lands exactly on the station line, or, for
 * the nine-seat phone ring (`rest: 'centre'`), the plate is centred on it and
 * its bottom edge never passes the felt window.
 *
 * Every input is permanent geometry in viewport px, except `scale` (viewport
 * px per layout px). Nothing here is the header, the portrait, a caption, a
 * card, a jackpot or a wager; that is the whole point.
 */
export function topChairRailShift(input: {
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
  rest?: TopChairRest;
}): number {
  const { ringTop, ringHeight, stationPct, plateTop, plateHeight } = input;
  const scale = input.scale > 0 && Number.isFinite(input.scale) ? input.scale : 1;
  const station = ringTop + (ringHeight * stationPct) / 100;
  const bottom =
    input.rest === 'centre'
      ? Math.min(station + plateHeight / 2, ringTop + (ringHeight * FELT_WINDOW.top) / 100)
      : station;
  return (bottom - plateHeight - plateTop) / scale;
}

/**
 * How far (layout px) the six-max phone top chair's action caption drops from
 * its lane above the crown so that it is never drawn behind the tab bar. Zero
 * whenever the lane is already clear, so a tall table keeps the caption above
 * the artwork exactly as every other chair does. The chair itself never moves
 * for it.
 */
export function topChairCaptionDrop(input: {
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
