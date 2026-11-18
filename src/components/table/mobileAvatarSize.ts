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

/** The nine-seat phone rail bust every chair takes (the `--sp-seat-rail-bust`
 * fallback in SeatSlot.css). Only a portrait whose own art is too wide for the
 * rail beside the board goes below it, on its own chair, while it is seated. */
export const NINE_SEAT_PHONE_RAIL_BUST = 1.7;

/** Rendered `.seat__avatar-img` heights, in layout px at the 600px phone
 * layout, that a phone table must reach with the fixture's character art.
 * Measured on the real-component fixture (tests/e2e/table-proportions.spec.ts). */
export const PHONE_AVATAR_MIN_HEIGHT_PX = {
  sixSeat: 175,
  nineSeatOpponent: 140,
  nineSeatHero: 187,
} as const;
