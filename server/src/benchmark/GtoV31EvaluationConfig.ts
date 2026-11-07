import type { GtoV31EvaluationFamily, GtoV31EvaluationKind } from './GtoV31CandidateEvaluation.js';
import { gtoV31PolicyContractIdentity } from '../engine/GtoPostflopV31.js';
import type { GtoV31SourceSeal } from '../engine/GtoPostflopV31.js';

/** Pure configuration identity shared by the evaluator and its boundary tests. */
export function evaluationConfig(args: {
  feature_contract_version?: GtoV31SourceSeal['feature_contract_version'];
  policy_export_schema?: 'smarter-poker.pio-policy.v4';
  datasetChecksum: string;
  kind: GtoV31EvaluationKind;
  family: GtoV31EvaluationFamily;
  scenarios: string[];
  engineCommit: string;
  /** The dataset's contract (gto_v31_datasets.evaluation_contract); v2 when absent. */
  contract?: 'gto_v31_candidate.v2' | 'gto_v31_candidate.v3';
}) {
  return {
    ...gtoV31PolicyContractIdentity(args),
    ...(args.feature_contract_version !== undefined
      ? { feature_contract_version: args.feature_contract_version }
      : {}),
    evaluation_contract: args.contract ?? 'gto_v31_candidate.v2',
    evaluation_kind: args.kind,
    game_family: args.family,
    dataset_checksum: args.datasetChecksum,
    candidate: 'v31_certified',
    evaluation_profile:
      args.kind === 'paired_replay'
        ? 'policy_only_duplicate_deals'
        : 'full_brain_duplicate_deal_league',
    scenarios: args.scenarios,
    evaluation_engine_commit: args.engineCommit,
  };
}

/**
 * horse_league_results is unique per (run_date, matchup). Epoch 1 keeps the
 * historical matchup; a later audited epoch for another engine commit carries
 * `_epoch<n>` (fn_gto_v31_evaluation_matchup in PostgreSQL is the authority).
 */
export function evaluationMatchup(
  kind: GtoV31EvaluationKind,
  family: GtoV31EvaluationFamily,
  datasetChecksum: string,
  epochNo: number
): string {
  if (!Number.isSafeInteger(epochNo) || epochNo < 1)
    throw new Error('v31_evaluation_epoch_invalid');
  return `gto_v31_${kind}_${family}_${datasetChecksum}${epochNo > 1 ? `_epoch${epochNo}` : ''}`;
}
