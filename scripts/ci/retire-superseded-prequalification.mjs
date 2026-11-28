#!/usr/bin/env node
// One bounded, non-destructive cleanup step run ONLY after a main
// `engine-release-prequalification.yml` run has passed both `qualify` (8/8)
// and `prestage`. Cancels only strictly older ancestor runs of this exact
// workflow on `main`; never cancels itself, same-SHA runs, newer commits, or
// unrelated/non-ancestor commits; fails safe on any API or git error.
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const WORKFLOW_FILE = 'engine-release-prequalification.yml';
export const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILE}`;

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * True ONLY when `candidateSha` is a strictly older ancestor of `currentSha`
 * (`candidateSha !== currentSha` and `git merge-base --is-ancestor` exits 0).
 * Newer commits, diverged commits, and unknown SHAs all return false.
 */
export function isStrictGitAncestor(candidateSha, currentSha, cwd = process.cwd()) {
  if (!SHA_RE.test(candidateSha) || !SHA_RE.test(currentSha) || candidateSha === currentSha) {
    return false;
  }
  const probe = spawnSync(
    'git',
    ['--no-replace-objects', 'merge-base', '--is-ancestor', candidateSha, currentSha],
    { cwd, stdio: 'ignore', timeout: 10000 }
  );
  return probe.status === 0;
}

export async function retireSupersededPrequalification({
  repository,
  runId,
  headSha,
  ref,
  qualifyResult,
  prestageResult,
  request,
  isStrictAncestor = isStrictGitAncestor,
  maxCancels = 25,
  log = console.log,
  warn = (message) => console.error(`::warning::${message}`),
}) {
  if (ref !== 'refs/heads/main' || qualifyResult !== 'success' || prestageResult !== 'success') {
    return { cancelled: [], skipped: [], errors: [], reason: 'gate-not-passed' };
  }

  if (
    !REPO_RE.test(String(repository ?? '')) ||
    !SHA_RE.test(String(headSha ?? '')) ||
    !Number.isSafeInteger(runId) ||
    runId <= 0
  ) {
    const message = 'Invalid prequalification run identity; skipping retirement';
    warn(message);
    return { cancelled: [], skipped: [], errors: [{ message }], reason: 'invalid-identity' };
  }

  const expectedRepo = repository.toLowerCase();
  const seen = new Set();
  const discovered = [];
  const errors = [];

  for (const status of ['in_progress', 'queued']) {
    const path = `repos/${repository}/actions/workflows/${WORKFLOW_FILE}/runs?branch=main&status=${status}&per_page=100`;
    try {
      const payload = await request('GET', path);
      if (!Array.isArray(payload?.workflow_runs)) {
        const message = `Unreadable prequalification run inventory for status=${status}`;
        warn(message);
        errors.push({ message });
        continue;
      }
      for (const run of payload.workflow_runs) {
        if (Number.isSafeInteger(run?.id) && !seen.has(run.id)) {
          seen.add(run.id);
          discovered.push(run);
        }
      }
    } catch (error) {
      const message = `Failed to list ${status} prequalification runs: ${error?.message ?? String(error)}`;
      warn(message);
      errors.push({ message });
    }
  }

  const cancelled = [];
  const skipped = [];

  for (const run of discovered) {
    const id = run?.id;
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    if (id === runId) {
      skipped.push({ id, reason: 'self' });
      continue;
    }
    if (run.path !== WORKFLOW_PATH) {
      skipped.push({ id, reason: 'other-workflow' });
      continue;
    }
    if (run.head_branch !== 'main') {
      skipped.push({ id, reason: 'other-branch' });
      continue;
    }
    const repoName = run.repository?.full_name?.toLowerCase();
    const headRepoName = run.head_repository?.full_name?.toLowerCase();
    if (repoName !== expectedRepo || headRepoName !== expectedRepo) {
      skipped.push({ id, reason: 'other-repository' });
      continue;
    }
    if (run.status === 'completed') {
      skipped.push({ id, reason: 'completed' });
      continue;
    }
    if (!SHA_RE.test(String(run.head_sha ?? ''))) {
      skipped.push({ id, reason: 'invalid-sha' });
      continue;
    }
    if (run.head_sha === headSha) {
      skipped.push({ id, reason: 'same-sha' });
      continue;
    }
    if (!isStrictAncestor(run.head_sha, headSha)) {
      skipped.push({ id, reason: 'not-strict-ancestor' });
      continue;
    }
    if (cancelled.length >= maxCancels) {
      skipped.push({ id, reason: 'budget-reached' });
      continue;
    }

    try {
      await request('POST', `repos/${repository}/actions/runs/${id}/cancel`);
      cancelled.push(id);
      log(
        `Cancelled superseded ancestor prequalification run ${id} (${run.head_sha.slice(0, 12)} < ${headSha.slice(0, 12)})`
      );
    } catch (error) {
      const message = error?.message ?? String(error);
      warn(`Failed to cancel superseded prequalification run ${id}: ${message}`);
      errors.push({ id, message });
    }
  }

  return {
    cancelled,
    skipped,
    errors,
    reason: errors.length > 0 ? 'completed-with-warnings' : 'complete',
  };
}

function ghApiRequest(token) {
  return async (method, path) => {
    const args = method === 'POST' ? ['api', '-X', 'POST', path] : ['api', path];
    const stdout = execFileSync('gh', args, {
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, GH_TOKEN: token },
    });
    if (method === 'POST' || !stdout.trim()) return {};
    return JSON.parse(stdout);
  };
}

async function main() {
  const token = process.env.GH_TOKEN;
  if (!token) throw new Error('GH_TOKEN is unavailable');
  await retireSupersededPrequalification({
    repository: process.env.GITHUB_REPOSITORY,
    runId: Number(process.env.GITHUB_RUN_ID),
    headSha: process.env.GITHUB_SHA,
    ref: process.env.GITHUB_REF,
    qualifyResult: process.env.QUALIFY_RESULT,
    prestageResult: process.env.PRESTAGE_RESULT,
    request: ghApiRequest(token),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // Best-effort non-fatal suppression: never fail a passing prequalification run.
    console.error(
      `::warning::Superseded prequalification retirement skipped: ${error?.message ?? String(error)}`
    );
  });
}
