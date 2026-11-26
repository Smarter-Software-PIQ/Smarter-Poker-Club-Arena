/**
 * V78 COMMITTING BLUFF-RAISE PRICED REPLACEMENT (v2, 2026-11-22, Hold'em Strategy / HORSE DECISIONS;
 * option `v78NoCommittingBluffRaiseIsPriced`, read `=== true`, default OFF, `OPTION_SWITCH_REFUSED`).
 *
 * Replaces the unowned blanket 40%-of-stack bluff-raise veto (`v78NoCommittingBluffRaise`,
 * `added >= 0.4 * player.stack`) in single-board 2-card NLH with deterministic public-info EV
 * pricing wired directly onto `#11759`'s Wave 5.4 NLH raise pricing stack in
 * `holdemEmpiricalPriors.ts`:
 *   - `estimateHoldemFoldToRaisePrior` (measured NLH flop/turn/river fold-to-raise priors over
 *     raise geometry, SPR, villain commitment, all-in shift, multiway tightening/retention, and
 *     optional public opponent fold-to-raise sample / HUD shrinkage),
 *   - `conditionEquityAgainstRaiseCallRange` (exact Bayes power-law continuation conditioning with
 *     street-specific range-truncation sharpness: flop 0.65 < turn 0.85 < river 1.0),
 *   - `priceHoldemRaiseEv` (fold / call / villain 3-bet reraise response EV over contestable pot),
 *   - `heroBubbleFactor` true expected utility `E[u(X)]` (`u(x) = x < 0 ? x * bf : x`, `bf = max(1, bf)`):
 *       `callUtility    = e * pot - (1 - e) * bf * toCall`
 *       `calledUtility  = eqWhenCalled * (pot + callAdd) - (1 - eqWhenCalled) * bf * add`
 *       `reraiseUtility = max(-bf * add, eqVsReraise * (pot + callAdd + reraiseToCall) - (1 - eqVsReraise) * bf * (add + reraiseToCall))`
 *       `evRaise        = f * pot + callProb * calledUtility + r3 * reraiseUtility`
 *     (exact `priceHoldemRaiseEv` chip EV at `bf === 1`; avoids Jensen's inequality error of `u(E[X])`).
 *
 * Scope (r3, 2026-11-23): HorseLogic calls this ONLY in the blanket rule's own spot, a legalized
 * non-all-in raise adding >= 40% of the remaining stack. A legal jam or a smaller raise never reaches
 * this module and keeps the blanket rule's answer (not vetoed). Inside the spot the verdict governs
 * even when `v78NoCommittingBluffRaise` is false (as `v17ShortDeckIsPriced` overrides
 * `v17ShortDeck: false`). The module itself still prices any legalized action it is given.
 *
 * Allows the raise iff `EV(bluffRaise) > baseline`; vetoes otherwise (and fails closed to veto
 * on any unpriceable input). Zero `fastRandom()` draw, zero opponent hole cards, zero direct
 * import of `opponentHud/` (preserving `TheHudProviderChangesNoDecision.law.test.ts`).
 */
import type { Card } from '../types.js';
import {
  HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE,
  conditionEquityAgainstRaiseCallRange,
  estimateHoldemFoldToRaisePrior,
  priceHoldemRaiseEv,
  type HoldemEmpiricalStreet,
  type HoldemFoldToRaiseOpponentSample,
  type HoldemHudPacketOpponent,
  type HoldemRaisePriorSource,
} from './holdemEmpiricalPriors.js';

const EPS = 1e-9;

export interface CommittingBluffRaiseOpponent {
  /** Remaining stack behind before responding to hero's raise. */
  readonly stack: number;
  /** Chips already committed on the current street. */
  readonly bet: number;
  /** True when the opponent is already all-in (fold probability = 0). */
  readonly isAllIn: boolean;
  /** Optional structural OpponentHud packet (`f/t/r.fRaise`, fallback `f/t/r.fBet`; no opponentHud/ import). */
  readonly hudOpp?: HoldemHudPacketOpponent | null;
  /** Optional public fold-to-raise action-count sample for Empirical-Bayes shrinkage (zero hole cards). */
  readonly opponentSample?: HoldemFoldToRaiseOpponentSample | null;
}

export interface CommittingBluffRaisePriceInput {
  readonly street: HoldemEmpiricalStreet;
  /** Legalized action returned by HorseLogic.legalize for the candidate raise. */
  readonly legalAction: string;
  /** Legalized raise-to amount when legalAction === 'raise'. */
  readonly legalAmount?: number;
  /** Hero's current street bet before this raise. */
  readonly heroBet: number;
  /** Hero's remaining stack before this raise. */
  readonly heroStack: number;
  /** Current street bet hero faces. */
  readonly currentBet: number;
  /** Contestable pot before hero's raise (includes current street bets). */
  readonly pot: number;
  /** Chips hero needs to call without raising. */
  readonly toCall: number;
  /** Hero's public-info equity estimate in [0, 1] vs villain's betting range. */
  readonly equity: number;
  /** True when hero is in position on this street. */
  readonly inPosition: boolean;
  /** Stack-to-pot ratio on this street. */
  readonly spr: number;
  /** Public community cards. */
  readonly board: readonly Card[];
  /** Live (non-folded) opponents in the hand. */
  readonly opponents: readonly CommittingBluffRaiseOpponent[];
  /** Tournament bubble factor (>= 1); null/undefined defaults to 1 (chip EV). */
  readonly heroBubbleFactor?: number | null;
}

export type CommittingBluffRaiseReason =
  | 'ev_positive'
  | 'ev_non_positive'
  | 'not_a_raise'
  | 'no_foldable_opponent'
  | 'unpriceable_inputs';

export interface CommittingBluffRaisePriceResult {
  readonly allow: boolean;
  readonly veto: boolean;
  readonly evRaise: number;
  readonly baselineEv: number;
  readonly foldProb: number;
  readonly eqWhenCalled: number;
  readonly reraiseProb: number;
  readonly add: number;
  readonly callAdd: number;
  readonly isAllInRaise: boolean;
  readonly foldPriorSource: HoldemRaisePriorSource | null;
  readonly reason: CommittingBluffRaiseReason;
}

function vetoResult(
  reason: Exclude<CommittingBluffRaiseReason, 'ev_positive' | 'ev_non_positive'>,
  baselineEv = 0,
  add = 0,
  isAllInRaise = false
): CommittingBluffRaisePriceResult {
  return {
    allow: false,
    veto: true,
    evRaise: 0,
    baselineEv: Number.isFinite(baselineEv) ? baselineEv : 0,
    foldProb: 0,
    eqWhenCalled: 0,
    reraiseProb: 0,
    add: Number.isFinite(add) && add > 0 ? add : 0,
    callAdd: 0,
    isAllInRaise,
    foldPriorSource: null,
    reason,
  };
}

/**
 * Deterministically prices a candidate NLH committing bluff-raise using `#11759`'s measured NLH
 * street fold-to-raise priors (`estimateHoldemFoldToRaisePrior`), Bayes raise-continuing equity
 * conditioning (`conditionEquityAgainstRaiseCallRange`), `priceHoldemRaiseEv`, and tournament
 * bubble factor (`heroBubbleFactor`).
 *
 * Allows the raise iff `evRaise > baselineEv`; fails closed to veto on unpriceable inputs.
 */
export function priceCommittingBluffRaise(
  input: CommittingBluffRaisePriceInput
): CommittingBluffRaisePriceResult {
  const { street, legalAction, legalAmount, equity, spr, opponents } = input;
  if (street !== 'flop' && street !== 'turn' && street !== 'river') {
    return vetoResult('unpriceable_inputs');
  }
  const pot = input.pot;
  const heroBet = input.heroBet;
  const heroStack = input.heroStack;
  const currentBet = input.currentBet;
  const toCall = input.toCall;

  if (
    !Number.isFinite(pot) ||
    !(pot > 0) ||
    !Number.isFinite(heroBet) ||
    heroBet < 0 ||
    !Number.isFinite(heroStack) ||
    !(heroStack > 0) ||
    !Number.isFinite(currentBet) ||
    currentBet < 0 ||
    !Number.isFinite(toCall) ||
    toCall < 0 ||
    !Number.isFinite(equity) ||
    equity < 0 ||
    equity > 1 ||
    !Array.isArray(opponents) ||
    opponents.length === 0
  ) {
    return vetoResult('unpriceable_inputs');
  }

  const bf =
    input.heroBubbleFactor !== null &&
    input.heroBubbleFactor !== undefined &&
    Number.isFinite(input.heroBubbleFactor)
      ? Math.max(1, input.heroBubbleFactor)
      : 1;
  // True expected utility E[u(X)] for calling (winning gains +pot, losing drops -bf * toCall).
  const baselineEv = Math.max(0, equity * pot - (1 - equity) * bf * toCall);

  let raiseTo: number;
  let rawAdd: number;
  let isAllInRaise: boolean;

  if (legalAction === 'raise') {
    if (
      typeof legalAmount !== 'number' ||
      !Number.isFinite(legalAmount) ||
      !(legalAmount > currentBet + EPS)
    ) {
      return vetoResult('not_a_raise', baselineEv);
    }
    raiseTo = legalAmount;
    rawAdd = raiseTo - heroBet;
    isAllInRaise = rawAdd >= heroStack - EPS;
  } else if (legalAction === 'all_in') {
    if (!(heroBet + heroStack > currentBet + EPS)) {
      return vetoResult('not_a_raise', baselineEv);
    }
    rawAdd = heroStack;
    raiseTo = heroBet + heroStack;
    isAllInRaise = true;
  } else {
    return vetoResult('not_a_raise', baselineEv);
  }

  if (!(rawAdd > EPS) || !(rawAdd > toCall + EPS)) {
    return vetoResult('not_a_raise', baselineEv, rawAdd, isAllInRaise);
  }

  // Validate opponent stacks/bets, locate foldable opponents and the primary bettor.
  let maxOppTotal = 0;
  let foldableCount = 0;
  let hasAllInOpponent = false;
  let primaryBettor: CommittingBluffRaiseOpponent | null = null;
  for (const opp of opponents) {
    if (
      !opp ||
      !Number.isFinite(opp.stack) ||
      opp.stack < 0 ||
      !Number.isFinite(opp.bet) ||
      opp.bet < 0
    ) {
      return vetoResult('unpriceable_inputs', baselineEv, rawAdd, isAllInRaise);
    }
    if (opp.isAllIn || !(opp.stack > EPS)) {
      hasAllInOpponent = true;
    } else {
      foldableCount++;
      const total = opp.bet + opp.stack;
      if (total > maxOppTotal) maxOppTotal = total;
      if (primaryBettor === null || opp.bet > primaryBettor.bet) {
        primaryBettor = opp;
      }
    }
  }

  if (foldableCount === 0 || primaryBettor === null) {
    return vetoResult('no_foldable_opponent', baselineEv, rawAdd, isAllInRaise);
  }

  // Cap hero's effective contestable raise to what the deepest live opponent can match.
  const effRaiseTo = Math.min(raiseTo, maxOppTotal);
  const add = Math.max(0, Math.min(rawAdd, effRaiseTo - heroBet));
  if (!(add > EPS)) {
    return vetoResult('no_foldable_opponent', baselineEv, rawAdd, isAllInRaise);
  }

  let callAdd = 0;
  let maxOppRemainingAfterCall = 0;
  let anyZeroCallAdd = false;
  for (const opp of opponents) {
    if (opp.isAllIn || !(opp.stack > EPS)) continue;
    const oppCallAdd = Math.min(opp.stack, Math.max(0, effRaiseTo - opp.bet));
    if (oppCallAdd > callAdd) callAdd = oppCallAdd;
    if (!(oppCallAdd > EPS)) {
      anyZeroCallAdd = true;
    }
    const remAfterCall = Math.max(0, opp.stack - oppCallAdd);
    if (remAfterCall > maxOppRemainingAfterCall) maxOppRemainingAfterCall = remAfterCall;
  }

  // Compute empirical NLH fold-to-raise probability (`F`) via `#11759`'s `estimateHoldemFoldToRaisePrior`.
  // Any already-all-in or already-matched opponent forces `F = 0` (cannot win pot without showdown).
  let foldProb = 0;
  let foldPriorSource: HoldemRaisePriorSource | null = null;
  if (!hasAllInOpponent && !anyZeroCallAdd) {
    const bettorBet = primaryBettor.bet > EPS ? primaryBettor.bet : currentBet;
    const raiseToBetRatio = bettorBet > EPS ? effRaiseTo / bettorBet : undefined;
    const raiseToPotRatio = pot > EPS ? add / pot : undefined;
    const safeSpr = Number.isFinite(spr) && spr >= 0 ? spr : undefined;
    const bettorTotal = primaryBettor.bet + primaryBettor.stack;
    const commitmentFactor =
      primaryBettor.bet > EPS && bettorTotal > EPS ? primaryBettor.bet / bettorTotal : 0;
    const bettorCallAdd = Math.min(
      primaryBettor.stack,
      Math.max(0, effRaiseTo - primaryBettor.bet)
    );
    const effectiveAllIn = isAllInRaise || bettorCallAdd >= primaryBettor.stack - EPS;

    const priorEst = estimateHoldemFoldToRaisePrior({
      street,
      raiseToBetRatio,
      raiseToPotRatio,
      opponentsInPot: opponents.length,
      spr: safeSpr,
      commitmentFactor,
      isAllInRaise: effectiveAllIn,
      opponentSample: primaryBettor.opponentSample ?? null,
      hudOpp: primaryBettor.hudOpp ?? null,
    });
    foldProb = priorEst.mean;
    foldPriorSource = priorEst.source;
  }

  // Condition hero's called equity on villain's stronger raise-continuing range via Bayes power-law kernel.
  const eqWhenCalled = conditionEquityAgainstRaiseCallRange(equity, foldProb, { street });

  // Non-all-in raises with chips behind on both sides face villain's measured street 3-bet / jam response.
  const heroRemainingAfterRaise = Math.max(0, heroStack - add);
  const canBeReraised =
    !isAllInRaise && heroRemainingAfterRaise > EPS && maxOppRemainingAfterCall > EPS;
  const reraiseResponse = canBeReraised
    ? {
        reraiseProb: HOLDEM_EMPIRICAL_STREET_FOLD_TO_RAISE[street].baseReraiseRate,
        reraiseToCall: Math.min(heroRemainingAfterRaise, maxOppRemainingAfterCall),
      }
    : null;

  const pricedEv = priceHoldemRaiseEv({
    pot,
    toCall,
    heroAdded: add,
    rawEquity: equity,
    villainCall: callAdd,
    foldToRaiseProb: foldProb,
    equityConditioning: { street },
    eqWhenCalledOverride: eqWhenCalled,
    reraiseResponse,
  });

  // Apply tournament bubble-factor true expected utility E[u(X)] (equals pricedEv.evRaise at bf === 1).
  const effAdd = pricedEv.effectiveHeroAdded;
  const effCallAdd = pricedEv.villainCall;
  const finalBaselineEv = Math.max(0, equity * pot - (1 - equity) * bf * toCall);
  const calledUtility =
    pricedEv.eqWhenCalled * (pot + effCallAdd) - (1 - pricedEv.eqWhenCalled) * bf * effAdd;
  let reraiseUtility = 0;
  if (pricedEv.reraiseProb > 0 && reraiseResponse !== null && pricedEv.eqVsReraise !== null) {
    const r3Call = reraiseResponse.reraiseToCall;
    const totalRisk = effAdd + r3Call;
    const winNetVsReraise = pot + effCallAdd + r3Call;
    const callReraiseUtility =
      pricedEv.eqVsReraise * winNetVsReraise - (1 - pricedEv.eqVsReraise) * bf * totalRisk;
    reraiseUtility = Math.max(-bf * effAdd, callReraiseUtility);
  }
  const evRaise =
    bf === 1
      ? pricedEv.evRaise
      : pricedEv.foldToRaiseProb * pot +
        pricedEv.callProb * calledUtility +
        (pricedEv.reraiseProb > 0 ? pricedEv.reraiseProb * reraiseUtility : 0);

  if (!Number.isFinite(evRaise) || !Number.isFinite(finalBaselineEv)) {
    return vetoResult('unpriceable_inputs', baselineEv, add, isAllInRaise);
  }

  const allow = evRaise > finalBaselineEv;
  return {
    allow,
    veto: !allow,
    evRaise,
    baselineEv: finalBaselineEv,
    foldProb: pricedEv.foldToRaiseProb,
    eqWhenCalled: pricedEv.eqWhenCalled,
    reraiseProb: pricedEv.reraiseProb,
    add: pricedEv.effectiveHeroAdded,
    callAdd: pricedEv.villainCall,
    isAllInRaise,
    foldPriorSource,
    reason: allow ? 'ev_positive' : 'ev_non_positive',
  };
}
