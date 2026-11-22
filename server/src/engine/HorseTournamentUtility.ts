/**
 * Phase 7 Round 1 — action-specific tournament utility.
 *
 * The final tournament arbiter receives a bounded set of range-conditioned
 * showdown samples captured inside HorseEval's canonical Monte Carlo pass. It
 * prices fold, call/check, every canonical legal raise size, and jam by building
 * the resulting stack vector for each sampled response/outcome. Main pots,
 * side pots, multi-callers, ties, low halves, paid busts, bounties, and
 * recovery options are settled explicitly. The pure evaluator can settle
 * multiple boards when they arrive in one shared-deck sample; Round 1's live
 * arbiter fails closed until that canonical shared-deck sampler is wired.
 *
 * No style, mood, tightness, or aggression multiplier is accepted here. Those
 * layers may propose the baseline action, but they cannot overwrite a utility
 * choice whose confidence interval separates from that baseline.
 */

import type {
  ActionType,
  HorseDecision,
  HorseTournamentUtilityCandidateLedger,
  HorseTournamentUtilityLedger,
  HorseTournamentUtilityObjective,
  HandStage,
  Pot,
  SeatPlayer,
} from '../types.js';
import { mdfFold } from './HorseEvEngine.js';
import { createIcmEquityEstimator, pairwiseBubbleFactor, type IcmMethod } from './IcmModel.js';
import { calculateContestablePot, calculatePots } from './PokerEngine.js';
import { prepareJointPots, settleJointScores } from './multiway/JointPotDistribution.js';
import {
  buildHorseTournamentUtilityEvidence,
  type HorseTournamentJointSamplerProvenance,
  type HorseTournamentUtilityObservations,
} from './HorseTournamentUtilityEvidence.js';
import {
  simulateTournamentFutureHands,
  FUTURE_HAND_POLICY,
  type FutureHandConfig,
  type FutureHandDraw,
  type FutureHandResult,
} from './HorseTournamentFutureHand.js';
import {
  simulateTournamentContinuation,
  CONTINUATION_POLICY,
  type TournamentContinuationStreet,
} from './HorseTournamentContinuation.js';

const EPS = 0.005;
const CONFIDENCE_Z_999 = 3.291;
const MAX_ACTION_ICM_VECTORS = 2_048;
/** Shared with worker response admission; one owner for the outcome ceiling. */
export const MAX_UTILITY_OUTCOMES = 160;
const MAX_EQUITY_CALIBRATION_ERROR = 0.025;
const MIN_EFFECTIVE_OUTCOMES = 8;

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));
const chips = (value: number): number => Math.round(value);

export interface TournamentUtilityOpponentEvidence {
  userId: string;
  /** Preflop/postflop strength percentile band from HorseMind. */
  range: [number, number] | null;
  /** Confidence-weighted response tendency; 1 is solver MDF. */
  foldMul: number;
  actsAfterHero: boolean;
}

export interface TournamentUtilityBoardOutcome {
  continuationStreets?: TournamentContinuationStreet[];
  heroHigh: number;
  opponentHigh: number[];
  /** Strength at the decision point; never includes sampled future cards. */
  opponentDecisionStrength: number[];
  /** Lower is better; null means no qualifying low. */
  heroLow: number | null;
  opponentLow: Array<number | null>;
}

/** Boards from one shared, range-conditioned Monte Carlo iteration. */
export interface TournamentUtilityShowdownSample {
  boards: TournamentUtilityBoardOutcome[];
}

export interface TournamentUtilityContext {
  format: 'mtt' | 'sng' | 'spin' | 'hu_sng';
  playersLeft: number;
  spotsPaid: number;
  satellite: boolean;
  satelliteSeats: number;
  /** Unsettled payouts for the remaining places (place 1 first). */
  payoutPct: number[];
  fieldStacks: number[];
  /** Cached values for table-local identities; remote identities stay private to the cache. */
  fieldStackByUser: Record<string, number>;
  isPko: boolean;
  isBounty: boolean;
  isMysteryBounty: boolean;
  mysteryBountyStage: 'none' | 'pending' | 'active' | 'complete';
  bountyFactor: number;
  bountyByUser: Record<string, number>;
  mysteryMeanCents: number;
  meanBountyCents: number;
  prizePoolCents: number;
  bountyPoolCents: number;
  reentryOpen: boolean;
  rebuyOpen: boolean;
  maxReentries: number | null;
  maxRebuys: number | null;
  addOnPeriodOpen: boolean;
  addOnCostCents: number | null;
  addOnChips: number | null;
  buyInCents: number | null;
  startingStackChips: number | null;
  rebuyCostCents: number | null;
  rebuyChips: number | null;
  rebuyPrizeContributionCents: number | null;
  rebuyBountyContributionCents: number | null;
  reloadsUsed: number | null;
  addOnTaken: boolean | null;
  rebuyAffordable: boolean | null;
  addOnAffordable: boolean | null;
}

export interface TournamentUtilityInput {
  /** Optional actual joint acquisition. Absent preserves historical callers. */
  samplerProvenance?: HorseTournamentJointSamplerProvenance;
  /** Original decision-local reads, never a fresh read at action acceptance. */
  observations?: HorseTournamentUtilityObservations;
  /** Phase13 exact board/odd-chip settlement. The existing Phase7 objective
   * still owns payout, bounty and recovery utility; no second ICM is added. */
  settlement?: { chipUnit: 1; dealerSeat: number; splitLow: boolean };
  /** Internal deadline for an optional shadow evaluation. Never from live worker input. */
  withinBudget?: () => boolean;
  /** Asymmetric cover-ICM response elasticity & preflop realization confidence (default true). */
  v86AsymmetricIcmAndPreflop?: boolean;
  /** OPTION tournamentUtilityStackScaledMargin (HorseDecideOpts, 2026-11-15, default OFF; only an explicit true
   *  engages): the equity-uncertainty margin of a candidate is the equity standard error times the candidate's own
   *  utility sensitivity to hero's showdown share (never more than the whole-pool margin it replaces), not the
   *  standard error times the whole payout pool. Absent, every margin is what it was. */
  stackScaledMargin?: boolean;
  /** Explicit Phase 8 counterfactual. Absent preserves Phase 7 exactly. */
  continuation?: {
    dealerSeat: number;
    bigBlind: number;
    shortStackThresholdChips?: number;
    futureHands?: FutureHandConfig;
    withinBudget?: () => boolean;
    /** Internal numeric work receipt; never consulted by strategy or RNG. */
    work?: TournamentContinuationWork;
  };
  street: HandStage;
  hero: SeatPlayer;
  players: SeatPlayer[];
  pots: Pot[];
  pot: number;
  currentBet: number;
  toCall: number;
  legalActions: ActionType[];
  minRaiseTo: number | null;
  maxRaiseTo: number | null;
  bettingStructure: 'no_limit' | 'pot_limit' | 'fixed_limit';
  /**
   * The menu offers the all-in button and no sized bet or raise, and the
   * controller executes that button as a wager of the whole stack: the hero
   * holds more than the call and less than the minimum bet or raise. Only the
   * caller can know it (the same pot-limit or fixed-limit menu is also what a
   * capped street or a seat that may not reopen shows, where the button is a
   * call), so it is set from the controller's own rule and never inferred
   * here. Absent, a pot-limit or fixed-limit menu with no ceiling builds no
   * jam, exactly as before. No-limit never reads it.
   */
  shortAllInWagers?: true;
  baseline: HorseDecision;
  /** Structural-cap-calibrated equity target; samples retain outcome shape. */
  heroEquity: number;
  equitySampleSize: number;
  equityStandardError: number;
  opponents: TournamentUtilityOpponentEvidence[];
  /** IDs parallel to every board sample's opponent score arrays. */
  sampledOpponentIds: string[];
  showdownSamples: TournamentUtilityShowdownSample[];
  context: TournamentUtilityContext;
}

export interface TournamentContinuationWork {
  attempts: number;
  candidateCount: number;
  candidatesCompleted: number;
  outcomeSamples: number;
  samplesVisited: number;
  rollouts: number;
  rolloutCacheHits: number;
  estimates: number;
  estimateCacheHits: number;
  icmMethod: IcmMethod | 'unavailable';
  levelBounds: number;
  budgetStop: 'none' | 'sample' | 'future_rollout' | 'icm';
}

export type TournamentUtilityUnavailableReason =
  | 'invalid_input'
  | 'no_action_candidates'
  | 'field_reconciliation'
  | 'sample_calibration'
  | 'candidate_settlement'
  | 'recovery_option'
  | 'operation_budget'
  | 'baseline_not_modeled'
  | 'chip_value_not_modeled';

export interface TournamentUtilityEvaluation {
  result: {
    decision: HorseDecision;
    ledger: HorseTournamentUtilityLedger;
  } | null;
  unavailableReason: TournamentUtilityUnavailableReason | null;
  /**
   * Receipt only (2026-11-18): true when stackScaledMargin was on and the whole-pool margin would have kept the
   * baseline this result overrode (HorseLogic fires tournament_utility_stack_scaled_margin_changed_seen). Not part
   * of the ledger, so no receipt hash or journal field changes.
   */
  stackScaledMarginChangedDecision?: boolean;
  /** Decision-local workspace reuse. Never attached to a serialized receipt. */
  continuePostflop?: TournamentContinuationRunner;
}

export type TournamentContinuationRunner = (
  baseline: HorseDecision,
  continuation: NonNullable<TournamentUtilityInput['continuation']>,
  maxSamples: number
) => TournamentUtilityEvaluation;

/** Spread bounded work over the captured continuation pool, not just its prefix. */
export function selectContinuationSamples(
  samples: TournamentUtilityShowdownSample[],
  maxSamples: number
) {
  const available = Math.min(samples.length, CONTINUATION_POLICY.maxOutcomeSamples);
  const count = Math.min(available, maxSamples);
  return Array.from({ length: count }, (_, i) => samples[Math.floor((i * available) / count)]);
}

/** Decision-local rollout results by settled local-stack key, then by
 * sample index * 2 + blind-level identity (at most two levels). */
type FutureRolloutCache = Map<string, Array<FutureHandResult | undefined>>;

interface UtilityWorkspace {
  field: FieldState;
  estimateCache: Map<string, Estimate>;
  actionIcm: ReturnType<typeof createIcmEquityEstimator>;
}

type CandidateKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'jam';

interface ActionCandidate {
  id: string;
  kind: CandidateKind;
  action: ActionType;
  amount: number | null;
  investment: number;
}

interface FieldState {
  stacks: number[];
  localIndex: Map<string, number>;
  heroIndex: number;
  conservationTarget: number;
  fieldPlayersActual: number;
  fieldPlayersModeled: number;
  reconciliationErrorChips: number;
  aggregateReconciliationErrorChips: number;
}

interface BranchResult {
  vector: number[];
  heroFinalStack: number;
  realizedPayoutPct: number;
  heroFinishedPaid: boolean;
  bountyWonPct: number;
  bountyDeniedPct: number;
  /** Current-hand PKO growth carried into Phase 8's next-hand valuation. */
  futureBountyHeads?: Record<string, number>;
  heroBusted: boolean;
  heroWon: boolean;
  wonBounty: boolean;
  allFold: boolean;
  sidePotCount: number;
  conservationError: number;
  shortStackCollision: boolean;
  coveredStacks: number;
}

interface Estimate {
  /** Key validated for this private resulting vector before its estimate. */
  vectorKey: string;
  equity: number;
  equityError: number;
  payout: number;
  error: number;
  method: IcmMethod;
}

interface OptionEstimate {
  value: number;
  error: number;
}

interface WeightedMoment {
  sum: number;
  square: number;
}

interface CandidateEvaluationSuccess {
  ledger: HorseTournamentUtilityCandidateLedger;
  icmError: number;
  methods: Set<IcmMethod>;
  /**
   * Receipt only (tournamentUtilityStackScaledMargin, 2026-11-18): the confidence half width this candidate carries
   * with the whole-pool margin, i.e. with the option off. Equal to the ledger's half width whenever the option is off
   * or did not narrow it. The selection never reads it and it is never serialized.
   */
  unscaledHalfWidth: number;
  unavailableReason: null;
}

interface CandidateEvaluationFailure {
  ledger: null;
  unavailableReason: Extract<
    TournamentUtilityUnavailableReason,
    'candidate_settlement' | 'recovery_option' | 'operation_budget'
  >;
}

type CandidateEvaluation = CandidateEvaluationSuccess | CandidateEvaluationFailure;

function objectiveOf(context: TournamentUtilityContext): HorseTournamentUtilityObjective {
  if (context.satellite) return 'satellite_seat_equity';
  if (context.isMysteryBounty) return 'mystery_bounty';
  if (context.isPko || context.isBounty) return 'pko';
  if (context.format === 'spin') {
    return context.spotsPaid <= 1 ? 'spin_chip_ev' : 'spin_payout';
  }
  if (context.format === 'hu_sng' || context.format === 'sng') return 'sng';
  return 'mtt_payout';
}

function uniqueCandidate(
  list: ActionCandidate[],
  candidate: ActionCandidate,
  seen: Set<string>
): void {
  const key = `${candidate.kind}:${candidate.amount === null ? '-' : candidate.amount}`;
  if (seen.has(key)) return;
  seen.add(key);
  list.push(candidate);
}

/** Finite, legal action abstraction used inside the synchronous engine. */
export function buildTournamentActionCandidates(
  input: Pick<
    TournamentUtilityInput,
    | 'hero'
    | 'toCall'
    | 'legalActions'
    | 'minRaiseTo'
    | 'maxRaiseTo'
    | 'pot'
    | 'currentBet'
    | 'bettingStructure'
    | 'shortAllInWagers'
    | 'baseline'
  > & {
    settlement?: { chipUnit: 0.01 | 1 };
  }
): ActionCandidate[] {
  const legal = new Set(input.legalActions);
  const candidates: ActionCandidate[] = [];
  const seen = new Set<string>();
  const hero = input.hero;
  const toCall = Math.min(Math.max(0, input.toCall), Math.max(0, hero.stack));

  if (toCall > EPS && legal.has('fold')) {
    uniqueCandidate(
      candidates,
      { id: 'fold', kind: 'fold', action: 'fold', amount: null, investment: 0 },
      seen
    );
  }
  if (toCall <= EPS && legal.has('check')) {
    uniqueCandidate(
      candidates,
      { id: 'check', kind: 'check', action: 'check', amount: null, investment: 0 },
      seen
    );
  }
  if (toCall > EPS && (legal.has('call') || (legal.has('all_in') && toCall >= hero.stack - EPS))) {
    uniqueCandidate(
      candidates,
      {
        id: toCall >= hero.stack - EPS ? 'call:all-in' : 'call',
        kind: 'call',
        action: toCall >= hero.stack - EPS ? 'all_in' : 'call',
        amount: null,
        investment: toCall,
      },
      seen
    );
  }

  const wagerAction: 'bet' | 'raise' | null = legal.has('bet')
    ? 'bet'
    : legal.has('raise')
      ? 'raise'
      : null;
  const minTo = input.minRaiseTo;
  const maxTo = input.maxRaiseTo;
  if (
    wagerAction &&
    typeof minTo === 'number' &&
    Number.isFinite(minTo) &&
    typeof maxTo === 'number' &&
    Number.isFinite(maxTo) &&
    maxTo >= minTo - EPS
  ) {
    const potAfterCall = Math.max(1, input.pot + toCall);
    const fractions =
      input.bettingStructure === 'fixed_limit'
        ? []
        : input.bettingStructure === 'pot_limit'
          ? [0.33, 0.5, 0.75, 1]
          : [0.33, 0.5, 0.75, 1, 1.5];
    const amounts = [minTo];
    for (const fraction of fractions) {
      amounts.push(
        wagerAction === 'raise'
          ? input.currentBet + potAfterCall * fraction
          : potAfterCall * fraction
      );
    }
    if (
      input.baseline.action === wagerAction &&
      typeof input.baseline.amount === 'number' &&
      Number.isFinite(input.baseline.amount)
    ) {
      amounts.push(input.baseline.amount);
    }
    amounts.push(maxTo);

    for (const rawAmount of amounts) {
      const unit = input.settlement?.chipUnit;
      const amount = unit
        ? clamp(
            Math.round(rawAmount / unit) * unit,
            Math.ceil((minTo - EPS) / unit) * unit,
            Math.floor((maxTo + EPS) / unit) * unit
          )
        : chips(clamp(rawAmount, minTo, maxTo));
      if (amount < minTo - EPS || amount > maxTo + EPS) continue;
      // HorseLogic's final legalizer intentionally commits near-stack wagers
      // as the canonical all_in action (92% for a bet, 95% for a raise). Do
      // not create a second, differently-labeled candidate that the executor
      // can never commit; the distinct jam below prices that outcome once.
      const canonicalAllIn =
        legal.has('all_in') &&
        (wagerAction === 'bet'
          ? amount >= hero.stack * 0.92
          : amount >= (hero.bet + hero.stack) * 0.95);
      if (canonicalAllIn) continue;
      const investment = clamp(amount - hero.bet, 0, hero.stack);
      if (investment <= EPS) continue;
      uniqueCandidate(
        candidates,
        {
          id: `${wagerAction}:${amount}`,
          kind: wagerAction,
          action: wagerAction,
          amount,
          investment,
        },
        seen
      );
    }
  }

  // The all-in button wagers only where the controller executes it as a
  // wager. Pot-limit: only a shove the pot ceiling admits (HorseLogic caps the
  // rest). Fixed limit: HandController.clampToStructure executes an all-in
  // above the street ceiling as a bet or raise TO that ceiling, and as a call
  // where no wager is legal, so the jam is built at its executed raise-to and
  // every consumer that commits `investment` prices what the table does.
  // With no ceiling on the menu at all (the sized wager is withheld because
  // the stack is below the minimum), the button is the whole stack only where
  // the caller says the controller executes it so (`shortAllInWagers`).
  const ceilingTo = typeof maxTo === 'number' && Number.isFinite(maxTo) ? maxTo : null;
  const jamIsRaise =
    legal.has('all_in') &&
    hero.stack > toCall + EPS &&
    ((input.bettingStructure !== 'pot_limit' && input.bettingStructure !== 'fixed_limit') ||
      (input.bettingStructure === 'pot_limit' &&
        ceilingTo !== null &&
        hero.bet + hero.stack <= ceilingTo + EPS) ||
      (input.bettingStructure === 'fixed_limit' && ceilingTo !== null) ||
      (ceilingTo === null && input.shortAllInWagers === true));
  if (jamIsRaise) {
    const jamTo = executedAllInTo(hero, input.bettingStructure, ceilingTo);
    uniqueCandidate(
      candidates,
      {
        id: 'jam',
        kind: 'jam',
        action: 'all_in',
        amount: null,
        investment: Math.max(0, Math.min(hero.stack, jamTo - hero.bet)),
      },
      seen
    );
  }
  return candidates;
}

/**
 * The raise-to the controller executes for an all-in that wagers: the whole
 * stack, except in fixed limit where clampToStructure stops it at the street
 * ceiling (the menu's maxRaiseTo). A jam candidate's investment is this less
 * the hero's standing bet, so its target is always `hero.bet + investment`.
 */
export function executedAllInTo(
  hero: Pick<SeatPlayer, 'bet' | 'stack'>,
  bettingStructure: string | undefined,
  maxRaiseTo: number | null | undefined
): number {
  const allInTo = hero.bet + hero.stack;
  if (
    bettingStructure === 'fixed_limit' &&
    typeof maxRaiseTo === 'number' &&
    Number.isFinite(maxRaiseTo) &&
    allInTo > maxRaiseTo + EPS
  )
    return maxRaiseTo;
  return allInTo;
}

function strengthOf(evidence: TournamentUtilityOpponentEvidence | undefined): number {
  if (!evidence?.range) return 0.5;
  return clamp((evidence.range[0] + evidence.range[1]) / 2, 0, 1);
}

function validateInput(input: TournamentUtilityInput): boolean {
  if (
    input.settlement &&
    (input.settlement.chipUnit !== 1 ||
      !Number.isInteger(input.settlement.dealerSeat) ||
      input.settlement.dealerSeat < 1 ||
      input.settlement.dealerSeat > 10 ||
      typeof input.settlement.splitLow !== 'boolean')
  )
    return false;
  const wholeNonNegative = (value: number): boolean =>
    Number.isFinite(value) && value >= 0 && Math.abs(value - Math.round(value)) <= EPS;
  const wholePositive = (value: number): boolean => wholeNonNegative(value) && value > 0;
  const nullableWholeNonNegative = (value: number | null): boolean =>
    value === null || wholeNonNegative(value);
  if (
    !['preflop', 'flop', 'turn', 'river'].includes(input.street) ||
    !wholeNonNegative(input.pot) ||
    !wholeNonNegative(input.currentBet) ||
    !wholeNonNegative(input.toCall) ||
    !Number.isFinite(input.heroEquity) ||
    input.heroEquity < 0 ||
    input.heroEquity > 1 ||
    !Number.isSafeInteger(input.equitySampleSize) ||
    input.equitySampleSize < 1 ||
    !Number.isFinite(input.equityStandardError) ||
    input.equityStandardError < 0 ||
    input.context.payoutPct.length === 0 ||
    input.context.fieldStacks.length === 0 ||
    input.players.length < 2 ||
    input.showdownSamples.length < MIN_EFFECTIVE_OUTCOMES ||
    input.showdownSamples.length > MAX_UTILITY_OUTCOMES
  ) {
    return false;
  }
  if (
    !Number.isSafeInteger(input.context.playersLeft) ||
    input.context.playersLeft < 2 ||
    !Number.isSafeInteger(input.context.spotsPaid) ||
    input.context.spotsPaid < 1 ||
    input.context.payoutPct.length !==
      Math.min(input.context.spotsPaid, input.context.playersLeft) ||
    !Number.isSafeInteger(input.context.satelliteSeats) ||
    input.context.satelliteSeats < 0 ||
    input.context.satelliteSeats > input.context.spotsPaid ||
    (input.context.satellite && input.context.satelliteSeats < 1) ||
    input.context.payoutPct.some((payout) => !Number.isFinite(payout) || payout <= 0) ||
    input.context.payoutPct.reduce((sum, payout) => sum + payout, 0) > 100.5 ||
    (input.context.playersLeft >= input.context.spotsPaid &&
      Math.abs(input.context.payoutPct.reduce((sum, payout) => sum + payout, 0) - 100) > 0.5) ||
    input.context.fieldStacks.some((stack) => !wholePositive(stack)) ||
    !wholeNonNegative(input.context.prizePoolCents) ||
    !wholeNonNegative(input.context.bountyPoolCents) ||
    !nullableWholeNonNegative(input.context.buyInCents) ||
    !nullableWholeNonNegative(input.context.startingStackChips) ||
    !nullableWholeNonNegative(input.context.rebuyCostCents) ||
    !nullableWholeNonNegative(input.context.rebuyChips) ||
    !nullableWholeNonNegative(input.context.rebuyPrizeContributionCents) ||
    !nullableWholeNonNegative(input.context.rebuyBountyContributionCents) ||
    !nullableWholeNonNegative(input.context.addOnCostCents) ||
    !nullableWholeNonNegative(input.context.addOnChips) ||
    !Number.isFinite(input.context.bountyFactor) ||
    input.context.bountyFactor < 0 ||
    input.context.bountyFactor > 1 ||
    !wholeNonNegative(input.context.mysteryMeanCents) ||
    !wholeNonNegative(input.context.meanBountyCents)
  ) {
    return false;
  }
  if (
    (input.context.reloadsUsed !== null &&
      (!Number.isSafeInteger(input.context.reloadsUsed) || input.context.reloadsUsed < 0)) ||
    (input.context.addOnTaken !== null && typeof input.context.addOnTaken !== 'boolean') ||
    (input.context.rebuyAffordable !== null &&
      typeof input.context.rebuyAffordable !== 'boolean') ||
    (input.context.addOnAffordable !== null && typeof input.context.addOnAffordable !== 'boolean')
  ) {
    return false;
  }
  if (
    !['none', 'pending', 'active', 'complete'].includes(input.context.mysteryBountyStage) ||
    (input.context.isMysteryBounty && input.context.mysteryBountyStage === 'none') ||
    (!input.context.isMysteryBounty && input.context.mysteryBountyStage !== 'none')
  ) {
    return false;
  }
  if (
    (input.minRaiseTo !== null && !wholeNonNegative(input.minRaiseTo)) ||
    (input.maxRaiseTo !== null && !wholeNonNegative(input.maxRaiseTo)) ||
    (input.minRaiseTo === null) !== (input.maxRaiseTo === null) ||
    (input.minRaiseTo !== null && input.maxRaiseTo !== null && input.minRaiseTo > input.maxRaiseTo)
  ) {
    return false;
  }
  // The short all-in is a claim about one menu shape only: the button, no
  // sized wager and chips beyond the call.
  if (
    input.shortAllInWagers !== undefined &&
    (input.shortAllInWagers !== true ||
      input.minRaiseTo !== null ||
      input.maxRaiseTo !== null ||
      !input.legalActions.includes('all_in') ||
      input.legalActions.includes('bet') ||
      input.legalActions.includes('raise') ||
      !(input.hero.stack > input.toCall + EPS))
  ) {
    return false;
  }
  const ids = new Set<string>();
  for (const player of input.players) {
    if (
      !player.user_id ||
      ids.has(player.user_id) ||
      !wholeNonNegative(player.stack) ||
      !wholeNonNegative(player.bet) ||
      !wholeNonNegative(player.totalInvested) ||
      player.bet > player.totalInvested + EPS
    ) {
      return false;
    }
    ids.add(player.user_id);
  }
  if (
    !input.context.fieldStackByUser ||
    typeof input.context.fieldStackByUser !== 'object' ||
    Array.isArray(input.context.fieldStackByUser) ||
    Object.entries(input.context.fieldStackByUser).some(
      ([userId, stack]) => !ids.has(userId) || !wholePositive(stack)
    )
  ) {
    return false;
  }
  const publicHero = input.players.find((player) => player.user_id === input.hero.user_id);
  if (
    !publicHero ||
    publicHero.seat !== input.hero.seat ||
    Math.abs(publicHero.stack - input.hero.stack) > EPS ||
    Math.abs(publicHero.bet - input.hero.bet) > EPS ||
    Math.abs(publicHero.totalInvested - input.hero.totalInvested) > EPS ||
    publicHero.is_folded !== input.hero.is_folded ||
    publicHero.is_all_in !== input.hero.is_all_in ||
    publicHero.is_sitting_out !== input.hero.is_sitting_out ||
    input.hero.is_folded ||
    input.hero.is_all_in ||
    input.hero.is_sitting_out ||
    Math.abs(
      input.toCall -
        Math.min(Math.max(0, input.currentBet - input.hero.bet), Math.max(0, input.hero.stack))
    ) > EPS
  ) {
    return false;
  }
  const sampled = new Set(input.sampledOpponentIds);
  if (sampled.size !== input.sampledOpponentIds.length || sampled.has(input.hero.user_id)) {
    return false;
  }
  const activeOpponents = input.players
    .filter(
      (player) =>
        player.user_id !== input.hero.user_id &&
        !player.is_folded &&
        (!player.is_sitting_out || player.is_all_in)
    )
    .map((player) => player.user_id);
  if (
    activeOpponents.length !== input.sampledOpponentIds.length ||
    activeOpponents.some((userId) => !sampled.has(userId))
  ) {
    return false;
  }
  const evidenceIds = new Set<string>();
  for (const evidence of input.opponents) {
    if (
      !sampled.has(evidence.userId) ||
      evidenceIds.has(evidence.userId) ||
      !Number.isFinite(evidence.foldMul) ||
      evidence.foldMul < 0 ||
      typeof evidence.actsAfterHero !== 'boolean' ||
      (evidence.range !== null &&
        (!Number.isFinite(evidence.range[0]) ||
          !Number.isFinite(evidence.range[1]) ||
          evidence.range[0] < 0 ||
          evidence.range[1] > 1 ||
          evidence.range[0] > evidence.range[1]))
    ) {
      return false;
    }
    evidenceIds.add(evidence.userId);
  }
  if (evidenceIds.size !== sampled.size) return false;
  let boardCount: number | null = null;
  for (const sample of input.showdownSamples) {
    if (!Array.isArray(sample.boards) || sample.boards.length === 0) return false;
    if (boardCount === null) boardCount = sample.boards.length;
    else if (sample.boards.length !== boardCount) return false;
    for (const board of sample.boards) {
      if (
        !Number.isFinite(board.heroHigh) ||
        board.opponentHigh.length !== input.sampledOpponentIds.length ||
        board.opponentDecisionStrength.length !== input.sampledOpponentIds.length ||
        board.opponentLow.length !== input.sampledOpponentIds.length ||
        board.opponentHigh.some((score) => !Number.isFinite(score)) ||
        board.opponentDecisionStrength.some(
          (strength) => !Number.isFinite(strength) || strength < 0 || strength > 1
        ) ||
        (board.heroLow !== null && !Number.isFinite(board.heroLow)) ||
        board.opponentLow.some((score) => score !== null && !Number.isFinite(score))
      ) {
        return false;
      }
    }
  }
  const potTotal = input.pots.reduce((sum, pot) => sum + pot.amount, 0);
  if (Math.abs(potTotal - input.pot) > EPS) return false;
  return input.pots.every(
    (pot) =>
      wholePositive(pot.amount) &&
      pot.eligiblePlayers.length > 0 &&
      new Set(pot.eligiblePlayers).size === pot.eligiblePlayers.length &&
      pot.eligiblePlayers.every((userId) => ids.has(userId))
  );
}

function buildField(input: TournamentUtilityInput): FieldState {
  const remaining = input.context.fieldStacks
    .filter((stack) => Number.isFinite(stack) && stack > 0)
    .slice();
  const local = input.players.filter(
    (player) => typeof player.user_id === 'string' && player.user_id.length > 0
  );
  let reconciliationErrorChips = 0;
  let removedLocalTotal = 0;
  let exactLocalTotal = 0;

  // The field list is identityless, but the cache retains values for this
  // table's user IDs. Remove those exact stale local entries when available,
  // then re-add authoritative in-hand values. Older fixtures fall back to the
  // closest value without weakening the aggregate-conservation gate below.
  for (const player of local) {
    const total = Math.max(0, player.stack) + Math.max(0, player.totalInvested);
    if (total <= EPS || remaining.length === 0) continue;
    exactLocalTotal += total;
    const observed = input.context.fieldStackByUser[player.user_id];
    let closest =
      Number.isFinite(observed) && observed > 0
        ? remaining.findIndex((stack) => Math.abs(stack - observed) <= EPS)
        : -1;
    if (closest < 0) {
      closest = 0;
      for (let index = 1; index < remaining.length; index++) {
        if (Math.abs(remaining[index] - total) < Math.abs(remaining[closest] - total)) {
          closest = index;
        }
      }
    }
    reconciliationErrorChips += Math.abs(remaining[closest] - total);
    removedLocalTotal += remaining[closest];
    remaining.splice(closest, 1);
  }

  const stacks = remaining.slice();
  const localIndex = new Map<string, number>();
  for (const player of local) {
    localIndex.set(player.user_id, stacks.length);
    stacks.push(Math.max(0, player.stack));
  }
  const heroIndex = localIndex.get(input.hero.user_id) ?? -1;
  return {
    stacks,
    localIndex,
    heroIndex,
    conservationTarget: stacks.reduce((sum, stack) => sum + stack, 0) + Math.max(0, input.pot),
    fieldPlayersActual: Math.max(0, Math.floor(input.context.playersLeft)),
    fieldPlayersModeled: remaining.length + local.length,
    reconciliationErrorChips,
    aggregateReconciliationErrorChips: Math.abs(removedLocalTotal - exactLocalTotal),
  };
}

function currencyToPoolPct(input: TournamentUtilityInput, amountCents: number): number {
  if (!(amountCents > 0)) return 0;
  const totalPool =
    Math.max(0, input.context.prizePoolCents) + Math.max(0, input.context.bountyPoolCents);
  if (totalPool > 0) return (amountCents / totalPool) * 100;

  const mean = Math.max(0, input.context.meanBountyCents || input.context.mysteryMeanCents);
  const left = Math.max(1, input.context.playersLeft);
  if (mean > 0 && input.context.bountyFactor > 0) {
    return (amountCents / mean) * ((clamp(input.context.bountyFactor, 0, 1) * 100) / left);
  }
  return 0;
}

/**
 * The share of what the event awards that is paid by finishing place:
 * prize / (prize + bounty), or 1 - bountyFactor when neither pool is known.
 * Exported so the short-stack push/fold tables (HorseLogic payJumpBubbleFactor)
 * weight a bubble factor by the same number this arbiter weights payouts by.
 */
export function payoutWeightOfPools(pools: {
  prizePoolCents?: number | null;
  bountyPoolCents?: number | null;
  bountyFactor?: number | null;
}): number {
  const prize = Math.max(0, Number(pools.prizePoolCents) || 0);
  const bounty = Math.max(0, Number(pools.bountyPoolCents) || 0);
  if (prize + bounty > 0) return prize / (prize + bounty);
  return 1 - clamp(Number(pools.bountyFactor) || 0, 0, 1);
}

function payoutPoolWeight(input: TournamentUtilityInput): number {
  return payoutWeightOfPools(input.context);
}

function targetBountyCents(input: TournamentUtilityInput, userId: string): number {
  if (input.context.isMysteryBounty) {
    if (input.context.mysteryBountyStage === 'complete') return 0;
    if (input.context.mysteryBountyStage === 'active') {
      return Math.max(0, input.context.mysteryMeanCents);
    }
    return Math.max(0, input.context.bountyByUser[userId] ?? input.context.meanBountyCents);
  }
  const head = Math.max(0, input.context.bountyByUser[userId] ?? input.context.meanBountyCents);
  // Only the immediately payable half is current PKO bounty EV. The other
  // half becomes the winner's own head; counting it again is double counting.
  return input.context.isPko ? head * 0.5 : head;
}

function ownBountyCents(input: TournamentUtilityInput): number {
  if (input.context.isMysteryBounty) {
    return targetBountyCents(input, input.hero.user_id);
  }
  const head = Math.max(
    0,
    input.context.bountyByUser[input.hero.user_id] ?? input.context.meanBountyCents
  );
  return input.context.isPko ? head * 0.5 : head;
}

function responseFoldProbability(
  input: TournamentUtilityInput,
  field: FieldState,
  candidate: ActionCandidate,
  opponent: SeatPlayer,
  evidence: TournamentUtilityOpponentEvidence | undefined,
  sampledDecisionStrength: number,
  seats: SeatPlayer[],
  plan: SettlementPlan,
  candidateCache: CandidateSettlementCache,
  responseStep: number,
  responseMask: number
): number {
  if (opponent.is_all_in) return 0;
  const target =
    candidate.kind === 'jam'
      ? input.hero.bet + candidate.investment
      : (candidate.amount ?? input.currentBet);
  const facing = Math.min(
    Math.max(0, target - Math.max(0, opponent.bet)),
    Math.max(0, opponent.stack)
  );
  if (facing <= EPS) return 0;
  // Price each responder after the candidate and preceding responses have
  // committed. A short stack cannot defend side pots it can never win, and
  // its own not-yet-paid call must not appear twice in the price denominator.
  // Within one candidate, every earlier seat's fold/call state is uniquely
  // encoded by (responseMask, responseStep), eliminating per-sample string keys.
  let potFacing: number;
  if (plan.useBitmaskCache) {
    const maskKey = responseMask * 32 + responseStep;
    const cached = candidateCache.contestablePotByMask.get(maskKey);
    if (cached !== undefined) {
      potFacing = cached;
    } else {
      potFacing = calculateContestablePot(seats, opponent.user_id, facing);
      candidateCache.contestablePotByMask.set(maskKey, potFacing);
    }
  } else {
    potFacing = cachedContestablePot(seats, opponent.user_id, facing, plan.contestablePotCache);
  }
  let foldMul = evidence?.foldMul ?? 1;
  if (input.v86AsymmetricIcmAndPreflop !== false) {
    const heroTotal = Math.max(0, input.hero.stack) + Math.max(0, input.hero.bet);
    const oppTotal = Math.max(0, opponent.stack) + Math.max(0, opponent.bet);
    const oppFieldIdx = field.localIndex.get(opponent.user_id);
    // Asymmetric cover pressure: when hero covers a medium stack on a pay-jump
    // or satellite bubble, the covered opponent's survival bubble factor raises
    // their required continuing equity (higher fold frequency).
    // All five arguments to pairwiseBubbleFactor are invariant across showdown
    // samples within this action; memoize per (oppFieldIdx, facing) so late-stage
    // exact-ICM tables do not recompute 2^10 Malmuth-Harville DP thousands of times.
    if (
      oppFieldIdx !== undefined &&
      field.heroIndex >= 0 &&
      heroTotal > oppTotal * 1.05 &&
      plan.effectiveCoverPayouts !== null
    ) {
      const bfKey = `${oppFieldIdx}|${facing}`;
      let oppBF = plan.coverBubbleFactorCache.get(bfKey);
      if (oppBF === undefined) {
        oppBF = pairwiseBubbleFactor(
          field.stacks,
          plan.effectiveCoverPayouts,
          oppFieldIdx,
          field.heroIndex,
          facing
        );
        plan.coverBubbleFactorCache.set(bfKey, oppBF);
      }
      if (oppBF > 1.08) {
        foldMul *= 1 + Math.min(0.28, (oppBF - 1.08) * 0.22);
      }
    } else if (
      oppTotal > heroTotal * 1.05 &&
      candidate.investment >= input.hero.stack - EPS &&
      (input.context.isBounty ||
        input.context.isPko ||
        (input.context.isMysteryBounty && input.context.mysteryBountyStage === 'active'))
    ) {
      // Covering bounty hunter calls wider when hero is all-in with a live head.
      const ownHead = ownBountyCents(input);
      if (ownHead > 0) {
        const bountyPull = clamp(input.context.bountyFactor * 0.28, 0.04, 0.22);
        foldMul *= 1 - bountyPull;
      }
    }
  }
  const base = mdfFold(Math.max(1, potFacing), facing, foldMul);
  // The opening/action-history range remains the prior, but the hand sampled
  // from that range now drives the actual response. This makes a continuing
  // range strictly stronger as price rises instead of letting premium and air
  // samples fold at the same rate.
  const strength = clamp(strengthOf(evidence) * 0.25 + sampledDecisionStrength * 0.75, 0, 1);
  return clamp(base * clamp(1.45 - strength * 0.9, 0.5, 1.4), 0, 0.98);
}

function responseDraw(sampleIndex: number, userId: string): number {
  let hash = 2166136261;
  // Common response draws make wager comparisons nested: when a larger size
  // raises fold probability, every hand that folded to the smaller size also
  // folds to the larger one. Candidate-specific randomness made identical
  // samples reach different conclusions merely because their labels differed.
  const key = `${sampleIndex}|${userId}`;
  for (let index = 0; index < key.length; index++) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000;
}

function winnersFor(
  input: Pick<TournamentUtilityInput, 'hero' | 'sampledOpponentIds'>,
  board: TournamentUtilityBoardOutcome,
  eligible: string[],
  sampledOpponentIndexById?: Map<string, number>
): { high: string[]; low: string[] } | null {
  const heroId = input.hero.user_id;
  let bestHigh = Number.NEGATIVE_INFINITY;
  let bestLow = Number.POSITIVE_INFINITY;
  let scoredCount = 0;
  let high: string[] = [];
  let low: string[] = [];

  for (let i = 0; i < eligible.length; i++) {
    const userId = eligible[i];
    let h: number;
    let l: number | null;
    if (userId === heroId) {
      h = board.heroHigh;
      l = board.heroLow;
    } else {
      const idx = sampledOpponentIndexById
        ? sampledOpponentIndexById.get(userId)
        : input.sampledOpponentIds.indexOf(userId);
      if (idx === undefined || idx < 0) continue;
      h = board.opponentHigh[idx];
      l = board.opponentLow[idx];
    }
    scoredCount++;
    if (h > bestHigh) {
      bestHigh = h;
      high = [userId];
    } else if (h === bestHigh) {
      high.push(userId);
    }
    if (l !== null) {
      if (l < bestLow) {
        bestLow = l;
        low = [userId];
      } else if (l === bestLow) {
        low.push(userId);
      }
    }
  }
  if (scoredCount === 0) return null;
  return { high, low };
}

/** Per-candidate integer-keyed settlement caches (valid when responseOrder.length <= 24). */
interface CandidateSettlementCache {
  contestablePotByMask: Map<number, number>;
  potsByMask: Map<number, Pot[]>;
}

/** Action-wide facts every candidate/sample settlement reads unchanged. */
interface SettlementPlan {
  /** Last public seat holding hero's id (the id map's winner), or -1. */
  heroSeat: number;
  /** Clockwise response order after hero, as public-seat indices. */
  responseOrder: number[];
  evidenceById: Map<string, TournamentUtilityOpponentEvidence>;
  /** Last public seat index for each user_id (matches Map construction semantics). */
  seatIndexById: Map<string, number>;
  sampledOpponentIndexById: Map<string, number>;
  /** Effective payout curve for <=10-player cover-pressure bubble factors, or null if inapplicable. */
  effectiveCoverPayouts: number[] | null;
  /** Action-scoped memo of pairwiseBubbleFactor(field.stacks, effectiveCoverPayouts, oppIdx, heroIdx, facing). */
  coverBubbleFactorCache: Map<string, number>;
  /** Action-scoped memo of calculatePots(seats) keyed by per-seat (is_folded, totalInvested). */
  potCache: Map<string, Pot[]>;
  /** Action-scoped memo of calculateContestablePot(seats, opponentId, facing). */
  contestablePotCache: Map<string, number>;
  /** Lazily populated common response draws indexed by sampleIndex * opponentCount + opponentIndex. */
  responseDrawCache: Float64Array;
  sampledOpponentCount: number;
  /** Reusable per-sample seat workspace (reset from input.players before each sample). */
  workSeats: SeatPlayer[];
  /** True when responseOrder.length <= 24 so a single SMI bitmask encodes responder states. */
  useBitmaskCache: boolean;
}

function settlementPlan(input: TournamentUtilityInput, field: FieldState): SettlementPlan {
  let heroSeat = -1;
  const seatIndexById = new Map<string, number>();
  for (let index = 0; index < input.players.length; index++) {
    const userId = input.players[index].user_id;
    seatIndexById.set(userId, index);
    if (userId === input.hero.user_id) heroSeat = index;
  }
  const heroSeatNumber = heroSeat < 0 ? 0 : input.players[heroSeat].seat;
  // The same stable comparison the per-sample seat copies used; seat numbers
  // are never changed by a settlement, so the permutation is action-wide.
  const responseOrder = input.players
    .map((_, index) => index)
    .sort(
      (a, b) =>
        Number(input.players[a].seat <= heroSeatNumber) -
          Number(input.players[b].seat <= heroSeatNumber) ||
        input.players[a].seat - input.players[b].seat
    );
  const sampledOpponentIndexById = new Map<string, number>();
  for (let index = 0; index < input.sampledOpponentIds.length; index++) {
    sampledOpponentIndexById.set(input.sampledOpponentIds[index], index);
  }
  const effectiveCoverPayouts =
    field.stacks.length <= 10 &&
    (input.context.payoutPct.length >= 2 ||
      (input.context.satellite && input.context.satelliteSeats >= 1))
      ? input.context.satellite && input.context.satelliteSeats >= 1
        ? Array.from({ length: Math.max(1, input.context.satelliteSeats) }, () => 1)
        : input.context.payoutPct
      : null;
  const sampledOpponentCount = input.sampledOpponentIds.length;
  const responseDrawCache = new Float64Array(input.showdownSamples.length * sampledOpponentCount);
  responseDrawCache.fill(-1);
  const workSeats = input.players.map((player) => ({ ...player, cards: [...player.cards] }));
  return {
    heroSeat,
    responseOrder,
    evidenceById: new Map(input.opponents.map((evidence) => [evidence.userId, evidence])),
    seatIndexById,
    sampledOpponentIndexById,
    effectiveCoverPayouts,
    coverBubbleFactorCache: new Map(),
    potCache: new Map(),
    contestablePotCache: new Map(),
    responseDrawCache,
    sampledOpponentCount,
    workSeats,
    useBitmaskCache: responseOrder.length <= 24,
  };
}

function seatsStateKey(seats: SeatPlayer[]): string {
  let key = `${seats[0].is_folded ? 'F' : 'L'}${seats[0].totalInvested}`;
  for (let i = 1; i < seats.length; i++) {
    key += `|${seats[i].is_folded ? 'F' : 'L'}${seats[i].totalInvested}`;
  }
  return key;
}

function cachedBranchPots(seats: SeatPlayer[], potCache: Map<string, Pot[]>): Pot[] {
  const key = seatsStateKey(seats);
  let pots = potCache.get(key);
  if (pots === undefined) {
    pots = calculatePots(seats);
    potCache.set(key, pots);
  }
  return pots;
}

function cachedContestablePot(
  seats: SeatPlayer[],
  userId: string,
  facing: number,
  cache: Map<string, number>
): number {
  const key = `${seatsStateKey(seats)}|${userId}|${facing}`;
  let pot = cache.get(key);
  if (pot === undefined) {
    pot = calculateContestablePot(seats, userId, facing);
    cache.set(key, pot);
  }
  return pot;
}

function settleSample(args: {
  input: TournamentUtilityInput;
  field: FieldState;
  candidate: ActionCandidate;
  sample: TournamentUtilityShowdownSample;
  sampleIndex: number;
  payoutWeight: number;
  plan: SettlementPlan;
  candidateCache: CandidateSettlementCache;
}): BranchResult | null {
  const { input, field, candidate, sample, plan, candidateCache } = args;
  if (plan.heroSeat < 0) return null;
  const vector = field.stacks.slice();
  const seats = plan.workSeats;
  for (let i = 0; i < input.players.length; i++) {
    const src = input.players[i];
    const dst = seats[i];
    dst.stack = src.stack;
    dst.bet = src.bet;
    dst.totalInvested = src.totalInvested;
    dst.is_folded = src.is_folded;
    dst.is_all_in = src.is_all_in;
  }
  const seatForId = (userId: string): SeatPlayer | undefined => {
    const idx = plan.seatIndexById.get(userId);
    return idx === undefined ? undefined : seats[idx];
  };
  const hero = seats[plan.heroSeat];

  const commit = (player: SeatPlayer, requested: number): void => {
    const amount = Math.min(Math.max(0, requested), Math.max(0, player.stack));
    player.stack -= amount;
    player.bet = Math.max(0, player.bet) + amount;
    player.totalInvested = Math.max(0, player.totalInvested) + amount;
    if (player.stack <= EPS) player.is_all_in = true;
    const index = field.localIndex.get(player.user_id);
    if (index !== undefined) vector[index] = Math.max(0, player.stack);
  };

  if (candidate.kind === 'fold') hero.is_folded = true;
  else commit(hero, candidate.investment);

  const wager = candidate.kind === 'bet' || candidate.kind === 'raise' || candidate.kind === 'jam';
  const evidenceById = plan.evidenceById;
  let discretionaryCallers = 0;
  let forcedCallers = 0;
  let responseMask = 0;
  // Earlier calls change the next responder's available pot. Use actual
  // clockwise action order, not the storage order of the public seat array.
  for (let responseStep = 0; responseStep < plan.responseOrder.length; responseStep++) {
    const seatIndex = plan.responseOrder[responseStep];
    const opponent = seats[seatIndex];
    if (
      opponent.user_id === hero.user_id ||
      opponent.is_folded ||
      (opponent.is_sitting_out && !opponent.is_all_in)
    ) {
      continue;
    }
    const evidence = evidenceById.get(opponent.user_id);
    // A hero wager comes back around to every live opponent. When hero only
    // folds or calls an existing wager, the still-unacted players behind must
    // nevertheless answer that price before an all-in hero's result is known.
    // Ignoring them made an all-in call look heads-up even when a third player
    // still held a live fold/call decision.
    const responds =
      wager ||
      (evidence?.actsAfterHero === true && input.currentBet > Math.max(0, opponent.bet) + EPS);
    if (!responds) continue;
    if (opponent.is_all_in) {
      if (wager) {
        forcedCallers++;
      }
      continue;
    }
    const opponentIndex = plan.sampledOpponentIndexById.get(opponent.user_id);
    if (opponentIndex === undefined) return null;
    const sampledStrength =
      sample.boards.length === 1
        ? sample.boards[0].opponentDecisionStrength[opponentIndex]
        : sample.boards.reduce(
            (sum, board) => sum + board.opponentDecisionStrength[opponentIndex],
            0
          ) / sample.boards.length;
    const drawSlot = args.sampleIndex * plan.sampledOpponentCount + opponentIndex;
    let draw = plan.responseDrawCache[drawSlot];
    if (draw < 0) {
      draw = responseDraw(args.sampleIndex, opponent.user_id);
      plan.responseDrawCache[drawSlot] = draw;
    }
    const folds =
      draw <
      responseFoldProbability(
        input,
        field,
        candidate,
        opponent,
        evidence,
        sampledStrength,
        seats,
        plan,
        candidateCache,
        responseStep,
        responseMask
      );
    if (folds) {
      opponent.is_folded = true;
      continue;
    }
    responseMask |= 1 << responseStep;
    discretionaryCallers++;
    const target =
      candidate.kind === 'jam'
        ? input.hero.bet + candidate.investment
        : (candidate.amount ?? input.currentBet);
    commit(opponent, Math.max(0, target - Math.max(0, opponent.bet)));
  }
  const allFold = wager && discretionaryCallers === 0 && forcedCallers === 0;
  let ranContinuation = false;
  if (input.continuation && !hero.is_folded && !hero.is_all_in && !allFold) {
    ranContinuation = true;
    const streets = sample.boards[0]?.continuationStreets;
    if (
      sample.boards.length !== 1 ||
      !streets ||
      !simulateTournamentContinuation(
        seats,
        {
          ...input.continuation,
          heroId: hero.user_id,
          currentStreet: input.street,
          heroChecked: candidate.kind === 'check',
          opponentIds: input.sampledOpponentIds,
          sampleIndex: args.sampleIndex,
          streets,
        },
        commit
      )
    )
      return null;
  }
  let exactSettlement: ReturnType<typeof settleJointScores> | null = null;
  let branchPots: Pot[];
  try {
    if (input.settlement) {
      const prepared = prepareJointPots(seats, input.settlement.chipUnit);
      branchPots = prepared.pots;
      exactSettlement = settleJointScores({
        prepared,
        heroId: input.hero.user_id,
        opponentIds: input.sampledOpponentIds,
        sample,
        dealerSeat: input.settlement.dealerSeat,
        splitLow: input.settlement.splitLow,
      });
    } else if (plan.useBitmaskCache && !ranContinuation) {
      let pots = candidateCache.potsByMask.get(responseMask);
      if (pots === undefined) {
        pots = calculatePots(seats);
        candidateCache.potsByMask.set(responseMask, pots);
      }
      branchPots = pots;
    } else branchPots = cachedBranchPots(seats, plan.potCache);
  } catch {
    return null;
  }
  const branchTotal = branchPots.reduce((sum, pot) => sum + pot.amount, 0);
  const expectedBranchPot =
    input.pot +
    seats.reduce((sum, player, index) => {
      const original = input.players[index];
      return sum + Math.max(0, player.totalInvested - original.totalInvested);
    }, 0);
  const refundsTotal = exactSettlement
    ? Object.values(exactSettlement.refunds).reduce((a, b) => a + b, 0)
    : 0;
  if (Math.abs(branchTotal + refundsTotal - expectedBranchPot) > EPS) return null;

  const winnersByPot = branchPots.map(() => new Set<string>());
  let heroAward = 0;
  const award = (userId: string, amount: number): void => {
    const index = field.localIndex.get(userId);
    if (index === undefined) return;
    vector[index] += amount;
    if (userId === input.hero.user_id) heroAward += amount;
  };

  if (exactSettlement) {
    for (const [userId, amount] of Object.entries(exactSettlement.refunds)) award(userId, amount);
    for (const item of exactSettlement.awards) {
      award(item.playerId, item.amount);
      winnersByPot[item.potIndex].add(item.playerId);
    }
  } else
    for (let layerIndex = 0; layerIndex < branchPots.length; layerIndex++) {
      const layer = branchPots[layerIndex];
      const liveEligible = layer.eligiblePlayers.filter((userId) => !seatForId(userId)?.is_folded);
      if (liveEligible.length === 0) return null;
      const boardAmount = layer.amount / sample.boards.length;
      for (const board of sample.boards) {
        const winners = winnersFor(input, board, liveEligible, plan.sampledOpponentIndexById);
        if (!winners) {
          if (liveEligible.length !== 1) return null;
          winnersByPot[layerIndex].add(liveEligible[0]);
          award(liveEligible[0], boardAmount);
          continue;
        }
        const highAmount = winners.low.length > 0 ? boardAmount / 2 : boardAmount;
        for (const userId of winners.high) {
          winnersByPot[layerIndex].add(userId);
          award(userId, highAmount / winners.high.length);
        }
        if (winners.low.length > 0) {
          for (const userId of winners.low) {
            winnersByPot[layerIndex].add(userId);
            award(userId, boardAmount / 2 / winners.low.length);
          }
        }
      }
    }

  const bustedIds = input.players
    .filter((player) => {
      const index = field.localIndex.get(player.user_id);
      return index !== undefined && vector[index] <= EPS;
    })
    .map((player) => player.user_id);
  const heroBusted = bustedIds.includes(input.hero.user_id);
  let realizedPayoutPct = 0;
  let heroFinishedPaid = false;
  if (heroBusted) {
    const startOf = (userId: string): number => {
      const player = seatForId(userId)!;
      return player.stack + player.totalInvested;
    };
    const heroStart = startOf(input.hero.user_id);
    const shorter = bustedIds.filter((userId) => startOf(userId) < heroStart - EPS).length;
    const tied = bustedIds.filter((userId) => Math.abs(startOf(userId) - heroStart) <= EPS).length;
    let locked = 0;
    for (let offset = 0; offset < tied; offset++) {
      const finishPlace = input.context.playersLeft - (shorter + offset);
      if (finishPlace >= 1 && finishPlace <= input.context.payoutPct.length) {
        heroFinishedPaid = true;
        locked += input.context.payoutPct[finishPlace - 1];
      }
    }
    // Equal starting stacks split the occupied payout places rather than
    // receiving an arbitrary user-id tie-break. Shorter stacks still bust in
    // the lower place, matching tournament settlement convention.
    realizedPayoutPct = (locked / Math.max(1, tied)) * args.payoutWeight;
  }

  let bountyWonPct = 0;
  let wonBounty = false;
  const futureBountyHeads =
    input.continuation?.futureHands && input.context.isPko && !input.context.isMysteryBounty
      ? Object.fromEntries(
          input.players.map((p) => [
            p.user_id,
            Math.max(0, input.context.bountyByUser[p.user_id] ?? input.context.meanBountyCents),
          ])
        )
      : undefined;
  if (!hero.is_folded || futureBountyHeads) {
    for (const opponentId of bustedIds) {
      if (opponentId === hero.user_id && !futureBountyHeads) continue;
      let claimants: string[] = [];
      let lastEligiblePot = -1;
      for (let index = 0; index < branchPots.length; index++) {
        if (branchPots[index].eligiblePlayers.includes(opponentId)) lastEligiblePot = index;
      }
      // Match knockoutAttribution exactly: distinct winners of the last pot
      // that contained the eliminated player's chips share one head equally.
      // Winning both hi and low is still one claim. If that layer has no
      // usable winner other than the busted player, walk down as production
      // attribution does instead of inventing proportional ownership.
      for (let index = lastEligiblePot; index >= 0; index--) {
        claimants = [...winnersByPot[index]].filter((userId) => userId !== opponentId);
        if (claimants.length === 0) continue;
        break;
      }
      if (futureBountyHeads) {
        // Use pre-hand heads for simultaneous knockouts. Growth is retained
        // head value, not an additional immediate prize to the winner.
        for (const claimant of claimants)
          futureBountyHeads[claimant] += targetBountyCents(input, opponentId) / claimants.length;
        futureBountyHeads[opponentId] = 0;
      }
      const ownership =
        !hero.is_folded && opponentId !== hero.user_id && claimants.includes(hero.user_id)
          ? 1 / claimants.length
          : 0;
      if (ownership <= 0) continue;
      bountyWonPct += ownership * currencyToPoolPct(input, targetBountyCents(input, opponentId));
      wonBounty = true;
    }
  }
  const bountyDeniedPct = heroBusted ? currencyToPoolPct(input, ownBountyCents(input)) : 0;
  let total = 0;
  for (let index = 0; index < vector.length; index++) total += vector[index];
  return {
    vector,
    heroFinalStack: vector[field.heroIndex],
    realizedPayoutPct,
    heroFinishedPaid,
    bountyWonPct,
    bountyDeniedPct,
    ...(futureBountyHeads ? { futureBountyHeads } : {}),
    heroBusted,
    heroWon: !hero.is_folded && heroAward > EPS,
    wonBounty,
    allFold,
    sidePotCount: branchPots.length,
    conservationError: Math.abs(total - field.conservationTarget),
    shortStackCollision:
      Boolean(input.continuation) &&
      seats.some((p, seatIndex) => {
        // Public ids are unique (the id map above); the copy keeps its index.
        const original = input.players[seatIndex];
        return (
          p.user_id !== hero.user_id &&
          !p.is_folded &&
          original.stack > 0 &&
          original.stack <= (input.continuation?.shortStackThresholdChips ?? 0) &&
          p.totalInvested > original.totalInvested
        );
      }),
    coveredStacks: seats.filter(
      (p) =>
        p.user_id !== hero.user_id &&
        vector[field.localIndex.get(p.user_id)!] > 0 &&
        vector[field.localIndex.get(p.user_id)!] < vector[field.heroIndex]
    ).length,
  };
}

function optionValue(
  input: TournamentUtilityInput,
  field: FieldState,
  vector: number[],
  heroBusted: boolean,
  heroFinishedPaid: boolean,
  estimate: (vector: number[]) => Estimate
): OptionEstimate | null {
  const totalPool =
    Math.max(0, input.context.prizePoolCents) + Math.max(0, input.context.bountyPoolCents);
  const paidOptionRelevant = heroBusted
    ? !heroFinishedPaid && (input.context.rebuyOpen || input.context.reentryOpen)
    : input.context.addOnPeriodOpen;
  if (totalPool <= 0) return paidOptionRelevant ? null : { value: 0, error: 0 };
  const costPct = (costCents: number): number => (costCents / totalPool) * 100;
  const payoutAtPool = (result: Estimate, prizePoolCents: number): number =>
    result.equity * (prizePoolCents / totalPool);
  const payoutErrorAtPool = (result: Estimate, prizePoolCents: number): number =>
    result.equityError * (prizePoolCents / totalPool);

  if (heroBusted) {
    // The canonical purchase authority only admits an exact unpaid zero-stack
    // entry.  A paid finish is terminal even when a nominal rebuy window is
    // still open; adding both the locked payout and a restart would invent a
    // tournament entry the database can never create.
    if (heroFinishedPaid) return { value: 0, error: 0 };
    if (!input.context.rebuyOpen && !input.context.reentryOpen) {
      return { value: 0, error: 0 };
    }
    if (input.context.rebuyAffordable === null || input.context.reloadsUsed === null) {
      return null;
    }
    if (input.context.rebuyAffordable === false) return { value: 0, error: 0 };

    const used = Math.max(0, Math.floor(input.context.reloadsUsed));
    const recoveryOpen = input.context.rebuyOpen
      ? input.context.maxRebuys === null || used < input.context.maxRebuys
      : input.context.maxReentries === null || used < input.context.maxReentries;
    if (!recoveryOpen) return { value: 0, error: 0 };

    // A bounty recovery creates or resets the hero's own head while also
    // changing two funded pools. Until that continuation is modeled as one
    // transaction, treating it as an ordinary ticket would double-count or
    // omit bounty value. Returning null retains the established tournament
    // baseline; zero would falsely claim that the paid option was modeled.
    if (input.context.isPko || input.context.isBounty || input.context.isMysteryBounty) {
      return null;
    }

    // The canonical window can overlap the automatic add-on period. A busted
    // horse that recovers may then take the add-on, so the two wallet debits,
    // chip grants and pool changes must be valued in sequence. Round 1 keeps
    // the baseline unless those downstream facts prove there is no add-on.
    if (input.context.addOnPeriodOpen) {
      if (input.context.addOnTaken === null || input.context.addOnAffordable === null) {
        return null;
      }
      if (input.context.addOnTaken === false && input.context.addOnAffordable === true) {
        return null;
      }
    }

    const chipsAfter = input.context.rebuyChips ?? input.context.startingStackChips ?? 0;
    const costCents = input.context.rebuyCostCents ?? 0;
    const prizeContribution = input.context.rebuyPrizeContributionCents ?? -1;
    if (
      !(chipsAfter > 0) ||
      !(costCents > 0) ||
      prizeContribution < 0 ||
      (input.context.rebuyBountyContributionCents ?? 0) !== 0
    ) {
      return null;
    }
    const restart = vector.slice();
    restart[field.heroIndex] = chipsAfter;
    const after = estimate(restart);
    const newPrizePool = input.context.prizePoolCents + prizeContribution;
    return {
      // The engine auto-attempts the configured recovery. A negative value is
      // a real cost of busting, not an elective option that may be clamped off.
      value: payoutAtPool(after, newPrizePool) - costPct(costCents),
      error: payoutErrorAtPool(after, newPrizePool),
    };
  }

  const addOnChips = input.context.addOnChips ?? 0;
  const addOnCost = input.context.addOnCostCents ?? 0;
  if (!input.context.addOnPeriodOpen) {
    return { value: 0, error: 0 };
  }
  if (input.context.addOnTaken === null || input.context.addOnAffordable === null) return null;
  if (input.context.addOnTaken || !input.context.addOnAffordable) {
    return { value: 0, error: 0 };
  }
  // Adding chips in a bounty event changes future head ownership/denial EV.
  // Do not pass that omitted value off as an exact zero.
  if (input.context.isPko || input.context.isBounty || input.context.isMysteryBounty) return null;
  if (!(addOnChips > 0) || !(addOnCost > 0)) return null;
  const withAddOn = vector.slice();
  withAddOn[field.heroIndex] += addOnChips;
  const before = estimate(vector);
  const after = estimate(withAddOn);
  const newPrizePool = input.context.prizePoolCents + addOnCost;
  return {
    // Horse add-ons are engine-driven too, so preserve a negative net value.
    value: payoutAtPool(after, newPrizePool) - before.payout - costPct(addOnCost),
    error: payoutErrorAtPool(after, newPrizePool) + before.error,
  };
}

function heroShareInSample(
  input: Pick<TournamentUtilityInput, 'hero' | 'sampledOpponentIds'>,
  sample: TournamentUtilityShowdownSample
): number {
  let share = 0;
  const eligible = [input.hero.user_id, ...input.sampledOpponentIds];
  for (const board of sample.boards) {
    const winners = winnersFor(input, board, eligible);
    if (!winners) continue;
    let boardShare = winners.high.includes(input.hero.user_id) ? 1 / winners.high.length : 0;
    if (winners.low.length > 0) {
      boardShare =
        boardShare * 0.5 +
        (winners.low.includes(input.hero.user_id) ? 0.5 / winners.low.length : 0);
    }
    share += boardShare / sample.boards.length;
  }
  return share;
}

/** Preserve the unweighted joint sample population when another policy
 * supplies actual shared-deck outcomes to this utility owner. */
export function tournamentSampleEquity(
  input: Pick<TournamentUtilityInput, 'hero' | 'sampledOpponentIds' | 'showdownSamples'>
) {
  const shares = input.showdownSamples.map((sample) => heroShareInSample(input, sample));
  if (!shares.length) throw new Error('joint_utility_empty_samples');
  const n = shares.length,
    equity = shares.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? shares.reduce((s, v) => s + (v - equity) ** 2, 0) / (n - 1) : 0.25;
  return { equity, sampleSize: n, standardError: Math.max(Math.sqrt(variance / n), 1 / (2 * n)) };
}

/** Exponential tilting preserves sample shapes while matching the safety-capped equity. */
function calibratedSampleWeights(input: TournamentUtilityInput): {
  weights: number[];
  calibrationError: number;
  effectiveSamples: number;
} {
  const shares = input.showdownSamples.map((sample) => heroShareInSample(input, sample));
  const target = clamp(input.heroEquity, 0, 1);
  const minimum = Math.min(...shares);
  const maximum = Math.max(...shares);
  const meanFor = (lambda: number): { mean: number; weights: number[] } => {
    const raw = shares.map((share) => Math.exp(clamp(lambda * share, -40, 40)));
    const total = raw.reduce((sum, weight) => sum + weight, 0);
    const weights = raw.map((weight) => weight / total);
    return {
      mean: weights.reduce((sum, weight, index) => sum + weight * shares[index], 0),
      weights,
    };
  };

  let result = meanFor(0);
  // Joint samples already carry their exact uniform mean. Tilting that same
  // mean through sixty bisections introduced rounding noise: eight equally
  // weighted outcomes became 7.999999999999998 effective outcomes and failed
  // the eight-outcome gate. Keep the original distribution when it matches to
  // numerical precision; different targets still use the calibrated weights.
  if (Math.abs(result.mean - target) <= 1e-12) {
    // Uniform weights are the exact lambda=0 solution.
  } else if (target > minimum + 1e-9 && target < maximum - 1e-9) {
    let low = -40;
    let high = 40;
    for (let step = 0; step < 60; step++) {
      const mid = (low + high) / 2;
      const probe = meanFor(mid);
      if (probe.mean < target) low = mid;
      else high = mid;
      result = probe;
    }
  } else if (target <= minimum) {
    result = meanFor(-40);
  } else if (target >= maximum) {
    result = meanFor(40);
  }
  const weightSquares = result.weights.reduce((sum, weight) => sum + weight * weight, 0);
  return {
    weights: result.weights,
    calibrationError: Math.abs(result.mean - target),
    effectiveSamples: weightSquares > 0 ? 1 / weightSquares : 0,
  };
}

function addMoment(moment: WeightedMoment, value: number, weight: number): void {
  moment.sum += value * weight;
  moment.square += value * value * weight;
}

function evaluateCandidate(args: {
  input: TournamentUtilityInput;
  candidate: ActionCandidate;
  field: FieldState;
  sampleWeights: number[];
  effectiveSamples: number;
  estimate: (vector: number[]) => Estimate;
  payoutWeight: number;
  futureDraws: Map<string, FutureHandDraw>;
  futureResults: FutureRolloutCache;
  vectorKey: (vector: number[], rounded: boolean) => string;
  plan: SettlementPlan;
}): CandidateEvaluation {
  const chipMoment = { sum: 0, square: 0 };
  const payoutMoment = { sum: 0, square: 0 };
  const bountyMoment = { sum: 0, square: 0 };
  const optionMoment = { sum: 0, square: 0 };
  const utilityMoment = { sum: 0, square: 0 };
  let bust = 0;
  let heroWin = 0;
  let bountyWin = 0;
  let allFold = 0;
  let sidePotCount = 0;
  let conservationError = 0;
  let icmError = 0;
  let shortStackCollision = 0;
  let coveredStacks = 0;
  let noFullBlindRaise = 0;
  let futureHands = 0;
  let futureLevelEnvelope = 0;
  let futureForcedPaid = 0;
  const methods = new Set<IcmMethod>();
  const vectors = new Set<string>();
  // tournamentUtilityStackScaledMargin: weighted moments of (hero's showdown share, utility) over the calibrated
  // samples, the sensitivity of this candidate's utility to hero's equity. Accumulated only with the option on.
  const stackScaled = args.input.stackScaledMargin === true;
  const tilt = { w: 0, s: 0, u: 0, su: 0, ss: 0, low: Infinity, high: -Infinity };
  // The blind-level bounds are fixed for the whole action. A rollout is
  // identified by its sample, its level's (smallBlind, bigBlind, ante,
  // anteType) and its settled local stacks; equal level fields share one
  // identity exactly as their formatted key did.
  const futureConfig = args.input.continuation?.futureHands;
  const futureLevels = futureConfig
    ? futureConfig.nextLevelDue
      ? futureConfig.levels.slice(-1)
      : futureConfig.levels
    : [];
  const levelIdentity = futureLevels.map(
    (level) => `${level.smallBlind}:${level.bigBlind}:${level.ante}:${level.anteType}`
  );
  const levelSlot = levelIdentity.map((key) => levelIdentity.indexOf(key));
  const candidateCache: CandidateSettlementCache = {
    contestablePotByMask: new Map(),
    potsByMask: new Map(),
  };

  for (let index = 0; index < args.input.showdownSamples.length; index++) {
    if (
      args.input.withinBudget?.() === false ||
      args.input.continuation?.withinBudget?.() === false
    ) {
      const work = args.input.continuation?.work;
      if (work && work.budgetStop === 'none') work.budgetStop = 'sample';
      return { ledger: null, unavailableReason: 'operation_budget' };
    }
    if (args.input.continuation?.work) args.input.continuation.work.samplesVisited++;
    const weight = args.sampleWeights[index] ?? 0;
    if (weight <= 0) continue;
    let branch = settleSample({
      plan: args.plan,
      candidateCache,
      input: args.input,
      field: args.field,
      candidate: args.candidate,
      sample: args.input.showdownSamples[index],
      sampleIndex: index,
      payoutWeight: args.payoutWeight,
    });
    if (!branch || branch.conservationError > EPS) {
      return { ledger: null, unavailableReason: 'candidate_settlement' };
    }
    // Every current-action branch funds its own future hand. Evaluate explicit
    // current/next-level bounds separately; their probabilities are unknown.
    // Select the conservative utility bound and include their span as model error.
    const future = args.input.continuation?.futureHands;
    let futureError = 0;
    let selectedForecast: Estimate | undefined;
    let selectedRecovery: OptionEstimate | undefined;
    if (future && !branch.heroBusted) {
      const levels = futureLevels;
      if (!levels.length || levels.length > 2)
        return { ledger: null, unavailableReason: 'candidate_settlement' };
      const bounds: Array<{
        branch: BranchResult;
        forecast: Estimate;
        recovery: OptionEstimate;
        utility: number;
        hands: number;
        forced: number;
      }> = [];
      // Both blind-level bounds start from the same settled snapshot. Check
      // its complete immutable field once before either rollout copies it.
      const branchKey = args.vectorKey(branch.vector, false);
      let branchRollouts = args.futureResults.get(branchKey);
      if (!branchRollouts) {
        branchRollouts = [];
        args.futureResults.set(branchKey, branchRollouts);
      }
      for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
        const level = levels[levelIndex];
        const rolloutSlot = index * 2 + levelSlot[levelIndex];
        const cachedRollout = branchRollouts[rolloutSlot];
        const work = args.input.continuation?.work;
        if (work) {
          if (cachedRollout) work.rolloutCacheHits++;
          else work.rollouts++;
        }
        const rollout =
          cachedRollout ??
          simulateTournamentFutureHands({
            players: args.input.players,
            vector: branch.vector,
            localIndex: args.field.localIndex,
            heroId: args.input.hero.user_id,
            dealerSeat: args.input.continuation!.dealerSeat,
            level,
            sampleIndex: index,
            withinBudget: args.input.continuation!.withinBudget,
            drawCache: args.futureDraws,
          });
        if (!rollout) {
          const expired = args.input.continuation?.withinBudget?.() === false;
          if (work && work.budgetStop === 'none' && expired) work.budgetStop = 'future_rollout';
          return {
            ledger: null,
            unavailableReason: expired ? 'operation_budget' : 'candidate_settlement',
          };
        }
        branchRollouts[rolloutSlot] = rollout;
        const next = {
          ...branch,
          vector: rollout.vector,
          heroFinalStack: rollout.vector[args.field.heroIndex],
          conservationError: Math.max(branch.conservationError, rollout.conservationError),
        };
        for (const event of rollout.eliminations) {
          if (event.userId === args.input.hero.user_id) {
            next.heroBusted = true;
            next.heroFinishedPaid = event.places.some(
              (place) => place <= args.input.context.payoutPct.length
            );
            next.realizedPayoutPct +=
              (event.places.reduce(
                (sum, place) => sum + (args.input.context.payoutPct[place - 1] ?? 0),
                0
              ) /
                event.places.length) *
              args.payoutWeight;
            next.bountyDeniedPct += currencyToPoolPct(
              args.input,
              branch.futureBountyHeads
                ? branch.futureBountyHeads[event.userId] * 0.5
                : ownBountyCents(args.input)
            );
          } else if (event.claimants.includes(args.input.hero.user_id)) {
            next.bountyWonPct +=
              currencyToPoolPct(
                args.input,
                branch.futureBountyHeads
                  ? branch.futureBountyHeads[event.userId] * 0.5
                  : targetBountyCents(args.input, event.userId)
              ) / event.claimants.length;
            next.wonBounty = true;
          }
        }
        const forecast = args.estimate(next.vector);
        const recovery = optionValue(
          args.input,
          args.field,
          next.vector,
          next.heroBusted,
          next.heroFinishedPaid,
          args.estimate
        );
        if (!recovery) return { ledger: null, unavailableReason: 'recovery_option' };
        bounds.push({
          branch: next,
          forecast,
          recovery,
          utility:
            forecast.payout +
            next.realizedPayoutPct +
            next.bountyWonPct -
            next.bountyDeniedPct +
            recovery.value,
          hands: rollout.hands,
          forced: rollout.forcedPaid[args.input.hero.user_id] ?? 0,
        });
      }
      bounds.sort((a, b) => a.utility - b.utility);
      futureError = bounds[bounds.length - 1].utility - bounds[0].utility;
      branch = bounds[0].branch;
      selectedForecast = bounds[0].forecast;
      selectedRecovery = bounds[0].recovery;
      futureHands += weight * bounds[0].hands;
      futureForcedPaid += weight * bounds[0].forced;
      futureLevelEnvelope = Math.max(futureLevelEnvelope, futureError);
    }
    // The selected bound already owns these exact values. Its vector is not
    // mutated after settlement; final accounting consumes that same bound.
    const icm = selectedForecast ?? args.estimate(branch.vector);
    const option =
      selectedRecovery ??
      optionValue(
        args.input,
        args.field,
        branch.vector,
        branch.heroBusted,
        branch.heroFinishedPaid,
        args.estimate
      );
    if (!option) return { ledger: null, unavailableReason: 'recovery_option' };
    const payout = icm.payout + branch.realizedPayoutPct;
    const bounty = branch.bountyWonPct - branch.bountyDeniedPct;
    const utility = payout + bounty + option.value;
    addMoment(chipMoment, branch.heroFinalStack, weight);
    addMoment(payoutMoment, payout, weight);
    addMoment(bountyMoment, bounty, weight);
    addMoment(optionMoment, option.value, weight);
    addMoment(utilityMoment, utility, weight);
    if (stackScaled) {
      const share = heroShareInSample(args.input, args.input.showdownSamples[index]!);
      tilt.w += weight;
      tilt.s += weight * share;
      tilt.u += weight * utility;
      tilt.su += weight * share * utility;
      tilt.ss += weight * share * share;
      tilt.low = Math.min(tilt.low, utility);
      tilt.high = Math.max(tilt.high, utility);
    }
    bust += weight * (branch.heroBusted ? 1 : 0);
    heroWin += weight * (branch.heroWon ? 1 : 0);
    bountyWin += weight * (branch.wonBounty ? 1 : 0);
    allFold += weight * (branch.allFold ? 1 : 0);
    shortStackCollision += weight * Number(branch.shortStackCollision);
    coveredStacks += weight * branch.coveredStacks;
    noFullBlindRaise +=
      weight * Number(branch.heroFinalStack <= (args.input.continuation?.bigBlind ?? 0));
    sidePotCount = Math.max(sidePotCount, branch.sidePotCount);
    conservationError = Math.max(conservationError, branch.conservationError);
    icmError = Math.max(icmError, icm.error + option.error + futureError);
    methods.add(icm.method);
    vectors.add(icm.vectorKey);
  }

  const variance = Math.max(0, utilityMoment.square - utilityMoment.sum ** 2);
  const standardError = Math.sqrt(variance / Math.max(1, args.effectiveSamples));
  const wholePoolUncertainty =
    Math.max(0, args.input.equityStandardError) * 100 * args.payoutWeight;
  let equityUncertainty = args.candidate.kind === 'fold' ? 0 : wholePoolUncertainty;
  if (stackScaled && args.candidate.kind !== 'fold' && tilt.w > 0 && tilt.high >= tilt.low) {
    // What a point of hero's equity moves in THIS candidate's utility: the regression slope of utility on hero's
    // showdown share, bounded by the utility span, and never wider than the whole-pool margin it replaces.
    const span = tilt.high - tilt.low;
    const meanShare = tilt.s / tilt.w;
    const varShare = tilt.ss / tilt.w - meanShare * meanShare;
    const covariance = tilt.su / tilt.w - meanShare * (tilt.u / tilt.w);
    const slope = varShare > 1e-9 ? Math.min(span, Math.abs(covariance) / varShare) : span;
    equityUncertainty = Math.min(
      wholePoolUncertainty,
      Math.max(0, args.input.equityStandardError) * slope
    );
  }
  const isTerminal = terminalForHero(args.input, args.candidate);
  const preflopNonTerminalSlack =
    args.input.v86AsymmetricIcmAndPreflop !== false &&
    args.input.street === 'preflop' &&
    !isTerminal &&
    !args.input.continuation
      ? Math.max(0, 1 - args.candidate.investment / Math.max(1, args.input.hero.stack)) *
        0.22 *
        Math.max(standardError, equityUncertainty, icmError)
      : 0;
  const confidenceHalfWidth =
    icmError +
    preflopNonTerminalSlack +
    CONFIDENCE_Z_999 * Math.max(standardError, equityUncertainty);
  // Receipt only (tournament_utility_stack_scaled_margin_changed_seen, 2026-11-18): the same half width with the
  // whole-pool margin, written exactly as the lines above evaluate it with the option off. Arithmetic on values
  // already computed; nothing above reads it.
  let unscaledHalfWidth = confidenceHalfWidth;
  if (stackScaled && args.candidate.kind !== 'fold' && equityUncertainty !== wholePoolUncertainty) {
    const unscaledSlack =
      args.input.v86AsymmetricIcmAndPreflop !== false &&
      args.input.street === 'preflop' &&
      !isTerminal &&
      !args.input.continuation
        ? Math.max(0, 1 - args.candidate.investment / Math.max(1, args.input.hero.stack)) *
          0.22 *
          Math.max(standardError, wholePoolUncertainty, icmError)
        : 0;
    unscaledHalfWidth =
      icmError + unscaledSlack + CONFIDENCE_Z_999 * Math.max(standardError, wholePoolUncertainty);
  }
  const ledger: HorseTournamentUtilityCandidateLedger = {
    id: args.candidate.id,
    action: args.candidate.action,
    amount: args.candidate.amount,
    investment: chips(args.candidate.investment),
    chipEv: Math.round((chipMoment.sum - args.input.hero.stack) * 100) / 100,
    payoutEv: payoutMoment.sum,
    bountyEv: bountyMoment.sum,
    optionEv: optionMoment.sum,
    combinedUtility: utilityMoment.sum,
    utilityStandardError: standardError,
    utilityConfidenceHalfWidth: confidenceHalfWidth,
    winProbability: clamp(heroWin, 0, 1),
    allFoldProbability: clamp(allFold, 0, 1),
    bustProbability: clamp(bust, 0, 1),
    bountyWinProbability: clamp(bountyWin, 0, 1),
    outcomeCount: args.input.showdownSamples.length,
    resultingStackVectors: vectors.size,
    terminalForHero: terminalForHero(args.input, args.candidate),
    sidePotCount,
    stackConservationError: conservationError,
    ...(args.input.continuation
      ? {
          continuation: {
            shortStackCollisionProbability: shortStackCollision,
            futureHands,
            futureForcedPaid,
            futureLevelUtilityEnvelope: futureLevelEnvelope,
            expectedRetainedStackBb: chipMoment.sum / args.input.continuation.bigBlind,
            expectedCoveredStacks: coveredStacks,
            noFullBlindRaiseProbability: noFullBlindRaise,
          },
        }
      : {}),
  };
  return { ledger, icmError, methods, unscaledHalfWidth, unavailableReason: null };
}

function strongestMethod(methods: Set<IcmMethod>): IcmMethod {
  return methods.has('plackett_luce_mc') ? 'plackett_luce_mc' : 'exact_mh';
}

function decisionFromCandidate(
  candidate: HorseTournamentUtilityCandidateLedger,
  toCall: number
): HorseDecision {
  if (candidate.action === 'bet' || candidate.action === 'raise') {
    return { action: candidate.action, amount: candidate.amount ?? undefined, thinkTime: 0 };
  }
  if (candidate.action === 'call') {
    return { action: 'call', amount: chips(toCall), thinkTime: 0 };
  }
  return { action: candidate.action, thinkTime: 0 };
}

function sameDecision(
  candidate: HorseTournamentUtilityCandidateLedger,
  baseline: HorseDecision
): boolean {
  if (candidate.action !== baseline.action) return false;
  if (candidate.action !== 'bet' && candidate.action !== 'raise') return true;
  return (
    typeof candidate.amount === 'number' &&
    typeof baseline.amount === 'number' &&
    Math.abs(candidate.amount - baseline.amount) <= EPS
  );
}

function terminalForHero(
  input: TournamentUtilityInput,
  candidate: ActionCandidate | HorseTournamentUtilityCandidateLedger
): boolean {
  if (candidate.action === 'fold' || candidate.investment >= input.hero.stack - EPS) return true;
  if (input.street !== 'river') return false;
  if (candidate.action !== 'check' && candidate.action !== 'call') return false;
  return !input.opponents.some((opponent) => opponent.actsAfterHero);
}

export function evaluateTournamentUtilityDetailed(
  input: TournamentUtilityInput
): TournamentUtilityEvaluation {
  return evaluateWithWorkspace(input);
}

function evaluateWithWorkspace(
  input: TournamentUtilityInput,
  workspace?: UtilityWorkspace
): TournamentUtilityEvaluation {
  const work = input.continuation?.work;
  if (work) work.attempts++;
  if (input.withinBudget?.() === false)
    return { result: null, unavailableReason: 'operation_budget' };
  if (!validateInput(input)) {
    return { result: null, unavailableReason: 'invalid_input' };
  }
  const actionCandidates = buildTournamentActionCandidates(input);
  if (work) {
    work.candidateCount = actionCandidates.length;
    work.outcomeSamples = input.showdownSamples.length;
    work.levelBounds = input.continuation?.futureHands
      ? input.continuation.futureHands.nextLevelDue
        ? 1
        : input.continuation.futureHands.levels.length
      : 0;
  }
  if (actionCandidates.length === 0) {
    return { result: null, unavailableReason: 'no_action_candidates' };
  }
  const field = workspace?.field ?? buildField(input);
  if (
    field.heroIndex < 0 ||
    field.fieldPlayersModeled !== field.fieldPlayersActual ||
    // The cached field is identityless and may predate chips moving between
    // two players at this table. Replacing those stale local entries is safe
    // when their aggregate is conserved; requiring every individual stack to
    // match made the arbiter dark after virtually every completed hand. A
    // changed aggregate (rebuy/add-on/roster lag or wrong reconciliation)
    // still fails closed.
    field.aggregateReconciliationErrorChips > EPS ||
    !Number.isFinite(field.conservationTarget)
  ) {
    return { result: null, unavailableReason: 'field_reconciliation' };
  }

  const payoutWeight = payoutPoolWeight(input);
  // A bounty event with no payout pool leaves chips without a modeled worth:
  // payout is weighted by zero and only the head won or lost in this hand is
  // counted. A stack that covers the table then scores every all-in as a free
  // shot at a head and every fold as nothing, so the arbiter turned folds of
  // 34o at 115 big blinds into all-ins (HVH2D-TRN-001, direction 2). Until
  // chips are valued as future head equity, the reference action stands.
  // The test is the weight itself, not the event type: whatever the event
  // awards (cash places, satellite tickets, which are paid out of the prize
  // pool), a payout weight of zero means this model would value all of it at
  // nothing, so it has no justified valuation to offer.
  if (payoutWeight <= 0) {
    return { result: null, unavailableReason: 'chip_value_not_modeled' };
  }
  const boundedFuture = Boolean(input.continuation?.futureHands);
  const localIndices = [...field.localIndex.values()].sort((a, b) => a - b);
  const localSet = new Set(localIndices);
  const remoteIndices = field.stacks.map((_, i) => i).filter((i) => !localSet.has(i));
  const vectorKey = (vector: number[], rounded: boolean) => {
    // The remote field is immutable within this action: only table-local
    // coordinates can distinguish valid vectors. Keep the full remote-field
    // mutation guard for continuation rollouts, and avoid formatting hundreds
    // of invariant remote stacks on every Phase 7 branch.
    if (boundedFuture) {
      if (vector.length !== field.stacks.length)
        throw new Error('Continuation changed the immutable remote field');
      for (let slot = 0; slot < remoteIndices.length; slot++) {
        const index = remoteIndices[slot];
        if (vector[index] !== field.stacks[index])
          throw new Error('Continuation changed the immutable remote field');
      }
    }
    const first = vector[localIndices[0]];
    let key = String(rounded ? Math.round(first * 100) / 100 : first);
    for (let slot = 1; slot < localIndices.length; slot++) {
      const value = vector[localIndices[slot]];
      key += `,${rounded ? Math.round(value * 100) / 100 : value}`;
    }
    return key;
  };
  const estimateCache = (!boundedFuture && workspace?.estimateCache) || new Map<string, Estimate>();
  const actionIcm =
    workspace?.actionIcm ||
    createIcmEquityEstimator(
      field.stacks,
      input.context.payoutPct,
      field.heroIndex,
      [...field.localIndex.values()],
      boundedFuture ? FUTURE_HAND_POLICY.maxIcmTrials : undefined
    );
  if (work) work.icmMethod = actionIcm.method;
  let operationBudgetHit = false;
  const estimate = (vector: number[]): Estimate => {
    const key = vectorKey(vector, true);
    const cached = estimateCache.get(key);
    if (cached) {
      if (work) work.estimateCacheHits++;
      return cached;
    }
    // A future hand can consume the continuation deadline after the sample's
    // initial check. Do not begin another ICM pass after that budget is spent.
    if (
      input.withinBudget?.() === false ||
      input.continuation?.withinBudget?.() === false ||
      estimateCache.size >= MAX_ACTION_ICM_VECTORS
    ) {
      operationBudgetHit = true;
      if (work && work.budgetStop === 'none') work.budgetStop = 'icm';
      return {
        vectorKey: key,
        equity: 0,
        equityError: Number.POSITIVE_INFINITY,
        payout: 0,
        error: Number.POSITIVE_INFINITY,
        method: actionIcm.method,
      };
    }
    // Phase 7 already generated these common clocks. A bounded prefix produces
    // the same Phase 8 estimates as a fresh workspace, with its wider error,
    // without rebuilding and sorting the entire remote field on the action clock.
    const icm = actionIcm.estimate(
      vector,
      boundedFuture ? FUTURE_HAND_POLICY.maxIcmTrials : undefined
    );
    if (work) {
      work.estimates++;
      work.icmMethod = actionIcm.method;
    }
    const result = {
      vectorKey: key,
      equity: icm.equity,
      equityError: icm.errorBound,
      payout: icm.equity * payoutWeight,
      error: icm.errorBound * payoutWeight,
      method: icm.method,
    };
    estimateCache.set(key, result);
    return result;
  };
  const calibrated = calibratedSampleWeights(input);
  if (
    calibrated.calibrationError > MAX_EQUITY_CALIBRATION_ERROR ||
    calibrated.effectiveSamples < MIN_EFFECTIVE_OUTCOMES
  ) {
    return { result: null, unavailableReason: 'sample_calibration' };
  }
  const futureDraws = new Map<string, FutureHandDraw>();
  const futureResults: FutureRolloutCache = new Map();
  const plan = settlementPlan(input, field);
  const candidateEvaluations = actionCandidates.map((candidate) => {
    const evaluated = evaluateCandidate({
      input,
      candidate,
      field,
      sampleWeights: calibrated.weights,
      effectiveSamples: calibrated.effectiveSamples,
      estimate,
      payoutWeight,
      futureDraws,
      futureResults,
      vectorKey,
      plan,
    });
    if (work && evaluated.unavailableReason === null) work.candidatesCompleted++;
    return evaluated;
  });
  if (operationBudgetHit) {
    return { result: null, unavailableReason: 'operation_budget' };
  }
  const failedCandidate = candidateEvaluations.find(
    (evaluation): evaluation is CandidateEvaluationFailure => evaluation.unavailableReason !== null
  );
  if (failedCandidate) {
    return { result: null, unavailableReason: failedCandidate.unavailableReason };
  }
  const evaluated = candidateEvaluations.filter(
    (evaluation): evaluation is CandidateEvaluationSuccess => evaluation.unavailableReason === null
  );

  const ranked = evaluated.slice().sort((left, right) => {
    const utility = right.ledger.combinedUtility - left.ledger.combinedUtility;
    if (Math.abs(utility) > 1e-10) return utility;
    if (objectiveOf(input.context) === 'satellite_seat_equity') {
      const survival = left.ledger.bustProbability - right.ledger.bustProbability;
      if (Math.abs(survival) > 1e-10) return survival;
      return left.ledger.investment - right.ledger.investment;
    }
    return right.ledger.chipEv - left.ledger.chipEv;
  });
  const baselineCandidate = evaluated.find((result) =>
    sameDecision(result.ledger, input.baseline)
  )?.ledger;
  if (!baselineCandidate) {
    return { result: null, unavailableReason: 'baseline_not_modeled' };
  }
  const minSizedPostflopBet =
    input.street !== 'preflop' &&
    input.bettingStructure !== 'fixed_limit' &&
    typeof input.maxRaiseTo === 'number' &&
    Number.isFinite(input.maxRaiseTo) &&
    typeof input.minRaiseTo === 'number' &&
    Number.isFinite(input.minRaiseTo) &&
    input.maxRaiseTo > input.minRaiseTo + EPS &&
    Number.isFinite(input.pot) &&
    input.pot > 0
      ? Math.min(input.maxRaiseTo, Math.max(input.minRaiseTo, input.pot * 0.25))
      : null;
  const nonTinyRanked =
    minSizedPostflopBet === null
      ? ranked
      : ranked.filter(
          (item) =>
            sameDecision(item.ledger, input.baseline) ||
            item.ledger.action !== 'bet' ||
            item.ledger.amount === null ||
            item.ledger.amount >= minSizedPostflopBet - EPS
        );
  let selected = (nonTinyRanked[0] ?? ranked[0]).ledger;
  let baselineRetainedForUncertainty = false;
  let baselineRetainedForContinuation = false;
  if (
    !sameDecision(selected, input.baseline) &&
    !selected.terminalForHero &&
    !input.continuation &&
    !(input.v86AsymmetricIcmAndPreflop !== false && input.street === 'preflop')
  ) {
    selected = baselineCandidate;
    baselineRetainedForContinuation = true;
  } else if (!sameDecision(selected, input.baseline)) {
    const selectedLower = selected.combinedUtility - selected.utilityConfidenceHalfWidth;
    const strongestAlternativeUpper = Math.max(
      ...evaluated
        .map((result) => result.ledger)
        .filter((candidate) => candidate.id !== selected.id)
        .map((candidate) => candidate.combinedUtility + candidate.utilityConfidenceHalfWidth)
    );
    if (selectedLower <= strongestAlternativeUpper) {
      selected = baselineCandidate;
      baselineRetainedForUncertainty = true;
    }
  }
  // Receipt only (tournamentUtilityStackScaledMargin, 2026-11-18): would the whole-pool margin (the option off)
  // have kept the baseline? The ranking and the continuation gate do not read any half width, and the scaled margin
  // is never wider than the whole-pool one, so the option changed this decision exactly when a non-baseline
  // candidate passed the uncertainty gate above and the same gate with the unscaled widths refuses it. An indexed
  // loop over the candidates already evaluated: no allocation, nothing above reads the result.
  let stackScaledMarginChangedDecision = false;
  if (input.stackScaledMargin === true && !sameDecision(selected, input.baseline)) {
    let selectedUnscaled = selected.utilityConfidenceHalfWidth;
    let alternativeUpperUnscaled = -Infinity;
    for (let index = 0; index < evaluated.length; index++) {
      const item = evaluated[index]!;
      if (item.ledger.id === selected.id) selectedUnscaled = item.unscaledHalfWidth;
      else
        alternativeUpperUnscaled = Math.max(
          alternativeUpperUnscaled,
          item.ledger.combinedUtility + item.unscaledHalfWidth
        );
    }
    stackScaledMarginChangedDecision =
      selected.combinedUtility - selectedUnscaled <= alternativeUpperUnscaled;
  }

  const methods = new Set<IcmMethod>();
  let icmErrorBound = 0;
  let reconciliationError = 0;
  for (const item of evaluated) {
    for (const method of item.methods) methods.add(method);
    icmErrorBound = Math.max(icmErrorBound, item.icmError);
    reconciliationError = Math.max(
      reconciliationError,
      Math.abs(
        item.ledger.combinedUtility -
          (item.ledger.payoutEv + item.ledger.bountyEv + item.ledger.optionEv)
      )
    );
  }

  const decision = decisionFromCandidate(selected, input.toCall);
  const ledger: HorseTournamentUtilityLedger = {
    schemaVersion: 1,
    evidence: buildHorseTournamentUtilityEvidence(input, input.observations),
    model: input.continuation
      ? 'horse-tournament-utility-phase8-round1'
      : 'horse-tournament-utility-phase7-round1',
    outcomeModel: input.continuation
      ? 'conditioned_public_street_continuation'
      : 'conditioned_showdown_samples',
    objective: objectiveOf(input.context),
    utilityUnit: 'total_funded_pool_pct',
    chipEvUnit: 'tournament_chips',
    baselineAction: input.baseline.action,
    baselineAmount:
      typeof input.baseline.amount === 'number' && Number.isFinite(input.baseline.amount)
        ? input.baseline.amount
        : null,
    selectedAction: decision.action,
    selectedAmount:
      typeof decision.amount === 'number' && Number.isFinite(decision.amount)
        ? decision.amount
        : null,
    executedAction: null,
    executedAmount: null,
    executionStatus: 'pending',
    overrodeBaseline: !sameDecision(selected, input.baseline),
    baselineRetainedForUncertainty,
    baselineRetainedForContinuation,
    sidePotCount: evaluated.reduce(
      (maximum, item) => Math.max(maximum, item.ledger.sidePotCount),
      input.pots.length
    ),
    playersBehind: input.opponents
      .filter((opponent) => opponent.actsAfterHero)
      .map((opponent) => opponent.userId),
    coveringPlayers: input.players
      .filter(
        (player) =>
          player.user_id !== input.hero.user_id &&
          !player.is_folded &&
          (!player.is_sitting_out || player.is_all_in) &&
          player.stack + player.totalInvested >= input.hero.stack + input.hero.totalInvested - EPS
      )
      .map((player) => player.user_id),
    conditionedOpponentRanges: input.opponents.filter((opponent) => opponent.range !== null).length,
    equitySampleSize: Math.max(0, Math.floor(input.equitySampleSize)),
    utilityOutcomeSamples: input.showdownSamples.length,
    equityStandardError: Math.max(0, input.equityStandardError),
    equityCalibrationError: calibrated.calibrationError,
    effectiveOutcomeSamples: calibrated.effectiveSamples,
    fieldPlayersActual: field.fieldPlayersActual,
    fieldPlayersModeled: field.fieldPlayersModeled,
    fieldReconciliationErrorChips: field.reconciliationErrorChips,
    icmMethod: strongestMethod(methods),
    icmErrorBound,
    componentReconciliationError: reconciliationError,
    candidates: evaluated.map((item) => item.ledger),
  };
  return {
    result: { decision, ledger },
    unavailableReason: null,
    stackScaledMarginChangedDecision,
    continuePostflop: (baseline, continuation, maxSamples) =>
      evaluateWithWorkspace(
        {
          ...input,
          baseline,
          continuation,
          showdownSamples: selectContinuationSamples(input.showdownSamples, maxSamples),
        },
        { field, estimateCache, actionIcm }
      ),
  };
}

export function evaluateTournamentUtility(input: TournamentUtilityInput): {
  decision: HorseDecision;
  ledger: HorseTournamentUtilityLedger;
} | null {
  return evaluateTournamentUtilityDetailed(input).result;
}
