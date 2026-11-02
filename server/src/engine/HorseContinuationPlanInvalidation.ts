import {
  horsePlanBatchBindingIsValid,
  type HorsePlanBatchBinding,
} from './HorsePlanHandIdentity.js';

export type ContinuationResponseBranch =
  | 'check'
  | 'call'
  | 'raise_small'
  | 'raise_half_pot'
  | 'raise_pot'
  | 'raise_all_in';

export type ContinuationPlanInvalidationReason =
  | 'action_not_accepted'
  | 'hand_mismatch'
  | 'actor_mismatch'
  | 'street_regression'
  | 'runout_invalidated'
  | 'player_count_changed'
  | 'sizing_out_of_band'
  | 'stack_exposure_changed'
  | 'plan_expired';

export interface ContinuationResponseRule {
  readonly branch: ContinuationResponseBranch;
  readonly action: 'check' | 'call' | 'bet' | 'raise' | 'fold';
  readonly sizingFractionOfPot: number;
  readonly minFacingFractionOfPot: number;
  readonly maxFacingFractionOfPot: number;
  readonly maxEffectiveSpr: number;
  readonly requiresIntactNutAdvantage: boolean;
}

export interface ExplicitContinuationPlanV2 {
  readonly planVersion: 'horse-continuation-plan-v2';
  readonly createdAtMs: number;
  readonly maxAgeMs: number;
  readonly handNumber: number;
  readonly handId: string | null;
  readonly tableId: string | null;
  readonly actorId: string;
  readonly createdStreet: 'FLOP' | 'TURN';
  readonly targetStreet: 'TURN' | 'RIVER';
  readonly binding: HorsePlanBatchBinding;
  readonly plannedOriginAction: 'fold' | 'check' | 'call' | 'bet' | 'raise';
  readonly plannedOriginAmount: number | null;
  readonly expectedMaxActivePlayers: number;
  readonly baselineEffectiveSpr: number;
  readonly maxSprDeviationRatio: number;
  readonly invalidateOnFlushComplete: boolean;
  readonly invalidateOnBoardPair: boolean;
  readonly invalidateOnLowComplete: boolean;
  readonly invalidateOnNutCounterfeit: boolean;
  readonly responses: Readonly<Record<ContinuationResponseBranch, ContinuationResponseRule>>;
}

export interface ContinuationTurnObservation {
  readonly observedAtMs: number;
  readonly handNumber: number;
  readonly handId: string | null;
  readonly tableId: string | null;
  readonly actorId: string;
  readonly currentStreet: 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER';
  readonly activePlayerCount: number;
  readonly potSize: number;
  readonly facingBetAmount: number;
  readonly effectiveRemainingStack: number;
  readonly opponentAction: 'check' | 'call' | 'bet' | 'raise';
  readonly opponentAllIn: boolean;
  readonly boardFlushCompletedSincePlan: boolean;
  readonly boardPairedSincePlan: boolean;
  readonly boardLowCompletedSincePlan: boolean;
  readonly heroNutCounterfeitedSincePlan: boolean;
  readonly controllerAcceptedOriginAction: boolean;
  readonly controllerAcceptedActionType: 'fold' | 'check' | 'call' | 'bet' | 'raise' | null;
  readonly controllerAcceptedAmount: number | null;
}

export interface ContinuationPlanEvaluationResult {
  readonly valid: boolean;
  readonly selectedBranch: ContinuationResponseBranch | null;
  readonly recommendedAction: 'check' | 'call' | 'bet' | 'raise' | 'fold' | null;
  readonly recommendedSizingFractionOfPot: number | null;
  readonly invalidationReasons: readonly ContinuationPlanInvalidationReason[];
}

const STREET_ORDER: Readonly<Record<'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER', number>> = {
  PREFLOP: 0,
  FLOP: 1,
  TURN: 2,
  RIVER: 3,
};

/**
 * Classifies an opponent action + facing bet size into one of the six explicit
 * continuation response branches (`check`, `call`, `raise_small`, `raise_half_pot`,
 * `raise_pot`, `raise_all_in`).
 */
export function classifyOpponentContinuationBranch(
  opponentAction: 'check' | 'call' | 'bet' | 'raise',
  facingBetAmount: number,
  potSize: number,
  opponentAllIn: boolean,
  effectiveRemainingStack: number
): ContinuationResponseBranch {
  if (opponentAction === 'check' && facingBetAmount <= 0) {
    return 'check';
  }
  if (opponentAction === 'call' && facingBetAmount <= 0) {
    return 'call';
  }
  const safePot = Math.max(1, potSize);
  const facingFraction = Math.max(0, facingBetAmount) / safePot;
  if (
    opponentAllIn ||
    (effectiveRemainingStack > 0 && facingBetAmount >= effectiveRemainingStack * 0.85) ||
    facingFraction > 1.15
  ) {
    return 'raise_all_in';
  }
  if (facingFraction <= 0.4) {
    return 'raise_small';
  }
  if (facingFraction <= 0.75) {
    return 'raise_half_pot';
  }
  return 'raise_pot';
}

/**
 * Evaluates whether an `ExplicitContinuationPlanV2` remains valid on the current
 * street and turn, returning either the deterministic response branch or all
 * applicable invalidation reasons (`action_not_accepted`, `runout_invalidated`,
 * `player_count_changed`, `sizing_out_of_band`, `stack_exposure_changed`, etc.).
 */
export function evaluateExplicitContinuationPlanV2(
  plan: ExplicitContinuationPlanV2,
  observation: ContinuationTurnObservation
): ContinuationPlanEvaluationResult {
  const reasons: ContinuationPlanInvalidationReason[] = [];

  // 1. Verify original controller action acceptance & exact batch binding
  if (
    !horsePlanBatchBindingIsValid(plan.binding) ||
    !observation.controllerAcceptedOriginAction ||
    observation.controllerAcceptedActionType !== plan.plannedOriginAction ||
    (plan.plannedOriginAmount !== null &&
      (observation.controllerAcceptedAmount === null ||
        Math.abs(observation.controllerAcceptedAmount - plan.plannedOriginAmount) > 1e-6))
  ) {
    reasons.push('action_not_accepted');
  }

  // 2. Verify hand and table identity match
  const handMatches =
    plan.handId !== null && observation.handId !== null
      ? plan.handId === observation.handId
      : plan.handNumber === observation.handNumber &&
        (plan.tableId === null ||
          observation.tableId === null ||
          plan.tableId === observation.tableId);
  if (!handMatches) {
    reasons.push('hand_mismatch');
  }

  // 3. Verify actor identity match
  if (plan.actorId !== observation.actorId || plan.binding.actorId !== observation.actorId) {
    reasons.push('actor_mismatch');
  }

  // 4. Verify street progression
  if (STREET_ORDER[observation.currentStreet] <= STREET_ORDER[plan.createdStreet]) {
    reasons.push('street_regression');
  }

  // 5. Verify plan age
  if (
    plan.maxAgeMs > 0 &&
    observation.observedAtMs > plan.createdAtMs &&
    observation.observedAtMs - plan.createdAtMs > plan.maxAgeMs
  ) {
    reasons.push('plan_expired');
  }

  // 6. Verify board runout contingencies (flush completion, board pair, low completion, counterfeit)
  if (
    (plan.invalidateOnFlushComplete && observation.boardFlushCompletedSincePlan) ||
    (plan.invalidateOnBoardPair && observation.boardPairedSincePlan) ||
    (plan.invalidateOnLowComplete && observation.boardLowCompletedSincePlan) ||
    (plan.invalidateOnNutCounterfeit && observation.heroNutCounterfeitedSincePlan)
  ) {
    reasons.push('runout_invalidated');
  }

  // 7. Verify active player count / multiway contention
  if (
    observation.activePlayerCount > plan.expectedMaxActivePlayers ||
    observation.activePlayerCount < 2
  ) {
    reasons.push('player_count_changed');
  }

  const branch = classifyOpponentContinuationBranch(
    observation.opponentAction,
    observation.facingBetAmount,
    observation.potSize,
    observation.opponentAllIn,
    observation.effectiveRemainingStack
  );
  const rule = plan.responses[branch];

  // 8. Verify facing bet sizing is within the rule's planned fraction band
  const safePot = Math.max(1, observation.potSize);
  const facingFraction = Math.max(0, observation.facingBetAmount) / safePot;
  if (
    facingFraction < rule.minFacingFractionOfPot - 1e-6 ||
    facingFraction > rule.maxFacingFractionOfPot + 1e-6
  ) {
    reasons.push('sizing_out_of_band');
  }

  // 9. Verify effective stack-to-pot ratio (SPR) and stack exposure
  const currentSpr = Math.max(0, observation.effectiveRemainingStack) / safePot;
  const sprDeviationRatio =
    plan.baselineEffectiveSpr > 0
      ? Math.abs(currentSpr - plan.baselineEffectiveSpr) / plan.baselineEffectiveSpr
      : 0;
  if (
    currentSpr > rule.maxEffectiveSpr + 1e-6 ||
    (plan.maxSprDeviationRatio > 0 && sprDeviationRatio > plan.maxSprDeviationRatio + 1e-6)
  ) {
    reasons.push('stack_exposure_changed');
  }

  // 10. If the selected branch requires intact nut advantage and nut was counterfeited or flush/low completed
  if (
    rule.requiresIntactNutAdvantage &&
    (observation.heroNutCounterfeitedSincePlan ||
      observation.boardFlushCompletedSincePlan ||
      observation.boardLowCompletedSincePlan) &&
    !reasons.includes('runout_invalidated')
  ) {
    reasons.push('runout_invalidated');
  }

  if (reasons.length > 0) {
    return {
      valid: false,
      selectedBranch: null,
      recommendedAction: null,
      recommendedSizingFractionOfPot: null,
      invalidationReasons: reasons,
    };
  }

  return {
    valid: true,
    selectedBranch: branch,
    recommendedAction: rule.action,
    recommendedSizingFractionOfPot: rule.sizingFractionOfPot,
    invalidationReasons: [],
  };
}

export interface ContinuationContenderFingerprint {
  readonly activeContenderIds: readonly string[];
  readonly activeContenderCount: number;
  readonly effectiveStackBb: number;
  readonly potBb: number;
  readonly effectiveSpr: number;
}

export interface MultiStreetBarrelEvaluation {
  readonly canContinuePlan: boolean;
  readonly selectedCardClass: 'good' | 'blank' | 'scare';
  readonly winningBranchReason:
    | 'improved_on_good_card'
    | 'continued_on_blank'
    | 'checked_scare_card'
    | 'aborted_multiway_contender_shift'
    | 'aborted_stack_exposure_shift'
    | 'aborted_scare_under_pressure';
  readonly invalidationReasons: readonly ContinuationPlanInvalidationReason[];
}

/**
 * Computes a deterministic multi-street contender & stack-exposure fingerprint
 * so a flop continuation plan can detect when a third player stays in or when
 * effective stack-to-pot exposure shifts materially on the turn/river.
 */
export function computeContinuationContenderFingerprint(
  contenderIds: readonly string[],
  effectiveStackChips: number,
  potChips: number,
  bigBlindChips: number
): ContinuationContenderFingerprint {
  const safeBb = Math.max(1, bigBlindChips);
  const sortedIds = [
    ...new Set(contenderIds.filter((id) => typeof id === 'string' && id.length > 0)),
  ].sort();
  const safePot = Math.max(1, potChips);
  const clampedStack = Math.max(0, effectiveStackChips);
  return {
    activeContenderIds: sortedIds,
    activeContenderCount: sortedIds.length,
    effectiveStackBb: clampedStack / safeBb,
    potBb: safePot / safeBb,
    effectiveSpr: clampedStack / safePot,
  };
}

/**
 * Evaluates a multi-street barrel continuation across street transitions,
 * combining `NextCardOutlook` classification (`good`, `blank`, `scare`) with
 * contender-set and effective-SPR invalidation guards and returning an explicit
 * `winningBranchReason` for decision telemetry.
 */
export function evaluateMultiStreetBarrelContinuation(params: {
  readonly plannedFingerprint: ContinuationContenderFingerprint;
  readonly currentFingerprint: ContinuationContenderFingerprint;
  readonly cardKey: string;
  readonly goodCards: readonly string[];
  readonly scareCards: readonly string[];
  readonly facingBetChips: number;
  readonly maxSprDeviationRatio?: number;
}): MultiStreetBarrelEvaluation {
  const reasons: ContinuationPlanInvalidationReason[] = [];
  const maxSprDev = params.maxSprDeviationRatio ?? 0.65;

  const selectedCardClass: 'good' | 'blank' | 'scare' = params.goodCards.includes(params.cardKey)
    ? 'good'
    : params.scareCards.includes(params.cardKey)
      ? 'scare'
      : 'blank';

  // Contender count increase or new unexpected contender invalidates a heads-up barrel plan
  const unexpectedContender = params.currentFingerprint.activeContenderIds.some(
    (id) => !params.plannedFingerprint.activeContenderIds.includes(id)
  );
  if (
    params.currentFingerprint.activeContenderCount >
      params.plannedFingerprint.activeContenderCount ||
    unexpectedContender ||
    params.currentFingerprint.activeContenderCount < 2
  ) {
    reasons.push('player_count_changed');
  }

  const sprDelta =
    params.plannedFingerprint.effectiveSpr > 0
      ? Math.abs(params.currentFingerprint.effectiveSpr - params.plannedFingerprint.effectiveSpr) /
        params.plannedFingerprint.effectiveSpr
      : 0;
  if (maxSprDev > 0 && sprDelta > maxSprDev + 1e-6) {
    reasons.push('stack_exposure_changed');
  }

  if (selectedCardClass === 'scare' && params.facingBetChips > 0) {
    reasons.push('runout_invalidated');
  }

  if (reasons.includes('player_count_changed')) {
    return {
      canContinuePlan: false,
      selectedCardClass,
      winningBranchReason: 'aborted_multiway_contender_shift',
      invalidationReasons: reasons,
    };
  }
  if (reasons.includes('stack_exposure_changed')) {
    return {
      canContinuePlan: false,
      selectedCardClass,
      winningBranchReason: 'aborted_stack_exposure_shift',
      invalidationReasons: reasons,
    };
  }
  if (reasons.includes('runout_invalidated')) {
    return {
      canContinuePlan: false,
      selectedCardClass,
      winningBranchReason: 'aborted_scare_under_pressure',
      invalidationReasons: reasons,
    };
  }

  return {
    canContinuePlan: selectedCardClass !== 'scare',
    selectedCardClass,
    winningBranchReason:
      selectedCardClass === 'good'
        ? 'improved_on_good_card'
        : selectedCardClass === 'blank'
          ? 'continued_on_blank'
          : 'checked_scare_card',
    invalidationReasons: [],
  };
}
