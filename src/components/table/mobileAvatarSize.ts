/**
 * THE APPROVED PHONE AVATAR SIZES (Dan 2026-11-18, binding).
 *
 * Dan: "I KEEP FIXING IT AND MAKING IT SO THE AVATARS ARE AS LARGE AS THEY CAN
 * BE WITHOUT OVERLAPPING ANYTHING OR HIDING ANYTHING, AND THEN IT KEEPS
 * REGRESSING BACK TO THE SMALLER VERSIONS ... PREVENT IT FROM BREAKING OR
 * REGRESSING AGAIN!"
 *
 * A phone table (rendered at the 600px layout width) draws its portraits at a
 * size set HERE, not at whatever a solver happened to leave room for. Every
 * earlier enlargement was undone by one of three things, and all three are
 * now closed:
 *
 *  1. A device-wide size record in localStorage that could only move down, so
 *     one crowded table shrank that game type on that phone for good and no
 *     deploy could undo it (mobileAvatarEnlargement.ts, retired keys deleted).
 *  2. A nine-seat rail size shared by the whole ring that started from its
 *     own last value and could only be multiplied down, so one wide portrait
 *     shrank every chair for the session (opponentAvatarLayout.ts: every
 *     chair now takes the base; a too-wide portrait limits only its own).
 *  3. Size decided by whatever was on the felt at the first fit (wagers, the
 *     puck's current chair, a tabled hand) and then locked for the session.
 *
 * And the reason nobody saw it: every browser check asserted only "bigger than
 * 1x" (the CSS base alone already is), and cleared the device record before
 * each case. The checks now assert these absolute sizes.
 *
 * To change a size, change it here, in SeatSlot.css and in the approved
 * screenshots, in one commit. A feature that needs room must make room around
 * the portrait; it may not shrink it. tests/mobile-avatars-never-ratchet-smaller.law.test.ts
 */

/** `--sp-bust-scale` for six-seat (and the nine-seat default) phone portraits,
 * 481-640px portrait. SeatSlot.css carries the same number. */
export const SIX_SEAT_PHONE_BUST_SCALE = 2.1;

/** A watched six-max table (no hero, so no private card row to keep clear).
 * Measured 2026-11-18: 2.3 passes every guard; 2.4 reaches the dealer button. */
export const SIX_SEAT_SPECTATOR_PHONE_BUST_SCALE = 2.3;

/** The nine-seat phone rail bust every chair takes (the `--sp-seat-rail-bust`
 * fallback in SeatSlot.css). Only a portrait whose own art is too wide for the
 * rail beside the board goes below it, on its own chair, while it is seated. */
export const NINE_SEAT_PHONE_RAIL_BUST = 1.7;

/** Rendered `.seat__avatar-img` heights, in layout px at the 600px phone
 * layout, that a phone table must reach with the fixture's character art.
 * Measured on the real-component fixture (tests/e2e/table-proportions.spec.ts). */
/** A watched six-max table takes SIX_SEAT_SPECTATOR_PHONE_BUST_SCALE only where
 * the phone is tall enough for it. Dan's binding rule is "as large as they can
 * be without overlapping anything": on a height-bound phone (layout viewport
 * shorter than this, in layout px at the 600px phone layout) the fit keeps the
 * spectator portraits clear of the dealer button below 2.3, so the spectator
 * floor does not apply there and the six-seat floor does - still absolute,
 * never lower. Measured 2026-11-19 on production: 320x568 is 1065 layout px tall
 * and painted 176.6-189.2px; 375x852, 393x852 and 430x852 (>= 1189) reach 191. */
export const SPECTATOR_PHONE_MIN_LAYOUT_HEIGHT_PX = 1120;

/** A full-ring portrait is a fixed share of the felt: NINE_SEAT_PHONE_RAIL_BUST
 * times a chair slot that is 0.158 of the felt's width (`--seat-avatar-full`,
 * SeatSlot.css). The nine-seat phone felt is `min(88%, height budget * 0.725)`
 * wide (TablePage.css), so it is 528 layout px wide only where the page is tall
 * enough to give it 728 layout px of height. On a shorter page the whole felt
 * is narrower and every chair, card and portrait on it is smaller by the same
 * share. Nothing shrank the portrait: the rail bust is still 1.7 and no chair
 * carries a limit of its own.
 *
 * The 140px floor was measured on the 320x568 phone (1065 layout px tall, felt
 * 521px). The reconnect witness of the live proof runs on Playwright's
 * iPhone 13 profile, whose viewport is 390x664 with the browser bars showing:
 * 1021 layout px tall. Measured on production 2026-11-24 to 11-26 (runs
 * 45370915465, 45404132008, 45565107595, 45717008924, 45740747646): every
 * full-ring opponent painted 132.1px there, against 140.0 at 1065 and 141.8 at
 * 1188, 1300 and 1363. So, exactly as for the watched six-max table above, a
 * page shorter than this takes the height-bound floor below: still absolute,
 * and the 320x568 phone and every taller one keep 140. */
export const NINE_SEAT_PHONE_MIN_LAYOUT_HEIGHT_PX = 1060;

export const PHONE_AVATAR_MIN_HEIGHT_PX = {
  sixSeat: 175,
  sixSeatSpectator: 191,
  nineSeatOpponent: 140,
  /** Only below NINE_SEAT_PHONE_MIN_LAYOUT_HEIGHT_PX. Measured, never guessed. */
  nineSeatOpponentHeightBound: 132,
  nineSeatHero: 187,
} as const;
