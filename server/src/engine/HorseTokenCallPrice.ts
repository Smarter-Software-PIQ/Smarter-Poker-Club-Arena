/**
 * A TOKEN-PRICED CALL IS NOT BARRED BY STACK-OFF PREMIUMS (PLO6-AUDIT-010, 2026-11-12).
 *
 * Production hand 58750626 (PLO6 1/2), river Qd Ah 6c 8s 9d: a player moved
 * all in for 205 into 2,372. One Horse held a set of queens with 3 chips
 * behind and folded a call that needed 0.12% equity; another held top set
 * with 131 behind and its second look folded a call that needed 4.8%. Both
 * folds reproduce with the original inputs on the source that made them and
 * on the source serving on 2026-11-12.
 *
 * The committed-call bar is the price plus absolute premiums (a margin, the
 * multiway and all-in commitment bar, the scare-card margin, the shades).
 * Those premiums are sized for calls that risk a stack at a third of the pot.
 * Added to a price near zero they become the whole bar, so the hand needs
 * 10% to 20% equity to call a bet that asks for a fraction of one percent.
 * The paired-board rule already says it: a Horse with three chips behind
 * never folds to a shove for two of them.
 *
 * The rule: below TOKEN_CALL_PRICE the premiums shrink in proportion to the
 * price. At or above it the bar is returned unchanged, bit for bit. Why 0.15:
 * it is the price the owner's paired-board rule already treats as a token
 * call left to the brain (TOKEN_CALL_REQUIRED_EQUITY in
 * HorsePloPairedBoardFold.ts), so the two rules share one line.
 */
export const TOKEN_CALL_PRICE = 0.15;
/**
 * Under this price a river call is decided by an exact count, not by the
 * sampled estimate: the first pass on seat 2 above drew 48 hands and could
 * not clear a bar of 0.13%. Forty-eight samples cannot measure a tenth of a
 * percent.
 */
export const TOKEN_CALL_COUNTED_PRICE = 0.01;
/**
 * How much stronger than a random hand the bettor is assumed to be. Hero's
 * share of random six-card hands it beats is divided by 20 before it is
 * compared with the price: a deliberately pessimistic bound, not an estimate.
 * A hand that beats half of all random hands clears a 1% price forty times
 * over; a hand that beats almost nothing does not clear it and is left to the
 * ordinary bar, so a hopeless hand still folds.
 */
export const TOKEN_CALL_RANGE_DISCOUNT = 0.05;

/**
 * True when a river call priced under 1% is covered even by the pessimistic
 * bound. `beatenByRandom` is the exact-count probability that one random hand
 * beats hero on the final board (omahaRiverBeatProbability), or null when it
 * is not available (not the river, one incomplete board), which never covers.
 */
export function tokenCallIsCovered(potOdds: number, beatenByRandom: number | null): boolean {
  if (!Number.isFinite(potOdds) || potOdds < 0 || potOdds >= TOKEN_CALL_COUNTED_PRICE) return false;
  if (beatenByRandom === null || !Number.isFinite(beatenByRandom)) return false;
  if (beatenByRandom < 0 || beatenByRandom > 1) return false;
  return (1 - beatenByRandom) * TOKEN_CALL_RANGE_DISCOUNT >= potOdds;
}

/**
 * @param potOdds the true price of the call (effective call over the final pot)
 * @param required the committed bar: potOdds plus every premium
 */
export function tokenCallRequiredEquity(potOdds: number, required: number): number {
  if (!Number.isFinite(potOdds) || !Number.isFinite(required)) return required;
  if (potOdds < 0 || potOdds >= TOKEN_CALL_PRICE) return required;
  const premiums = required - potOdds;
  if (premiums <= 0) return required;
  return potOdds + premiums * (potOdds / TOKEN_CALL_PRICE);
}

/**
 * Where the rule applies: Omaha high cash on one ordinary board. Hi-lo splits
 * the pot, a tournament call carries payout utility, and several boards or a
 * bomb pot price a call differently; none of them is in the evidence, so none
 * is in scope (the V88 commitment rule beside it draws the same line).
 */
export function tokenCallPriceApplies(scope: {
  enabled: boolean;
  isOmaha: boolean;
  isHiLo: boolean;
  tournament: boolean;
  multiBoard: boolean;
  bombPot: boolean;
}): boolean {
  return (
    scope.enabled &&
    scope.isOmaha &&
    !scope.isHiLo &&
    !scope.tournament &&
    !scope.multiBoard &&
    !scope.bombPot
  );
}
