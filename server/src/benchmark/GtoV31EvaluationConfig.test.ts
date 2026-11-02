import { describe, expect, it } from 'vitest';
import { evaluationConfig, evaluationMatchup } from './GtoV31EvaluationConfig.js';

const args = {
  datasetChecksum: 'a'.repeat(64),
  kind: 'paired_replay' as const,
  family: 'cash' as const,
  scenarios: ['cash-srp'],
  engineCommit: 'b'.repeat(40),
};

describe('V31 evaluation policy identity', () => {
  it('preserves the exact legacy configuration bytes', () => {
    expect(JSON.stringify(evaluationConfig(args))).toBe(
      JSON.stringify({
        evaluation_contract: 'gto_v31_candidate.v2',
        evaluation_kind: 'paired_replay',
        game_family: 'cash',
        dataset_checksum: 'a'.repeat(64),
        candidate: 'v31_certified',
        evaluation_profile: 'policy_only_duplicate_deals',
        scenarios: ['cash-srp'],
        evaluation_engine_commit: 'b'.repeat(40),
      })
    );
  });
  it('binds V4 while retaining explicit feature identity and league profile', () => {
    const result = evaluationConfig({
      ...args,
      kind: 'league',
      feature_contract_version: 'holdem-board-relative-v2',
      policy_export_schema: 'smarter-poker.pio-policy.v4',
    });
    expect(result.policy_export_schema).toBe('smarter-poker.pio-policy.v4');
    expect(result.feature_contract_version).toBe('holdem-board-relative-v2');
    expect(result.evaluation_profile).toBe('full_brain_duplicate_deal_league');
  });
  it.each([null, undefined, false, 'unknown'])('rejects explicit invalid metadata %s', (value) => {
    expect(() => evaluationConfig({ ...args, policy_export_schema: value } as never)).toThrow(
      'v31_policy_contract_unknown'
    );
  });
});

describe('V31 evaluation epoch matchup', () => {
  it('keeps the historical matchup for epoch 1 and suffixes later epochs', () => {
    const checksum = 'c'.repeat(64);
    expect(evaluationMatchup('league', 'spin', checksum, 1)).toBe(
      `gto_v31_league_spin_${checksum}`
    );
    expect(evaluationMatchup('league', 'spin', checksum, 2)).toBe(
      `gto_v31_league_spin_${checksum}_epoch2`
    );
  });
  it.each([0, -1, 1.5, Number.NaN])('rejects epoch %s', (epoch) => {
    expect(() => evaluationMatchup('paired_replay', 'cash', 'c'.repeat(64), epoch)).toThrow(
      'v31_evaluation_epoch_invalid'
    );
  });
});
