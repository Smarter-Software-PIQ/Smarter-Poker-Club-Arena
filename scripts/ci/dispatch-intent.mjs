#!/usr/bin/env node
/**
 * DISPATCH INTENT: the exact binding between a job-token dispatch and the
 * trusted run that sent it (owner direction 2026-11-11).
 *
 * A job token (github-actions[bot]) can start another workflow only through
 * workflow_dispatch or repository_dispatch. Naming "a recent run of the right
 * sender" proves nothing about the inputs, and can be replayed. So:
 *
 *   SENDER  `write` records one intent per dispatch BEFORE sending it: the
 *           operation, the exact inputs, this repository, the sender's
 *           workflow path, run id, attempt, head SHA and event, and a random
 *           128-bit nonce. The sender's own job uploads every intent as the
 *           artifact `dispatch-intents-<run_attempt>` of that exact run, then
 *           sends the body `write` printed. Only the sender workflow's
 *           reviewed code can upload an artifact to its own run.
 *
 *   RECEIVER `prove` (first step of every bot-admitted privileged job) reads
 *           the payload from GITHUB_EVENT_PATH, never from caller-chosen
 *           environment, and refuses unless:
 *             1. this run is the named receiver workflow, event and action;
 *             2. the cited sender run attempt is the operation's sender
 *                workflow, in this repository, for an allowed event, on the
 *                default branch with a head SHA protected main contains
 *                (pull_request_target runs default-branch code by definition
 *                and is admitted on its event and same-repository head);
 *             3. that run attempt owns exactly one unexpired
 *                `dispatch-intents-<attempt>` artifact whose recorded run id
 *                and head SHA are that run's, holding `<nonce>.json`;
 *             4. the intent names this operation, repository, sender path,
 *                run, attempt, head SHA, event and nonce;
 *             5. every operation input in the payload equals the intent's
 *                value exactly, and no other input is present;
 *             6. ONE TIME: this run's display title (its run-name carries the
 *                nonce or the sender attempt) is the expected one, this is
 *                attempt 1, and no earlier run of this receiver workflow
 *                since the sender run started carries the same title. A
 *                second dispatch citing the same intent is refused.
 *
 * Only data is read from the artifact: one JSON member, size-capped, parsed
 * with JSON.parse. Nothing in it is executed, imported or interpolated.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const RUN_ID = /^[1-9][0-9]{0,19}$/;
const ATTEMPT = /^[1-9][0-9]{0,3}$/;
const NONCE = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MIGRATION = /^supabase\/migrations\/[A-Za-z0-9_.-]{1,200}\.sql$|^[A-Za-z0-9_.-]{1,200}\.sql$/;
const INTENT_KEYS = ['intent_run_id', 'intent_run_attempt', 'intent_nonce'];
export const MAX_INTENT_BYTES = 65536;

/** What each sender may ask for. `inputs`: name -> { required, test(value) }. */
export const OPERATIONS = Object.freeze({
  'apply-merged-migration': {
    sender: '.github/workflows/dispatch-merged-migrations.yml',
    senderEvents: ['pull_request_target'],
    dispatch: { kind: 'repository_dispatch', eventType: 'apply-merged-migration' },
    inputs: {
      migration: { required: true, test: (v) => typeof v === 'string' && MIGRATION.test(v) },
      dry_run: { required: true, test: (v) => v === false },
    },
  },
  'engine-certification': {
    sender: '.github/workflows/auto-deploy-hetzner.yml',
    senderEvents: ['repository_dispatch'],
    dispatch: { kind: 'repository_dispatch', eventType: 'run-post-deploy-e2e' },
    inputs: {
      engine_sha: { required: true, test: (v) => typeof v === 'string' && SHA.test(v) },
      release_run_key: { required: false, test: (v) => typeof v === 'string' && /^[1-9][0-9]{0,19}-[1-9][0-9]{0,3}$/.test(v) },
      gameplay_receipt: { required: false, test: (v) => typeof v === 'string' && v.length <= 32768 },
    },
  },
  'gto-recheck': {
    sender: '.github/workflows/gto-v31-qualification.yml',
    senderEvents: ['workflow_run'],
    dispatch: { kind: 'workflow_dispatch', workflow: 'gto-v31-qualification.yml', ref: 'main' },
    inputs: {
      dataset: { required: true, test: (v) => typeof v === 'string' && UUID.test(v) },
      operation: { required: true, test: (v) => v === 'recheck' },
      reason: { required: true, test: (v) => v === '' },
    },
  },
});

/**
 * Which receiver job accepts which operation, and the display title its
 * run-name must produce (the one-time key). `emptyInputs`: declared
 * workflow_dispatch inputs the operation never sets; they must be absent or ''.
 */
export const RECEIVERS = Object.freeze({
  'apply-merged-migration': {
    path: '.github/workflows/apply-merged-migration.yml', event: 'repository_dispatch',
    action: 'apply-merged-migration', operation: 'apply-merged-migration',
    title: (i, n) => `Apply Merged Migration ${i.migration} ${n}`,
  },
  'post-deploy-e2e': {
    path: '.github/workflows/post-deploy-e2e.yml', event: 'repository_dispatch',
    action: 'run-post-deploy-e2e', operation: 'engine-certification',
    title: (i, n) => `Post-Deploy E2E ${i.engine_sha} ${n}`,
  },
  'backup-after-seal': {
    path: '.github/workflows/backup-engine.yml', event: 'repository_dispatch',
    action: 'run-post-deploy-e2e', operation: 'engine-certification', requires: ['release_run_key'],
    title: (i) => `Backup after seal ${i.release_run_key}`,
  },
  'gto-recheck': {
    path: '.github/workflows/gto-v31-qualification.yml', event: 'workflow_dispatch',
    operation: 'gto-recheck', emptyInputs: ['engine'],
    title: (i, n) => `V31 qualification recheck ${i.dataset} ${n}`,
  },
});

export const artifactName = (attempt) => `dispatch-intents-${attempt}`;

function fail(message) { throw new Error(message); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const workflowPath = (ref) => String(ref ?? '').replace(/^[^/]+\/[^/]+\//, '').replace(/@.*$/, '');

export function validateInputs(operation, inputs) {
  const spec = OPERATIONS[operation] ?? fail(`unknown operation ${operation}`);
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) fail('inputs must be an object');
  for (const key of Object.keys(inputs)) {
    const rule = spec.inputs[key] ?? fail(`input ${key} is not part of ${operation}`);
    if (!rule.test(inputs[key])) fail(`input ${key} is not an admitted ${operation} value`);
  }
  for (const [key, rule] of Object.entries(spec.inputs))
    if (rule.required && !(key in inputs)) fail(`input ${key} is required for ${operation}`);
  return spec;
}

/** Record one intent and return the exact request body to send. */
export function writeIntent({ operation, inputs, dir, env = process.env, nonce = randomBytes(16).toString('hex') }) {
  const spec = validateInputs(operation, inputs);
  const sender = {
    repository: env.GITHUB_REPOSITORY, senderPath: workflowPath(env.GITHUB_WORKFLOW_REF),
    senderRunId: String(env.GITHUB_RUN_ID ?? ''), senderRunAttempt: String(env.GITHUB_RUN_ATTEMPT ?? ''),
    senderHeadSha: env.GITHUB_SHA, senderEvent: env.GITHUB_EVENT_NAME,
  };
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(sender.repository ?? '')) fail('GITHUB_REPOSITORY is required');
  if (sender.senderPath !== spec.sender) fail(`${operation} may only be sent by ${spec.sender}`);
  if (!spec.senderEvents.includes(sender.senderEvent)) fail(`${operation} may not be sent from a ${sender.senderEvent} run`);
  if (!RUN_ID.test(sender.senderRunId) || !ATTEMPT.test(sender.senderRunAttempt) || !SHA.test(sender.senderHeadSha ?? ''))
    fail('the sending run identity is incomplete');
  if (!NONCE.test(nonce)) fail('nonce must be 32 lowercase hex characters');
  const intent = { schema: 1, operation, ...sender, nonce, inputs };
  const text = JSON.stringify(intent);
  if (Buffer.byteLength(text) > MAX_INTENT_BYTES) fail('intent is too large');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${nonce}.json`), text, { flag: 'wx' });
  const fields = { intent_run_id: sender.senderRunId, intent_run_attempt: sender.senderRunAttempt, intent_nonce: nonce };
  const body = spec.dispatch.kind === 'repository_dispatch'
    ? { event_type: spec.dispatch.eventType, client_payload: { ...inputs, ...fields } }
    : { ref: spec.dispatch.ref, inputs: { ...Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, String(v)])), ...fields } };
  return { nonce, intent, body, path: spec.dispatch.kind === 'repository_dispatch' ? 'dispatches' : `actions/workflows/${spec.dispatch.workflow}/dispatches` };
}

function containsProtected(compare) {
  return compare && (compare.status === 'identical' || compare.status === 'ahead');
}

/**
 * Prove the dispatch that started this run. `api(path)` returns parsed JSON
 * for a repository-relative REST path and throws on any non-2xx;
 * `readIntent(artifact, nonce)` returns the text of `<nonce>.json` in it.
 */
export async function proveIntent({ receiverName, env, event, api, readIntent }) {
  const receiver = RECEIVERS[receiverName] ?? fail(`unknown receiver ${receiverName}`);
  const operation = OPERATIONS[receiver.operation];
  const repo = env.GITHUB_REPOSITORY;
  if (env.GITHUB_EVENT_NAME !== receiver.event) fail(`${receiverName} admits only ${receiver.event}`);
  if (receiver.action && event?.action !== receiver.action) fail(`${receiverName} admits only the ${receiver.action} action`);
  const raw = receiver.event === 'repository_dispatch' ? event?.client_payload : event?.inputs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('the dispatch carried no payload');
  const runId = String(raw.intent_run_id ?? '');
  const attempt = String(raw.intent_run_attempt ?? '');
  const nonce = String(raw.intent_nonce ?? '');
  if (!RUN_ID.test(runId) || !ATTEMPT.test(attempt) || !NONCE.test(nonce))
    fail('a job-token dispatch must cite its sender run, attempt and intent nonce');

  // 1. This run.
  const own = await api(`actions/runs/${env.GITHUB_RUN_ID}`);
  if (String(own.id) !== String(env.GITHUB_RUN_ID) || own.path !== receiver.path || own.event !== receiver.event)
    fail('this run is not the named receiver');
  if (String(own.run_attempt) !== '1' || String(env.GITHUB_RUN_ATTEMPT) !== '1')
    fail('a job-token dispatch is honoured on its first attempt only; a person may re-run it');

  // 2. The sender run attempt.
  const run = await api(`actions/runs/${runId}/attempts/${attempt}`);
  const defaultBranch = event?.repository?.default_branch || 'main';
  if (String(run.id) !== runId || String(run.run_attempt) !== attempt) fail('the cited sender attempt does not exist');
  if (run.path !== operation.sender || !operation.senderEvents.includes(run.event))
    fail(`the cited run is not ${operation.sender} on ${operation.senderEvents.join('/')}`);
  if (run.repository?.full_name !== repo || run.head_repository?.full_name !== repo)
    fail('the cited run did not run in this repository');
  if (!SHA.test(run.head_sha ?? '')) fail('the cited run has no head SHA');
  if (run.event !== 'pull_request_target') {
    if (run.head_branch !== defaultBranch) fail('the cited run did not run on the default branch');
    const compare = await api(`compare/${run.head_sha}...${defaultBranch}`);
    if (!containsProtected(compare)) fail('the cited run head is not on protected main');
  }

  // 3. The artifact that run attempt uploaded.
  const listing = await api(`actions/runs/${runId}/artifacts?name=${artifactName(attempt)}&per_page=10`);
  const artifacts = (listing?.artifacts ?? []).filter((a) => a?.name === artifactName(attempt));
  if (artifacts.length !== 1) fail('the cited run attempt did not record exactly one intent artifact');
  const artifact = artifacts[0];
  if (artifact.expired || String(artifact.workflow_run?.id) !== runId || artifact.workflow_run?.head_sha !== run.head_sha)
    fail('the intent artifact does not belong to the cited run');
  const text = await readIntent(artifact, nonce);
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_INTENT_BYTES) fail('the intent record is missing or too large');
  let intent;
  try { intent = JSON.parse(text); } catch { fail('the intent record is not JSON'); }

  // 4. The intent names this exact sender and operation.
  const expected = { schema: 1, operation: receiver.operation, repository: repo, senderPath: operation.sender,
    senderRunId: runId, senderRunAttempt: attempt, senderHeadSha: run.head_sha, senderEvent: run.event, nonce };
  for (const [key, value] of Object.entries(expected))
    if (intent?.[key] !== value) fail(`the intent does not bind ${key}`);
  validateInputs(receiver.operation, intent.inputs);

  // 5. The payload carries exactly the intended inputs.
  const declared = new Set([...Object.keys(intent.inputs), ...INTENT_KEYS, ...(receiver.emptyInputs ?? [])]);
  for (const key of Object.keys(raw)) if (!declared.has(key)) fail(`the dispatch carried an unbound input ${key}`);
  for (const key of receiver.emptyInputs ?? []) if (raw[key] !== undefined && raw[key] !== '') fail(`input ${key} must be empty`);
  for (const [key, value] of Object.entries(intent.inputs)) {
    const got = receiver.event === 'workflow_dispatch' ? String(raw[key] ?? '') : raw[key];
    const want = receiver.event === 'workflow_dispatch' ? String(value) : value;
    if (canonical(got) !== canonical(want)) fail(`input ${key} differs from the sender's intent`);
  }
  for (const key of receiver.requires ?? []) if (!(key in intent.inputs)) fail(`${receiverName} requires ${key}`);
  if ('release_run_key' in intent.inputs && intent.inputs.release_run_key !== `${runId}-${attempt}`)
    fail('release_run_key does not name the sending attempt');

  // 6. One time.
  const title = receiver.title(intent.inputs, nonce);
  if (own.display_title !== title) fail('this run does not carry the intent title');
  const since = encodeURIComponent(`>=${run.created_at}`);
  const file = receiver.path.split('/').pop();
  for (let page = 1; page <= 20; page += 1) {
    const list = await api(`actions/workflows/${file}/runs?event=${receiver.event}&created=${since}&per_page=100&page=${page}`);
    const runs = list?.workflow_runs ?? [];
    for (const other of runs)
      if (other.display_title === title && Number(other.id) < Number(own.id))
        fail(`intent already consumed by run ${other.id}`);
    if (runs.length < 100) return { title, intent, sender: run };
  }
  fail('could not read every earlier receiver run');
}

function githubApi(env) {
  const base = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/`;
  const headers = { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  return {
    async api(path) {
      const r = await fetch(base + path, { headers });
      if (!r.ok) fail(`GitHub answered HTTP ${r.status} for ${path.split('?')[0]}`);
      return r.json();
    },
    async readIntent(artifact, nonce) {
      if (!NONCE.test(nonce)) fail('invalid nonce');
      const first = await fetch(`${base}actions/artifacts/${Number(artifact.id)}/zip`, { headers, redirect: 'manual' });
      const location = first.headers.get('location');
      const r = location ? await fetch(location) : first;
      if (!r.ok) fail(`the intent artifact download answered HTTP ${r.status}`);
      const zip = Buffer.from(await r.arrayBuffer());
      if (zip.length > 4 * 1024 * 1024) fail('the intent artifact is too large');
      const dir = mkdtempSync(join(tmpdir(), 'dispatch-intent-'));
      try {
        writeFileSync(join(dir, 'intents.zip'), zip);
        return execFileSync('unzip', ['-p', join(dir, 'intents.zip'), `${nonce}.json`],
          { maxBuffer: MAX_INTENT_BYTES, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch { fail('the intent artifact holds no record for this nonce'); } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  };
}

function args(argv) {
  const out = { inputs: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]; const value = argv[i + 1];
    if (flag === '--input' || flag === '--input-json') {
      const at = value.indexOf('=');
      if (at < 1) fail(`${flag} needs key=value`);
      out.inputs[value.slice(0, at)] = flag === '--input' ? value.slice(at + 1) : JSON.parse(value.slice(at + 1));
      i += 1;
    } else if (flag.startsWith('--')) { out[flag.slice(2)] = value; i += 1; } else fail(`unexpected argument ${flag}`);
  }
  return out;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const a = args(rest);
  if (command === 'write') {
    const out = writeIntent({ operation: a.operation, inputs: a.inputs, dir: a.dir ?? fail('--dir is required') });
    process.stdout.write(`${JSON.stringify({ nonce: out.nonce, path: out.path, body: out.body })}\n`);
  } else if (command === 'prove') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const result = await proveIntent({ receiverName: a.receiver, env: process.env, event, ...githubApi(process.env) });
    console.log(`Dispatch intent proved: ${result.title} from ${result.sender.path} run ${result.sender.id} attempt ${result.sender.run_attempt} at ${result.sender.head_sha}.`);
  } else fail('usage: dispatch-intent.mjs write --operation OP --dir DIR [--input k=v|--input-json k=json]... | prove --receiver NAME');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(`::error::[dispatch-intent] ${error.message}`); process.exitCode = 1; });
}
