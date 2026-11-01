import type { ContinuationPlanInvalidationReason } from './HorseContinuationPlanInvalidation.js';

export type HorseStyleFastShiftClassification =
  | 'stable'
  | 'shifted_passive_calling_station'
  | 'shifted_aggressive_maniac'
  | 'shifted_tight_nit';

export type HorseWholeHandLossBucket =
  | 'no_net_loss'
  | 'unavoidable_cooler_or_runout'
  | 'stale_or_missing_input_defect'
  | 'calling_station_payoff_defect'
  | 'spew_bluff_into_station_or_nut_blocker_defect'
  | 'plan_invalidation_ignored_defect'
  | 'sizing_or_spr_threshold_defect';

export interface HorseDecisionStreetAuditRecord {
  readonly street: 'preflop' | 'flop' | 'turn' | 'river';
  readonly action: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all_in';
  readonly amountChips: number;
  readonly potBeforeChips: number;
  readonly effectiveStackBeforeChips: number;
  /** True when the turn had a canonical digest + fresh read frame and consulted all required range/plan getters. */
  readonly inputReadFrameComplete: boolean;
  /** True when the turn fell back due to worker timeout, stale generation, or missing context. */
  readonly timedOutOrFallbackUsed: boolean;
  /** Estimated equity (0..1) against the opponent's public-action-conditioned continuing range. */
  readonly estimatedEquityVsContinuingRange: number;
  /** Required minimum equity (0..1) for the chosen committed action given pot odds / fold equity / contestable risk. */
  readonly requiredThresholdEquity: number;
  /** Whether the action is classified as a bluff (rather than value or protection). */
  readonly isBluffAction: boolean;
  /** Whether hero holds the required nut or low blockers for a polarized river/turn bluff. */
  readonly holdsRequiredBlockerForBluff: boolean;
  /** Opponent style classification from the rare-opportunity / fast-window tracker. */
  readonly opponentStyleShift: HorseStyleFastShiftClassification;
  /** Opponent river/turn fold-to-bet estimate (0..1) from public observations. */
  readonly opponentFoldFrequencyEstimate: number;
  /** Whether an active multi-street plan was invalidated on this street before the action. */
  readonly planInvalidationReason: ContinuationPlanInvalidationReason | null;
  /** Whether the horse continued betting/raising despite `planInvalidationReason !== null`. */
  readonly continuedBarrelDespiteInvalidation: boolean;
  /** Stack-to-pot ratio before the action. */
  readonly sprBeforeAction: number;
  /** Fraction of remaining effective stack committed by this action (0..1). */
  readonly stackFractionCommitted: number;
}

export interface HorseWholeHandOutcomeAuditInput {
  readonly handId: string;
  readonly actorId: string;
  readonly variant: 'nlh' | 'plo4' | 'plo5' | 'plo6' | 'plo8';
  readonly isTournament: boolean;
  readonly bigBlindChips: number;
  /** Net chip delta for the whole hand (negative means chip loss). */
  readonly netChipDelta: number;
  /** Net tournament utility delta (negative means ICM/utility loss; null in cash games). */
  readonly netTournamentUtilityDelta: number | null;
  /** True when showdown or all-in runout lost despite >= required equity when money went in. */
  readonly lostShowdownOrRunoutWithPositiveEntryEv: boolean;
  readonly streetRecords: readonly HorseDecisionStreetAuditRecord[];
}

export interface HorseWholeHandLossAttributionResult {
  readonly handId: string;
  readonly actorId: string;
  readonly variant: 'nlh' | 'plo4' | 'plo5' | 'plo6' | 'plo8';
  readonly netBigBlindDelta: number;
  readonly netTournamentUtilityDelta: number | null;
  readonly isNetLoss: boolean;
  readonly primaryBucket: HorseWholeHandLossBucket;
  readonly triggeredDefects: readonly Exclude<
    HorseWholeHandLossBucket,
    'no_net_loss' | 'unavoidable_cooler_or_runout'
  >[];
  readonly triggerStreet: 'preflop' | 'flop' | 'turn' | 'river' | null;
  readonly avoidableLossBigBlinds: number;
}

export interface HorseDecisionQualityBenchmarkSummary {
  readonly totalHandsAudited: number;
  readonly netBigBlindDeltaTotal: number;
  readonly netBigBlindsPer100: number;
  readonly totalLossBigBlinds: number;
  readonly unavoidableCoolerLossBigBlinds: number;
  readonly avoidableDefectLossBigBlinds: number;
  readonly avoidableDefectRatePer100Hands: number;
  readonly bucketCounts: Readonly<Record<HorseWholeHandLossBucket, number>>;
  readonly bucketLossBigBlinds: Readonly<Record<HorseWholeHandLossBucket, number>>;
}

function isAggressiveAction(action: HorseDecisionStreetAuditRecord['action']): boolean {
  return action === 'bet' || action === 'raise' || action === 'all_in';
}

function isCommittedAction(action: HorseDecisionStreetAuditRecord['action']): boolean {
  return action === 'call' || action === 'bet' || action === 'raise' || action === 'all_in';
}

/**
 * Attributes a whole-hand outcome into a deterministic loss bucket and lists all
 * in-hand decision defects in priority order (Items 32 & 33).
 */
export function attributeHorseWholeHandLoss(
  input: HorseWholeHandOutcomeAuditInput
): HorseWholeHandLossAttributionResult {
  const bb = Math.max(0.0001, input.bigBlindChips);
  const netBigBlindDelta = Number((input.netChipDelta / bb).toFixed(4));
  const isTournamentLoss =
    input.isTournament &&
    input.netTournamentUtilityDelta !== null &&
    input.netTournamentUtilityDelta < -1e-6;
  const isNetLoss = netBigBlindDelta < -1e-6 || isTournamentLoss;

  if (!isNetLoss) {
    return {
      handId: input.handId,
      actorId: input.actorId,
      variant: input.variant,
      netBigBlindDelta,
      netTournamentUtilityDelta: input.netTournamentUtilityDelta,
      isNetLoss: false,
      primaryBucket: 'no_net_loss',
      triggeredDefects: [],
      triggerStreet: null,
      avoidableLossBigBlinds: 0,
    };
  }

  const triggeredDefects: Exclude<
    HorseWholeHandLossBucket,
    'no_net_loss' | 'unavoidable_cooler_or_runout'
  >[] = [];
  let firstTriggerStreet: 'preflop' | 'flop' | 'turn' | 'river' | null = null;

  const recordDefect = (
    defect: Exclude<HorseWholeHandLossBucket, 'no_net_loss' | 'unavoidable_cooler_or_runout'>,
    street: 'preflop' | 'flop' | 'turn' | 'river'
  ): void => {
    if (!triggeredDefects.includes(defect)) {
      triggeredDefects.push(defect);
    }
    if (firstTriggerStreet === null) {
      firstTriggerStreet = street;
    }
  };

  for (const rec of input.streetRecords) {
    if (!isCommittedAction(rec.action)) continue;

    // 1. Stale or missing input / fallback timeout defect
    if (!rec.inputReadFrameComplete || rec.timedOutOrFallbackUsed) {
      recordDefect('stale_or_missing_input_defect', rec.street);
    }

    // 2. Plan invalidation ignored defect (continued barrel after board/action invalidation)
    if (
      rec.planInvalidationReason !== null &&
      rec.continuedBarrelDespiteInvalidation &&
      isAggressiveAction(rec.action)
    ) {
      recordDefect('plan_invalidation_ignored_defect', rec.street);
    }

    // 3. Spew bluff into calling-station read or without required nut/low blockers
    if (rec.isBluffAction && isAggressiveAction(rec.action)) {
      const intoStation =
        rec.opponentStyleShift === 'shifted_passive_calling_station' ||
        rec.opponentFoldFrequencyEstimate < 0.24;
      const missingBlockerOnLateStreet =
        (rec.street === 'turn' || rec.street === 'river') &&
        !rec.holdsRequiredBlockerForBluff &&
        rec.estimatedEquityVsContinuingRange < rec.requiredThresholdEquity;
      if (intoStation || missingBlockerOnLateStreet) {
        recordDefect('spew_bluff_into_station_or_nut_blocker_defect', rec.street);
      }
    }

    // 4. Calling-station payoff defect (calling turn/river pressure when equity < required threshold)
    if (
      rec.action === 'call' &&
      (rec.street === 'turn' || rec.street === 'river') &&
      rec.estimatedEquityVsContinuingRange + 0.015 < rec.requiredThresholdEquity
    ) {
      recordDefect('calling_station_payoff_defect', rec.street);
    }

    // 5. Sizing or SPR threshold defect (committing >= 45% stack at medium/high SPR with insufficient equity)
    if (
      rec.stackFractionCommitted >= 0.45 &&
      rec.sprBeforeAction >= 2.5 &&
      !rec.isBluffAction &&
      rec.estimatedEquityVsContinuingRange + 0.02 < rec.requiredThresholdEquity
    ) {
      recordDefect('sizing_or_spr_threshold_defect', rec.street);
    }
  }

  const lossMagnitudeBb = Math.max(0, -netBigBlindDelta);
  if (triggeredDefects.length === 0) {
    return {
      handId: input.handId,
      actorId: input.actorId,
      variant: input.variant,
      netBigBlindDelta,
      netTournamentUtilityDelta: input.netTournamentUtilityDelta,
      isNetLoss: true,
      primaryBucket: 'unavoidable_cooler_or_runout',
      triggeredDefects: [],
      triggerStreet: null,
      avoidableLossBigBlinds: 0,
    };
  }

  return {
    handId: input.handId,
    actorId: input.actorId,
    variant: input.variant,
    netBigBlindDelta,
    netTournamentUtilityDelta: input.netTournamentUtilityDelta,
    isNetLoss: true,
    primaryBucket: triggeredDefects[0],
    triggeredDefects,
    triggerStreet: firstTriggerStreet,
    avoidableLossBigBlinds: Number(lossMagnitudeBb.toFixed(4)),
  };
}

/**
 * Summarizes a cohort of whole-hand attributions into a decision-quality benchmark report (Items 32 & 33).
 */
export function summarizeHorseDecisionQualityBenchmark(
  hands: readonly HorseWholeHandOutcomeAuditInput[]
): HorseDecisionQualityBenchmarkSummary {
  const bucketCounts: Record<HorseWholeHandLossBucket, number> = {
    no_net_loss: 0,
    unavoidable_cooler_or_runout: 0,
    stale_or_missing_input_defect: 0,
    calling_station_payoff_defect: 0,
    spew_bluff_into_station_or_nut_blocker_defect: 0,
    plan_invalidation_ignored_defect: 0,
    sizing_or_spr_threshold_defect: 0,
  };
  const bucketLossBigBlinds: Record<HorseWholeHandLossBucket, number> = {
    no_net_loss: 0,
    unavoidable_cooler_or_runout: 0,
    stale_or_missing_input_defect: 0,
    calling_station_payoff_defect: 0,
    spew_bluff_into_station_or_nut_blocker_defect: 0,
    plan_invalidation_ignored_defect: 0,
    sizing_or_spr_threshold_defect: 0,
  };

  let netBigBlindDeltaTotal = 0;
  let totalLossBigBlinds = 0;
  let unavoidableCoolerLossBigBlinds = 0;
  let avoidableDefectLossBigBlinds = 0;
  let avoidableDefectHands = 0;

  for (const hand of hands) {
    const attr = attributeHorseWholeHandLoss(hand);
    netBigBlindDeltaTotal += attr.netBigBlindDelta;
    bucketCounts[attr.primaryBucket] += 1;

    if (attr.isNetLoss) {
      const lossBb = Math.max(0, -attr.netBigBlindDelta);
      totalLossBigBlinds += lossBb;
      bucketLossBigBlinds[attr.primaryBucket] = Number(
        (bucketLossBigBlinds[attr.primaryBucket] + lossBb).toFixed(4)
      );
      if (attr.primaryBucket === 'unavoidable_cooler_or_runout') {
        unavoidableCoolerLossBigBlinds += lossBb;
      } else if (attr.primaryBucket !== 'no_net_loss') {
        avoidableDefectLossBigBlinds += attr.avoidableLossBigBlinds;
        avoidableDefectHands += 1;
      }
    }
  }

  const n = hands.length;
  return {
    totalHandsAudited: n,
    netBigBlindDeltaTotal: Number(netBigBlindDeltaTotal.toFixed(4)),
    netBigBlindsPer100: n > 0 ? Number(((netBigBlindDeltaTotal / n) * 100).toFixed(4)) : 0,
    totalLossBigBlinds: Number(totalLossBigBlinds.toFixed(4)),
    unavoidableCoolerLossBigBlinds: Number(unavoidableCoolerLossBigBlinds.toFixed(4)),
    avoidableDefectLossBigBlinds: Number(avoidableDefectLossBigBlinds.toFixed(4)),
    avoidableDefectRatePer100Hands:
      n > 0 ? Number(((avoidableDefectHands / n) * 100).toFixed(4)) : 0,
    bucketCounts,
    bucketLossBigBlinds,
  };
}
