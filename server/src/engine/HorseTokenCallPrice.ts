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
 * price. At or above it the bar is returned unchanged, bit for bit.
 */
export const TOKEN_CALL_PRICE = 0.15;
/**
 * Below this price the sampled equity is not consulted at all: the first
 * pass on seat 2 above drew 48 hands and could not clear a bar of 0.13%. A
 * sample that small cannot measure a tenth of a percent, so a made hand
 * simply calls.
 */
export const TOKEN_CALL_CERTAIN_PRICE = 0.01;

/** True when the call is so cheap that any made hand takes it. */
export function tokenCallIsCertain(potOdds: number, madeHandCategory: number): boolean {
  return (
    Number.isFinite(potOdds) &&
    potOdds >= 0 &&
    potOdds < TOKEN_CALL_CERTAIN_PRICE &&
    Number.isFinite(madeHandCategory) &&
    madeHandCategory > 0
  );
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
