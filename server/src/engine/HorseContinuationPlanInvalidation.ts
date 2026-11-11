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

// ═══════════════════════════════════════════════════════════════════════════
// WAVE 1 MULTI-STREET GEOMETRIC SIZING, ARCHETYPES & DYNAMIC RE-EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

export type MultiStreetLineArchetype =
  | 'value_geometric'
  | 'value_pot_control'
  | 'semibluff_barrel'
  | 'blocker_triple_barrel'
  | 'oop_check_raise_trap'
  | 'ip_float_takeaway'
  | 'delayed_turn_probe';

export interface GeometricSizingInput {
  readonly pot: number;
  readonly effectiveStack: number;
  readonly streetsRemaining: 1 | 2 | 3;
  readonly isPotLimit: boolean;
  readonly minFraction?: number;
  readonly maxFraction?: number;
}

export interface GeometricSizingPlan {
  readonly fractionOfPot: number;
  readonly targetBetChips: number;
  readonly commitsAllInNow: boolean;
  readonly projectedRemainingSpr: number;
}

/**
 * Solves exact multi-street geometric bet sizing `(1 + 2f)^k = 1 + 2 * SPR`
 * across `k = streetsRemaining` (`3` on flop, `2` on turn, `1` on river),
 * obeying Pot-Limit caps (`f <= 1.0`) and eliminating awkward `0.08..0.28 SPR`
 * micro-stubs left behind for the next street.
 */
export function solveGeometricStreetSizing(input: GeometricSizingInput): GeometricSizingPlan {
  const safePot = Math.max(1, input.pot);
  const effStack = Math.max(0, input.effectiveStack);
  const spr = effStack / safePot;
  if (spr <= 0) {
    return {
      fractionOfPot: 0,
      targetBetChips: 0,
      commitsAllInNow: false,
      projectedRemainingSpr: 0,
    };
  }

  const minFrac = Math.max(0.2, input.minFraction ?? 0.28);
  const maxAllowed = input.isPotLimit
    ? Math.min(1.0, input.maxFraction ?? 1.0)
    : Math.max(minFrac, input.maxFraction ?? 1.5);

  // In No-Limit at shallow SPR (`<= 1.35` with 1-2 streets left), shoving immediately avoids tiny stubs:
  if (!input.isPotLimit && spr <= 1.35 && input.streetsRemaining <= 2) {
    return {
      fractionOfPot: spr,
      targetBetChips: effStack,
      commitsAllInNow: true,
      projectedRemainingSpr: 0,
    };
  }

  const k = Math.max(1, Math.min(3, input.streetsRemaining));
  const rawGeometric = (Math.pow(1 + 2 * spr, 1 / k) - 1) / 2;
  let frac = Math.max(minFrac, Math.min(maxAllowed, rawGeometric));

  let targetBet = frac * safePot;
  let remaining = Math.max(0, effStack - targetBet);
  let nextPot = safePot + 2 * targetBet;
  let nextSpr = nextPot > 0 ? remaining / nextPot : 0;

  // Eliminate awkward `0.01 .. 0.28 SPR` next-street stubs when at least one later street remains (`k >= 2`):
  if (k >= 2 && nextSpr > 0 && nextSpr <= 0.28) {
    if (!input.isPotLimit && spr <= maxAllowed) {
      return {
        fractionOfPot: spr,
        targetBetChips: effStack,
        commitsAllInNow: true,
        projectedRemainingSpr: 0,
      };
    }
    if (input.isPotLimit && spr <= 1.0) {
      return {
        fractionOfPot: spr,
        targetBetChips: effStack,
        commitsAllInNow: true,
        projectedRemainingSpr: 0,
      };
    }
    // Otherwise trim current street slightly (`~0.50-0.58 pot`) so next street retains a clean `>= 0.35 SPR` shove:
    const targetNextSpr = 0.36;
    // Solve `(effStack - f*P) / (P + 2*f*P) = targetNextSpr` => `f = (spr - targetNextSpr) / (1 + 2*targetNextSpr)`
    const trimmed = (spr - targetNextSpr) / (1 + 2 * targetNextSpr);
    if (trimmed >= minFrac) {
      frac = Math.min(maxAllowed, trimmed);
      targetBet = frac * safePot;
      remaining = Math.max(0, effStack - targetBet);
      nextPot = safePot + 2 * targetBet;
      nextSpr = nextPot > 0 ? remaining / nextPot : 0;
    }
  }

  const commitsAllInNow = targetBet >= effStack * 0.96;
  if (commitsAllInNow) {
    targetBet = effStack;
    frac = spr;
    nextSpr = 0;
  }

  return {
    fractionOfPot: frac,
    targetBetChips: targetBet,
    commitsAllInNow,
    projectedRemainingSpr: nextSpr,
  };
}

export interface DynamicPlanBuilderInput {
  readonly createdAtMs: number;
  readonly handNumber: number;
  readonly handId: string | null;
  readonly tableId: string | null;
  readonly actorId: string;
  readonly createdStreet: 'FLOP' | 'TURN';
  readonly binding?: HorsePlanBatchBinding;
  readonly plannedOriginAction: 'check' | 'call' | 'bet' | 'raise';
  readonly plannedOriginAmount: number | null;
  readonly archetype: MultiStreetLineArchetype;
  readonly activePlayerCount: number;
  readonly pot: number;
  readonly effectiveStack: number;
  readonly isPotLimit: boolean;
  readonly hasNutAdvantage: boolean;
  readonly vulnerableToFlush: boolean;
  readonly vulnerableToPair: boolean;
  readonly vulnerableToLow?: boolean;
}

export interface DynamicMultiStreetPlan {
  readonly archetype: MultiStreetLineArchetype;
  readonly v2: ExplicitContinuationPlanV2;
  readonly turnTargetFraction: number;
  readonly riverTargetFraction: number;
}

/**
 * Constructs an explicit Flop->Turn->River `DynamicMultiStreetPlan` wrapping
 * `ExplicitContinuationPlanV2` with geometric sizing targets and contingency rules.
 */
export function buildExplicitContinuationPlanV2(
  input: DynamicPlanBuilderInput
): DynamicMultiStreetPlan {
  const safePot = Math.max(1, input.pot);
  const spr = Math.max(0, input.effectiveStack) / safePot;
  const streetsLeft: 1 | 2 = input.createdStreet === 'FLOP' ? 2 : 1;
  const geom = solveGeometricStreetSizing({
    pot: safePot,
    effectiveStack: input.effectiveStack,
    streetsRemaining: streetsLeft,
    isPotLimit: input.isPotLimit,
    minFraction: input.archetype === 'value_pot_control' ? 0.33 : 0.45,
    maxFraction: input.isPotLimit ? 1.0 : 1.25,
  });

  const baseBarrelFrac =
    input.archetype === 'value_pot_control'
      ? Math.min(0.5, geom.fractionOfPot)
      : input.archetype === 'ip_float_takeaway' || input.archetype === 'delayed_turn_probe'
        ? Math.min(0.7, Math.max(0.52, geom.fractionOfPot))
        : geom.fractionOfPot;

  const isTrapOrCommit =
    input.archetype === 'value_geometric' || input.archetype === 'oop_check_raise_trap';

  const responses: Record<ContinuationResponseBranch, ContinuationResponseRule> = {
    check: {
      branch: 'check',
      action: input.archetype === 'value_pot_control' && !input.hasNutAdvantage ? 'check' : 'bet',
      sizingFractionOfPot: baseBarrelFrac,
      minFacingFractionOfPot: 0,
      maxFacingFractionOfPot: 0.01,
      maxEffectiveSpr: Math.max(20, spr * 2.5 + 4),
      requiresIntactNutAdvantage: input.archetype === 'blocker_triple_barrel',
    },
    call: {
      branch: 'call',
      action: input.archetype === 'value_pot_control' ? 'check' : 'bet',
      sizingFractionOfPot: baseBarrelFrac,
      minFacingFractionOfPot: 0,
      maxFacingFractionOfPot: 0.01,
      maxEffectiveSpr: Math.max(20, spr * 2.5 + 4),
      requiresIntactNutAdvantage: false,
    },
    raise_small: {
      branch: 'raise_small',
      action: isTrapOrCommit ? 'raise' : 'call',
      sizingFractionOfPot: input.isPotLimit ? 0.85 : 0.75,
      minFacingFractionOfPot: 0.01,
      maxFacingFractionOfPot: 0.42,
      maxEffectiveSpr: Math.max(20, spr * 2.5 + 4),
      requiresIntactNutAdvantage: false,
    },
    raise_half_pot: {
      branch: 'raise_half_pot',
      action:
        input.archetype === 'oop_check_raise_trap'
          ? 'raise'
          : input.archetype === 'blocker_triple_barrel'
            ? 'fold'
            : 'call',
      sizingFractionOfPot: input.isPotLimit ? 1.0 : 0.85,
      minFacingFractionOfPot: 0.38,
      maxFacingFractionOfPot: 0.78,
      maxEffectiveSpr: Math.max(20, spr * 2.5 + 4),
      requiresIntactNutAdvantage: input.archetype === 'oop_check_raise_trap',
    },
    raise_pot: {
      branch: 'raise_pot',
      action: isTrapOrCommit && input.hasNutAdvantage ? 'raise' : 'call',
      sizingFractionOfPot: 1.0,
      minFacingFractionOfPot: 0.72,
      maxFacingFractionOfPot: 1.2,
      maxEffectiveSpr: Math.max(20, spr * 2.5 + 4),
      requiresIntactNutAdvantage: true,
    },
    raise_all_in: {
      branch: 'raise_all_in',
      action: isTrapOrCommit && input.hasNutAdvantage ? 'call' : 'fold',
      sizingFractionOfPot: 1.0,
      minFacingFractionOfPot: 0.5,
      maxFacingFractionOfPot: 50,
      maxEffectiveSpr: Math.max(20, spr * 2.5 + 4),
      requiresIntactNutAdvantage: true,
    },
  };

  const v2: ExplicitContinuationPlanV2 = {
    planVersion: 'horse-continuation-plan-v2',
    createdAtMs: input.createdAtMs,
    maxAgeMs: 180_000,
    handNumber: input.handNumber,
    handId: input.handId,
    tableId: input.tableId,
    actorId: input.actorId,
    createdStreet: input.createdStreet,
    targetStreet: input.createdStreet === 'FLOP' ? 'TURN' : 'RIVER',
    binding: input.binding ?? {
      version: 'horse-plan-batch-v1',
      fastRequestId: 1,
      generation: 0,
      fence: 'local',
      decisionKey: `phase5-v1:${'0'.repeat(64)}`,
      actorId: input.actorId || 'hero',
      seat: 1,
      street: input.createdStreet === 'FLOP' ? 'flop' : 'turn',
      planContext: { version: 1, hand: null },
    },
    plannedOriginAction: input.plannedOriginAction,
    plannedOriginAmount: input.plannedOriginAmount,
    expectedMaxActivePlayers: Math.max(2, input.activePlayerCount),
    baselineEffectiveSpr: spr,
    maxSprDeviationRatio: 0.85,
    invalidateOnFlushComplete: input.vulnerableToFlush,
    invalidateOnBoardPair: input.vulnerableToPair,
    invalidateOnLowComplete: input.vulnerableToLow ?? false,
    invalidateOnNutCounterfeit: true,
    responses,
  };

  return {
    archetype: input.archetype,
    v2,
    turnTargetFraction: baseBarrelFrac,
    riverTargetFraction: Math.min(input.isPotLimit ? 1.0 : 1.15, baseBarrelFrac * 1.1),
  };
}

export interface DynamicNodeReevaluationInput {
  readonly archetype: MultiStreetLineArchetype | null;
  readonly street: 'flop' | 'turn' | 'river';
  readonly facingBetChips: number;
  readonly potBeforeBet: number;
  readonly effectiveStackChips: number;
  readonly isPotLimit: boolean;
  readonly equity: number;
  readonly potOdds: number;
  readonly hasCurrentNuts: boolean;
  readonly hasNutRedraw: boolean;
  readonly certifiedNutBlocker: boolean;
  readonly villainRangeCapped: boolean;
  readonly multiwayIncreased: boolean;
  readonly facingUnexpectedRaise: boolean;
  readonly facingUnexpectedDonk: boolean;
  readonly cardClass: 'good' | 'blank' | 'scare';
}

export type DynamicNodeDirective =
  | 'execute_planned_barrel'
  | 'execute_float_takeaway'
  | 'execute_check_raise_trap'
  | 'attack_small_donk'
  | 'defend_polar_donk'
  | 'scare_nut_blocker_barrel'
  | 'pivot_pot_control_check'
  | 'reraise_commit_value'
  | 'call_unexpected_raise_priced'
  | 'fold_unexpected_raise_unpriced'
  | 'abort_multiway_air';

export interface DynamicNodeReevaluationResult {
  readonly reevaluated: boolean;
  readonly directive: DynamicNodeDirective;
  readonly recommendedSizingFraction: number;
  readonly reason: string;
}

/**
 * Dynamically re-evaluates the multi-street continuation plan on any unexpected
 * mid-street or cross-street action (check-raise, multiway cold-call, small vs
 * polar donk lead, scare runout, or capped check-through) so the horse neither
 * blindly executes a stale plan nor throws away forward lookahead.
 */
export function reevaluateDynamicContinuationNode(
  input: DynamicNodeReevaluationInput
): DynamicNodeReevaluationResult {
  const safePot = Math.max(1, input.potBeforeBet);
  const facingFrac = input.facingBetChips > 0 ? input.facingBetChips / safePot : 0;
  const streetsLeft: 1 | 2 | 3 = input.street === 'flop' ? 3 : input.street === 'turn' ? 2 : 1;
  const geom = solveGeometricStreetSizing({
    pot: safePot + input.facingBetChips,
    effectiveStack: Math.max(0, input.effectiveStackChips - input.facingBetChips),
    streetsRemaining: streetsLeft,
    isPotLimit: input.isPotLimit,
  });

  // 1. Unexpected raise / check-raise on current street: NEVER blindly auto-fold!
  if (input.facingUnexpectedRaise && input.facingBetChips > 0) {
    const sprAfterCall =
      Math.max(0, input.effectiveStackChips - input.facingBetChips) /
      Math.max(1, safePot + 2 * input.facingBetChips);
    if (
      input.hasCurrentNuts ||
      (input.equity >= 0.62 && (input.hasNutRedraw || sprAfterCall <= 1.2))
    ) {
      return {
        reevaluated: true,
        directive: 'reraise_commit_value',
        recommendedSizingFraction: input.isPotLimit ? 1.0 : Math.max(0.85, geom.fractionOfPot),
        reason: 'unexpected_raise_nut_or_high_equity_commit',
      };
    }
    const impliedAllowance = input.hasNutRedraw && input.street !== 'river' ? 0.06 : 0;
    if (input.equity + impliedAllowance >= input.potOdds - 0.01) {
      return {
        reevaluated: true,
        directive: 'call_unexpected_raise_priced',
        recommendedSizingFraction: 0,
        reason: 'unexpected_raise_priced_continue',
      };
    }
    return {
      reevaluated: true,
      directive: 'fold_unexpected_raise_unpriced',
      recommendedSizingFraction: 0,
      reason: 'unexpected_raise_insufficient_equity',
    };
  }

  // 2. Unexpected donk-bet into preflop / prior-street aggressor:
  if (input.facingUnexpectedDonk && input.facingBetChips > 0) {
    if (
      facingFrac <= 0.36 &&
      (input.hasCurrentNuts ||
        input.equity >= 0.58 ||
        input.hasNutRedraw ||
        (input.certifiedNutBlocker && !input.multiwayIncreased))
    ) {
      return {
        reevaluated: true,
        directive: 'attack_small_donk',
        recommendedSizingFraction: input.isPotLimit ? 0.85 : 0.78,
        reason: 'small_blocker_donk_punish',
      };
    }
    return {
      reevaluated: true,
      directive: 'defend_polar_donk',
      recommendedSizingFraction: 0,
      reason: 'polar_donk_mdf_defense',
    };
  }

  // 3. Facing a bet with a planned OOP check-raise trap:
  if (
    input.archetype === 'oop_check_raise_trap' &&
    input.facingBetChips > 0 &&
    (input.hasCurrentNuts || input.equity >= 0.6 || input.hasNutRedraw)
  ) {
    return {
      reevaluated: false,
      directive: 'execute_check_raise_trap',
      recommendedSizingFraction: input.isPotLimit ? 1.0 : 0.85,
      reason: 'planned_oop_check_raise_trap',
    };
  }

  // 4. Multiway cold-call shift when checked to: shut down pure air, size up protection on value/nut draws:
  if (input.multiwayIncreased && input.facingBetChips <= 0) {
    if (input.equity < 0.48 && !input.hasNutRedraw && !input.hasCurrentNuts) {
      return {
        reevaluated: true,
        directive: 'abort_multiway_air',
        recommendedSizingFraction: 0,
        reason: 'multiway_cold_call_air_shutdown',
      };
    }
    return {
      reevaluated: true,
      directive: 'execute_planned_barrel',
      recommendedSizingFraction: Math.min(
        input.isPotLimit ? 1.0 : 1.1,
        Math.max(0.66, geom.fractionOfPot * 1.12)
      ),
      reason: 'multiway_protection_value_sizing',
    };
  }

  // 5. IP Flop Float -> Turn Takeaway when checked to by capped villain:
  if (
    input.archetype === 'ip_float_takeaway' &&
    input.facingBetChips <= 0 &&
    (input.villainRangeCapped || input.cardClass !== 'scare' || input.certifiedNutBlocker)
  ) {
    return {
      reevaluated: input.cardClass === 'scare',
      directive: 'execute_float_takeaway',
      recommendedSizingFraction: Math.min(0.75, Math.max(0.56, geom.fractionOfPot)),
      reason: 'ip_float_turn_takeaway_stab',
    };
  }

  // 6. Scare card arrived when checked to:
  if (input.cardClass === 'scare' && input.facingBetChips <= 0) {
    if (input.certifiedNutBlocker && input.equity < 0.44 && !input.multiwayIncreased) {
      return {
        reevaluated: true,
        directive: 'scare_nut_blocker_barrel',
        recommendedSizingFraction: Math.min(
          input.isPotLimit ? 0.9 : 0.85,
          Math.max(0.65, geom.fractionOfPot)
        ),
        reason: 'scare_card_nut_blocker_leverage',
      };
    }
    if (!input.hasCurrentNuts && input.equity < 0.64) {
      return {
        reevaluated: true,
        directive: 'pivot_pot_control_check',
        recommendedSizingFraction: 0,
        reason: 'scare_card_pot_control_check',
      };
    }
  }

  return {
    reevaluated: false,
    directive: 'execute_planned_barrel',
    recommendedSizingFraction: geom.fractionOfPot,
    reason: 'intact_geometric_plan',
  };
}
