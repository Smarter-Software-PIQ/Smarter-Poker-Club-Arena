/**
 * FIXED-LIMIT MANIAC CAP NEEDS VALUE (2026-11-15, Fixed-Limit lane; opt-in
 * HorseDecideOpts.fixedLimitManiacCapNeedsValue, read as === true, DEFAULT OFF).
 *
 * V53 (HorseLogic, "facing the aggressive human's 3-bet") 4-bets any hand whose
 * equity against the raiser's read range clears the V38 required equity by 6
 * points. That rule was measured on a pot-sized PLO5 3-bet. In fixed limit,
 * after the Horse opens and an aggressor 3-bets, the 4-bet is the CAP
 * (FIXED_LIMIT_MAX_WAGERS: the big blind is the first wager preflop): one more
 * small bet that the raiser calls and cannot answer. Its value is then
 * (2e - 1) small bets for equity e against one caller, break-even at e = 0.5
 * (FIXED_LIMIT_CAP_BREAK_EVEN). Measured on main 4296fa23 (evidence
 * AH-V38-FIXED-LIMIT.md, flh 6-max, an observed maniac 3-bet, 20 seeds a hand):
 * V53 capped Q9o, J8o, 76s, 54s, 83o and 72o with 0.30-0.46 equity against the
 * maniac's range, each of which calls against an unknown 3-bettor.
 *
 * With the option on, a fixed-limit V53 pressure raise that would be the cap
 * fires only when eq >= 0.5 + m. Otherwise the hand takes the call it would
 * make without the pressure raise.
 *
 * m is two standard errors of the equity estimate the decision actually used,
 * not a chosen number:
 *   - the V38 equity is one simulateEquity pass (HorseEval), non-adaptive (its
 *     adaptive argument is false), of n independent deals, each scoring hero's
 *     pot share in [0, 1];
 *   - a [0, 1] variable has variance at most 1/4, so SE <= 0.5 / sqrt(n), the
 *     binomial bound, reached at e = 0.5, the break-even this bar sits on;
 *   - m = 2 * 0.5 / sqrt(n) = 1 / sqrt(n).
 * n is read from equitySampleSizeOfLastCall() straight after that pass, so it is
 * the count after the equity load governor and the V44 depth multiplier, the
 * samples actually drawn. The sampler settings: max(160, floor(0.8 *
 * vi.iterations)) requested (HorseLogic V38), vi.iterations = 450 for fixed-limit
 * hold'em and 220 for hi-lo (HorseEval variantInfo). At full scale that is
 * n = 360 for flh, m = 0.0527, bar 0.5527; n = 176 for flo8, m = 0.0754,
 * bar 0.5754. A missing or zero n gives m = 1: no cap, the call (fail safe).
 */
import { FIXED_LIMIT_MAX_WAGERS, fixedLimitWagerCount } from './BettingStructure.js';
import type { ActionRecord } from '../types.js';

/** Break-even equity of the capping increment: one small bet, called by one
 *  opponent, no further preflop action. */
export const FIXED_LIMIT_CAP_BREAK_EVEN = 0.5;

/** Two standard errors of a Monte Carlo equity estimate over n deals (worst
 *  case, a [0, 1] outcome): 2 * 0.5 / sqrt(n). */
export function fixedLimitCapValueMargin(sampleSize: number): number {
  if (!Number.isFinite(sampleSize) || sampleSize < 1) return 1;
  return 1 / Math.sqrt(Math.floor(sampleSize));
}

/** The equity a fixed-limit pressure cap needs: 0.5 + m. */
export function fixedLimitCapValueBar(sampleSize: number): number {
  return FIXED_LIMIT_CAP_BREAK_EVEN + fixedLimitCapValueMargin(sampleSize);
}

/** True when one more preflop raise would be the last wager the street takes
 *  (the big blind counts as the first, FIXED_LIMIT_MAX_WAGERS in all). */
export function fixedLimitPreflopRaiseIsTheCap(actions: ActionRecord[]): boolean {
  return fixedLimitWagerCount(actions, 'preflop') + 1 >= FIXED_LIMIT_MAX_WAGERS;
}
