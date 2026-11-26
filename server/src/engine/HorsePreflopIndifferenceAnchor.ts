/**
 * PREFLOP INDIFFERENCE ANCHORS (PLO lead-7 lane plo-preflop, 2026-11-26). Small pure functions that give the answer a
 * player would make to a re-raise at the indifference points of its sizes, for priors that must not be fitted on the
 * mis-playing field (tests/a-priced-options-prior-is-anchored.law.test.ts: "Priors anchor to solved/equilibrium play,
 * never to the mis-playing Horse field"). A player's own record is put on top of these by the caller, with shrinkage.
 *
 *   indifferenceFold(s)       = s / (1 + s): the fold share at which a wager risking s x the pot it wins breaks even
 *                               as a pure bluff (the defender's minimum defence is 1 - this; 2/3 for a pot-limit pot
 *                               re-raise, reraiseSizeOf);
 *   indifferenceBluffShare(s) = s / (1 + 2s): the bluff share of a betting range that leaves the caller indifferent;
 *   preflopAnswerToReraise    = the fold / call / re-raise split of a player facing a re-raise:
 *       fold   = indifferenceFold(s) of the re-raise he faces;
 *       re-raise = the hands of his band that are ahead of the re-raiser's range (value: the top half of the re-raiser's
 *                  own width, as a share of his band), plus the bluffs a pot re-raise carries at its own indifference
 *                  (value / (1 - indifferenceBluffShare(s'))), never more than he continues;
 *       call   = the rest of what continues.
 * Nothing here reads a card, an opponent memory or a random stream.
 */

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const finite = (x: number, d: number): number => (Number.isFinite(x) ? x : d);

/** The fold share at which a wager of `s` times the pot it is made into breaks even as a pure bluff. */
export function indifferenceFold(s: number): number {
  const v = Math.max(0, finite(s, 0));
  return v / (1 + v);
}

/** The bluff share of a betting range of size `s` (times the pot) that leaves the caller indifferent. */
export function indifferenceBluffShare(s: number): number {
  const v = Math.max(0, finite(s, 0));
  return v / (1 + 2 * v);
}

/**
 * The size of a re-raise as a bluff: the chips the re-raiser adds (risk) over the pot before he acts (what he wins
 * when everyone folds). A pot-limit pot 3-bet or pot 4-bet is 2: the big blind's pot 3-bet to 30 over an open to 9
 * (blinds 1/2, big-blind ante 2, pot 14) risks 28 to win 14, and the opener's pot 4-bet to 93 risks 84 to win 42.
 */
export function reraiseSizeOf(potBefore: number, raiseTo: number, reraiserBet: number): number {
  const pot = Math.max(0, finite(potBefore, 0));
  const risk = Math.max(0, finite(raiseTo, 0) - Math.max(0, finite(reraiserBet, 0)));
  return pot > 0 ? risk / pot : 0;
}

export interface IndifferenceAnswer {
  fold: number;
  call: number;
  raise: number;
}

/**
 * The anchored answer of a player facing a re-raise of size `s` (reraiseSizeOf), whose own band is `ownWidth` wide
 * (share of all hands) against a re-raiser whose range is `reraiserWidth` wide, when his own re-raise would be of size
 * `sNext` (2 for a pot-limit pot re-raise, reraiseSizeOf).
 */
export function preflopAnswerToReraise(
  s: number,
  ownWidth: number,
  reraiserWidth: number,
  sNext = 2
): IndifferenceAnswer {
  const fold = clamp(indifferenceFold(s), 0, 0.95);
  const cont = 1 - fold;
  const own = clamp(finite(ownWidth, 1), 0.01, 1);
  const value = clamp(clamp(finite(reraiserWidth, 0.1), 0, 1) / 2 / own, 0, 1);
  const raise = Math.min(cont, value / (1 - indifferenceBluffShare(sNext)));
  return { fold, call: cont - raise, raise };
}
