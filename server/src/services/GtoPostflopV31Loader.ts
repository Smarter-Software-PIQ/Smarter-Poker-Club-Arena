/**
 * GTO POSTFLOP V31 LOADER (2026-08-30)
 *
 * Hydrates the active certified V31 dataset into the in-memory policy store.
 * The RPC exposes only a dataset that passed provenance, held-out, replay and
 * league promotion gates. The legacy `gto_postflop_v31` table is intentionally
 * not read: it has no source seal and cannot distinguish response nodes.
 *
 * Paged at 500 rows so no single response carries an unbounded amount of
 * jsonb, and refreshed every 6 hours so a newly promoted immutable dataset
 * reaches the fleet without an engine deploy. The live worker explicitly
 * awaits the initial load; this module's timer owns periodic refresh plus
 * bounded failed-load recovery. Evaluating and candidate datasets remain
 * physically unavailable to this path until PostgreSQL promotes one active.
 *
 * COLLECT-THEN-SWAP, deliberately: every page is fetched and every row is
 * revalidated before the store is touched. A failed or partial load leaves
 * the last known-good snapshot in place.
 *
 * The 80 GB warehouse is never touched at runtime.
 *
 * A failed load is loud but not fatal: the lookup reports an empty store, the
 * consult falls back to V30 and then to the heuristics.
 */

import type { GtoV31V3CellContext } from '../benchmark/GtoV31EvaluationContractV3.js';
import { supabase } from './supabase/client.js';
import { reportError } from './errorReporter.js';
import {
  replaceGtoPostflopV31Async,
  replaceGtoPostflopV31Evaluation,
  replaceGtoPostflopV31Recheck,
  gtoPostflopV31Count,
  gtoPostflopV31Dataset,
  gtoPostflopV31EvaluationCount,
  gtoPostflopV31RangeRefusals,
  type GtoV31RuntimeRow,
  type GtoV31SourceSeal,
  gtoV31FeatureContractVersion,
  gtoV31PolicyContractValid,
} from '../engine/GtoPostflopV31.js';
import { createAdaptiveRefreshLoop } from './AdaptiveRefreshLoop.js';

const REFRESH_MS = 6 * 60 * 60_000;
const RETRY_MS = 30_000;
const MAX_RETRY_MS = 5 * 60_000;
const PAGE = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
let activeLoadGeneration = 0;
const SHA = /^[0-9a-f]{40}$/;

/**
 * SERVING BINDING GATE (live decision workers only). A promoted dataset was
 * evaluated on one engine decision closure; only an engine commit that the
 * qualification operation proved closure-identical and recorded in
 * gto_v31_serving_bindings may serve it. Any other build - a later release, a
 * rollback, a missing GIT_COMMIT_SHA - serves the empty store (the existing
 * V30/heuristic fallback) and reports the refusal. Offline evaluators never
 * arm the gate: their incumbent must be the database's active dataset.
 */
let servingGate: { commit: string | null } | null = null;
export function requireGtoV31ServingBinding(engineCommit: string | undefined): void {
  const commit = engineCommit?.trim().toLowerCase() ?? '';
  servingGate = { commit: SHA.test(commit) && commit !== '0'.repeat(40) ? commit : null };
}
/** Test seam only. */
export function _resetGtoV31ServingBinding(): void {
  servingGate = null;
}
interface ServingAdmission {
  active: { dataset_id: string; dataset_checksum: string } | null;
  admitted: boolean;
}
async function servingAdmission(commit: string | null): Promise<ServingAdmission> {
  if (commit === null) return { active: { dataset_id: '', dataset_checksum: '' }, admitted: false };
  const { data, error } = await supabase.rpc('fn_gto_v31_serving_admission', {
    p_engine_commit: commit,
  });
  if (error) throw new Error(error.message);
  const v = data as any;
  if (
    !v ||
    typeof v !== 'object' ||
    typeof v.admitted !== 'boolean' ||
    !(
      v.active === null ||
      (typeof v.active === 'object' &&
        UUID.test(v.active.dataset_id ?? '') &&
        /^[0-9a-f]{64}$/.test(v.active.dataset_checksum ?? ''))
    ) ||
    (v.active === null && v.admitted)
  )
    throw new Error('v31_serving_admission_invalid');
  return { active: v.active, admitted: v.admitted };
}

// A missing/malformed RPC body is not an authoritative empty dataset. Keep
// full policy validation in the real store; these checks bind transport shape
// and the requested offline identity before any candidate store can change.
function readV31CellPage(data: unknown, expectedDatasetId?: string): GtoV31RuntimeRow[] {
  if (!Array.isArray(data)) throw new Error('v31_cell_page_not_array');
  if (data.length > PAGE) throw new Error('v31_cell_page_overflow');
  for (const row of data) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('v31_cell_page_row_invalid');
    }
    if (expectedDatasetId !== undefined && row.dataset_id !== expectedDatasetId) {
      throw new Error('v31_evaluation_dataset_mismatch');
    }
    if (row.feature_contract_version !== null && gtoV31FeatureContractVersion(row) === null)
      throw new Error('v31_feature_contract_unknown');
    if (row.policy_export_schema !== null && !gtoV31PolicyContractValid(row))
      throw new Error('v31_policy_contract_unknown');
  }
  return data.map((row) => {
    // Nullable SQL metadata is historical omission, not an explicit version.
    const legacy = { ...row };
    if (row.feature_contract_version === null) delete legacy.feature_contract_version;
    if (row.policy_export_schema === null) delete legacy.policy_export_schema;
    return legacy;
  }) as GtoV31RuntimeRow[];
}

/**
 * RANGE PROVENANCE (2026-11-12). The registration of the dataset's round
 * declares, per cell, how its ranges were built (gto_v31_round_registrations.
 * cell_provenance). It is read once per load, never per decision. Any failure
 * to read it - the column or table not installed, no registration, a
 * transport error - yields null, and the store refuses every cell: a cell
 * whose range assumption is unstated is never served.
 */
async function readRangeProvenance(datasetKey: unknown): Promise<unknown> {
  if (typeof datasetKey !== 'string' || datasetKey === '') return null;
  try {
    const { data, error } = await supabase
      .from('gto_v31_round_registrations')
      .select('cell_provenance')
      .eq('dataset_key', datasetKey)
      .maybeSingle();
    if (error || !data) return null;
    return (data as { cell_provenance?: unknown }).cell_provenance ?? null;
  } catch {
    return null;
  }
}
let rangeRefusalLoggedFor: string | null = null;

async function loadGtoPostflopV31Attempt(): Promise<{ ok: boolean; count: number }> {
  const generation = ++activeLoadGeneration;
  const gate = servingGate;
  let admissionUnreadable = false;
  const admit = async (commit: string | null) => {
    try {
      return await servingAdmission(commit);
    } catch (error) {
      admissionUnreadable = true;
      throw error;
    }
  };
  try {
    let admittedId: string | null = null;
    if (gate) {
      const admission = await admit(gate.commit);
      if (admission.active && !admission.admitted) {
        // Fail closed: never serve a dataset this build was not proven against.
        if (generation !== activeLoadGeneration) throw new Error('v31_active_load_superseded');
        const cleared = await replaceGtoPostflopV31Async(
          [],
          () => generation === activeLoadGeneration
        );
        console.warn(
          `[GtoPostflopV31Loader] V31_SERVING_BINDING_REFUSED: active dataset ${admission.active.dataset_id || 'unknown'} is not bound to engine ${gate.commit ?? 'unknown'}; serving the empty store`
        );
        reportError(new Error('v31_serving_binding_refused'), 'GtoPostflopV31Loader.gate');
        return { ok: true, count: cleared };
      }
      admittedId = admission.active?.dataset_id ?? null;
      // A different dataset is never kept as a "last known-good" fallback:
      // drop it before fetching, so a failed load leaves the empty store and
      // two datasets can never be served side by side.
      const held = gtoPostflopV31Dataset();
      if (held && held.id !== admittedId) {
        if (generation !== activeLoadGeneration) throw new Error('v31_active_load_superseded');
        await replaceGtoPostflopV31Async([], () => generation === activeLoadGeneration);
      }
    }
    const rows: GtoV31RuntimeRow[] = [];
    for (let offset = 0; ; ) {
      const { data, error } = await supabase.rpc('fn_gto_v31_active_cells', {
        p_offset: offset,
        p_limit: PAGE,
      });
      if (error) throw new Error(error.message);
      const page = readV31CellPage(data);
      if (page.length === 0) break;
      rows.push(...page);
      offset += page.length;
      // Parametric responses deliberately page one full model at a time.
      // A short page is therefore not EOF. The sealed dataset census bounds
      // collection; the detached store validates every row and exact count.
      if (rows[0].policy_representation === 'public_hist215_v1') {
        if (!Number.isSafeInteger(rows[0].dataset_cells) || rows[0].dataset_cells < 1)
          throw new Error('v31_dataset_cell_count_invalid');
        if (rows.length >= rows[0].dataset_cells) break;
        continue;
      }
      if (page.length < PAGE) break;
    }
    // Full success only. The validator performs the atomic swap.
    // An older periodic read must not overwrite a newer explicit refresh,
    // including when its old authoritative-empty response arrives last.
    if (generation !== activeLoadGeneration) throw new Error('v31_active_load_superseded');
    if (gate) {
      if (rows.some((row) => (row as { dataset_id?: unknown }).dataset_id !== admittedId))
        throw new Error('v31_serving_admission_dataset_changed');
      // Re-read the binding after the collection: a revocation that landed
      // while pages were read wins, and the store is emptied instead.
      const recheck = await admit(gate.commit);
      if (
        (recheck.active?.dataset_id ?? null) !== admittedId ||
        (admittedId !== null && !recheck.admitted)
      ) {
        if (generation !== activeLoadGeneration) throw new Error('v31_active_load_superseded');
        const cleared = await replaceGtoPostflopV31Async(
          [],
          () => generation === activeLoadGeneration
        );
        reportError(new Error('v31_serving_binding_refused'), 'GtoPostflopV31Loader.gate');
        return { ok: true, count: cleared };
      }
    }
    const rangeProvenance = rows.length > 0 ? await readRangeProvenance(rows[0].dataset_key) : null;
    const applied = await replaceGtoPostflopV31Async(
      rows,
      () => generation === activeLoadGeneration,
      rangeProvenance
    );
    const refused = gtoPostflopV31RangeRefusals();
    if (Object.keys(refused).length > 0 && rangeRefusalLoggedFor !== rows[0]?.dataset_checksum) {
      rangeRefusalLoggedFor = rows[0]?.dataset_checksum ?? null;
      console.warn(
        `[GtoPostflopV31Loader] V31_RANGE_PROVENANCE_REFUSED: dataset ${rows[0]?.dataset_id ?? 'unknown'} serves ${applied} of ${rows.length} cells; refused ${JSON.stringify(refused)}`
      );
    }
    console.log(
      `[GtoPostflopV31Loader] ${applied} certified solver cells loaded (${gtoPostflopV31Count()} in the store)`
    );
    return { ok: true, count: applied };
  } catch (err) {
    // Fail closed: a live worker that cannot read its serving binding does
    // not keep serving a dataset it can no longer prove it may serve.
    if (
      gate &&
      admissionUnreadable &&
      gtoPostflopV31Dataset() &&
      generation === activeLoadGeneration
    ) {
      try {
        await replaceGtoPostflopV31Async([], () => generation === activeLoadGeneration);
      } catch {
        /* superseded by a newer attempt, which owns the store */
      }
    }
    reportError(err, 'GtoPostflopV31Loader.load');
    console.warn(
      `[GtoPostflopV31Loader] certified V31 load FAILED - the brain keeps the last sealed snapshot or falls back (${gtoPostflopV31Count()} cached)`
    );
    return { ok: false, count: 0 };
  }
}

const refreshLoop = createAdaptiveRefreshLoop({
  load: loadGtoPostflopV31Attempt,
  refreshMs: REFRESH_MS,
  retryMs: RETRY_MS,
  maxRetryMs: MAX_RETRY_MS,
});

export async function loadGtoPostflopV31(): Promise<number> {
  return (await refreshLoop.runNow()).count;
}

/** One explicit administrative attempt. Does not arm backoff or a retry. */
export function loadGtoPostflopV31Once(): Promise<{ ok: boolean; count: number }> {
  return loadGtoPostflopV31Attempt();
}

/**
 * Hydrate one sealed, not-yet-active dataset for an offline evaluation run.
 * This never mutates the live store and therefore cannot activate a candidate.
 */
export async function loadGtoPostflopV31Evaluation(
  datasetId: string,
  options: { recheck?: boolean } = {}
): Promise<{
  checksum: string;
  cells: number;
  /** Every loaded cell's table geometry (V31 evaluation contract v3). */
  contexts: GtoV31V3CellContext[];
  feature_contract_version?: GtoV31SourceSeal['feature_contract_version'];
  policy_export_schema?: GtoV31SourceSeal['policy_export_schema'];
}> {
  if (typeof datasetId !== 'string' || !UUID.test(datasetId)) {
    throw new Error('invalid V31 evaluation dataset id');
  }
  const rows: GtoV31RuntimeRow[] = [];
  for (let offset = 0; ; ) {
    const { data, error } = await supabase.rpc('fn_gto_v31_evaluation_cells', {
      p_dataset_id: datasetId,
      p_offset: offset,
      p_limit: PAGE,
    });
    if (error) throw new Error(error.message);
    const page = readV31CellPage(data, datasetId);
    if (page.length === 0) break;
    rows.push(...page);
    offset += page.length;
    if (rows[0].policy_representation === 'public_hist215_v1') {
      if (!Number.isSafeInteger(rows[0].dataset_cells) || rows[0].dataset_cells < 1)
        throw new Error('v31_dataset_cell_count_invalid');
      if (rows.length >= rows[0].dataset_cells) break;
      continue;
    }
    if (page.length < PAGE) break;
  }
  if (rows.length === 0) throw new Error('V31 evaluation dataset returned no cells');
  const checksum = rows[0].dataset_checksum;
  if (!checksum || rows.some((row) => row.dataset_checksum !== checksum)) {
    throw new Error('V31 evaluation dataset checksum is missing or inconsistent');
  }
  if (options.recheck === true) replaceGtoPostflopV31Recheck(rows);
  else replaceGtoPostflopV31Evaluation(rows);
  const cells = gtoPostflopV31EvaluationCount(checksum);
  console.log(
    `[GtoPostflopV31Loader] ${cells} sealed candidate cells loaded for ${checksum.slice(0, 12)}`
  );
  return {
    checksum,
    cells,
    contexts: rows.map((row) => ({
      cell_key_checksum: row.cell_key_checksum,
      game_family: row.game_family,
      utility_context: row.utility_context,
      table_size: row.table_size,
      depth_bucket: row.depth_bucket,
      node_role: row.node_role,
    })),
    ...(Object.prototype.hasOwnProperty.call(rows[0], 'policy_export_schema')
      ? { policy_export_schema: rows[0].policy_export_schema }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(rows[0], 'feature_contract_version')
      ? { feature_contract_version: rows[0].feature_contract_version }
      : {}),
  };
}

export function startGtoPostflopV31Loader(): void {
  refreshLoop.start();
}

export function stopGtoPostflopV31Loader(): void {
  refreshLoop.stop();
}
