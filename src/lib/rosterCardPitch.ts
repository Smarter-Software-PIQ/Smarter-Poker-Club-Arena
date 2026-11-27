/**
 * How tall one Player Management card is, by viewport width.
 *
 * The roster is a virtual list, so every card has one fixed pitch, and that
 * pitch has to hold the tallest card a width can produce: the portrait (double
 * size since 2026-11-27), the name and upline, the full-width PlayerID and
 * status line (a seated player's table name can wrap on a phone) and, beside
 * them, the figures column, whose long numbers wrap on the narrowest phones.
 * A pitch too short cuts the bottom of the card off (Dan, 2026-11-27: "INSURE
 * THINGS AREN'T CUT OFF ON THE BOTTOM"); one size for every width would leave
 * a tall empty band on wider screens. The widths match the card's own media
 * queries in ArenaWorkspace.css, and the containment spec renders every card
 * at the pitch this returns. Each value is the tallest card measured at that
 * width (both stylesheet orders, longest table name, widest figures, the
 * selection box in the upper right corner) plus 8px, measured with the local
 * fonts and with DejaVu Sans standing in for every missing face, which is what
 * the hosted CI runner draws with (its 360px and 375px cards came out taller
 * than this machine's on 2026-11-27).
 */
export const ROSTER_CARD_PITCH_DEFAULT = 226;

/** Narrowest first: the first tier whose maxWidth the viewport fits wins. */
export const ROSTER_CARD_PITCH_TIERS: ReadonlyArray<{ maxWidth: number; pitch: number }> = [
  { maxWidth: 341, pitch: 305 },
  { maxWidth: 360, pitch: 294 },
  { maxWidth: 375, pitch: 268 },
  { maxWidth: 400, pitch: 253 },
  { maxWidth: 480, pitch: 229 },
  { maxWidth: 719, pitch: 253 },
];

export function rosterCardPitchFor(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth)) return ROSTER_CARD_PITCH_DEFAULT;
  for (const tier of ROSTER_CARD_PITCH_TIERS) {
    if (viewportWidth <= tier.maxWidth) return tier.pitch;
  }
  return ROSTER_CARD_PITCH_DEFAULT;
}
