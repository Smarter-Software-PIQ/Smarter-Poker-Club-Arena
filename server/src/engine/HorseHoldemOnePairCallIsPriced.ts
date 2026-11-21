/**
 * HOLD'EM ONE-PAIR CALLS, PRICED (options v65TurnOnePairShadeIsPriced, v61RiverOnePairShadeIsPriced and
 * v63LargeRiverBetShadeIsPriced, 2026-11-21, Horse Switch lane; each default OFF, read only as === true,
 * unevaluated). Owner orders: no blanket rule decides a Horse action (2026-11-20 15:27 America/Chicago); every
 * blanket rule goes off one at a time, each tested and validated (2026-11-21 02:00).
 *
 * THE BLANKET RULES THEY PRICE. In single-board two-card hold'em a hand of the bluff-catch class (one pair, a high
 * card, or two pair through the board's pair) that faces a wager has its equity cut by a fixed shade of the price
 * r = toCall / pot (the pot already holding the wager) before the call test:
 *   V65  turn, a wager the Horse did not start, no hole-card draw: (r - 0.2) x 0.4, capped at 12 points;
 *   V61  river: (r - 0.2) x 0.4, capped at 12 points (zero up to a fifth of the pot);
 *   V63  river, reshapes V61 above a half-pot wager (r > 1/3): 0.88 a unit of r there, capped at 20 points.
 * Each is withheld for a label (a legacy over-bluffer read, callDownMod above 1; on the river also a V62 polar
 * sample). The shade is the same against every opponent who is not so labelled, whatever he has shown: a class
 * shade by the owner's definition.
 *
 * WHAT THESE OPTIONS DO. At the same sites, for the same class (the label withholds are dropped: the price carries
 * his measured tendencies), the call or fold is decided by the expected value of the call in the heads-up model of
 * HorseHoldemValueAndCallsArePriced (holdemPricedVerdict, facing a wager: fold 0, call R x eq(range) x (pot + c) - c)
 * against his LINE RANGE: his preflop band (HorseMind.bandFor) re-weighted street by street by his line this hand,
 * his bets and calls cutting it with his measured bet share when checked to and fold to a bet (statRead posteriors,
 * prior strength 6, on his decayed counters, centred on the population cell OPPONENT_EXPLOIT_ENVELOPE). With no
 * read the posterior IS the population cell, so an unknown opponent gets the population's price, never a coin
 * flip, and no random number is drawn (the range equities use the model's own seeded generator). A one pair that
 * the betting range beats with many made hands has a low equity against that range and folds at the price; no
 * class cliff is added. The call is taken when EV(call) > EV(fold) = 0; a tie folds (the passive option).
 *
 *   v65TurnOnePairShadeIsPriced    the turn sites (the V38 continuation verdict and the heuristic call line);
 *   v61RiverOnePairShadeIsPriced   the river sites (the committed branch and the V38 river verdict), every price;
 *   v63LargeRiverBetShadeIsPriced  the river sites only above a half-pot wager (r > 1/3, where V63 departs from
 *                                  V61); below it the river is as the other options leave it. Inert where
 *                                  v61RiverOnePairShadeIsPriced is on (that one already prices every price).
 *
 * INDEPENDENT OF THE PARENTS. None reads v65TurnOnePairShade, v61RiverOnePairShade or v63LargeRiverBetShade: where
 * the spot is priced the parent's shade is not applied whatever its state, so the parent can go off later without
 * removing the priced child. Not priced (more than one live opponent, no population cell, an empty range, an
 * error): receipt *_unpriced, and the site is exactly as the parents' own states make it.
 *
 * DEFERRED. Where another rule has already cut this hand's equity read (a class cap: V15, V20, V21, V79, V80 and the
 * like) or charges the V11 domination penalty, the price does not decide (receipt *_deferred) and the site is as
 * the parents leave it: each of those rules comes off on its own grade, one at a time, not inside this one.
 *
 * NOT CHANGED. The V67 raised-river class (v67RiverBetRaisedOnePair, its own option, which also reads the V61
 * switch) is left to V67. Raises are not priced here: the sites only call or fold. In the committed branch a
 * priced call that clears the branch's own jam bar keeps the branch's own jam or flat logic (V51 and the plan
 * rules decide that, as today).
 *
 * STATED LIMITS (assumptions, not measurements). Heads-up chip EV (tournaments included: no ICM); his re-raise
 * after the call is left out; realization 1 on the river and in position, 0.88 out of position on the turn; the
 * population cell is the HORSES' rates, so against a person with no read the prior is the Horse figure.
 */
import type { HoldemPricedVerdict } from './HorseHoldemValueAndCallsArePriced.js';

export type HoldemOnePairPricedKind = 'turn' | 'river' | 'river_large';

export interface HoldemOnePairPricedOpts {
  v65TurnOnePairShadeIsPriced?: unknown;
  v61RiverOnePairShadeIsPriced?: unknown;
  v63LargeRiverBetShadeIsPriced?: unknown;
}

/** The V63 knee: from a half-pot wager (r = toCall / pot = 1/3) V63 departs from V61. */
export const HOLDEM_ONE_PAIR_PRICED_LARGE_RIVER_R = 1 / 3;

const EPS = 1e-9;

/** Which river option prices this call, or null (none on, or v63's below its knee). */
export function holdemOnePairPricedRiverKind(
  opts: HoldemOnePairPricedOpts,
  toCall: number,
  pot: number
): 'river' | 'river_large' | null {
  if (opts.v61RiverOnePairShadeIsPriced === true) return 'river';
  if (
    opts.v63LargeRiverBetShadeIsPriced === true &&
    toCall > 0 &&
    pot > 0 &&
    toCall / pot > HOLDEM_ONE_PAIR_PRICED_LARGE_RIVER_R + EPS
  )
    return 'river_large';
  return null;
}

/**
 * The priced answer facing a wager: call when EV(call) beats EV(fold) (0); a tie folds. Null when the verdict has
 * no call or fold priced (not a spot facing a wager).
 */
export function holdemOnePairPricedCalls(verdict: HoldemPricedVerdict): boolean | null {
  const call = verdict.options.find((o) => o.kind === 'call');
  const fold = verdict.options.find((o) => o.kind === 'fold');
  if (!call || !fold || !Number.isFinite(call.ev) || !Number.isFinite(fold.ev)) return null;
  return call.ev > fold.ev + EPS;
}
