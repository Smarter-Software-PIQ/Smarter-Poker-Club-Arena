/**
 * Evaluate one sealed V31 dataset without activating it.
 *
 *   npm run horse:gto-v31-evaluate -- --dataset=<uuid>
 *
 * Runs every missing paired-replay and league family of the dataset's OPEN
 * evaluation epoch, writes immutable evidence, and asks PostgreSQL to mark the
 * dataset as a candidate. The epoch (opened by the qualification workflow with
 * an audited reason) pins exactly one protected engine commit; this checkout
 * must be that commit. Receipts of earlier epochs stay readable provenance and
 * never count. Promotion is not done here: it runs only through the
 * engine-locked atomic qualification operation (promote + eight-worker load +
 * readiness), which binds the evaluated and serving engine commits. This
 * script never moves real chips and never runs inside the live dealer process.
 *
 * Contract v3 (strict re-check, 2026-11-06): after the receipts the evaluator
 * records the epoch's execution anchor (execution digest + replay corpus and
 * digest, GtoV31Recheck.ts). With --recheck it instead re-checks a candidate
 * or active v3 playbook on THIS (newer) engine:
 *
 *   npm run horse:gto-v31-evaluate -- --dataset=<uuid> --recheck
 *
 * Both digests must be identical to the anchor before a hand is dealt; then
 * every certification table re-runs with the certification seeds and each
 * result is recorded on the re-check round. One loss retires the playbook.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  buildGtoV31EvaluationScenarios,
  runGtoV31EvaluationFamily,
  type GtoV31EvaluationFamily,
  type GtoV31EvaluationKind,
} from '../benchmark/GtoV31CandidateEvaluation.js';
import { gtoPostflopV31Dataset } from '../engine/GtoPostflopV31.js';
import { evaluationConfig, evaluationMatchup } from '../benchmark/GtoV31EvaluationConfig.js';
import {
  GTO_V31_EVALUATION_CONTRACT_V3,
  gtoV31V3Refusal,
  gtoV31V3Tables,
  runGtoV31EvaluationFamilyV3,
  type GtoV31V3CellContext,
  type GtoV31V3Component,
} from '../benchmark/GtoV31EvaluationContractV3.js';
import {
  loadGtoPostflopV31,
  loadGtoPostflopV31Evaluation,
} from '../services/GtoPostflopV31Loader.js';
import { supabase } from '../services/supabase/client.js';
import { gtoV31ReplayAnchorRefusal, gtoV31ReplayDigest } from '../benchmark/GtoV31ReplayDigest.js';
import {
  decodeGtoV31ReplayCorpus,
  encodeGtoV31ReplayCorpus,
  gtoV31ExecutionDigest,
  gtoV31RecheckIncumbent,
  gtoV31RecheckMatchup,
  recordGtoV31ReplayCorpus,
} from '../benchmark/GtoV31Recheck.js';
import { equityGovernor } from '../engine/EquityLoadGovernor.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FAMILIES: GtoV31EvaluationFamily[] = ['cash', 'spin', 'tourney_ev', 'tourney_icm'];
const KINDS: GtoV31EvaluationKind[] = ['paired_replay', 'league'];
const HEX40 = /^[0-9a-f]{40}$/;
/** Qualification refuses to pin an epoch to a commit whose evaluator lacks this protocol. */
const GTO_V31_EVALUATION_EPOCH_PROTOCOL = 'smarter-poker.gto-v31-evaluation-epochs.v1';

interface StatusEvaluation {
  kind: GtoV31EvaluationKind | 'heldout';
  game_family: GtoV31EvaluationFamily | 'all';
  verdict: 'win' | 'tie' | 'loss' | 'pass' | 'fail';
  evaluation_epoch_id?: string | null;
}

interface EvaluationEpoch {
  epoch_id: string;
  epoch_no: number;
  engine_commit: string;
  promoted_at: string | null;
}

interface DatasetStatus {
  dataset_id: string;
  dataset_checksum: string;
  state: string;
  current_epoch?: EvaluationEpoch | null;
  evaluations: StatusEvaluation[];
}

/** The dataset's open epoch must pin exactly this checked-out engine commit. */
function openEpochFor(status: DatasetStatus, engineCommit: string): EvaluationEpoch {
  const epoch = status.current_epoch;
  if (
    !epoch ||
    typeof epoch.epoch_id !== 'string' ||
    !Number.isSafeInteger(epoch.epoch_no) ||
    epoch.epoch_no < 1 ||
    epoch.promoted_at !== null ||
    epoch.engine_commit !== engineCommit
  ) {
    throw new Error(
      `the open evaluation epoch does not pin this engine commit (${engineCommit}); ` +
        'the qualification workflow opens the audited epoch before evaluation'
    );
  }
  return epoch;
}

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function seedFor(
  checksum: string,
  kind: GtoV31EvaluationKind,
  family: GtoV31EvaluationFamily
): number {
  return createHash('sha256').update(`${checksum}:${kind}:${family}`).digest().readUInt32BE(0) || 1;
}

function snakeComponents(result: Awaited<ReturnType<typeof runGtoV31EvaluationFamily>>) {
  return result.benchmarkComponents.map((component) => ({
    scenario: component.scenario,
    hands: component.hands,
    bb100: component.bb100,
    stderr: component.stderr,
    duration_ms: component.durationMs,
    illegal_actions: component.illegalActions,
    truncated_streets: component.truncatedStreets,
    candidate_policy_hits: component.candidatePolicyHits,
    candidate_execution_mismatches: component.candidateExecutionMismatches,
    candidate_node_roles: component.candidateNodeRoles,
  }));
}

/** v3 components: v2's ten fields, the executed cells and (league) the learning-off run. */
function snakeComponentsV3(components: GtoV31V3Component[]) {
  return components.map((c) => ({
    scenario: c.scenario,
    hands: c.hands,
    bb100: c.bb100,
    stderr: c.stderr,
    duration_ms: c.durationMs,
    illegal_actions: c.illegalActions,
    truncated_streets: c.truncatedStreets,
    candidate_policy_hits: c.candidatePolicyHits,
    candidate_execution_mismatches: c.candidateExecutionMismatches,
    candidate_node_roles: c.candidateNodeRoles,
    candidate_cells: c.candidateCells,
    ...(c.memoryOff
      ? {
          memory_off: {
            hands: c.memoryOff.hands,
            bb100: c.memoryOff.bb100,
            stderr: c.memoryOff.stderr,
            duration_ms: c.memoryOff.durationMs,
            illegal_actions: c.memoryOff.illegalActions,
            truncated_streets: c.memoryOff.truncatedStreets,
            candidate_policy_hits: c.memoryOff.candidatePolicyHits,
            candidate_execution_mismatches: c.memoryOff.candidateExecutionMismatches,
            candidate_cells: c.memoryOff.candidateCells,
          },
        }
      : {}),
  }));
}

interface EvaluationPlan {
  evaluation_contract: 'gto_v31_candidate.v2' | 'gto_v31_candidate.v3';
  families: Partial<Record<GtoV31EvaluationFamily, { tables: string[]; cells: string[] }>>;
}

/**
 * The database's plan for this dataset. v3 tables are derived twice, here
 * from the loaded cells and in PostgreSQL from gto_v31_runtime_cells; any
 * difference refuses before a single hand is dealt.
 */
async function evaluationPlan(
  datasetId: string,
  contexts: readonly GtoV31V3CellContext[]
): Promise<EvaluationPlan> {
  const { data, error } = await supabase.rpc('fn_gto_v31_evaluation_plan', {
    p_dataset_id: datasetId,
  });
  // Before the contract v3 migration installs there is no plan RPC and no v3
  // dataset can exist (the contract column arrives with it): contract v2.
  if (
    error &&
    (error.code === 'PGRST202' || /fn_gto_v31_evaluation_plan/.test(error.message ?? ''))
  ) {
    return { evaluation_contract: 'gto_v31_candidate.v2', families: {} };
  }
  if (error) throw new Error(error.message);
  const plan = data as EvaluationPlan | null;
  if (
    !plan ||
    (plan.evaluation_contract !== 'gto_v31_candidate.v2' &&
      plan.evaluation_contract !== GTO_V31_EVALUATION_CONTRACT_V3) ||
    !plan.families ||
    typeof plan.families !== 'object'
  ) {
    throw new Error('the V31 evaluation plan is missing or malformed');
  }
  if (plan.evaluation_contract === GTO_V31_EVALUATION_CONTRACT_V3) {
    for (const family of FAMILIES) {
      const local = gtoV31V3Tables(family, contexts);
      const remote = plan.families[family]?.tables ?? [];
      if (canonicalJson(local) !== canonicalJson(remote)) {
        throw new Error(
          `${family}: the evaluator derives tables ${JSON.stringify(local)} but the database ` +
            `derives ${JSON.stringify(remote)}; refusing to evaluate`
        );
      }
      const localCells = contexts
        .filter((c) => c.game_family === family)
        .map((c) => c.cell_key_checksum)
        .sort();
      const remoteCells = [...(plan.families[family]?.cells ?? [])].sort();
      if (canonicalJson(localCells) !== canonicalJson(remoteCells)) {
        throw new Error(`${family}: the loaded cells differ from the database's cells`);
      }
    }
  }
  return plan;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  const scalar = JSON.stringify(value);
  if (scalar === undefined) throw new Error('evaluation configuration is not JSON');
  return scalar;
}

function evaluationEngineCommit(): string {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  }).trim();
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (!HEX40.test(head)) throw new Error('cannot prove the evaluation engine commit');
  const worktreeChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (worktreeChanges) {
    throw new Error('the evaluation checkout is not clean; commit or remove changes before gating');
  }
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', head, 'origin/main'], {
      cwd: root,
      stdio: 'ignore',
    });
  } catch {
    throw new Error('the evaluation engine commit is not published on origin/main');
  }
  const declared = process.env.GIT_COMMIT_SHA?.trim().toLowerCase();
  if (declared && (!HEX40.test(declared) || declared !== head)) {
    throw new Error(`GIT_COMMIT_SHA does not match the checked-out evaluation engine (${head})`);
  }
  return head;
}

async function certificationStatus(datasetId: string): Promise<DatasetStatus> {
  const { data, error } = await supabase.rpc('ca_gto_v31_certification_status', {
    p_dataset_id: datasetId,
  });
  if (error) throw new Error(error.message);
  const datasets = (data as { datasets?: DatasetStatus[] } | null)?.datasets;
  if (!Array.isArray(datasets) || datasets.length !== 1) {
    throw new Error('the requested V31 dataset does not exist or is not visible');
  }
  return datasets[0];
}

async function existingResult(args: {
  runDate: string;
  matchup: string;
  configA: Record<string, unknown>;
  configB: Record<string, unknown>;
}): Promise<number | null> {
  const { data, error } = await supabase
    .from('horse_league_results')
    .select(
      'id,hands,illegal_actions,truncated_streets,candidate_policy_hits,candidate_execution_mismatches,candidate_benchmark_components,config_a,config_b'
    )
    .eq('run_date', args.runDate)
    .eq('matchup', args.matchup)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as {
    id: number;
    hands: number;
    illegal_actions: number;
    truncated_streets: number;
    candidate_policy_hits: number;
    candidate_execution_mismatches: number;
    candidate_benchmark_components: unknown[];
    config_a: unknown;
    config_b: unknown;
  };
  if (
    row.hands < 10_000 ||
    row.illegal_actions !== 0 ||
    row.truncated_streets !== 0 ||
    row.candidate_policy_hits <= 0 ||
    row.candidate_execution_mismatches !== 0 ||
    !Array.isArray(row.candidate_benchmark_components) ||
    row.candidate_benchmark_components.length === 0 ||
    row.candidate_benchmark_components.some(
      (component) =>
        !component ||
        typeof component !== 'object' ||
        (component as { candidate_execution_mismatches?: unknown })
          .candidate_execution_mismatches !== 0
    ) ||
    canonicalJson(row.config_a) !== canonicalJson(args.configA) ||
    canonicalJson(row.config_b) !== canonicalJson(args.configB)
  ) {
    throw new Error(
      `existing evaluation result ${row.id} is incomplete or has different provenance; refusing to reuse it`
    );
  }
  return row.id;
}

async function persistEvaluation(args: {
  feature_contract_version?:
    | 'rank-suit-count-v1'
    | 'holdem-board-relative-v2'
    | 'holdem-public-hist215-v1'
    | 'holdem-public-hist215-v2'
    | 'holdem-public-hist215-v3';
  policy_export_schema?: 'smarter-poker.pio-policy.v4';
  datasetId: string;
  datasetChecksum: string;
  incumbentChecksum: string;
  engineCommit: string;
  epochNo: number;
  kind: GtoV31EvaluationKind;
  family: GtoV31EvaluationFamily;
  /** v3: the family's derived tables and sealed cells; absent = contract v2. */
  v3?: { tables: string[]; cells: string[] };
  /** A strict re-check round of a v3 playbook on this engine (never a certification receipt). */
  recheck?: { roundId: string };
}): Promise<RecheckRecord | null> {
  if (args.recheck && !args.v3) throw new Error('only a contract v3 playbook is re-checked');
  const runDate = new Date().toISOString().slice(0, 10);
  const base = evaluationMatchup(args.kind, args.family, args.datasetChecksum, args.epochNo);
  // A re-check stores its run under its own name (results are unique per day and name).
  const matchup = args.recheck ? gtoV31RecheckMatchup(base, args.engineCommit) : base;
  const scenarios = args.v3
    ? [...args.v3.tables]
    : buildGtoV31EvaluationScenarios(args.family, args.kind, args.datasetChecksum).map(
        (scenario) => scenario.key
      );
  const configA = evaluationConfig({
    ...args,
    scenarios,
    contract: args.v3 ? GTO_V31_EVALUATION_CONTRACT_V3 : 'gto_v31_candidate.v2',
  });
  const configB = {
    incumbent_dataset_checksum: args.incumbentChecksum,
    candidate: 'incumbent',
  };
  let resultId = await existingResult({ runDate, matchup, configA, configB });
  if (resultId === null && args.v3) {
    const { result, components, pairs } = await runGtoV31EvaluationFamilyV3({
      family: args.family,
      kind: args.kind,
      datasetChecksum: args.datasetChecksum,
      tables: args.v3.tables,
      runSeed: seedFor(args.datasetChecksum, args.kind, args.family),
    });
    const refusal = gtoV31V3Refusal(args.kind, args.v3.tables, pairs, components, args.v3.cells);
    if (refusal) {
      throw new Error(`${args.kind}/${args.family} cannot certify under contract v3: ${refusal}`);
    }
    const { data, error } = await supabase
      .from('horse_league_results')
      .insert({
        run_date: runDate,
        matchup,
        hands: result.hands,
        bb100: result.bb100,
        stderr: result.stderr,
        config_a: configA,
        config_b: configB,
        duration_ms: result.durationMs,
        illegal_actions: result.illegalActions + result.truncatedStreets,
        truncated_streets: result.truncatedStreets,
        candidate_policy_hits: result.candidatePolicyHits,
        candidate_execution_mismatches: result.candidateExecutionMismatches,
        candidate_node_roles: result.candidateNodeRoles,
        candidate_benchmark_components: snakeComponentsV3(components),
      })
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error(`${args.kind}/${args.family} insert returned no evaluation receipt`);
    resultId = Number((data as { id: number }).id);
    const off = components.filter((c) => c.memoryOff);
    console.log(
      `[gto-v31-evaluate] v3 ${args.kind}/${args.family}: ${result.bb100.toFixed(4)} bb/100 ` +
        `(se ${result.stderr.toFixed(4)}) over ${components.length} tables, ` +
        `${result.candidatePolicyHits} candidate hits, ${result.candidateCells?.length ?? 0} cells` +
        (off.length
          ? `; memory off: ${off.map((c) => `${c.scenario} ${c.memoryOff!.bb100.toFixed(3)}`).join(', ')}`
          : '')
    );
  } else if (resultId === null) {
    const result = await runGtoV31EvaluationFamily({
      family: args.family,
      kind: args.kind,
      datasetChecksum: args.datasetChecksum,
      runSeed: seedFor(args.datasetChecksum, args.kind, args.family),
    });
    if (
      result.hands < 10_000 ||
      result.illegalActions !== 0 ||
      result.truncatedStreets !== 0 ||
      result.candidateExecutionMismatches !== 0 ||
      result.candidatePolicyHits <= 0 ||
      result.benchmarkComponents.some(
        (component) =>
          component.candidatePolicyHits <= 0 || component.candidateExecutionMismatches !== 0
      )
    ) {
      throw new Error(
        `${args.kind}/${args.family} did not safely exercise the candidate in every context: ` +
          `hands=${result.hands} hits=${result.candidatePolicyHits} illegal=${result.illegalActions} ` +
          `truncated=${result.truncatedStreets} execution_mismatches=${result.candidateExecutionMismatches}`
      );
    }
    const { data, error } = await supabase
      .from('horse_league_results')
      .insert({
        run_date: runDate,
        matchup,
        hands: result.hands,
        bb100: result.bb100,
        stderr: result.stderr,
        config_a: configA,
        config_b: configB,
        duration_ms: result.durationMs,
        illegal_actions: result.illegalActions + result.truncatedStreets,
        truncated_streets: result.truncatedStreets,
        candidate_policy_hits: result.candidatePolicyHits,
        candidate_execution_mismatches: result.candidateExecutionMismatches,
        candidate_node_roles: result.candidateNodeRoles,
        candidate_benchmark_components: snakeComponents(result),
      })
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(`${args.kind}/${args.family} insert returned no evaluation receipt`);
    }
    resultId = Number((data as { id: number }).id);
    console.log(
      `[gto-v31-evaluate] ${args.kind}/${args.family}: ${result.bb100.toFixed(4)} bb/100 ` +
        `(se ${result.stderr.toFixed(4)}), ${result.candidatePolicyHits} candidate hits`
    );
  } else {
    console.log(
      `[gto-v31-evaluate] reusing complete result ${resultId} for ${args.kind}/${args.family}`
    );
  }

  if (args.recheck) {
    const { data, error } = await supabase.rpc('fn_gto_v31_record_recheck_result', {
      p_round_id: args.recheck.roundId,
      p_evaluation_kind: args.kind,
      p_game_family: args.family,
      p_source_result_id: resultId,
    });
    if (error) throw new Error(error.message);
    return data as RecheckRecord;
  }
  const { error } = await supabase.rpc('fn_gto_v31_record_evaluation', {
    p_dataset_id: args.datasetId,
    p_evaluation_kind: args.kind,
    p_game_family: args.family,
    p_source_result_id: resultId,
  });
  if (error) throw new Error(error.message);
  return null;
}

interface RecheckRecord {
  round_id: string;
  verdict?: 'win' | 'tie' | 'loss';
  outcome: 'passed' | 'retired' | 'abandoned' | null;
  recorded: boolean;
  remaining?: number;
}

interface RecheckAnchor {
  epoch_id: string;
  engine_commit: string;
  execution_digest: string;
  replay_corpus_checksum: string;
  replay_digest: string;
  replay_states: number;
  corpus_sha256: string;
}

interface RecheckStatus {
  dataset_id: string;
  state: string | null;
  evaluation_contract: string | null;
  recheck_epoch_id: string | null;
  certification: Array<{
    kind: GtoV31EvaluationKind;
    family: GtoV31EvaluationFamily;
    verdict: string;
    incumbent_dataset_checksum: string | null;
  }>;
  anchors: RecheckAnchor[];
  rounds: Array<{ round_id: string; serving_commit: string; outcome: string | null }>;
}

async function rpcJson<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

/**
 * Record the epoch's execution anchor once (contract v3). Before the strict
 * re-check migration installs there is no RPC; the epoch then simply has no
 * anchor yet, and a resumed evaluation records it once the RPC exists.
 */
async function recordExecutionAnchor(args: {
  datasetId: string;
  datasetChecksum: string;
  engineCommit: string;
  epochId: string;
  families: Array<{ family: GtoV31EvaluationFamily; tables: string[] }>;
}): Promise<void> {
  const { data: statusData, error: statusError } = await supabase.rpc('fn_gto_v31_recheck_status', {
    p_dataset_id: args.datasetId,
  });
  if (
    statusError &&
    (statusError.code === 'PGRST202' || /fn_gto_v31_recheck_status/.test(statusError.message ?? ''))
  ) {
    console.warn(
      '[gto-v31-evaluate] the strict re-check migration is not installed yet; no execution anchor recorded'
    );
    return;
  }
  if (statusError) throw new Error(statusError.message);
  const existing = (statusData as RecheckStatus).anchors.find((a) => a.epoch_id === args.epochId);
  if (existing) {
    console.log(
      `[gto-v31-evaluate] execution anchor already recorded (replay ${existing.replay_digest.slice(0, 12)})`
    );
    return;
  }
  const executionDigest = await gtoV31ExecutionDigest(args.engineCommit);
  const corpus = await recordGtoV31ReplayCorpus({
    datasetChecksum: args.datasetChecksum,
    families: args.families,
    seedFor: (kind, family) => seedFor(args.datasetChecksum, kind, family),
  });
  const replay = gtoV31ReplayDigest(corpus);
  const refusal = gtoV31ReplayAnchorRefusal(replay);
  if (refusal) throw new Error(`the replay corpus cannot anchor this playbook: ${refusal}`);
  const encoded = encodeGtoV31ReplayCorpus(corpus);
  const recorded = await rpcJson<{ recorded: boolean }>('fn_gto_v31_record_execution_anchor', {
    p_epoch_id: args.epochId,
    p_execution_digest: executionDigest,
    p_replay_corpus_checksum: corpus.checksum,
    p_replay_digest: replay.digest,
    p_replay_states: replay.states,
    p_corpus_gzip_base64: encoded.base64,
    p_recorded_by: `gto-v31-evaluate:${args.engineCommit}`,
  });
  console.log(
    `[gto-v31-evaluate] execution anchor ${recorded.recorded ? 'recorded' : 'already present'}: ` +
      `execution ${executionDigest.slice(0, 12)}, replay ${replay.digest.slice(0, 12)} over ` +
      `${replay.states} states (${corpus.recorded} recorded, ${encoded.bytes} bytes gzipped)`
  );
}

/** --recheck: the strict re-check of a candidate or active v3 playbook on this engine. */
async function recheck(datasetId: string, engineCommit: string): Promise<void> {
  const loaded = await loadGtoPostflopV31Evaluation(datasetId, { recheck: true });
  const status = await certificationStatus(datasetId);
  if (status.dataset_checksum !== loaded.checksum) {
    throw new Error('re-check status and loaded cells disagree on dataset checksum');
  }
  if (!['candidate', 'active'].includes(status.state)) {
    throw new Error(`dataset state ${status.state} is not re-checked`);
  }
  const plan = await evaluationPlan(datasetId, loaded.contexts);
  if (plan.evaluation_contract !== GTO_V31_EVALUATION_CONTRACT_V3) {
    throw new Error(
      'only a contract v3 playbook is re-checked; contract v2 keeps its closure rule'
    );
  }
  const rs = await rpcJson<RecheckStatus>('fn_gto_v31_recheck_status', { p_dataset_id: datasetId });
  const epoch = status.current_epoch;
  if (!epoch || !rs.recheck_epoch_id || epoch.epoch_id !== rs.recheck_epoch_id) {
    throw new Error('the certification status and the re-check disagree on the certified epoch');
  }
  const anchor = rs.anchors.find((a) => a.epoch_id === epoch.epoch_id);
  if (!anchor) throw new Error('the playbook has no execution anchor to re-check against');
  if (anchor.engine_commit === engineCommit) {
    throw new Error('this is the certifying engine itself; it needs no re-check');
  }
  // The baseline arm plays the live store, so it must hold exactly what it
  // held at certification. Re-checking the ACTIVE playbook must never load
  // the live store: it would hold the playbook itself, and the playbook would
  // play itself to a meaningless tie.
  const { incumbent, loadLiveStore } = gtoV31RecheckIncumbent(rs.certification, loaded.checksum);
  if (loadLiveStore) await loadGtoPostflopV31();
  const incumbentNow = gtoPostflopV31Dataset()?.checksum ?? 'legacy_v30';
  if (incumbentNow !== incumbent) {
    throw new Error(
      `the playbook was certified against ${incumbent} but this engine would play against ` +
        `${incumbentNow}; the re-check cannot reproduce its baseline`
    );
  }

  // 1 + 2: both digests, before a single hand is dealt.
  const executionDigest = await gtoV31ExecutionDigest(engineCommit);
  const stored = await rpcJson<{ corpus_gzip_base64: string }>('fn_gto_v31_replay_corpus', {
    p_epoch_id: epoch.epoch_id,
  });
  const corpus = decodeGtoV31ReplayCorpus(stored.corpus_gzip_base64, {
    sha256: anchor.corpus_sha256,
    checksum: anchor.replay_corpus_checksum,
    datasetChecksum: loaded.checksum,
  });
  const replay = gtoV31ReplayDigest(corpus);
  console.log(
    `[gto-v31-evaluate] re-check of ${loaded.checksum.slice(0, 12)} on ${engineCommit}: ` +
      `execution ${executionDigest === anchor.execution_digest ? 'identical' : 'DIFFERS'}, ` +
      `replay ${replay.digest === anchor.replay_digest ? 'identical' : 'DIFFERS'} ` +
      `(${replay.states} states, ${replay.unfaithful} decisions changed)`
  );
  if (executionDigest !== anchor.execution_digest || replay.digest !== anchor.replay_digest) {
    throw new Error(
      'this engine is not execution-identical to the certified one: a full new certification is required'
    );
  }

  // 3: the round, every certification table on this engine.
  const opened = await rpcJson<
    RecheckRecord & { results?: Array<{ kind: string; family: string }> }
  >('fn_gto_v31_open_recheck_round', {
    p_dataset_id: datasetId,
    p_serving_commit: engineCommit,
    p_execution_digest: executionDigest,
    p_replay_digest: replay.digest,
    p_opened_by: `gto-v31-evaluate:${engineCommit}`,
    p_reason: `Strict re-check of ${loaded.checksum} on engine ${engineCommit} after identical execution and replay digests`,
  });
  if (opened.outcome === 'passed') {
    console.log(
      `[gto-v31-evaluate] engine ${engineCommit} already passed round ${opened.round_id}`
    );
    return;
  }
  const done = new Set((opened.results ?? []).map((r) => `${r.kind}/${r.family}`));
  const families = FAMILIES.filter((family) => (plan.families[family]?.tables.length ?? 0) > 0);
  for (const kind of KINDS) {
    for (const family of families) {
      if (done.has(`${kind}/${family}`)) {
        console.log(`[gto-v31-evaluate] re-check ${kind}/${family}: already recorded`);
        continue;
      }
      const record = await persistEvaluation({
        ...(Object.prototype.hasOwnProperty.call(loaded, 'policy_export_schema')
          ? { policy_export_schema: loaded.policy_export_schema }
          : {}),
        ...(loaded.feature_contract_version !== undefined
          ? { feature_contract_version: loaded.feature_contract_version }
          : {}),
        datasetId,
        datasetChecksum: loaded.checksum,
        incumbentChecksum: incumbentNow,
        engineCommit,
        epochNo: epoch.epoch_no,
        kind,
        family,
        v3: plan.families[family]!,
        recheck: { roundId: opened.round_id },
      });
      console.log(
        `[gto-v31-evaluate] re-check ${kind}/${family}: ${record?.verdict ?? 'unrecorded'}` +
          (record?.remaining !== undefined ? `, ${record.remaining} to go` : '')
      );
      if (record?.outcome === 'retired') {
        throw new Error(
          `STRICT re-check loss on ${kind}/${family}: the playbook is retired for good and every binding is revoked`
        );
      }
      if (record?.outcome === 'passed') {
        console.log(
          `[gto-v31-evaluate] engine ${engineCommit} passed the strict re-check (round ${opened.round_id})`
        );
        return;
      }
      if (record?.outcome === 'abandoned' || record?.recorded === false) {
        throw new Error(
          `the re-check round closed (${record.outcome}) before every table was recorded`
        );
      }
    }
  }
  throw new Error(
    'every certification table was re-run but the round did not pass; inspect the round'
  );
}

async function main(): Promise<void> {
  const datasetId = arg('dataset');
  if (!datasetId || !UUID.test(datasetId)) {
    throw new Error('--dataset=<uuid> is required');
  }
  if (process.argv.includes('--promote')) {
    throw new Error('promotion runs only through the engine-locked atomic qualification operation');
  }
  const engineCommit = evaluationEngineCommit();
  // A governed Monte Carlo scales its sample count with host event-loop lag,
  // so the same seed and engine would give load-dependent verdicts. The
  // qualification job exports EQUITY_GOVERNOR=off; refuse rather than trust it.
  if (equityGovernor.snapshot().enabled) {
    throw new Error('the V31 evaluation must run with EQUITY_GOVERNOR=off');
  }
  if (process.argv.includes('--recheck')) {
    await recheck(datasetId, engineCommit);
    return;
  }
  await loadGtoPostflopV31();
  const incumbentChecksum = gtoPostflopV31Dataset()?.checksum ?? 'legacy_v30';
  const loaded = await loadGtoPostflopV31Evaluation(datasetId);
  let status = await certificationStatus(datasetId);
  if (status.dataset_checksum !== loaded.checksum) {
    throw new Error('candidate status and loaded cells disagree on dataset checksum');
  }
  if (!['evaluating', 'candidate'].includes(status.state)) {
    throw new Error(`dataset state ${status.state} cannot be evaluated`);
  }
  const epoch = openEpochFor(status, engineCommit);
  const plan = await evaluationPlan(datasetId, loaded.contexts);
  const v3 = plan.evaluation_contract === GTO_V31_EVALUATION_CONTRACT_V3;
  // v3 certifies exactly the families the dataset has cells in.
  const families = v3
    ? FAMILIES.filter((family) => (plan.families[family]?.tables.length ?? 0) > 0)
    : FAMILIES;
  console.log(
    `[gto-v31-evaluate] ${plan.evaluation_contract}: ${families
      .map((f) => (v3 ? `${f} [${plan.families[f]!.tables.join(', ')}]` : f))
      .join('; ')}`
  );
  console.log(
    `[gto-v31-evaluate] ${GTO_V31_EVALUATION_EPOCH_PROTOCOL}: epoch ${epoch.epoch_no} pins ${engineCommit}`
  );

  for (const kind of KINDS) {
    for (const family of families) {
      const prior = status.evaluations.find(
        (evaluation) =>
          evaluation.kind === kind &&
          evaluation.game_family === family &&
          evaluation.evaluation_epoch_id === epoch.epoch_id
      );
      if (prior) {
        if (prior.verdict === 'loss') {
          throw new Error(`${kind}/${family} already failed; the candidate must not be promoted`);
        }
        console.log(`[gto-v31-evaluate] ${kind}/${family}: already ${prior.verdict}`);
        continue;
      }
      await persistEvaluation({
        ...(Object.prototype.hasOwnProperty.call(loaded, 'policy_export_schema')
          ? { policy_export_schema: loaded.policy_export_schema }
          : {}),
        ...(loaded.feature_contract_version !== undefined
          ? { feature_contract_version: loaded.feature_contract_version }
          : {}),
        datasetId,
        datasetChecksum: loaded.checksum,
        incumbentChecksum,
        engineCommit,
        epochNo: epoch.epoch_no,
        kind,
        family,
        ...(v3 ? { v3: plan.families[family]! } : {}),
      });
      status = await certificationStatus(datasetId);
      openEpochFor(status, engineCommit);
    }
  }

  if (v3) {
    await recordExecutionAnchor({
      datasetId,
      datasetChecksum: loaded.checksum,
      engineCommit,
      epochId: epoch.epoch_id,
      families: families.map((family) => ({ family, tables: plan.families[family]!.tables })),
    });
  }

  if (status.state === 'evaluating') {
    const { error } = await supabase.rpc('fn_gto_v31_mark_candidate', {
      p_dataset_id: datasetId,
    });
    if (error) throw new Error(error.message);
    status = await certificationStatus(datasetId);
  }
  if (status.state !== 'candidate') {
    throw new Error(`all evaluation calls returned but dataset state is ${status.state}`);
  }
  console.log(
    `[gto-v31-evaluate] candidate gates passed for ${loaded.checksum} ` +
      `(epoch ${epoch.epoch_no}, engine ${engineCommit}); not activated`
  );
}

const { channelHub } = await import('../hub/ChannelHub.js');
// ChannelHub's import-time interval keeps the event loop alive; without this
// close a failed or finished evaluation never reaches beforeExit, so the
// finite worker never acknowledges and the job idles to its timeout.
main()
  .catch((error) => {
    console.error('[gto-v31-evaluate] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => channelHub.close());
