/**
 * HU-HILO-001 (heads-up variants audit, 2026-11-13).
 *
 * The V40 Omaha pressure cap is a ceiling for a weak HIGH hand facing a bet
 * of 0.6 pot or more (pair 0.28, two pair 0.30 to 0.36). It was applied to
 * the whole pot share in hi-lo, so a hand holding the nut low with a weak
 * high was priced at 0.28 and folded the river to one pot-sized bet heads-up,
 * 20 seeds of 20, although the low half alone returns 18 for a call of 12.
 *
 * The floor is half of the sampled low share of ANY qualifying low, not only
 * the nut low: a second or third low is floored at its own share (a better
 * low can still take that half; the share already carries it).
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
 *
 * FIXED-LIMIT HI-LO (2026-11-14, Fixed-Limit lane, opt-in
 * HorseDecideOpts.fixedLimitHiLoLowHalfFloor): the same reasoning holds in
 * fixed limit, heads-up and multiway. A better high hand cannot take the low
 * half in any field. In flo8 six-handed the cap fired on
 * 254 of 493 river decisions and clipped pair-plus-low and high-plus-low hands
 * (low half 0.46 and 0.59) to 0.10 and 0.13 at a price of 0.05. River only:
 * on the turn the low is still a draw whose share against a line-conditioned
 * range is not measured, so earlier streets keep the ceiling as it was.
 *
 * WHAT lowShare IS (HorseEval simulateEquity, the hi-lo branch of its loop):
 * the mean, over the sampled runouts, of the hand's fraction of the LOW HALF
 * in that runout: 1/k when its low ties k ways for the best qualifying low, 0
 * when it has no qualifying low, a better low exists, or no low qualifies at
 * all. It is accumulated in the same iteration, from the same opponent
 * holdings and board, as the high share, and that iteration's pot share is
 * 0.5 x high share + 0.5 x low share (whole pot to the high when no low
 * qualifies). So the joint pot share the sampler returns is never below
 * 0.5 x lowShare, a quartered low (half of the low half) carries 0.5, and a
 * multi-board read averages both per board alike.
 *
 * NO DOUBLE COUNTING: the floor never ADDS the low half to the capped high
 * share. hiLoCappedRiverShare takes the larger of the class cap and the low
 * half and then the smaller of that and the joint share: a scoop, whose
 * joint share already holds its low half, is never priced above that joint
 * share, and a hand is never priced below 0.5 x lowShare while its joint
 * share is at least that (always, for the sampler's own joint share).
 */
export interface HiLoLowHalfSpot {
  isHiLo: boolean;
  isFixedLimit: boolean;
  isRiver: boolean;
  /** Opponents still in the hand. */
  opponents: number;
  /** The hand's share of the low half, 0 to 1 (HiLoSplit.lo). */
  lowShare: number | undefined;
  /** Opt-in (2026-11-14): the floor also applies in fixed limit, heads-up
   *  and multiway. Absent or false: fixed limit returns 0 as before. */
  fixedLimitLowHalf?: boolean;
}

/** The floor the hi-lo low half puts under the V40 pressure cap; 0 = none. */
export function hiLoRiverLowHalfFloor(spot: HiLoLowHalfSpot): number {
  if (!spot.isHiLo || !spot.isRiver) return 0;
  if (spot.isFixedLimit) {
    if (spot.fixedLimitLowHalf !== true || !(spot.opponents >= 1)) return 0;
  } else if (spot.opponents !== 1) return 0;
  const lo = spot.lowShare;
  if (lo === undefined || !Number.isFinite(lo)) return 0;
  return 0.5 * Math.max(0, Math.min(1, lo));
}

/**
 * The V40 weak-high cap applied to a joint hi-lo pot share: the class cap
 * (never under 0.08), raised to the low-half floor where one applies, and
 * never above the joint share it caps. With floor 0 this is the cap exactly
 * as it was: min(joint, max(0.08, cap)).
 */
export function hiLoCappedRiverShare(
  jointShare: number,
  cap: number,
  lowHalfFloor: number
): number {
  return Math.min(jointShare, Math.max(0.08, cap, lowHalfFloor));
}
