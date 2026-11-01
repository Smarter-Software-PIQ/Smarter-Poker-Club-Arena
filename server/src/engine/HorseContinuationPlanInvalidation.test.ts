import { describe, expect, it } from 'vitest';
import {
  classifyOpponentContinuationBranch,
  evaluateExplicitContinuationPlanV2,
  type ContinuationResponseBranch,
  type ContinuationResponseRule,
  type ContinuationTurnObservation,
  type ExplicitContinuationPlanV2,
} from './HorseContinuationPlanInvalidation.js';

function createBasePlan(): ExplicitContinuationPlanV2 {
  const responses: Record<ContinuationResponseBranch, ContinuationResponseRule> = {
    check: {
      branch: 'check',
      action: 'bet',
      sizingFractionOfPot: 0.66,
      minFacingFractionOfPot: 0,
      maxFacingFractionOfPot: 0,
      maxEffectiveSpr: 6.0,
      requiresIntactNutAdvantage: false,
    },
    call: {
      branch: 'call',
      action: 'bet',
      sizingFractionOfPot: 0.75,
      minFacingFractionOfPot: 0,
      maxFacingFractionOfPot: 0,
      maxEffectiveSpr: 5.0,
      requiresIntactNutAdvantage: true,
    },
    raise_small: {
      branch: 'raise_small',
      action: 'call',
      sizingFractionOfPot: 0,
      minFacingFractionOfPot: 0.1,
      maxFacingFractionOfPot: 0.4,
      maxEffectiveSpr: 6.0,
      requiresIntactNutAdvantage: false,
    },
    raise_half_pot: {
      branch: 'raise_half_pot',
      action: 'call',
      sizingFractionOfPot: 0,
      minFacingFractionOfPot: 0.4,
      maxFacingFractionOfPot: 0.75,
      maxEffectiveSpr: 5.0,
      requiresIntactNutAdvantage: false,
    },
    raise_pot: {
      branch: 'raise_pot',
      action: 'raise',
      sizingFractionOfPot: 1.0,
      minFacingFractionOfPot: 0.75,
      maxFacingFractionOfPot: 1.1,
      maxEffectiveSpr: 4.5,
      requiresIntactNutAdvantage: true,
    },
    raise_all_in: {
      branch: 'raise_all_in',
      action: 'fold',
      sizingFractionOfPot: 0,
      minFacingFractionOfPot: 0.85,
      maxFacingFractionOfPot: 5.0,
      maxEffectiveSpr: 6.0,
      requiresIntactNutAdvantage: true,
    },
  };

  return {
    planVersion: 'horse-continuation-plan-v2',
    createdAtMs: 1_700_000_000_000,
    maxAgeMs: 90_000,
    handNumber: 412,
    handId: 'hand-412-uuid',
    tableId: 'table-plo8-1',
    actorId: 'horse-042',
    createdStreet: 'FLOP',
    targetStreet: 'TURN',
    binding: {
      version: 'horse-plan-batch-v1',
      fastRequestId: 19,
      generation: 412,
      fence: 'table-plo8-1:412',
      decisionKey: 'phase5-v1:' + 'a'.repeat(64),
      actorId: 'horse-042',
      seat: 3,
      street: 'flop',
      planContext: {
        version: 1,
        hand: null,
      },
    },
    plannedOriginAction: 'bet',
    plannedOriginAmount: 24,
    expectedMaxActivePlayers: 2,
    baselineEffectiveSpr: 3.5,
    maxSprDeviationRatio: 0.5,
    invalidateOnFlushComplete: true,
    invalidateOnBoardPair: true,
    invalidateOnLowComplete: true,
    invalidateOnNutCounterfeit: true,
    responses,
  };
}

function createBaseObservation(
  overrides: Partial<ContinuationTurnObservation> = {}
): ContinuationTurnObservation {
  return {
    observedAtMs: 1_700_000_012_000,
    handNumber: 412,
    handId: 'hand-412-uuid',
    tableId: 'table-plo8-1',
    actorId: 'horse-042',
    currentStreet: 'TURN',
    activePlayerCount: 2,
    potSize: 80,
    facingBetAmount: 0,
    effectiveRemainingStack: 260,
    opponentAction: 'check',
    opponentAllIn: false,
    boardFlushCompletedSincePlan: false,
    boardPairedSincePlan: false,
    boardLowCompletedSincePlan: false,
    heroNutCounterfeitedSincePlan: false,
    controllerAcceptedOriginAction: true,
    controllerAcceptedActionType: 'bet',
    controllerAcceptedAmount: 24,
    ...overrides,
  };
}

describe('HorseContinuationPlanInvalidation — Items 21 & 23 qualification', () => {
  it('classifies check, call, small raise, half-pot raise, pot raise, and all-in branches deterministically', () => {
    expect(classifyOpponentContinuationBranch('check', 0, 100, false, 300)).toBe('check');
    expect(classifyOpponentContinuationBranch('call', 0, 100, false, 300)).toBe('call');
    expect(classifyOpponentContinuationBranch('bet', 33, 100, false, 300)).toBe('raise_small');
    expect(classifyOpponentContinuationBranch('raise', 60, 100, false, 300)).toBe('raise_half_pot');
    expect(classifyOpponentContinuationBranch('raise', 95, 100, false, 300)).toBe('raise_pot');
    expect(classifyOpponentContinuationBranch('raise', 280, 100, true, 280)).toBe('raise_all_in');
  });

  it('executes the planned continuation branch when controller action, runout, player count, sizing, and SPR remain valid', () => {
    const plan = createBasePlan();

    const afterCheck = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ opponentAction: 'check', facingBetAmount: 0 })
    );
    expect(afterCheck.valid).toBe(true);
    expect(afterCheck.selectedBranch).toBe('check');
    expect(afterCheck.recommendedAction).toBe('bet');
    expect(afterCheck.recommendedSizingFractionOfPot).toBe(0.66);

    const afterHalfPotProbe = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ opponentAction: 'bet', facingBetAmount: 48, potSize: 80 })
    );
    expect(afterHalfPotProbe.valid).toBe(true);
    expect(afterHalfPotProbe.selectedBranch).toBe('raise_half_pot');
    expect(afterHalfPotProbe.recommendedAction).toBe('call');

    const afterPotRaise = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ opponentAction: 'raise', facingBetAmount: 76, potSize: 80 })
    );
    expect(afterPotRaise.valid).toBe(true);
    expect(afterPotRaise.selectedBranch).toBe('raise_pot');
    expect(afterPotRaise.recommendedAction).toBe('raise');
    expect(afterPotRaise.recommendedSizingFractionOfPot).toBe(1.0);
  });

  it('invalidates the continuation plan with action_not_accepted if the controller rejected, coerced, or resized the origin action', () => {
    const plan = createBasePlan();

    const rejected = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ controllerAcceptedOriginAction: false })
    );
    expect(rejected.valid).toBe(false);
    expect(rejected.invalidationReasons).toContain('action_not_accepted');

    const coercedToCheck = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ controllerAcceptedActionType: 'check', controllerAcceptedAmount: 0 })
    );
    expect(coercedToCheck.valid).toBe(false);
    expect(coercedToCheck.invalidationReasons).toContain('action_not_accepted');

    const resizedAmount = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ controllerAcceptedAmount: 12 })
    );
    expect(resizedAmount.valid).toBe(false);
    expect(resizedAmount.invalidationReasons).toContain('action_not_accepted');
  });

  it('invalidates the continuation plan with runout_invalidated when flush, board pair, low completion, or nut counterfeit occurs', () => {
    const plan = createBasePlan();

    expect(
      evaluateExplicitContinuationPlanV2(
        plan,
        createBaseObservation({ boardFlushCompletedSincePlan: true })
      ).invalidationReasons
    ).toContain('runout_invalidated');

    expect(
      evaluateExplicitContinuationPlanV2(
        plan,
        createBaseObservation({ boardPairedSincePlan: true })
      ).invalidationReasons
    ).toContain('runout_invalidated');

    expect(
      evaluateExplicitContinuationPlanV2(
        plan,
        createBaseObservation({ boardLowCompletedSincePlan: true })
      ).invalidationReasons
    ).toContain('runout_invalidated');

    expect(
      evaluateExplicitContinuationPlanV2(
        plan,
        createBaseObservation({ heroNutCounterfeitedSincePlan: true })
      ).invalidationReasons
    ).toContain('runout_invalidated');
  });

  it('invalidates the continuation plan on multiway player count change, out-of-band sizing, or stack/SPR shift', () => {
    const plan = createBasePlan();

    const multiway = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ activePlayerCount: 3 })
    );
    expect(multiway.valid).toBe(false);
    expect(multiway.invalidationReasons).toContain('player_count_changed');

    const tinyBetBelowSmallBand = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ opponentAction: 'bet', facingBetAmount: 4, potSize: 80 })
    );
    expect(tinyBetBelowSmallBand.valid).toBe(false);
    expect(tinyBetBelowSmallBand.invalidationReasons).toContain('sizing_out_of_band');

    const sprShift = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ effectiveRemainingStack: 520, potSize: 80 })
    );
    expect(sprShift.valid).toBe(false);
    expect(sprShift.invalidationReasons).toContain('stack_exposure_changed');
  });

  it('invalidates on hand/actor mismatch, street regression, or expired plan clock', () => {
    const plan = createBasePlan();

    const wrongHand = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ handId: 'hand-413-uuid', handNumber: 413 })
    );
    expect(wrongHand.valid).toBe(false);
    expect(wrongHand.invalidationReasons).toContain('hand_mismatch');

    const sameStreet = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ currentStreet: 'FLOP' })
    );
    expect(sameStreet.valid).toBe(false);
    expect(sameStreet.invalidationReasons).toContain('street_regression');

    const expired = evaluateExplicitContinuationPlanV2(
      plan,
      createBaseObservation({ observedAtMs: plan.createdAtMs + 120_000 })
    );
    expect(expired.valid).toBe(false);
    expect(expired.invalidationReasons).toContain('plan_expired');
  });
});
