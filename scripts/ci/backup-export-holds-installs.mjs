/**
 * NO INSTALL LANDS INSIDE A BACKUP EXPORT (2026-11-09).
 *
 * backup-engine.yml's refresh job copies production's structure to the Backup
 * host: it captures schema evidence, runs a read-only pg_dump, captures the
 * evidence again from the dump and compares the two. Apply Merged Migration
 * installs merged migrations whenever it is dispatched. An install that
 * commits between the two captures makes the copy disagree with itself (the
 * refresh fails and the Backup certificate waits another ~55 minutes), and one
 * that commits just after the dump leaves the copy a version behind the
 * production it is meant to mirror.
 *
 * The applier therefore waits, inside its existing bounded queue, while a
 * Backup refresh is between its "due" decision and the end of its export.
 * It does not wait while the refresh is still deciding: that step itself
 * waits (bounded) for merged migrations production has not installed yet, so
 * holding the applier there would make each wait for the other.
 *
 * This module is the pure half plus a read-only reader. It sends nothing to
 * the database and writes nothing to GitHub. Output: one integer on stdout,
 * the number of Backup exports in progress. Exit 2 with nothing on stdout
 * when GitHub cannot be read (CLAUDE.md 10.86: an unreadable answer is not a
 * "no"); the applier refuses with nothing sent in that case.
 *
 * Pinned by tests/a-migration-install-waits-out-a-backup-export.law.test.ts.
 */
import { pathToFileURL } from 'node:url';

export const BACKUP_WORKFLOW = 'backup-engine.yml';
export const REFRESH_JOB = 'refresh';
export const DUE_STEP = 'Decide whether the production copy is due';
export const EXPORT_STEP_PREFIX = 'Export the production structure';

/**
 * True when this refresh job is past a positive "due" decision and its
 * export has not finished. A step GitHub has not listed yet counts as not
 * finished.
 */
export function exportInProgress(job) {
  if (!job || job.name !== REFRESH_JOB || job.status !== 'in_progress') return false;
  const steps = Array.isArray(job.steps) ? job.steps : [];
  const due = steps.find((s) => s.name === DUE_STEP);
  if (!due || due.status !== 'completed' || due.conclusion !== 'success') return false;
  const exp = steps.find((s) => typeof s.name === 'string' && s.name.startsWith(EXPORT_STEP_PREFIX));
  return !exp || exp.status !== 'completed';
}

export function countExports(jobs) {
  return jobs.filter(exportInProgress).length;
}

async function readJson(url, token) {
  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GH_TOKEN are required');
  const api = `https://api.github.com/repos/${repo}/actions`;
  const runs = await readJson(`${api}/workflows/${BACKUP_WORKFLOW}/runs?status=in_progress&per_page=20`, token);
  if (!Array.isArray(runs.workflow_runs)) throw new Error('no workflow_runs in the answer');
  const jobs = [];
  for (const run of runs.workflow_runs) {
    const page = await readJson(`${api}/runs/${run.id}/jobs?per_page=50`, token);
    if (!Array.isArray(page.jobs)) throw new Error(`no jobs in the answer for run ${run.id}`);
    jobs.push(...page.jobs);
  }
  process.stdout.write(`${countExports(jobs)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(`backup export state unreadable: ${err.message}\n`);
    process.exit(2);
  });
}
