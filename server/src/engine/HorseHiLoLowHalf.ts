/**
 * HU-HILO-001 (heads-up variants audit, 2026-11-13).
 *
 * The V40 Omaha pressure cap is a ceiling for a weak HIGH hand facing a bet
 * of 0.6 pot or more (pair 0.28, two pair 0.30 to 0.36). It was applied to
 * the whole pot share in hi-lo, so a hand holding the nut low with a weak
 * high was priced at 0.28 and folded the river to one pot-sized bet heads-up,
 * 20 seeds of 20, although the low half alone returns 18 for a call of 12.
 *
 * A better high hand cannot take the low half. So where this applies, the
 * ceiling never goes below half of the hand's own low share.
 *
 * Confined to the measured defect: pot-limit hi-lo, one opponent left, on the
 * river (the low is made, not drawn to). Fixed-limit hi-lo, multiway pots and
 * earlier streets return 0 and keep the ceiling exactly as it was; the
 * qualified fixed-limit deep-stack domain
 * (remainingVariants/FixedLimitDeepPolicy.test.ts) reads that capped equity
 * and must not move.
 */
export interface HiLoLowHalfSpot {
  isHiLo: boolean;
  isFixedLimit: boolean;
  isRiver: boolean;
  /** Opponents still in the hand. */
  opponents: number;
  /** The hand's share of the low half, 0 to 1 (HiLoSplit.lo). */
  lowShare: number | undefined;
}

/** The floor the hi-lo low half puts under the V40 pressure cap; 0 = none. */
export function hiLoRiverLowHalfFloor(spot: HiLoLowHalfSpot): number {
  if (!spot.isHiLo || spot.isFixedLimit || !spot.isRiver || spot.opponents !== 1) return 0;
  const lo = spot.lowShare;
  if (lo === undefined || !Number.isFinite(lo)) return 0;
  return 0.5 * Math.max(0, Math.min(1, lo));
}
