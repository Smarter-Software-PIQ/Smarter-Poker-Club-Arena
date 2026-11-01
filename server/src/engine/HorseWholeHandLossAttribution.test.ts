import { describe, expect, it } from 'vitest';
import {
  attributeHorseWholeHandLoss,
  summarizeHorseDecisionQualityBenchmark,
  type HorseDecisionStreetAuditRecord,
  type HorseWholeHandOutcomeAuditInput,
} from './HorseWholeHandLossAttribution.js';

function cleanStreetRecord(
  overrides: Partial<HorseDecisionStreetAuditRecord> = {}
): HorseDecisionStreetAuditRecord {
  return {
    street: 'flop',
    action: 'bet',
    amountChips: 12,
    potBeforeChips: 20,
    effectiveStackBeforeChips: 200,
    inputReadFrameComplete: true,
    timedOutOrFallbackUsed: false,
    estimatedEquityVsContinuingRange: 0.58,
    requiredThresholdEquity: 0.42,
    isBluffAction: false,
    holdsRequiredBlockerForBluff: true,
    opponentStyleShift: 'stable',
    opponentFoldFrequencyEstimate: 0.42,
    planInvalidationReason: null,
    continuedBarrelDespiteInvalidation: false,
    sprBeforeAction: 6.0,
    stackFractionCommitted: 0.06,
    ...overrides,
  };
}

function makeHandInput(
  overrides: Partial<HorseWholeHandOutcomeAuditInput> = {}
): HorseWholeHandOutcomeAuditInput {
  return {
    handId: 'hand-loss-audit-1',
    actorId: 'horse-042',
    variant: 'plo5',
    isTournament: false,
    bigBlindChips: 2,
    netChipDelta: -80,
    netTournamentUtilityDelta: null,
    lostShowdownOrRunoutWithPositiveEntryEv: false,
    streetRecords: [cleanStreetRecord()],
    ...overrides,
  };
}

describe('HorseWholeHandLossAttribution (Items 32 & 33)', () => {
  it('classifies profitable or break-even hands as no_net_loss', () => {
    const res = attributeHorseWholeHandLoss(
      makeHandInput({
        netChipDelta: 44,
      })
    );
    expect(res.isNetLoss).toBe(false);
    expect(res.primaryBucket).toBe('no_net_loss');
    expect(res.triggeredDefects).toEqual([]);
    expect(res.avoidableLossBigBlinds).toBe(0);
  });

  it('classifies positive-EV coolers / bad runouts with complete inputs as unavoidable_cooler_or_runout', () => {
    const res = attributeHorseWholeHandLoss(
      makeHandInput({
        netChipDelta: -200,
        lostShowdownOrRunoutWithPositiveEntryEv: true,
        streetRecords: [
          cleanStreetRecord({
            street: 'turn',
            action: 'all_in',
            estimatedEquityVsContinuingRange: 0.64,
            requiredThresholdEquity: 0.47,
            stackFractionCommitted: 1.0,
          }),
        ],
      })
    );
    expect(res.isNetLoss).toBe(true);
    expect(res.primaryBucket).toBe('unavoidable_cooler_or_runout');
    expect(res.triggeredDefects).toEqual([]);
    expect(res.avoidableLossBigBlinds).toBe(0);
  });

  it('identifies stale_or_missing_input_defect when a turn lacked read-frame binding or used fallback timeout', () => {
    const res = attributeHorseWholeHandLoss(
      makeHandInput({
        netChipDelta: -60,
        streetRecords: [
          cleanStreetRecord({
            street: 'turn',
            action: 'call',
            inputReadFrameComplete: false,
            timedOutOrFallbackUsed: true,
          }),
        ],
      })
    );
    expect(res.primaryBucket).toBe('stale_or_missing_input_defect');
    expect(res.triggerStreet).toBe('turn');
    expect(res.avoidableLossBigBlinds).toBe(30);
  });

  it('identifies plan_invalidation_ignored_defect when continuing a barrel after runout invalidation', () => {
    const res = attributeHorseWholeHandLoss(
      makeHandInput({
        netChipDelta: -90,
        streetRecords: [
          cleanStreetRecord({
            street: 'river',
            action: 'bet',
            planInvalidationReason: 'runout_invalidated',
            continuedBarrelDespiteInvalidation: true,
          }),
        ],
      })
    );
    expect(res.primaryBucket).toBe('plan_invalidation_ignored_defect');
    expect(res.triggerStreet).toBe('river');
    expect(res.avoidableLossBigBlinds).toBe(45);
  });

  it('identifies spew_bluff_into_station_or_nut_blocker_defect when bluffing into a calling-station shift or without blockers', () => {
    const intoStation = attributeHorseWholeHandLoss(
      makeHandInput({
        netChipDelta: -110,
        streetRecords: [
          cleanStreetRecord({
            street: 'river',
            action: 'bet',
            isBluffAction: true,
            opponentStyleShift: 'shifted_passive_calling_station',
            opponentFoldFrequencyEstimate: 0.18,
          }),
        ],
      })
    );
    expect(intoStation.primaryBucket).toBe('spew_bluff_into_station_or_nut_blocker_defect');
    expect(intoStation.avoidableLossBigBlinds).toBe(55);

    const missingBlocker = attributeHorseWholeHandLoss(
      makeHandInput({
        netChipDelta: -70,
        streetRecords: [
          cleanStreetRecord({
            street: 'river',
            action: 'raise',
            isBluffAction: true,
            holdsRequiredBlockerForBluff: false,
            estimatedEquityVsContinuingRange: 0.12,
            requiredThresholdEquity: 0.38,
          }),
        ],
      })
    );
    expect(missingBlocker.primaryBucket).toBe('spew_bluff_into_station_or_nut_blocker_defect');
  });

  it('identifies calling_station_payoff_defect and sizing_or_spr_threshold_defect and aggregates cohort benchmark summary', () => {
    const payoffHand = makeHandInput({
      handId: 'hand-payoff',
      netChipDelta: -64,
      streetRecords: [
        cleanStreetRecord({
          street: 'river',
          action: 'call',
          estimatedEquityVsContinuingRange: 0.19,
          requiredThresholdEquity: 0.33,
        }),
      ],
    });
    const sprDefectHand = makeHandInput({
      handId: 'hand-spr',
      netChipDelta: -140,
      streetRecords: [
        cleanStreetRecord({
          street: 'flop',
          action: 'raise',
          sprBeforeAction: 4.5,
          stackFractionCommitted: 0.65,
          estimatedEquityVsContinuingRange: 0.34,
          requiredThresholdEquity: 0.46,
        }),
      ],
    });
    const coolerHand = makeHandInput({
      handId: 'hand-cooler',
      netChipDelta: -100,
      lostShowdownOrRunoutWithPositiveEntryEv: true,
    });
    const winningHand = makeHandInput({
      handId: 'hand-win',
      netChipDelta: 220,
    });

    expect(attributeHorseWholeHandLoss(payoffHand).primaryBucket).toBe(
      'calling_station_payoff_defect'
    );
    expect(attributeHorseWholeHandLoss(sprDefectHand).primaryBucket).toBe(
      'sizing_or_spr_threshold_defect'
    );

    const summary = summarizeHorseDecisionQualityBenchmark([
      payoffHand,
      sprDefectHand,
      coolerHand,
      winningHand,
    ]);
    expect(summary.totalHandsAudited).toBe(4);
    // Net BBs: -32 - 70 - 50 + 110 = -42 BB
    expect(summary.netBigBlindDeltaTotal).toBe(-42);
    expect(summary.unavoidableCoolerLossBigBlinds).toBe(50);
    expect(summary.avoidableDefectLossBigBlinds).toBe(102);
    expect(summary.avoidableDefectRatePer100Hands).toBe(50);
    expect(summary.bucketCounts.calling_station_payoff_defect).toBe(1);
    expect(summary.bucketCounts.sizing_or_spr_threshold_defect).toBe(1);
    expect(summary.bucketCounts.unavoidable_cooler_or_runout).toBe(1);
    expect(summary.bucketCounts.no_net_loss).toBe(1);
  });
});
