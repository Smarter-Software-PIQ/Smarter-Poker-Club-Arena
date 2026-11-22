/**
 * V78 COMMITTING BLUFF-RAISE PRICED REPLACEMENT (2026-11-22, Hold'em Strategy / HORSE DECISIONS;
 * option `v78NoCommittingBluffRaiseIsPriced`, read `=== true`, default OFF, `OPTION_SWITCH_REFUSED`).
 *
 * Replaces the unowned blanket 40%-of-stack bluff-raise veto (`v78NoCommittingBluffRaise`,
 * `added >= 0.4 * player.stack`) in single-board 2-card NLH with deterministic public-info EV
 * pricing over measured NLH fold priors (`holdemEmpiricalPriors.ts`) and tournament bubble
 * factor (`heroBubbleFactor`).
 *
 *   u(x)            = x < 0 ? x * bf : x               (bf = max(1, heroBubbleFactor ?? 1))
 *   EV(bluffRaise)  = F * pot + (1 - F) * u(e * (pot + add + callAdd) - add)
 *   baseline        = max(0, u(e * (pot + toCall) - toCall))
 *
 * Allows the raise iff `EV(bluffRaise) > baseline`; vetoes otherwise (and fails closed to veto
 * on any unpriceable input). Zero `fastRandom()` draw, zero opponent hole cards, zero direct
 * import of `opponentHud/` (preserving `TheHudProviderChangesNoDecision.law.test.ts`).
 */
import type { Card } from '../types.js';
import type { ExploitCounters } from './HorseOpponentExploit.js';
import {
  estimateHoldemFlopCbetFold,
  estimateHoldemRiverFoldToRaise,
  estimateHoldemTurnBetFold,
  holdemVillainRaiseCallPrice,
  type HoldemEmpiricalStreet,
  type HoldemFlopTexture,
  type HoldemHudPacketOpponent,
  type HoldemRiverRaiseKind,
} from './holdemEmpiricalPriors.js';

const EPS = 1e-9;

export interface CommittingBluffRaiseOpponent {
  /** Remaining stack behind before responding to hero's raise. */
  readonly stack: number;
  /** Chips already committed on the current street. */
  readonly bet: number;
  /** True when the opponent is already all-in (fold probability = 0). */
  readonly isAllIn: boolean;
  /** Optional structural OpponentHud packet (no opponentHud/ import). */
  readonly hudOpp?: HoldemHudPacketOpponent | null;
  /** Optional HorseMind ExploitCounters slice for Empirical-Bayes shrinkage. */
  readonly exploitCounters?: Pick<ExploitCounters, 'foldToBet' | 'foldToBetOpp'> | null;
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
  /** Hero's public-info equity estimate in [0, 1]. */
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
  readonly add: number;
  readonly callAdd: number;
  readonly isAllInRaise: boolean;
  readonly reason: CommittingBluffRaiseReason;
}

/** Classify flop board texture from the first 3 public community cards. */
export function classifyHoldemFlopTexture(board: readonly Card[]): HoldemFlopTexture | undefined {
  if (!Array.isArray(board) || board.length < 3) return undefined;
  const b0 = board[0];
  const b1 = board[1];
  const b2 = board[2];
  if (!b0 || !b1 || !b2) return undefined;
  if (b0.suit === b1.suit && b1.suit === b2.suit) return 'mono';
  if (b0.rank === b1.rank || b1.rank === b2.rank || b0.rank === b2.rank) return 'paired';
  return 'unpaired_nonmono';
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
    add: Number.isFinite(add) && add > 0 ? add : 0,
    callAdd: 0,
    isAllInRaise,
    reason,
  };
}

/**
 * Deterministically prices a candidate NLH committing bluff-raise using measured empirical fold
 * priors (`holdemEmpiricalPriors.ts`) and tournament bubble factor.
 *
 * Allows the raise iff `evRaise > baselineEv`; fails closed to veto on unpriceable inputs.
 */
export function priceCommittingBluffRaise(
  input: CommittingBluffRaisePriceInput
): CommittingBluffRaisePriceResult {
  const { street, legalAction, legalAmount, equity, inPosition, spr, board, opponents } = input;
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
  const u = (x: number): number => (x < 0 ? x * bf : x);
  const baselineEv = Math.max(0, u(equity * (pot + toCall) - toCall));

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

  // Validate opponent stacks/bets and find live non-all-in opponents.
  let maxOppTotal = 0;
  let foldableCount = 0;
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
    if (!opp.isAllIn && opp.stack > EPS) {
      foldableCount++;
      const total = opp.bet + opp.stack;
      if (total > maxOppTotal) maxOppTotal = total;
    }
  }

  if (foldableCount === 0) {
    return vetoResult('no_foldable_opponent', baselineEv, rawAdd, isAllInRaise);
  }

  // Cap hero's effective contestable raise to what the deepest live opponent can match.
  const effRaiseTo = Math.min(raiseTo, maxOppTotal);
  const add = Math.max(0, Math.min(rawAdd, effRaiseTo - heroBet));
  if (!(add > EPS)) {
    return vetoResult('no_foldable_opponent', baselineEv, rawAdd, isAllInRaise);
  }

  const headsUp = opponents.length === 1;
  const texture = street === 'flop' ? classifyHoldemFlopTexture(board) : undefined;
  const safeSpr = Number.isFinite(spr) && spr >= 0 ? spr : undefined;

  let foldProb = 1;
  let callAdd = 0;

  for (const opp of opponents) {
    // An all-in opponent cannot fold -> product F = 0.
    if (opp.isAllIn || !(opp.stack > EPS)) {
      foldProb = 0;
      continue;
    }
    const oppCallAdd = Math.min(opp.stack, Math.max(0, effRaiseTo - opp.bet));
    if (oppCallAdd > callAdd) callAdd = oppCallAdd;
    if (!(oppCallAdd > EPS)) {
      foldProb = 0;
      continue;
    }

    let oppFold: number;
    if (street === 'river') {
      const villainCallPrice = holdemVillainRaiseCallPrice(
        pot,
        effRaiseTo,
        heroBet,
        opp.bet,
        heroStack,
        opp.stack
      );
      const raiseKind: HoldemRiverRaiseKind =
        isAllInRaise || oppCallAdd >= opp.stack - EPS ? 'all_in_raise' : 'non_allin_raise';
      oppFold = estimateHoldemRiverFoldToRaise({ raiseKind, villainCallPrice }, opp.hudOpp).mean;
    } else {
      const potBeforeCall = pot + add - oppCallAdd;
      const potFraction = potBeforeCall > EPS ? oppCallAdd / potBeforeCall : 0;
      if (street === 'flop') {
        oppFold = estimateHoldemFlopCbetFold(
          {
            bettorInPosition: inPosition,
            potFraction,
            texture,
            spr: safeSpr,
            headsUp,
          },
          opp.hudOpp,
          opp.exploitCounters
        ).mean;
      } else {
        oppFold = estimateHoldemTurnBetFold(
          {
            bettorInPosition: inPosition,
            potFraction,
            headsUp,
          },
          opp.hudOpp,
          opp.exploitCounters
        ).mean;
      }
    }

    foldProb *= oppFold;
  }

  const calledNet = equity * (pot + add + callAdd) - add;
  const evRaise = foldProb * pot + (1 - foldProb) * u(calledNet);
  if (!Number.isFinite(evRaise) || !Number.isFinite(baselineEv)) {
    return vetoResult('unpriceable_inputs', baselineEv, add, isAllInRaise);
  }

  const allow = evRaise > baselineEv;
  return {
    allow,
    veto: !allow,
    evRaise,
    baselineEv,
    foldProb,
    add,
    callAdd,
    isAllInRaise,
    reason: allow ? 'ev_positive' : 'ev_non_positive',
  };
}
