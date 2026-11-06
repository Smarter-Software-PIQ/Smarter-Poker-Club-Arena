import { describe, expect, it } from 'vitest';
import {
  buildIncrementalWarmRecords,
  incrementalHistoryVersion,
  NEAR_NUT_WARM_PUBLIC_HANDS,
} from './IncrementalPressureDevelopment.js';
import {
  makeFeatureAblationOwnHistory,
  featureAblationPlayerId,
  FEATURE_ABLATION_HISTORY_AVAILABLE_AT_MS as AVAILABLE,
} from './FeatureAblationHistory.js';
import { ownPublicHistoryIsValid } from '../engine/horseDecision/ownPublicHistory.js';

// 48 retained-node near-nut hands overflowed the original 256 KiB window at four
// and six dealt, so every multiway near-nut development pilot refused before dealing.
describe('near-nut warm public history fits the original packet bound', { timeout: 300000 }, () => {
  it('declares its own versioned warm size', () => {
    expect(NEAR_NUT_WARM_PUBLIC_HANDS).toBe(32);
    expect(incrementalHistoryVersion('small_pot_near_nut_value_raise')).toBe(
      'small_pot_near_nut_value_raise-physical-public-node-warm-v4-32'
    );
    expect(incrementalHistoryVersion('multiway_river_bluff_checkraise')).toBe(
      'multiway_river_bluff_checkraise-physical-public-node-warm-v1'
    );
  });
  it.each(['plo4', 'plo5', 'plo6'] as const)(
    '%s near-nut histories are admitted by the original validator at every dealt count',
    (variant) => {
      for (const seats of [2, 4, 6]) {
        const records = buildIncrementalWarmRecords(
          variant,
          seats,
          'small_pot_near_nut_value_raise'
        );
        expect(records).toHaveLength(NEAR_NUT_WARM_PUBLIC_HANDS);
        const context = {
          version: 1 as const,
          observerId: featureAblationPlayerId(1),
          variant,
          format: 'cash' as const,
          dealtCount: seats,
        };
        const packet = makeFeatureAblationOwnHistory(context, 1, records);
        expect(ownPublicHistoryIsValid(packet, context, AVAILABLE)).toBe(true);
      }
    }
  );
});
