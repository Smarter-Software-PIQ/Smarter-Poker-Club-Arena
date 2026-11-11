#!/usr/bin/env node
/**
 * V31 STRICT RE-CHECK DISPATCH (2026-11-07).
 *
 * A contract v3 playbook is served only by the engine it was certified on or
 * by an engine that passed a strict re-check round (migration
 * 20261107035438, `recheck` operation of gto-v31-qualification.yml). The plan
 * approved on 2026-11-06 makes the V31 lane run that re-check after each
 * engine update, as a dispatched step, with no timer.
 *
 * This is that step. It runs when an "Auto-Deploy Hetzner Engine" run on main
 * completes, whatever its verdict: a run can activate the engine and still fail
 * a later job, so the verdict is not the signal. The serving engine is (health
 * ok, phase ready, releaseSha). It reads, from production, the
 * serving engine and every candidate or active contract v3 dataset, and
 * dispatches `recheck` once for each one this engine still needs:
 *
 *   - never for the certifying engine itself, a passed (epoch, engine) pair,
 *     a retired playbook, or one without an execution anchor;
 *   - never when the serving engine's execution fingerprint differs from the
 *     anchor (that needs a full new certification, not a re-check);
 *   - never while a qualification run for that dataset is queued or running.
 *
 * It is a separate workflow run: nothing here can fail an engine release.
 * With no contract v3 playbook (today) it reads and dispatches nothing.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isClubArenaRepository } from './repository-identity.mjs';
import { RECHECK_CONTRACT } from './gto-v31-qualification.mjs';
import { executionClosure, executionDigest } from './v31-execution-fingerprint.mjs';
import { writeIntent } from './dispatch-intent.mjs';

const HEALTH = 'https://engine.smarter.poker/health';
const DATABASE = 'https://kuklfnapbkmacvwxktbh.supabase.co';
const SHA = /^[0-9a-f]{40}$/;
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_IN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;

export const RECHECK_WORKFLOW = 'gto-v31-qualification.yml';
/** The `name:` of the engine release workflow; any completed run of it may have changed the serving engine. */
export const RELEASE_WORKFLOW_NAME = 'Auto-Deploy Hetzner Engine (on server/ changes)';
/**
 * The release workflow is recognised by its file, never by its run name. Its
 * `run-name` titles every run per engine ("Engine Release <sha>"), and a
 * workflow_run payload's `name` is that title: on 2026-11-08 the admission
 * compared it with the workflow's name, refused the successful release that
 * put 391f7bc0 in service (run 42413295909 -> decision run 42415683930,
 * "Not a successful protected-main engine release"), and so no release since
 * #9852 could ever dispatch a re-check.
 */
export const RELEASE_WORKFLOW_PATH = '.github/workflows/auto-deploy-hetzner.yml';
export const RELEASE_STATES = Object.freeze(['active', 'candidate']);

const fullSha = (v) => typeof v === 'string' && SHA.test(v) && v !== '0'.repeat(40);

/**
 * Which contract v3 playbooks this serving engine must be re-checked for.
 * Pure: every input is read by the caller. Active first, then candidates, each
 * dataset at most once.
 */
export function recheckDispatchPlan({ datasets, statuses, servingSha, servingExecutionDigest, busyDatasets }) {
  const dispatch = [];
  const skipped = [];
  if (!fullSha(servingSha)) return { dispatch, skipped: [{ dataset: null, reason: 'serving engine identity is unavailable' }] };
  const busy = busyDatasets instanceof Set ? busyDatasets : new Set(busyDatasets ?? []);
  const seen = new Set();
  const playbooks = (Array.isArray(datasets) ? datasets : [])
    .filter((d) => d?.evaluation_contract === RECHECK_CONTRACT && RELEASE_STATES.includes(d.state))
    .sort((a, b) => RELEASE_STATES.indexOf(a.state) - RELEASE_STATES.indexOf(b.state) ||
      String(a.dataset_id).localeCompare(String(b.dataset_id)));
  for (const d of playbooks) {
    const id = d.dataset_id;
    const skip = (reason) => skipped.push({ dataset: id ?? null, reason });
    if (typeof id !== 'string' || !UUID.test(id)) { skip('malformed dataset id'); continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    const s = statuses?.[id];
    if (!s || s.dataset_id !== id || !UUID.test(s.recheck_epoch_id ?? '')) { skip('no re-check status for the certified epoch'); continue; }
    const rounds = Array.isArray(s.rounds) ? s.rounds : [];
    if (rounds.some((r) => r?.outcome === 'retired')) { skip('lost a re-check and is retired for good'); continue; }
    const anchor = (Array.isArray(s.anchors) ? s.anchors : []).find((a) => a?.epoch_id === s.recheck_epoch_id);
    if (!anchor) { skip('the certified epoch has no execution anchor'); continue; }
    if (anchor.engine_commit === servingSha) { skip('the serving engine is the certifying engine'); continue; }
    if (rounds.some((r) => r?.epoch_id === anchor.epoch_id && r?.serving_commit === servingSha && r?.outcome === 'passed')) {
      skip('the serving engine already passed'); continue;
    }
    if (!HEX.test(servingExecutionDigest ?? '')) { skip('the serving execution digest is unavailable'); continue; }
    if (anchor.execution_digest !== servingExecutionDigest) {
      skip('the serving execution fingerprint differs: a full new certification is required'); continue;
    }
    if (busy.has(id)) { skip('a qualification run for this dataset is already queued or running'); continue; }
    dispatch.push({ dataset: id, state: d.state, servingSha });
  }
  return { dispatch, skipped };
}

/** Datasets a queued or running qualification run already owns (run-name carries the dataset). */
export function busyDatasetsFromRuns(runs) {
  const busy = new Set();
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(run?.status)) continue;
    for (const id of String(run?.display_title ?? run?.name ?? '').match(UUID_IN) ?? []) busy.add(id);
  }
  return busy;
}

/** The dispatch body for one re-check. */
// The receiving job refuses a job-token dispatch unless it is the exact intent
// this run recorded and uploaded (scripts/ci/dispatch-intent.mjs, 2026-11-11),
// so every recheck is written as an intent first and its body comes from it.
export function recheckIntent(dataset, dir, env = process.env, nonce) {
  if (!UUID.test(dataset ?? '')) throw new Error('A canonical dataset UUID is required');
  return writeIntent({ operation: 'gto-recheck', inputs: { dataset, operation: 'recheck', reason: '' }, dir, env,
    ...(nonce ? { nonce } : {}) });
}

/**
 * Any completed release run on protected main of this repository starts a decision,
 * whatever its verdict. The run's conclusion does not say whether the serving engine
 * changed: Engine Release 40bc24676 (run 42389189340, 2026-11-07) activated and
 * served while a later job of the same run failed, so a success-only gate never
 * re-checked an engine that was live. The decision reads the serving engine from
 * production (health ok, phase ready) and skips an engine already certified or
 * passed, so a run that activated nothing dispatches nothing.
 */
export function releaseEventAdmitted({ eventName, repository, repositoryId, workflowRun }) {
  return eventName === 'workflow_run' && isClubArenaRepository(repository, repositoryId) &&
    workflowRun?.path === RELEASE_WORKFLOW_PATH && workflowRun?.head_branch === 'main';
}

async function json(url, init, label) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), ...init });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  return value;
}
function rpc(name, body) {
  if (process.env.SUPABASE_URL !== DATABASE || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('Configured service identity for the canonical database is unavailable');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return json(`${DATABASE}/rest/v1/rpc/${name}`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
    body: JSON.stringify(body) }, name);
}
function github(path, init = {}) {
  if (!process.env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is unavailable');
  return fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${path}`, { signal: AbortSignal.timeout(30000), ...init,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28', ...(init.headers ?? {}) } });
}
function summary(lines) {
  const text = `### V31 strict re-check after an engine release\n\n${lines.join('\n')}\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
  console.log(text);
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!releaseEventAdmitted({ eventName: process.env.GITHUB_EVENT_NAME, repository: process.env.GITHUB_REPOSITORY,
    repositoryId: process.env.GITHUB_REPOSITORY_ID, workflowRun: event.workflow_run })) {
    summary(['- Not a successful protected-main engine release: nothing to decide.']);
    return;
  }
  const health = await json(`${HEALTH}?v31-recheck=${Date.now()}`, {}, 'Serving health');
  const servingSha = health?.status === 'ok' && health?.liveHorseDecision?.phase === 'ready' ? health.releaseSha : null;
  const datasets = (await rpc('ca_gto_v31_certification_status', { p_dataset_id: null }))?.datasets;
  if (!Array.isArray(datasets)) throw new Error('Certification status returned no dataset list');
  const playbooks = datasets.filter((d) => d?.evaluation_contract === RECHECK_CONTRACT && RELEASE_STATES.includes(d.state));
  if (playbooks.length === 0) {
    summary([`- Serving engine: \`${servingSha ?? 'unknown'}\``, '- No candidate or active contract v3 playbook: nothing to re-check.']);
    return;
  }
  const statuses = {};
  for (const d of playbooks) statuses[d.dataset_id] = await rpc('fn_gto_v31_recheck_status', { p_dataset_id: d.dataset_id });
  let servingExecutionDigest = null;
  if (fullSha(servingSha)) {
    const repo = resolve(process.cwd());
    const onMain = spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', servingSha, 'origin/main'], { timeout: 20000 });
    if (onMain.status === 0) {
      try { servingExecutionDigest = executionDigest(executionClosure(repo, servingSha)); } catch { servingExecutionDigest = null; }
    }
  }
  const runs = [];
  for (const status of ['queued', 'in_progress']) {
    const r = await github(`/actions/workflows/${RECHECK_WORKFLOW}/runs?status=${status}&per_page=50`);
    if (!r.ok) throw new Error(`Reading ${status} qualification runs returned HTTP ${r.status}`);
    runs.push(...((await r.json())?.workflow_runs ?? []));
  }
  const plan = recheckDispatchPlan({ datasets: playbooks, statuses, servingSha, servingExecutionDigest,
    busyDatasets: busyDatasetsFromRuns(runs) });
  const lines = [`- Serving engine: \`${servingSha ?? 'unknown'}\``];
  for (const s of plan.skipped) lines.push(`- \`${s.dataset}\`: no re-check (${s.reason})`);
  const sends = [];
  for (const d of plan.dispatch) {
    const intent = recheckIntent(d.dataset, process.env.INTENT_DIR);
    sends.push({ dataset: d.dataset, state: d.state, body: intent.body });
    lines.push(`- \`${d.dataset}\` (${d.state}): re-check intent recorded`);
  }
  writeFileSync(process.env.INTENT_STATE, JSON.stringify(sends));
  if (sends.length && process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'send=true\n');
  summary(lines);
}

/** Second phase: send exactly the bodies the first phase recorded, after the upload. */
async function send() {
  const sends = JSON.parse(readFileSync(process.env.INTENT_STATE, 'utf8'));
  const lines = [];
  for (const s of sends) {
    const r = await github(`/actions/workflows/${RECHECK_WORKFLOW}/dispatches`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s.body) });
    if (r.status !== 204) throw new Error(`Dispatching the re-check of ${s.dataset} returned HTTP ${r.status}`);
    lines.push(`- \`${s.dataset}\` (${s.state}): **re-check dispatched**`);
  }
  summary(lines);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (process.argv[2] === 'send' ? send() : main()).catch((error) => { console.error(`[gto-v31-recheck-dispatch] ${error.message}`); process.exitCode = 1; });
}
