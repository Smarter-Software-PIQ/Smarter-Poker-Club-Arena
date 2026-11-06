// Directly invoked planning and evidence primitives. This module never publishes.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, renameSync, lstatSync, readdirSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
const digest = value => createHash('sha256').update(value).digest('hex');
const requireValue = (value, message) => { if (!value) throw Error(message); };


export function inputFingerprint(root, { inputs, command, runtime, environment, schema }) {
  // No implicit environment capture: only explicit nonsecret identity/version values.
  requireValue(Array.isArray(inputs) && inputs.length && Array.isArray(command) && command.length,
    'Explicit input closure and command required');
  for (const [key, value] of Object.entries({ runtime, environment, schema }))
    requireValue(typeof value === 'string' && value.length, `${key} identity required`);
  const files = [];
  const visit = path => {
    requireValue(typeof path === 'string' && path && !isAbsolute(path) &&
      !path.split('/').some(p => p === '..' || p === '.' || p === ''), 'Unsafe input path');
    const full = resolve(root, path);
    requireValue(realpathSync(full) === resolve(realpathSync(root), path), 'Symlink ancestor input');
    requireValue(!relative(root, full).startsWith('..'), 'Input outside checkout');
    const stat = lstatSync(full); // Missing and symlink inputs refuse reuse.
    requireValue(!stat.isSymbolicLink(), 'Symlink input is not reusable');
    if (stat.isDirectory()) for (const child of readdirSync(full).sort()) visit(`${path}/${child}`);
    else {
      requireValue(stat.isFile(), 'Nonregular input');
      files.push([path, stat.mode & 0o111, digest(readFileSync(full))]);
    }
  };
  for (const path of [...new Set(inputs)].sort()) visit(path);
  return digest(JSON.stringify({ version: 1, files, command, runtime, environment, schema }));
}

export function readProviderEvidence(expected, receipt, readApi = path => JSON.parse(execFileSync('gh', ['api', path], {
  encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
}))) {
  requireValue(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(expected.repository || ''), 'Repository identity required');
  requireValue([receipt?.runId, receipt?.jobId, receipt?.attempt].every(v => Number.isSafeInteger(v) && v > 0), 'Provider operation identity required');
  requireValue(/^[0-9a-f]{40}$/.test(receipt.head || '') && typeof expected.check === 'string' && expected.check &&
    /^\.github\/workflows\/[A-Za-z0-9_-]+\.yml$/.test(expected.workflow || ''), 'Workflow/check/source identity required');
  const prefix = `repos/${expected.repository}/actions`;
  const run = readApi(`${prefix}/runs/${receipt.runId}`);
  const job = readApi(`${prefix}/jobs/${receipt.jobId}`);
  requireValue(run.id === receipt.runId && run.head_sha === receipt.head && run.run_attempt === receipt.attempt &&
    run.repository?.full_name.toLowerCase() === expected.repository.toLowerCase() && run.path === expected.workflow &&
    job.run_id === run.id && job.id === receipt.jobId && job.head_sha === run.head_sha &&
    job.run_attempt === receipt.attempt && job.name === expected.check && job.status === 'completed',
    'Provider job provenance differs');
  return { runId: run.id, head: run.head_sha, attempt: run.run_attempt, repository: expected.repository,
    workflow: run.path, check: job.name, conclusion: job.conclusion };
}

export function reusableEvidence(receipt, expected, providerObservation) {
  const reasons = [];
  if (!receipt || receipt.version !== 1 || receipt.status !== 'passed' || receipt.exitCode !== 0)
    reasons.push('no_successful_execution');
  for (const key of ['fingerprint', 'check', 'authority', 'environment'])
    if (!expected[key] || receipt?.[key] !== expected[key]) reasons.push(`changed_or_missing_${key}`);
  if (!receipt?.startedAt || !receipt?.finishedAt ||
      !Number.isFinite(Date.parse(receipt.startedAt)) ||
      !Number.isFinite(Date.parse(receipt.finishedAt)) ||
      Date.parse(receipt.finishedAt) < Date.parse(receipt.startedAt)) reasons.push('invalid_execution_time');
  if (expected.authority === 'github') {
    // Caller supplies an authenticated provider readback, never the downloaded receipt alone.
    if (!providerObservation || providerObservation.conclusion !== 'success' ||
      providerObservation.runId !== receipt?.runId || providerObservation.head !== receipt?.head ||
      providerObservation.repository !== expected.repository ||
      providerObservation.workflow !== expected.workflow || providerObservation.check !== expected.check ||
      providerObservation.attempt !== receipt?.attempt) reasons.push('provider_provenance_unverified');
  } else if (expected.authority !== 'local') reasons.push('unknown_authority');
  return { reusable: reasons.length === 0, reasons };
}

export function operationTransition(current, event) {
  requireValue(event && typeof event.owner === 'string' && event.owner && event.id, 'Owner and operation required');
  if (!current) {
    requireValue(event.action === 'claim', 'Claim first');
    return { version: 1, id: event.id, owner: event.owner, status: 'claimed', sequence: 0 };
  }
  requireValue(current.id === event.id && current.owner === event.owner, 'Operation has another owner');
  requireValue(current.sequence === event.sequence, 'Stale operation revision');
  const allowed = {
    claimed: { start: 'running', abandon: 'abandoned' },
    running: { success: 'succeeded', failure: 'failed', interrupted: 'unknown' },
    unknown: { observed_success: 'succeeded', observed_failure: 'failed', observed_running: 'running' },
    failed: { retry: 'claimed' },
  };
  const status = allowed[current.status]?.[event.action];
  requireValue(status, 'Illegal operation transition; read back unknown outcome before retry');
  if (current.status === 'unknown') requireValue(event.source, 'Durable readback source required');
  return { ...current, status, sequence: current.sequence + 1, source: event.source ?? null };
}

export function updateOperation(directory, event) {
  mkdirSync(directory, { recursive: true });
  // Atomic exclusive creation serializes only this operation, never unrelated releases.
  const lock = resolve(directory, 'mutation.lock');
  writeFileSync(lock, event.owner, { flag: 'wx', mode: 0o600 });
  const file = resolve(directory, 'operation.json');
  let current;
  try {
    try { current = JSON.parse(readFileSync(file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const next = operationTransition(current, event);
    const temp = resolve(directory, `${randomUUID()}.json`);
    writeFileSync(temp, `${JSON.stringify(next)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(temp, file);
    return next;
  } finally {
    // No stale-lock takeover: an interrupted write requires explicit ownership recovery.
    unlinkSync(lock);
  }
}

export function failureDisposition({ outcome, sideEffect, source }) {
  if (!source || outcome === 'unknown' || outcome === 'timeout')
    return { action: 'readback', retry: false };
  if (outcome === 'success') return { action: 'verify', retry: false };
  if (outcome === 'test_failure' || outcome === 'configuration_failure')
    return { action: 'diagnose_changed_inputs', retry: false };
  if (outcome === 'provider_transient' && sideEffect === false)
    return { action: 'bounded_retry_same_operation', retry: true };
  return { action: 'inspect_owning_operation', retry: false };
}

export function summarizeMetrics(events) {
  requireValue(Array.isArray(events), 'Event array required');
  const count = type => events.filter(e => e.type === type).length;
  return { builds: count('build'), reusedChecks: count('reuse'), retries: count('retry'),
    statusMessages: count('status'), escapedRegressions: count('escaped_regression'),
    tokens: events.every(e => Number.isFinite(e.tokens)) ? events.reduce((n, e) => n + e.tokens, 0) : null,
    cost: events.every(e => Number.isFinite(e.cost)) ? events.reduce((n, e) => n + e.cost, 0) : null };
}

// Explicit maintained dependency inventory, never basename guesses or a SQL =>
// accounting rule. This describes selection; owning gates decide admission.
export function executionInventory(entries) {
  requireValue(Array.isArray(entries) && entries.length, 'Check inventory required');
  const ids = new Set();
  const safe = path => typeof path === 'string' && path && !isAbsolute(path) &&
    !path.includes('\\') && !path.includes('\0') &&
    !path.replace(/\/$/, '').split('/').some(part => !part || part === '.' || part === '..');
  for (const entry of entries) {
    requireValue(entry && typeof entry.id === 'string' && entry.id && !ids.has(entry.id), 'Unique check identity required');
    ids.add(entry.id);
    for (const key of ['owner', 'invariant', 'runtime', 'environment'])
      requireValue(typeof entry[key] === 'string' && entry[key], `${entry.id}: ${key} required`);
    requireValue(Array.isArray(entry.command) && entry.command.length && entry.command.every(v => typeof v === 'string' && v), 'Explicit command required');
    requireValue(Array.isArray(entry.inputs) && entry.inputs.length && entry.inputs.every(safe), 'Explicit safe input paths/scopes required');
    requireValue(Array.isArray(entry.risks) && entry.risks.length && entry.risks.every(v =>
      ['documentation','tooling','client','engine','database','financial','security','verification'].includes(v)), 'Explicit risk classification required');
    requireValue(typeof entry.always === 'boolean', 'Always-on admission must be explicit');
    requireValue(entry.durationSeconds == null || (Number.isFinite(entry.durationSeconds) && entry.durationSeconds >= 0), 'Observed duration or null required');
    requireValue(entry.replaces == null || typeof entry.replaces === 'string', 'Replacement identity must be explicit');
  }
  const overlap = [];
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    if (entries[i].invariant === entries[j].invariant)
      overlap.push({ checks: [entries[i].id, entries[j].id], invariant: entries[i].invariant,
        action: 'Review distinct authority/runtime before retiring anything; overlap never auto-skips a gate' });
  }
  return { version: 1, checks: structuredClone(entries), overlap };
}

export function previewExecution(inventory, { paths, complete, required = [], evidence = {}, expectedEvidence = {}, observations = {} }) {
  // Validate even a deserialized inventory rather than accepting a claimed seal.
  const checked = executionInventory(inventory?.checks);
  requireValue(Array.isArray(required) && required.every(id => checked.checks.some(c => c.id === id)), 'Unknown required gate');
  requireValue(Array.isArray(paths) && paths.every(p => typeof p === 'string' && p && !p.includes('\0')), 'Changed paths required');
  const matches = (path, input) => input.endsWith('/') ? path.startsWith(input) : path === input;
  const uncovered = paths.filter(path => !checked.checks.some(c => c.inputs.some(input => matches(path, input))));
  const uncertain = complete !== true || uncovered.length > 0;
  const checks = checked.checks.map(check => {
    const affected = paths.filter(path => check.inputs.some(input => matches(path, input)));
    const selected = uncertain || check.always || required.includes(check.id) || affected.length > 0;
    const reuse = expectedEvidence[check.id]
      ? reusableEvidence(evidence[check.id], expectedEvidence[check.id], observations[check.id])
      : { reusable: false, reasons: ['no_complete_input_evidence'] };
    return { ...check, selected, affected,
      reason: uncertain ? 'Incomplete or uncovered dependency evidence; preserve coverage' :
        required.includes(check.id) ? 'Required owning gate' : check.always ? 'Always-on invariant' : affected.length ? 'Declared input changed' : 'Declared inputs unchanged',
      reuse, action: !selected ? 'omit_if_owning_gate_allows' : reuse.reusable ? 'reuse_if_owning_gate_allows' : 'run' };
  });
  return { version: 1, mode: 'advisory', complete: !uncertain, uncovered, checks,
    risks: [...new Set(checks.filter(c => c.affected.length).flatMap(c => c.risks))].sort(),
    overlap: checked.overlap, estimatedSeconds: checks.filter(c => c.selected && !c.reuse.reusable).every(c => Number.isFinite(c.durationSeconds))
      ? checks.filter(c => c.selected && !c.reuse.reusable).reduce((sum,c) => sum + c.durationSeconds, 0) : null,
    limitation: 'Selection and evidence preview only; cannot waive provider, security, financial or publication gates' };
}
