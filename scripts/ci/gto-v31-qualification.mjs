#!/usr/bin/env node
// Explicit offline V31 qualification. Owner-dispatched on protected main only.
//
// evaluate: the dataset's audited evaluation epoch owns exactly one protected
//   engine commit (the pin). The first epoch pins the serving engine. While the
//   serving engine's full decision closure stays byte-identical to the pin, the
//   same epoch resumes; otherwise a new epoch for the serving commit opens only
//   with an explicit audited reason (PostgreSQL keeps every earlier receipt).
//   The existing evaluator then runs once at exactly the pinned commit.
// promote: one engine-locked host operation (promote -> eight-worker load ->
//   readiness) after proving the serving image is closure-compatible with the
//   evaluated epoch. Re-running after a partial outcome never re-promotes.
import {isClubArenaRepository} from './repository-identity.mjs';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closureCompatible, closureComplete, decisionClosure } from './v31-decision-closure.mjs';
import { receiptMatches as readinessReceiptMatches } from './inspect-v31-worker-readiness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEALTH = 'https://engine.smarter.poker/health';
const DATABASE = 'https://kuklfnapbkmacvwxktbh.supabase.co';
const SHA = /^[0-9a-f]{40}$/;
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KINDS = ['paired_replay', 'league'];
const FAMILIES = ['cash', 'spin', 'tourney_ev', 'tourney_icm'];
export const WORKERS = 8;
/** The host operation's whole budget; the host script enforces the same nine minutes. */
export const PROMOTION_BUDGET_MS = 9 * 60_000;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const fullSha = (v) => typeof v === 'string' && SHA.test(v) && v !== '0'.repeat(40);

export function invocation({ eventName, ref, repository, repositoryId, inputs }) {
  if (eventName !== 'workflow_dispatch' || ref !== 'refs/heads/main' || !isClubArenaRepository(repository, repositoryId))
    throw new Error('Only an explicit dispatch on this repository protected main is admitted');
  const keys = inputs && typeof inputs === 'object' ? Object.keys(inputs).sort().join(',') : '';
  if (!['dataset,operation', 'dataset,operation,reason'].includes(keys) ||
      typeof inputs.dataset !== 'string' || !UUID.test(inputs.dataset) || !['evaluate', 'promote'].includes(inputs.operation))
    throw new Error('A canonical dataset UUID and explicit evaluate/promote operation are required');
  const reason = inputs.reason ?? '';
  if (typeof reason !== 'string' || (reason !== '' &&
      (reason.trim().length < 20 || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason))))
    throw new Error('An audited reason is 20 to 500 printable characters');
  return { dataset: inputs.dataset, operation: inputs.operation, reason: reason.trim() || null };
}

export function servingIdentity(body) {
  if (body?.status !== 'ok' || body?.liveHorseDecision?.phase !== 'ready' ||
      typeof body.releaseSha !== 'string' || !SHA.test(body.releaseSha) || body.releaseSha === '0'.repeat(40))
    throw new Error('Healthy serving decision-worker source identity is unavailable');
  return { releaseSha: body.releaseSha };
}

/**
 * Files whose epoch protocol a pinned commit must carry: an evaluator that
 * predates epochs would ignore the epoch matchup and spend the epoch for good.
 */
export const EPOCH_PROTOCOL = Object.freeze({
  'server/src/scripts/gtoV31Evaluate.ts':
    "const GTO_V31_EVALUATION_EPOCH_PROTOCOL = 'smarter-poker.gto-v31-evaluation-epochs.v1';",
  'server/src/benchmark/GtoV31EvaluationConfig.ts': 'export function evaluationMatchup(',
});
export function epochProtocolPresent(sources) {
  return Object.entries(EPOCH_PROTOCOL).every(([path, marker]) =>
    typeof sources?.[path] === 'string' && sources[path].includes(marker));
}
/** The epoch protocol at an exact commit, read from git (never a working tree). */
export function epochAwareCommit(repo, sha) {
  if (!fullSha(sha)) return false;
  const sources = {};
  for (const path of Object.keys(EPOCH_PROTOCOL)) {
    const result = spawnSync('git', ['-C', repo, 'show', `${sha}:${path}`], { encoding: 'utf8', timeout: 20000, maxBuffer: 1 << 26 });
    if (result.status !== 0) return false;
    sources[path] = result.stdout;
  }
  return epochProtocolPresent(sources);
}

/** Replay/league receipts of exactly one epoch; any receipt in it bound to another commit is refused. */
export function epochReceipts(dataset, epoch) {
  const receipts = (dataset.evaluations ?? []).filter((r) => KINDS.includes(r.kind) && r.evaluation_epoch_id === epoch.epoch_id);
  for (const r of receipts)
    if (r.evaluation_engine_commit !== epoch.engine_commit ||
        r.metrics?.candidate_config?.evaluation_engine_commit !== epoch.engine_commit)
      throw new Error('An evaluation epoch holds a receipt for another engine commit');
  return receipts;
}

/** The pin is owned by the dataset's current epoch and never moves while that epoch is current. */
export function pinOwner(dataset) {
  const epochs = dataset?.evaluation_epochs ?? [];
  const epoch = dataset?.current_epoch ?? null;
  const receipts = (dataset?.evaluations ?? []).filter((r) => KINDS.includes(r.kind));
  if (!Array.isArray(epochs) || new Set(epochs.map((e) => e.engine_commit)).size !== epochs.length)
    throw new Error('Evaluation epochs must bind distinct engine commits');
  if (epoch === null) {
    if (epochs.length || receipts.length) throw new Error('Evaluation evidence exists without a current epoch');
    return null;
  }
  if (typeof epoch.epoch_id !== 'string' || !UUID.test(epoch.epoch_id) || !Number.isSafeInteger(epoch.epoch_no) ||
      epoch.epoch_no < 1 || !fullSha(epoch.engine_commit))
    throw new Error('The current evaluation epoch is malformed');
  const current = epochs.filter((e) => e.superseded_at === null);
  if (current.length !== 1 || current[0].epoch_id !== epoch.epoch_id || current[0].engine_commit !== epoch.engine_commit)
    throw new Error('Exactly one current evaluation epoch is required');
  for (const r of receipts) {
    const owner = epochs.find((e) => e.epoch_id === r.evaluation_epoch_id);
    if (!owner || owner.engine_commit !== r.evaluation_engine_commit)
      throw new Error('A receipt is not bound to its own epoch commit');
  }
  epochReceipts(dataset, epoch);
  return epoch;
}

/**
 * What an evaluate dispatch does. Closure compatibility of the open epoch's
 * pin with the serving engine decides between resuming the same epoch and an
 * audited new epoch; nothing else can move a pin. A new pin is the serving
 * engine when its closure is complete, otherwise this protected-main control
 * commit (promotion then waits for a closure-identical serving engine).
 */
export function selectEpoch({ dataset, servingSha, servingComplete = true, controlSha = servingSha,
  compatibleWithServing, reason, epochAware }) {
  if (typeof epochAware !== 'function') throw new Error('The pinned evaluator protocol must be checked');
  if (!['evaluating', 'candidate'].includes(dataset?.state)) throw new Error('A sealed evaluating/candidate dataset is required');
  if (!fullSha(servingSha) || !fullSha(controlSha)) throw new Error('Full serving and control engine commits are required');
  const pin = servingComplete === true ? servingSha : controlSha;
  const epoch = pinOwner(dataset);
  if (epoch?.promoted_at) throw new Error('A promoted dataset never reopens evaluation');
  if ((dataset.evaluations ?? []).some((r) => KINDS.includes(r.kind) && r.verdict === 'loss'))
    throw new Error('A dataset that lost an evaluation is never re-evaluated');
  const aware = (sha) => {
    if (epochAware(sha) !== true)
      throw new Error(`Engine commit ${sha} predates the epoch-aware evaluator; refusing to spend an evaluation epoch on it`);
    return sha;
  };
  if (epoch === null)
    return { action: 'open-first', engineSha: aware(pin),
      reason: reason ?? `Initial evaluation epoch pinned to the ${pin === servingSha ? 'serving engine' : 'protected control commit'} ${pin}` };
  if (compatibleWithServing === true) return { action: 'resume', engineSha: aware(epoch.engine_commit), epochNo: epoch.epoch_no };
  if (compatibleWithServing !== false) throw new Error('Closure compatibility must be decided before selecting an epoch');
  if (!reason)
    throw new Error('The serving engine is not closure-compatible with the open epoch; a new epoch needs an explicit audited reason');
  if ((dataset.evaluation_epochs ?? []).some((e) => e.engine_commit === pin))
    throw new Error('An engine commit is evaluated at most once per dataset');
  return { action: 'open-next', engineSha: aware(pin), reason };
}

/** Promotion (or a load-only resume of an already promoted epoch) of exactly the evaluated epoch. */
export function promotionPlan(dataset, id) {
  if (dataset?.dataset_id !== id || !HEX.test(dataset.dataset_checksum ?? ''))
    throw new Error('Promotion requires the exact sealed dataset');
  const epoch = pinOwner(dataset);
  if (!epoch) throw new Error('Promotion requires an evaluated epoch');
  if (dataset.state === 'active') {
    if (!epoch.promoted_at || !fullSha(epoch.promoted_serving_commit))
      throw new Error('An active dataset must carry its promoted epoch');
    return { mode: 'load-only', epoch };
  }
  if (dataset.state !== 'candidate' || epoch.promoted_at)
    throw new Error('Promotion requires the exact already-qualified candidate');
  const receipts = epochReceipts(dataset, epoch);
  const expected = new Set(KINDS.flatMap((kind) => FAMILIES.map((family) => `${kind}/${family}`)));
  for (const receipt of receipts)
    if (!['win', 'tie'].includes(receipt.verdict) || !expected.delete(`${receipt.kind}/${receipt.game_family}`))
      throw new Error('Promotion requires eight distinct passing replay/league receipts of the evaluated epoch');
  if (receipts.length !== 8 || expected.size)
    throw new Error('Promotion requires eight distinct passing replay/league receipts of the evaluated epoch');
  if (!(dataset.evaluations ?? []).some((r) => r.kind === 'heldout' && r.game_family === 'all' && r.verdict === 'pass'))
    throw new Error('Promotion requires the held-out pass');
  return { mode: 'promote', epoch };
}

function chicagoClock(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23' }).formatToParts(new Date(ms));
  return Number(parts.find((p) => p.type === 'hour').value) * 100 + Number(parts.find((p) => p.type === 'minute').value);
}

/** null when [now, now + budget] avoids every hourly :50-:10 boundary and the daily 03:50-04:06 Chicago window. */
export function maintenanceRefusal(nowMs, budgetMs = PROMOTION_BUDGET_MS) {
  if (!Number.isFinite(nowMs) || !Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error('A finite clock is required');
  for (let t = nowMs; ; t = Math.min(t + 15_000, nowMs + budgetMs)) {
    const minute = new Date(t).getUTCMinutes();
    if (minute >= 50 || minute < 10) return 'hourly-maintenance-boundary';
    const clock = chicagoClock(t);
    if (clock >= 350 && clock <= 406) return 'daily-maintenance-window';
    if (t === nowMs + budgetMs) return null;
  }
}

export const OUTCOMES = Object.freeze({
  0: { outcome: 'promoted-loaded-ready', changed: true, rerun: false },
  64: { outcome: 'refused-arguments', changed: false, rerun: false },
  65: { outcome: 'refused-serving-identity', changed: false, rerun: true },
  66: { outcome: 'promotion-refused', changed: false, rerun: false },
  67: { outcome: 'promotion-outcome-unknown', changed: null, rerun: true },
  68: { outcome: 'promoted-load-incomplete', changed: true, rerun: true },
  69: { outcome: 'promoted-loaded-readiness-unproved', changed: true, rerun: true },
  70: { outcome: 'serving-identity-changed', changed: null, rerun: true },
  75: { outcome: 'refused-lock-or-boundary', changed: false, rerun: true },
});

/** Parse the host transcript; the printed outcome must agree with the exit code. */
export function hostTranscript(stdout, exitCode) {
  const stages = {};
  let printed = null;
  for (const line of String(stdout).split('\n')) {
    let m = /^V31_ATOMIC_STAGE (promote|load|status|readiness) (.*)$/.exec(line);
    if (m) {
      let value = null;
      try { value = m[2] ? JSON.parse(m[2]) : null; } catch { value = null; }
      (stages[m[1]] ??= []).push(value);
      continue;
    }
    m = /^V31_ATOMIC_OUTCOME ([a-z-]+)$/.exec(line);
    if (m) printed = m[1];
  }
  const known = OUTCOMES[exitCode];
  const consistent = known && printed !== null && (printed === known.outcome ||
    (exitCode === 75 && printed.startsWith('refused-')) || (exitCode === 65 && printed === 'refused-serving-identity'));
  if (!consistent) return { outcome: 'host-outcome-unknown', changed: null, rerun: true, stages, printed, exitCode };
  return { ...known, printed, stages, exitCode };
}

/** One worker-count/cell-count generic reload or status receipt from reloadPublic215Stores. */
export function storeReceiptValid(v, p, operation, now = Date.now()) {
  if (!exact(v, ['format', 'operation', 'observedAt', 'sourceSha', 'receipt']) ||
      v.format !== 'v31_explicit_store_control_receipt_v1' || v.operation !== operation || v.sourceSha !== p.servingSha)
    return false;
  const age = now - Date.parse(v.observedAt);
  if (!Number.isFinite(age) || age < -30000 || age > 900000) return false;
  const r = v.receipt;
  if (!exact(r, ['checksum', 'datasetId', 'expectedCells', 'requestId', 'state', 'workers']) || r.checksum !== p.checksum ||
      r.datasetId !== p.datasetId || r.requestId !== p.requestId || r.expectedCells !== p.cellCount ||
      r.state !== 'complete' || !Array.isArray(r.workers) || r.workers.length !== WORKERS) return false;
  const seen = new Set();
  for (const a of r.workers) {
    if (!exact(a, ['worker', 'type', 'operation', 'requestId', 'ok', 'count', 'dataset', 'error']) ||
        !Number.isInteger(a.worker) || a.worker < 0 || a.worker >= WORKERS || seen.has(a.worker) ||
        a.type !== 'V31_STORE_CONTROL_ACK' || a.operation !== operation || a.requestId !== p.requestId || a.ok !== true ||
        a.count !== p.cellCount || a.error !== null || !exact(a.dataset, ['id', 'checksum']) ||
        a.dataset.id !== p.datasetId || a.dataset.checksum !== p.checksum) return false;
    seen.add(a.worker);
  }
  return true;
}

export function promotionRequest({ datasetId, checksum, engineSha, servingSha, requestId, cellCount, afterUtc }) {
  if (!UUID.test(datasetId ?? '') || !HEX.test(checksum ?? '') || !fullSha(engineSha) || !fullSha(servingSha) ||
      !UUID.test(requestId ?? '') || !Number.isSafeInteger(cellCount) || cellCount < 1 || cellCount > 10000 ||
      typeof afterUtc !== 'string' || new Date(afterUtc).toISOString() !== afterUtc)
    throw new Error('An exact promotion request is required');
  return { datasetId, checksum, engineSha, servingSha, requestId, cellCount, afterUtc };
}

export function readinessRequest(p) {
  return { version: 1, sourceSha: p.servingSha, datasetId: p.datasetId, datasetChecksum: p.checksum,
    cellCount: p.cellCount, workerCount: WORKERS, afterUtc: p.afterUtc };
}

const quote = (s) => "'" + String(s).replaceAll("'", "'\\''") + "'";
const b64 = (s) => Buffer.from(s).toString('base64');
export function remoteCommand(p) {
  p = promotionRequest(p);
  const host = readFileSync(join(HERE, 'v31-atomic-promotion-host.sh'), 'utf8');
  const args = [p.datasetId, p.checksum, p.engineSha, p.servingSha, p.requestId,
    b64(JSON.stringify(readinessRequest(p))),
    b64(readFileSync(join(HERE, 'v31-atomic-promotion-container.mjs'), 'utf8')),
    b64(readFileSync(join(HERE, 'inspect-v31-worker-readiness.mjs'), 'utf8'))];
  return `bash -c ${quote(host)} v31-atomic-promotion ${args.map(quote).join(' ')}`;
}

/** The single verdict of one host operation, given its transcript and the fresh health read after it. */
export function promotionVerdict(p, transcript, healthAfter, now = Date.now()) {
  const verdict = { ...transcript };
  delete verdict.stages;
  if (transcript.exitCode !== 0) return verdict;
  const promote = transcript.stages.promote?.at(-1);
  const load = transcript.stages.load?.at(-1);
  const status = transcript.stages.status?.at(-1);
  const ready = transcript.stages.readiness?.at(-1);
  const live = healthAfter?.liveHorseDecision;
  const store = live?.solverStores;
  if (!['promoted', 'already-promoted'].includes(promote?.result) || promote.engineCommit !== p.engineSha ||
      !storeReceiptValid(load, p, 'reload', now) || !storeReceiptValid(status, p, 'status', now) ||
      !readinessReceiptMatches(ready, readinessRequest(p)) ||
      healthAfter?.status !== 'ok' || healthAfter.releaseSha !== p.servingSha || live?.phase !== 'ready' ||
      live.workerCount !== WORKERS || store?.postflopV31 !== p.cellCount ||
      store.postflopV31Dataset?.id !== p.datasetId || store.postflopV31Dataset?.checksum !== p.checksum)
    return { ...verdict, outcome: 'promoted-loaded-readiness-unproved', changed: true, rerun: true };
  return { ...verdict, promotion: promote.result };
}

export function evaluatorArguments(dataset, operation) {
  if (!UUID.test(dataset) || operation !== 'evaluate') throw new Error('Invalid evaluator invocation');
  return ['scripts/gto-v31-evaluate-worker.mjs', `--dataset=${dataset}`];
}

async function health() {
  const response = await fetch(`${HEALTH}?v31-qualification=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Serving source read returned HTTP ${response.status}`);
  return response.json();
}
const healthy = async () => servingIdentity(await health());

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 20000 });
  if (result.status !== 0) throw new Error(`Runtime Git proof failed: ${args[0]}`);
  return result.stdout.trim();
}
export function protectedCommit(repo, sha) {
  if (!fullSha(sha)) throw new Error('Engine identity is not a full commit');
  git(repo, ['merge-base', '--is-ancestor', sha, 'origin/main']);
}

async function rpc(name, body) {
  if (process.env.SUPABASE_URL !== DATABASE || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Configured evaluator identity for the canonical database is unavailable');
  const response = await fetch(`${DATABASE}/rest/v1/rpc/${name}`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${name} returned HTTP ${response.status}: ${String(value?.message ?? '').slice(0, 200)}`);
  return value;
}
async function status(id) {
  const body = await rpc('ca_gto_v31_certification_status', { p_dataset_id: id });
  if (!Array.isArray(body?.datasets) || body.datasets.length !== 1 || body.datasets[0].dataset_id !== id)
    throw new Error('Certification status omitted the exact dataset');
  return body.datasets[0];
}

function provider() {
  if (!/^\d+$/.test(process.env.GITHUB_RUN_ID ?? '') || !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT ?? ''))
    throw new Error('Provider operation identity is unavailable');
  return `github-actions:${process.env.GITHUB_REPOSITORY}:run-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}:${process.env.GITHUB_ACTOR ?? 'unknown'}`.slice(0, 200);
}

async function resolveEvaluation(selected, directory, contextPath) {
  const control = resolve(process.env.GITHUB_WORKSPACE, 'control');
  if (git(control, ['rev-parse', 'HEAD']) !== process.env.GITHUB_SHA) throw new Error('Control checkout differs from the dispatched protected commit');
  const serving = await healthy();
  protectedCommit(control, serving.releaseSha);
  const dataset = await status(selected.dataset);
  const epoch = pinOwner(dataset);
  const compatibility = epoch ? closureCompatible(control, epoch.engine_commit, serving.releaseSha) : null;
  const choice = selectEpoch({ dataset, servingSha: serving.releaseSha, controlSha: process.env.GITHUB_SHA,
    servingComplete: closureComplete(decisionClosure(control, serving.releaseSha)), reason: selected.reason,
    epochAware: (sha) => epochAwareCommit(control, sha),
    compatibleWithServing: compatibility?.compatible });
  protectedCommit(control, choice.engineSha);
  let opened = null;
  if (choice.action !== 'resume') {
    // The pin's closure must be complete before an epoch is spent on it.
    closureCompatible(control, choice.engineSha, choice.engineSha);
    opened = await rpc('fn_gto_v31_open_evaluation_epoch', { p_dataset_id: selected.dataset,
      p_engine_commit: choice.engineSha, p_opened_by: provider(), p_reason: choice.reason });
    if (!UUID.test(opened?.epoch_id ?? '') || opened.engine_commit !== choice.engineSha)
      throw new Error('The database did not open the selected evaluation epoch');
  }
  const context = { ...selected, releaseSha: choice.engineSha, action: choice.action, servingAtResolve: serving.releaseSha,
    epoch: opened ?? { epoch_id: epoch.epoch_id, epoch_no: epoch.epoch_no, engine_commit: epoch.engine_commit },
    closure: compatibility ? { pin: compatibility.pin, serving: compatibility.serving,
      differenceCount: compatibility.differenceCount, differences: compatibility.differences } : null };
  mkdirSync(directory, { recursive: true });
  writeFileSync(contextPath, JSON.stringify(context) + '\n');
  appendFileSync(process.env.GITHUB_OUTPUT, `source_sha=${choice.engineSha}\nreceipt_directory=${directory}\n`);
  console.log(`Evaluation epoch ${context.epoch.epoch_no} pins ${choice.engineSha} (${choice.action}); serving ${serving.releaseSha}`);
}

async function runEvaluation(selected, directory, contextPath) {
  const context = JSON.parse(readFileSync(contextPath, 'utf8'));
  if (context.dataset !== selected.dataset || context.operation !== 'evaluate' || !fullSha(context.releaseSha))
    throw new Error('Resolved operation identity differs');
  const receipt = { ...context, startedAt: new Date().toISOString(), outcome: 'unknown', evaluatorExit: null };
  let failure;
  try {
    const runtime = resolve(process.env.GITHUB_WORKSPACE, 'runtime');
    if (git(runtime, ['rev-parse', 'HEAD']) !== context.releaseSha || git(runtime, ['status', '--porcelain', '--untracked-files=all']))
      throw new Error('Runtime checkout does not exactly match the clean pinned engine commit');
    protectedCommit(runtime, context.releaseSha);
    if (!epochAwareCommit(runtime, context.releaseSha)) throw new Error('The pinned runtime lacks the epoch-aware evaluator');
    // Production may advance during an evaluation; the epoch pin never moves.
    const before = await status(selected.dataset);
    const epoch = pinOwner(before);
    if (!epoch || epoch.epoch_id !== context.epoch.epoch_id || epoch.engine_commit !== context.releaseSha || epoch.promoted_at)
      throw new Error('The open evaluation epoch changed after it was resolved');
    receipt.datasetChecksum = before.dataset_checksum;
    const result = spawnSync(process.execPath, evaluatorArguments(selected.dataset, 'evaluate'), {
      cwd: join(runtime, 'server'), stdio: 'inherit',
      env: { ...process.env, GIT_COMMIT_SHA: context.releaseSha, EQUITY_GOVERNOR: 'off' },
    });
    receipt.evaluatorExit = result.status;
    if (result.status !== 0) throw new Error('Evaluator did not complete successfully; the open epoch keeps every durable receipt for a resumed run');
    const after = await status(selected.dataset);
    receipt.datasetState = after.state;
    const final = pinOwner(after);
    if (after.dataset_checksum !== before.dataset_checksum || after.state !== 'candidate' || final?.epoch_id !== epoch.epoch_id ||
        epochReceipts(after, final).length !== 8)
      throw new Error('Evaluator returned without the expected durable candidate epoch');
    receipt.outcome = 'candidate';
  } catch (error) {
    failure = error;
    receipt.outcome = 'incomplete-inspect-durable-state';
    receipt.error = error.message;
  } finally {
    try { receipt.servingAfter = await healthy(); } catch (error) { receipt.servingAfter = { error: error.message }; }
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Explicit V31 evaluate\n\n- Dataset: \`${selected.dataset}\`\n- Epoch: ${context.epoch.epoch_no} (${context.action})\n- Pinned engine: \`${context.releaseSha}\`\n- Serving at resolve: \`${context.servingAtResolve}\`\n- Outcome: **${receipt.outcome}**\n- Evaluator exit: \`${receipt.evaluatorExit}\`\n\nNothing was promoted or deployed. Promotion is the separate engine-locked operation.\n`);
  }
  if (failure) throw failure;
}

async function runPromotion(selected, directory) {
  const control = resolve(process.env.GITHUB_WORKSPACE, 'control');
  if (git(control, ['rev-parse', 'HEAD']) !== process.env.GITHUB_SHA) throw new Error('Control checkout differs from the dispatched protected commit');
  mkdirSync(directory, { recursive: true });
  const receipt = { dataset: selected.dataset, startedAt: new Date().toISOString(), outcome: 'refused-before-change' };
  let failure;
  try {
    const dataset = await status(selected.dataset);
    const plan = promotionPlan(dataset, selected.dataset);
    receipt.mode = plan.mode;
    receipt.epoch = { epoch_id: plan.epoch.epoch_id, epoch_no: plan.epoch.epoch_no, engine_commit: plan.epoch.engine_commit };
    const servingBody = await health();
    const serving = servingIdentity(servingBody);
    if (servingBody.liveHorseDecision?.workerCount !== WORKERS) throw new Error('The serving fleet is not eight ready workers');
    protectedCommit(control, plan.epoch.engine_commit);
    protectedCommit(control, serving.releaseSha);
    const compatibility = closureCompatible(control, plan.epoch.engine_commit, serving.releaseSha);
    receipt.closure = { pin: compatibility.pin, serving: compatibility.serving, differenceCount: compatibility.differenceCount,
      differences: compatibility.differences };
    if (!compatibility.compatible)
      throw new Error('The serving engine is not closure-compatible with the evaluated epoch; evaluate a new audited epoch first');
    const refusal = maintenanceRefusal(Date.now(), PROMOTION_BUDGET_MS + 60_000);
    if (refusal) throw new Error(`Refused near a maintenance boundary (${refusal}); nothing changed`);
    const cellCount = Number(dataset.runtime_cells);
    const p = promotionRequest({ datasetId: selected.dataset, checksum: dataset.dataset_checksum,
      engineSha: plan.epoch.engine_commit, servingSha: serving.releaseSha, requestId: randomUUID(), cellCount,
      afterUtc: new Date().toISOString() });
    receipt.request = p;
    const keys = process.env.V31_SSH_DIR;
    if (!keys || !/^[A-Za-z0-9.-]+$/.test(process.env.HETZNER_HOST ?? '')) throw new Error('Configured SSH metadata unavailable');
    const ssh = spawnSync('ssh', ['-i', join(keys, 'key'), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
      '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${join(keys, 'known_hosts')}`,
      '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=10',
      '-o', 'ServerAliveCountMax=3', `root@${process.env.HETZNER_HOST}`, remoteCommand(p)],
      { encoding: 'utf8', timeout: PROMOTION_BUDGET_MS + 120_000, maxBuffer: 8 << 20 });
    const transcript = hostTranscript(ssh.stdout ?? '', ssh.status);
    let healthAfter = null;
    try { healthAfter = await health(); } catch { healthAfter = null; }
    const verdict = promotionVerdict(p, transcript, healthAfter);
    Object.assign(receipt, { outcome: verdict.outcome, changed: verdict.changed, rerunnable: verdict.rerun,
      hostExit: ssh.status, hostOutcome: transcript.printed, stages: transcript.stages, healthAfter });
    if (verdict.outcome !== 'promoted-loaded-ready')
      throw new Error(`Atomic promotion ended ${verdict.outcome}; ${verdict.rerun ? 're-run promote (a recorded promotion is never repeated)' : 'inspect before any new operation'}`);
  } catch (error) {
    failure = error;
    receipt.error = error.message;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    writeFileSync(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `### Explicit V31 promote\n\n- Dataset: \`${selected.dataset}\`\n- Epoch: ${receipt.epoch?.epoch_no ?? 'n/a'} engine \`${receipt.epoch?.engine_commit ?? 'n/a'}\`\n- Serving: \`${receipt.request?.servingSha ?? 'n/a'}\`\n- Outcome: **${receipt.outcome}**${receipt.error ? `\n- Detail: ${receipt.error}` : ''}\n`);
  }
  if (failure) throw failure;
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const selected = invocation({ eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF,
    repository: process.env.GITHUB_REPOSITORY, repositoryId: process.env.GITHUB_REPOSITORY_ID, inputs: event.inputs });
  provider();
  const directory = join(process.env.RUNNER_TEMP, `gto-v31-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`);
  const contextPath = join(directory, 'context.json');
  const phase = process.argv[2];
  if (phase === 'resolve' && selected.operation === 'evaluate') return resolveEvaluation(selected, directory, contextPath);
  if (phase === 'run' && selected.operation === 'evaluate') return runEvaluation(selected, directory, contextPath);
  if (phase === 'promote' && selected.operation === 'promote') return runPromotion(selected, directory);
  throw new Error('Unknown qualification phase for this operation');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`[gto-v31-qualification] ${error.message}`); process.exitCode = 1; });
}
