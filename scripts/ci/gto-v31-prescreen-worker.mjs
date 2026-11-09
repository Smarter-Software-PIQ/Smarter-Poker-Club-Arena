// The V31 pre-screen's worker body (see gto-v31-prescreen.mjs). Launched by
// the pinned runtime's finite evaluation worker, so public-hist215 cells
// answer exactly as they do in the evaluator, and every engine module is the
// pinned runtime's own. It imports the evaluator's harness, never the
// evaluator script, and sends only admitted read-only requests.
import { isMainThread } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FAMILIES, componentSeed, familySeed, guardedFetch, pairStages, pendingWork, prefixDecided,
  DEFAULT_FLOOR, DEFAULT_FIRST_PAIRS, DEFAULT_MAX_PAIRS } from './gto-v31-prescreen.mjs';

if (isMainThread) throw new Error('V31_PRESCREEN_WORKER_THREAD_REQUIRED');
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const int = (name, fallback) => (arg(name) === null ? fallback : Number(arg(name)));
const runtime = arg('runtime');
const dataset = arg('dataset');
const engine = arg('engine');
const out = arg('out');
const floor = int('floor', DEFAULT_FLOOR);
const firstPairs = int('first-pairs', DEFAULT_FIRST_PAIRS);
const maxPairs = int('max-pairs', DEFAULT_MAX_PAIRS);
const all = process.argv.includes('--all');

// Before any runtime module loads: the only network this thread can reach is
// the admitted read-only RPC list. A refused request fails the pre-screen.
const refused = [];
globalThis.fetch = guardedFetch(globalThis.fetch.bind(globalThis), refused);

const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);
const report = { dataset, engine, floor, firstPairs, maxPairs, refused, screened: [], skipped: [], runs: [] };
let hub = null;
const started = Date.now();
try {
  const mod = (path) => import(pathToFileURL(join(runtime, 'server', 'src', path)).href);
  const { supabase } = await mod('services/supabase/client.ts');
  const { loadGtoPostflopV31, loadGtoPostflopV31Evaluation } = await mod('services/GtoPostflopV31Loader.ts');
  const { buildGtoV31EvaluationScenarios } = await mod('benchmark/GtoV31CandidateEvaluation.ts');
  const { runMatchup } = await mod('benchmark/HorseLeague.ts');
  const { equityGovernor } = await mod('engine/EquityLoadGovernor.ts');
  ({ channelHub: hub } = await mod('hub/ChannelHub.ts'));
  if (equityGovernor.snapshot().enabled) throw new Error('the pre-screen must run with EQUITY_GOVERNOR=off');

  const rpc = async (name, params) => {
    const { data, error } = await supabase.rpc(name, params);
    if (error) throw Object.assign(new Error(`${name}: ${error.message}`), { code: error.code });
    return data;
  };
  const status = async () => {
    const datasets = (await rpc('ca_gto_v31_certification_status', { p_dataset_id: dataset }))?.datasets;
    if (!Array.isArray(datasets) || datasets.length !== 1 || datasets[0].dataset_id !== dataset)
      throw new Error('the requested V31 dataset does not exist or is not visible');
    return datasets[0];
  };
  const fingerprint = (s) => canonical({ state: s.state, checksum: s.dataset_checksum, epoch: s.current_epoch ?? null,
    epochs: s.evaluation_epochs ?? null, evaluations: s.evaluations ?? null });

  // The evaluator's own preparation: the incumbent store, then the sealed candidate.
  await loadGtoPostflopV31();
  const loaded = await loadGtoPostflopV31Evaluation(dataset);
  const before = await status();
  if (before.dataset_checksum !== loaded.checksum) throw new Error('candidate status and loaded cells disagree on dataset checksum');
  if (!['evaluating', 'candidate'].includes(before.state)) throw new Error(`dataset state ${before.state} cannot be evaluated`);
  let plan;
  try {
    plan = await rpc('fn_gto_v31_evaluation_plan', { p_dataset_id: dataset });
  } catch (error) {
    if (error.code !== 'PGRST202') throw error;
    plan = { evaluation_contract: 'gto_v31_candidate.v2', families: {} };
  }
  // Contract v3 (2026-11-06) is loaded only for a v3 dataset: an older pin has no such module.
  const v3 = plan?.evaluation_contract === 'gto_v31_candidate.v3';
  if (!v3 && plan?.evaluation_contract !== 'gto_v31_candidate.v2') throw new Error('the V31 evaluation plan is missing or malformed');
  const { gtoV31V3Tables, buildGtoV31EvaluationScenariosV3 } = v3 ? await mod('benchmark/GtoV31EvaluationContractV3.ts') : {};
  if (v3) for (const family of FAMILIES) {
    const local = gtoV31V3Tables(family, loaded.contexts);
    if (canonical(local) !== canonical(plan.families?.[family]?.tables ?? []))
      throw new Error(`${family}: the evaluator would refuse before a hand (local tables ${JSON.stringify(local)} differ from the database plan)`);
  }
  const families = v3 ? FAMILIES.filter((f) => (plan.families[f]?.tables.length ?? 0) > 0) : [...FAMILIES];
  report.contract = plan.evaluation_contract;
  report.checksum = loaded.checksum;
  const { work, skipped } = pendingWork(before, families, engine, { all });
  report.screened = work;
  report.skipped = skipped;
  console.log(`[gto-v31-prescreen] ${plan.evaluation_contract}: screening ${work.map((w) => `${w.kind}/${w.family}`).join(', ') || 'nothing'}` +
    (skipped.length ? `; already recorded ${skipped.map((s) => `${s.kind}/${s.family}`).join(', ')}` : ''));

  for (const { kind, family } of work) {
    const runSeed = familySeed(loaded.checksum, kind, family);
    const components = v3
      ? buildGtoV31EvaluationScenariosV3(family, kind, loaded.checksum, plan.families[family].tables).flatMap((s, index) => [
          { table: s.key, run: 'main', matchup: s.matchup, pairs: s.pairs, index },
          ...(s.memoryOff ? [{ table: s.key, run: 'memory_off', matchup: s.memoryOff, pairs: s.pairs, index }] : []),
        ])
      : buildGtoV31EvaluationScenarios(family, kind, loaded.checksum).map((s, index) =>
          ({ table: s.key, run: 'main', matchup: s.matchup, pairs: s.pairs, index }));
    for (const c of components) {
      const seed = componentSeed(runSeed, c.index);
      let r = null;
      let played = 0;
      for (const pairs of pairStages(firstPairs, maxPairs, c.pairs)) {
        r = await runMatchup(c.matchup, pairs, seed);
        played = pairs;
        if (prefixDecided({ hits: r.candidatePolicyHits, illegal: r.illegalActions, truncated: r.truncatedStreets,
          mismatches: r.candidateExecutionMismatches }, floor)) break;
      }
      const run = { kind, family, table: c.table, run: c.run, pairs: played, fullPairs: c.pairs, hands: r.hands,
        hits: r.candidatePolicyHits, illegal: r.illegalActions, truncated: r.truncatedStreets,
        mismatches: r.candidateExecutionMismatches, cells: r.candidateCells?.length ?? 0 };
      report.runs.push(run);
      console.log(`[gto-v31-prescreen] ${kind}/${family} ${c.table}${c.run === 'memory_off' ? ' memory-off' : ''}: ` +
        `${run.hits} playbook decisions in ${run.hands} hands (${played} of ${c.pairs} pairs)`);
    }
  }
  // Proof of no write: the dataset's whole certification state is unchanged.
  if (fingerprint(await status()) !== fingerprint(before)) throw new Error('the dataset certification state changed during the pre-screen');
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
} finally {
  report.durationMs = Date.now() - started;
  try { hub?.close(); } catch { /* the hub's interval only keeps the loop alive */ }
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
}
