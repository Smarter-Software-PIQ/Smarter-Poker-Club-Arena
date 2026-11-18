/**
 * OMAHA TURN CALL: REALIZATION FROM THE RUNOUT, NOT FROM ONE FLAT NUMBER
 * (2026-11-17, PLO Strategy lane; option omahaTurnCallRealizationByRunout,
 * default OFF, read `=== true`; acts only inside omahaFacingBetEv).
 *
 * Owner, 2026-11-16: "the size of the bet should not make or break the
 * decision, the decision needs to be made on the hand, and the math and the
 * opponents range". And: Phase 2 PLO4/PLO5, texture-based equity realization.
 *
 * What it replaces. A turn call with chips behind does not get its showdown
 * equity: there is a river bet to face first. omahaFacingBetEv prices that
 * with one factor, 0.85 out of position and 0.92 in position (capped at 0.85
 * with a player behind), whatever the hand and the board (GtoFacingDefenseV32
 * realizationFactor: hold'em-origin). Hand-specific caps were then added for
 * hands the flat number got wrong (a paired turn with no boat out, a big
 * barrel against one or two pair with no real draw), each behind a bet-size
 * threshold.
 *
 * What it does. The exact turn count already scores the hand on EVERY river
 * card against the bettor's value region and against his other holdings. This
 * module reads those per-river results (OmahaEvHandCounts.runout) and asks,
 * river by river, the one question realization is about: on this river, is
 * the hand strong enough against the hands he bets for value to call a river
 * bet?
 *
 *  - Where it is (it beats at least OMAHA_RUNOUT_CALLS_AT of his value region
 *    on that river), the equity of that river is realized in full: the hand
 *    reaches showdown whatever he does. A nut draw's equity sits on such
 *    rivers, so it is no longer shaved by the flat factor.
 *  - Where it is not (under OMAHA_RUNOUT_FOLDS_AT), the hand folds to a river
 *    bet: its wins against his value region there are not realized, and its
 *    wins against his other holdings are realized only when that river is
 *    checked down (OMAHA_RUNOUT_CHECKDOWN, by position), or when he bluffs
 *    often enough that the bluff-catch is right (the bluff share q of THIS
 *    bettor, from the same measured read the verdict uses).
 *  - Linear in between.
 *
 * The board's texture enters through the cards, not through a label: a hand
 * that many rivers turn into a bluff-catcher (two pair on a three-suited or
 * connected board) realizes little; the same hand on a dry board, or a hand
 * that is the nuts on the rivers it wins, realizes nearly all of it. No term
 * is the size of the bet.
 *
 * The constants are STATED, not measured: the option stays OFF until its
 * declared league evaluation passes (authority file). The earlier caps still
 * apply after it as upper bounds, so with the option on a hand is never
 * priced above what those reviewed corrections allow.
 *
 * Pure: no random draws, no telemetry, no memory.
 */

/** Columns of one river's row in OmahaEvHandCounts.runout. */
export const OMAHA_RUNOUT_ROW = 4;
/** Row layout: wins (+ half ties) vs the value region, value holdings, wins (+ half ties) vs the rest, other holdings. */
export const OMAHA_RUNOUT_VAL_WIN = 0;
export const OMAHA_RUNOUT_VAL_N = 1;
export const OMAHA_RUNOUT_OTH_WIN = 2;
export const OMAHA_RUNOUT_OTH_N = 3;

/** Share of his value region the hand must beat on a river to call a river bet there / under which it folds. */
export const OMAHA_RUNOUT_CALLS_AT = 0.5;
export const OMAHA_RUNOUT_FOLDS_AT = 0.2;
/** Share of rivers a non-value holding checks down rather than bets, by the Horse's position. */
export const OMAHA_RUNOUT_CHECKDOWN: Readonly<Record<'ip' | 'oop', number>> = {
  ip: 0.6,
  oop: 0.45,
};
/**
 * His bluff share at which a river bluff-catch is right whatever the hand: the checkdown share rises to 1 from MIN to MAX.
 * Only that check-down term rises with the bluff share; the factor as a whole is not monotone in it (a higher share
 * moves weight from value-region wins to wins on rivers realized at the check-down share).
 */
export const OMAHA_RUNOUT_BLUFF_CATCH_MIN = 0.35;
export const OMAHA_RUNOUT_BLUFF_CATCH_MAX = 0.6;
/** Bounds of the factor. */
export const OMAHA_RUNOUT_REALIZATION_MIN = 0.35;
export const OMAHA_RUNOUT_REALIZATION_MAX = 1;

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

export interface OmahaRunoutRealization {
  /** the factor, within [MIN, MAX] */
  realization: number;
  /** share of the hand's turn equity that sits on rivers where it calls a river bet */
  robustShare: number;
  /** rivers counted */
  rivers: number;
}

/**
 * The realization factor of a turn call from the per-river counts, or null
 * when there is nothing to read (no rows, no equity): the caller keeps its
 * own factor then.
 *
 * @param runout   OmahaEvHandCounts.runout (OMAHA_RUNOUT_ROW numbers per river card)
 * @param bluffShare  q: the share of the bettor's range that is not value (omahaEvBluffShare)
 * @param inPosition  the Horse acts last on the river
 */
export function omahaRunoutRealization(
  runout: ArrayLike<number> | null | undefined,
  bluffShare: number,
  inPosition: boolean
): OmahaRunoutRealization | null {
  if (!runout || runout.length < OMAHA_RUNOUT_ROW || runout.length % OMAHA_RUNOUT_ROW !== 0)
    return null;
  if (!Number.isFinite(bluffShare)) return null;
  const q = clamp01(bluffShare);
  const rivers = runout.length / OMAHA_RUNOUT_ROW;
  let valN = 0;
  let othN = 0;
  for (let k = 0; k < rivers; k++) {
    const vn = runout[k * OMAHA_RUNOUT_ROW + OMAHA_RUNOUT_VAL_N];
    const on = runout[k * OMAHA_RUNOUT_ROW + OMAHA_RUNOUT_OTH_N];
    if (!Number.isFinite(vn) || !Number.isFinite(on) || vn < 0 || on < 0) return null;
    valN += vn;
    othN += on;
  }
  // The weights of the verdict's own blend: pWin = q x other + (1 - q) x value.
  const wVal = valN > 0 ? (1 - q) / valN : 0;
  const wOth = othN > 0 ? q / othN : 0;
  const base = OMAHA_RUNOUT_CHECKDOWN[inPosition ? 'ip' : 'oop'];
  const catches = clamp01(
    (q - OMAHA_RUNOUT_BLUFF_CATCH_MIN) /
      (OMAHA_RUNOUT_BLUFF_CATCH_MAX - OMAHA_RUNOUT_BLUFF_CATCH_MIN)
  );
  const checkdown = base + (1 - base) * catches;
  let total = 0;
  let realized = 0;
  let robust = 0;
  for (let k = 0; k < rivers; k++) {
    const o = k * OMAHA_RUNOUT_ROW;
    const vw = runout[o + OMAHA_RUNOUT_VAL_WIN];
    const vn = runout[o + OMAHA_RUNOUT_VAL_N];
    const ow = runout[o + OMAHA_RUNOUT_OTH_WIN];
    if (!Number.isFinite(vw) || !Number.isFinite(ow) || vw < 0 || ow < 0) return null;
    // No value holding is possible on this river: nothing there bets the hand off.
    const beats = vn > 0 ? vw / vn : 1;
    const calls = clamp01(
      (beats - OMAHA_RUNOUT_FOLDS_AT) / (OMAHA_RUNOUT_CALLS_AT - OMAHA_RUNOUT_FOLDS_AT)
    );
    const eqVal = wVal * vw;
    const eqOth = wOth * ow;
    total += eqVal + eqOth;
    realized += eqVal * calls + eqOth * (checkdown + (1 - checkdown) * calls);
    robust += (eqVal + eqOth) * calls;
  }
  if (!(total > 0)) return null;
  const raw = realized / total;
  return {
    realization: Math.max(
      OMAHA_RUNOUT_REALIZATION_MIN,
      Math.min(OMAHA_RUNOUT_REALIZATION_MAX, raw)
    ),
    robustShare: robust / total,
    rivers,
  };
}
