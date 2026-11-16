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
 * SCOPE: HEADS-UP AFTER THE 3-BET, CASH TABLES ONLY (2026-11-16, the lane
 * owner's rulings on the independent review REVIEW-MC-237f1ad9.md):
 *   - heads-up: the 0.5 break-even is derived for ONE caller. With k players
 *     already in at this price the cap is worth ((k + 1)e - 1) small bets and
 *     breaks even at 1/(k + 1), so the 0.5 bar would take away caps that win
 *     chips (the review, flh 6-max, open, maniac 3-bet, a cold-caller in: 99
 *     capped at 3-way equity 0.44-0.48 and KQs at 0.35-0.43, both +EV, and the
 *     0.5 bar called them). The rule acts only when the 3-bettor is the only
 *     other player in the pot and no other live player can still respond;
 *     everywhere else the decision is the one without the option.
 *   - cash: no evidence covers fixed-limit tournament tables (the evaluation
 *     cells were all cash), so a tournament table keeps the code without the
 *     option, the same isTournamentMode test as W5's cash-only gate.
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
 *  (the big blind counts as the first, FIXED_LIMIT_MAX_WAGERS in all).
 *
 *  Redundant under V53 today: V53 already requires raises === 2, the Horse's
 *  own preflop raise and a 3-bettor who is not all in, which in fixed limit is
 *  always three wagers, so this was true at every V53 spot the review probed.
 *  It is kept as a guard and is pinned by the law's unit and source
 *  assertions, not by a behaviour case. Its count (fixedLimitWagerCount,
 *  isFullRaise) is not the engine's authoritative cap count
 *  (fixedLimitStreetBounds, a half wager counts) and the two can differ on a
 *  short all-in history; either way the result is the legal call below or
 *  the raise without the option. */
export function fixedLimitPreflopRaiseIsTheCap(actions: ActionRecord[]): boolean {
  return fixedLimitWagerCount(actions, 'preflop') + 1 >= FIXED_LIMIT_MAX_WAGERS;
}

/** The facts the gate reads, all from HorseLogic's V38/V53 block, at the
 *  moment V53 would 4-bet. */
export interface FixedLimitManiacCapSpot {
  /** HorseDecideOpts.fixedLimitManiacCapNeedsValue as given: only === true is on. */
  readonly option: unknown;
  /** The betting structure is fixed limit (variantInfo isFixedLimit). */
  readonly fixedLimit: boolean;
  /** A tournament table (HorseLogic isTournamentMode): the rule is cash only. */
  readonly tournament: boolean;
  /** Players other than the Horse already in at this price or all in
   *  (inPotPlayers38): heads-up after the 3-bet is exactly one, the 3-bettor. */
  readonly playersInPot: number;
  /** A live player other than the Horse and the 3-bettor who can still act
   *  (otherLiveResponder38): heads-up after the 3-bet is false. */
  readonly otherLiveResponder: boolean;
  /** The hand's public action history. */
  readonly actions: ActionRecord[];
  /** The V38 equity against the 3-bettor's read range. */
  readonly equity: number;
  /** The deals that equity pass drew (equitySampleSizeOfLastCall). */
  readonly sampleSize: number;
  /** The chips the Horse owes. */
  readonly toCall: number;
  /** The Horse's stack behind. */
  readonly stack: number;
}

/** The only answer the rule ever gives. */
export interface FixedLimitManiacCapCall {
  readonly action: 'call';
  readonly amount: number;
}

/** The rule. null: the rule does not act and V53 4-bets as it does without
 *  the option. Otherwise the call for the chips owed: never a fold, never a
 *  raise. HorseLogic returns this value unchanged. */
export function fixedLimitManiacCapCall(
  spot: FixedLimitManiacCapSpot
): FixedLimitManiacCapCall | null {
  if (
    spot.option !== true ||
    spot.fixedLimit !== true ||
    spot.tournament ||
    spot.playersInPot !== 1 ||
    spot.otherLiveResponder ||
    !fixedLimitPreflopRaiseIsTheCap(spot.actions) ||
    !(spot.equity < fixedLimitCapValueBar(spot.sampleSize))
  )
    return null;
  return { action: 'call', amount: Math.min(spot.toCall, spot.stack) };
}
