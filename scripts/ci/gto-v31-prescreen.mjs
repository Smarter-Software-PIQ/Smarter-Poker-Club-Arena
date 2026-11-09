#!/usr/bin/env node
// V31 QUALIFICATION PRE-SCREEN (2026-11-08). A few minutes, before the
// evaluator's hours.
//
// Twice (2026-11-05, epochs 1 and 2) the evaluator refused only after hours
// because one scenario component never consulted the candidate playbook
// ("did not safely exercise the candidate in every context", hits=0). This
// step plays a short prefix of the same deals the evaluator will play, with
// the pinned runtime's own harness (scenario builders, runMatchup, the V31
// loader) inside the same finite worker thread, and fails the job naming every
// component that reached the playbook fewer than `floor` times, or that showed
// illegal play, truncated streets or execution mismatches. A prefix with any
// of those means the full run refuses too.
//
// READ-ONLY. The worker never imports server/src/scripts/gtoV31Evaluate.ts
// (the only caller of fn_gto_v31_record_evaluation, horse_league_results
// inserts and fn_gto_v31_mark_candidate). On top of that, before any runtime
// module loads, it replaces the thread's fetch with an allowlist that admits
// only four read-only (STABLE) RPCs; every other database request is refused
// and turns the pre-screen into a failure. It records no receipt, opens and
// touches no epoch, and never spends or replaces the write-once evaluation.
//
// Outside the V31 decision closure and execution fingerprint: no closure file
// imports or names this file or its worker.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DATABASE = 'https://kuklfnapbkmacvwxktbh.supabase.co';
/** The only requests the pre-screen may send: STABLE, SECURITY DEFINER reads with no DML. */
export const PRESCREEN_READ_RPCS = Object.freeze([
  'ca_gto_v31_certification_status',
  'fn_gto_v31_evaluation_plan',
  'fn_gto_v31_evaluation_cells',
  'fn_gto_v31_active_cells',
]);
export const KINDS = Object.freeze(['paired_replay', 'league']);
export const FAMILIES = Object.freeze(['cash', 'spin', 'tourney_ev', 'tourney_icm']);
/**
 * A component passes at its first playbook decision (floor 1, the evaluator's
 * own "hits > 0" rule). It plays 256 duplicate pairs (512 hands); only a
 * silent one is played on to 2,048 pairs (4,096 hands) before it is refused.
 */
export const DEFAULT_FLOOR = 1;
export const DEFAULT_FIRST_PAIRS = 256;
export const DEFAULT_MAX_PAIRS = 2048;
export const STAGE_GROWTH = 8;
export const EXIT = Object.freeze({ pass: 0, refused: 1, unscreened: 2 });
const SHA = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Whether one outbound request is an admitted read. Anything else is refused. */
export function requestAdmitted(url, method = 'GET', database = DATABASE) {
  let parsed;
  try { parsed = new URL(String(url)); } catch { return false; }
  if (parsed.origin !== new URL(database).origin) return false;
  if (!['GET', 'POST', 'HEAD'].includes(String(method).toUpperCase())) return false;
  const m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)$/.exec(parsed.pathname);
  return Boolean(m && PRESCREEN_READ_RPCS.includes(m[1]));
}

/** A fetch that forwards admitted reads and refuses (and remembers) everything else. */
export function guardedFetch(realFetch, refused, database = DATABASE) {
  if (typeof realFetch !== 'function' || !Array.isArray(refused)) throw new TypeError('guardedFetch needs a fetch and a list');
  return async function prescreenFetch(input, init = {}) {
    const isRequest = typeof Request !== 'undefined' && input instanceof Request;
    const url = isRequest ? input.url : input instanceof URL ? input.href : String(input);
    const method = init?.method ?? (isRequest ? input.method : 'GET');
    if (!requestAdmitted(url, method, database)) {
      let path = url;
      try { path = new URL(url).pathname; } catch { /* keep the raw text */ }
      refused.push(`${String(method).toUpperCase()} ${path}`);
      throw new Error(`V31_PRESCREEN_REQUEST_REFUSED: ${String(method).toUpperCase()} ${path} is not a read-only pre-screen request`);
    }
    return realFetch(input, init);
  };
}

/** The evaluator's family seed (gtoV31Evaluate.ts seedFor). */
export function familySeed(checksum, kind, family) {
  if (!HEX64.test(checksum ?? '')) throw new Error('a sealed dataset checksum is required');
  return createHash('sha256').update(`${checksum}:${kind}:${family}`).digest().readUInt32BE(0) || 1;
}
/** The harness's per-component seed (runGtoV31EvaluationFamily / ...V3). */
export function componentSeed(runSeed, index) {
  return (runSeed ^ ((index + 1) * 0x9e3779b9)) >>> 0;
}

/**
 * The prefix lengths one component is played to: a short look, growing 8x
 * only while it stays silent, never past maxPairs or the component's own
 * length. Each component uses the evaluator's own seed, and a pair's deal
 * is a function of (seed, pair index) only, so a prefix deals the same first
 * hands the evaluator will deal that component.
 */
export function pairStages(firstPairs, maxPairs, fullPairs) {
  for (const [name, n] of [['first', firstPairs], ['max', maxPairs], ['full', fullPairs]])
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`pre-screen ${name} pairs must be a positive integer`);
  if (firstPairs > maxPairs) throw new Error('pre-screen first pairs exceed its max pairs');
  const cap = Math.min(maxPairs, fullPairs);
  const stages = [];
  for (let n = Math.min(firstPairs, cap); n < cap; n *= STAGE_GROWTH) stages.push(n);
  stages.push(cap);
  return stages;
}
/** Whether a played prefix already decides the component (no longer prefix is needed). */
export function prefixDecided(run, floor = DEFAULT_FLOOR) {
  return run.hits >= floor || run.illegal > 0 || run.truncated > 0 || run.mismatches > 0;
}

/**
 * The (kind, family) pairs the evaluator will still run in the current epoch,
 * in its order. Recorded ones are skipped exactly as the evaluator skips them.
 */
export function pendingWork(status, families, engineCommit, { all = false } = {}) {
  const epoch = status?.current_epoch ?? null;
  // Only a resumed epoch (one that already pins this commit) skips anything;
  // a first or new epoch for this commit runs every family.
  const resumed = epoch !== null && typeof epoch.epoch_id === 'string' && epoch.engine_commit === engineCommit;
  const work = [];
  const skipped = [];
  for (const kind of KINDS)
    for (const family of families) {
      const prior = resumed ? (status.evaluations ?? []).find((e) => e.kind === kind && e.game_family === family &&
        e.evaluation_epoch_id === epoch.epoch_id) : undefined;
      if (prior && !all) skipped.push({ kind, family, verdict: prior.verdict });
      else work.push({ kind, family });
    }
  return { work, skipped };
}

const label = (r) => `${r.kind}/${r.family} ${r.table}${r.run === 'memory_off' ? ' (memory-off run)' : ''}`;

/** The single verdict of one pre-screen report. Pure: which components fail, the message, the exit code. */
export function prescreenVerdict(report, { floor = DEFAULT_FLOOR } = {}) {
  if (!Number.isSafeInteger(floor) || floor < 1) throw new Error('the pre-screen floor is a positive integer');
  if (!report || typeof report !== 'object' || report.error) {
    return { ok: false, exitCode: EXIT.unscreened, failures: [],
      message: `V31 pre-screen could not screen the dataset: ${report?.error ?? 'no report'}. ` +
        'The full evaluation did not start; nothing was recorded.' };
  }
  const refused = Array.isArray(report.refused) ? report.refused : [];
  if (refused.length) {
    return { ok: false, exitCode: EXIT.unscreened, failures: [],
      message: `V31 pre-screen refused ${refused.length} database request(s) outside its read-only allowlist ` +
        `(${[...new Set(refused)].slice(0, 5).join('; ')}). The request never left the runner; the full evaluation did not start.` };
  }
  const runs = Array.isArray(report.runs) ? report.runs : [];
  const work = Array.isArray(report.screened) ? report.screened : [];
  if (work.length === 0) {
    return { ok: true, exitCode: EXIT.pass, failures: [],
      message: 'V31 pre-screen: every kind/family of the current epoch is already recorded; nothing to screen.' };
  }
  for (const w of work)
    if (!runs.some((r) => r.kind === w.kind && r.family === w.family))
      return { ok: false, exitCode: EXIT.unscreened, failures: [],
        message: `V31 pre-screen played no component of ${w.kind}/${w.family}. The full evaluation did not start.` };
  const failures = [];
  for (const r of runs) {
    const reasons = [];
    if (!(r.hits >= floor)) reasons.push(`${r.hits} playbook decisions in ${r.hands} hands` +
      ` (${r.pairs >= r.fullPairs ? `all ${r.fullPairs}` : `the first ${r.pairs} of its ${r.fullPairs}`} pairs; floor ${floor})`);
    if (r.illegal > 0) reasons.push(`${r.illegal} illegal actions`);
    if (r.truncated > 0) reasons.push(`${r.truncated} truncated streets`);
    if (r.mismatches > 0) reasons.push(`${r.mismatches} execution mismatches`);
    if (reasons.length) failures.push({ component: label(r), kind: r.kind, family: r.family, table: r.table, run: r.run, reasons });
  }
  if (failures.length === 0) {
    return { ok: true, exitCode: EXIT.pass, failures,
      message: `V31 pre-screen passed: all ${runs.length} components of ${work.length} kind/families reached the candidate playbook ` +
        `(floor ${floor}) with no illegal play or execution mismatch. Nothing was recorded.` };
  }
  return { ok: false, exitCode: EXIT.refused, failures,
    message: [
      `V31 pre-screen REFUSED dataset ${report.dataset ?? 'unknown'}: ${failures.length} of ${runs.length} components would fail ` +
        'the full evaluation after hours ("did not safely exercise the candidate in every context").',
      ...failures.map((f) => `  - ${f.component}: ${f.reasons.join(', ')}`),
      'The pre-screen recorded no receipt and touched no epoch; the write-once evaluation is unspent. ' +
        'Fix what keeps those tables from reaching the playbook (the sealed cells, or the engine at this pin) before dispatching evaluate again.',
    ].join('\n') };
}

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(`Runtime Git proof failed: ${args[0]}`);
  return r.stdout.trim();
}
const argOf = (argv, name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
const intArg = (argv, name, fallback) => {
  const v = argOf(argv, name);
  if (v === null) return fallback;
  if (!/^[0-9]{1,5}$/.test(v)) throw new Error(`--${name} must be a whole number`);
  return Number(v);
};

/**
 * Workflow mode reads the resolved context; local mode takes --dataset --engine --runtime.
 * Agents run it through the workflow (operation prescreen), whose database
 * identity comes from the repository secret store. Local mode reads only the
 * SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY a person already exported from an
 * approved store: never source a .env file, and never fetch or reveal API keys
 * through the Supabase management API to feed it (2026-11-08 credential
 * incident, .agent/audits/2026-11-08-SECURITY-INCIDENT-prescreen-credential-copy.md).
 */
async function main(argv) {
  const floor = intArg(argv, 'floor', DEFAULT_FLOOR);
  const firstPairs = intArg(argv, 'first-pairs', DEFAULT_FIRST_PAIRS);
  const maxPairs = intArg(argv, 'max-pairs', DEFAULT_MAX_PAIRS);
  pairStages(firstPairs, maxPairs, 1);
  let dataset, engine, runtime, directory;
  if (argOf(argv, 'dataset') !== null) {
    dataset = argOf(argv, 'dataset'); engine = argOf(argv, 'engine'); runtime = resolve(argOf(argv, 'runtime') ?? '.');
    directory = resolve(argOf(argv, 'out-dir') ?? join(runtime, '..', 'v31-prescreen-out'));
  } else {
    const { invocation } = await import('./gto-v31-qualification.mjs');
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const selected = invocation({ eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
      repository: process.env.GITHUB_REPOSITORY, repositoryId: process.env.GITHUB_REPOSITORY_ID, inputs: event.inputs });
    if (selected.operation !== 'evaluate' && selected.operation !== 'prescreen')
      throw new Error('The pre-screen runs only before an evaluate operation, or on its own as prescreen');
    directory = join(process.env.RUNNER_TEMP, `gto-v31-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
    // The plan phase (read-only) chose the commit; no epoch is open yet.
    const plan = JSON.parse(readFileSync(join(directory, 'plan.json'), 'utf8'));
    if (plan.dataset !== selected.dataset || plan.operation !== selected.operation ||
        (selected.operation === 'prescreen' && selected.engine && plan.releaseSha !== selected.engine))
      throw new Error('Planned operation identity differs');
    dataset = selected.dataset; engine = plan.releaseSha; runtime = resolve(process.env.GITHUB_WORKSPACE, 'runtime');
  }
  if (!UUID.test(dataset ?? '') || !SHA.test(engine ?? '')) throw new Error('A dataset UUID and a full pinned engine commit are required');
  const clean = () => git(runtime, ['rev-parse', 'HEAD']) === engine && !git(runtime, ['status', '--porcelain', '--untracked-files=all']);
  if (!clean()) throw new Error('Runtime checkout does not exactly match the clean pinned engine commit');
  if ((process.env.EQUITY_GOVERNOR ?? '').toLowerCase() !== 'off') throw new Error('The pre-screen must run with EQUITY_GOVERNOR=off, as the evaluator does');
  mkdirSync(directory, { recursive: true });
  const out = join(directory, 'prescreen.json');
  rmSync(out, { force: true });
  const launcher = join(runtime, 'server', 'scripts', 'finite-evaluation-worker.mjs');
  if (!existsSync(launcher)) throw new Error('The pinned runtime lacks the finite evaluation worker');
  const { runFiniteEvaluationWorker } = await import(pathToFileURL(launcher).href);
  // The evaluator runs from runtime/server (tsx reads that tsconfig); so does the pre-screen.
  process.chdir(join(runtime, 'server'));
  const started = Date.now();
  const outcome = await runFiniteEvaluationWorker(new URL('./gto-v31-prescreen-worker.mjs', import.meta.url), [
    `--runtime=${runtime}`, `--dataset=${dataset}`, `--engine=${engine}`, `--out=${out}`,
    `--floor=${floor}`, `--first-pairs=${firstPairs}`, `--max-pairs=${maxPairs}`,
    ...(argv.includes('--all') ? ['--all'] : []),
  ]);
  let report;
  try { report = JSON.parse(readFileSync(out, 'utf8')); } catch { report = null; }
  if (outcome.exitCode !== 0 && !report?.error) report = { error: `the pre-screen worker exited ${outcome.exitCode} (${outcome.error ?? 'no detail'})` };
  if (!clean()) report = { error: 'the pre-screen changed the pinned runtime checkout' };
  const verdict = prescreenVerdict(report, { floor });
  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  (verdict.ok ? console.log : console.error)(`[gto-v31-prescreen] ${verdict.message}\n[gto-v31-prescreen] ${minutes} min`);
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### V31 pre-screen\n\n- Dataset: \`${dataset}\`\n- Pinned engine: \`${engine}\`\n` +
      `- Outcome: **${verdict.ok ? 'passed' : 'refused'}** (${minutes} min)\n\n\`\`\`\n${verdict.message}\n\`\`\`\n`);
  return verdict.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error) => {
    console.error(`[gto-v31-prescreen] could not screen: ${error.message}`);
    process.exitCode = EXIT.unscreened;
  });
}
