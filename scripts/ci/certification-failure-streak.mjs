#!/usr/bin/env node
/**
 * A PRODUCTION CERTIFICATE THAT KEEPS FAILING REACHES A PERSON (2026-11-24).
 *
 * Club Create Certification failed on every run from about 2026-11-18 to
 * 2026-11-24 09:00Z (a refused residual fixture, then three stale assertions,
 * fixed by #11891, #11892, #11895 and #11900), and Rabbit Hunt Certification
 * failed on every daily run in the same week. Each failure was only a red
 * check run: public.operational_alert_events received nothing, so for a week
 * live club creation went uncertified and no person or fleet lane was told.
 *
 * This decides, inside the run whose verdict it is, whether that verdict goes
 * to the operational inbox through record-post-deploy-verdict.mjs, the route
 * post-deploy-e2e.yml and deploy-monitoring.yml already use:
 *
 *   passed              record. The recorder closes an open episode whose
 *                       failed releases this run covers, and writes nothing
 *                       when no episode is open.
 *   failed, and the     record. The first such run opens one episode; every
 *   previous run that   later failure bumps it (the recorder reuses a firing
 *   ran the certificate episode), so a streak is one alert, not one per run.
 *   on main also failed
 *   failed, previous    do not record. One failed run (a publish superseded
 *   passed              mid-proof is the common case) stays a red check; the
 *                       second failure in a row is the alarm.
 *   could not read the  record. An unread history is never treated as a pass
 *   history             (CLAUDE.md 10.86), so it fails loud, not silent.
 *
 * A run whose certificate job was cancelled or skipped is passed over when the
 * previous run is looked for: it certified nothing either way.
 *
 * It also names the failed steps and the first error line of each failed
 * certificate job, for the alert's description. No timer and no watcher
 * (CLAUDE.md 10.85): it rides the run. It makes a fixed, small number of
 * single GitHub API reads (MAX_PAGES run lists, then one job list per run) and never polls.
 *
 * Run:  GH_TOKEN=... GITHUB_REPOSITORY=owner/repo RUN_ID=... WORKFLOW_FILE=x.yml \
 *       CERT_JOB=certify CERT_RESULT=failure [GITHUB_OUTPUT=...] \
 *       node scripts/ci/certification-failure-streak.mjs
 */
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// The history is paged, never polled: at most MAX_PAGES single list reads of
// PER_PAGE completed runs on main, then one job-list read per run until the
// newest run whose certificate job actually ran. Club Create Certification
// starts on every publish and skips certify on most of them, so twenty runs is
// not enough history (2026-11-24, review of #11919).
export const PER_PAGE = 100;
export const MAX_PAGES = 3;
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
const PASSED = 'success';

/** Pure decision, exported for the regression test. previous: 'success' | 'failure' | 'none' | 'unknown'. */
export function decide({ result, previous }) {
  if (result === PASSED)
    return {
      record: true,
      reason: 'the certificate passed; a passing run may close an open episode',
    };
  if (result === 'skipped') return { record: false, reason: 'the certificate did not run' };
  if (previous === 'unknown')
    return {
      record: true,
      reason: 'the previous run could not be read; an unread history is never a pass',
    };
  if (previous === 'failure')
    return { record: true, reason: 'the certificate failed twice in a row on main' };
  return {
    record: false,
    reason:
      previous === 'none'
        ? 'first failure with no earlier certificate run on main; the next failure in a row alarms'
        : 'first failure after a pass; the next failure in a row alarms',
  };
}

/** The certificate job's conclusion in one run's job list, or null when it did not run. */
export function certificateConclusion(jobsPayload, jobName) {
  const jobs = jobsPayload && Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : null;
  if (!jobs) return 'unknown';
  const matches = jobs.filter((job) => job && job.name === jobName);
  if (matches.length === 0) return null;
  const conclusion = matches[matches.length - 1].conclusion;
  if (conclusion === PASSED) return 'success';
  if (FAILED.has(conclusion)) return 'failure';
  return null;
}

/** The first line of a job log that says what failed. Never the generic exit line. */
export function firstErrorLine(log) {
  const lines = String(log || '')
    .split('\n')
    .map((line) =>
      line
        .replace(/\u001b\[[0-9;]*m/g, '')
        .replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '')
        .trim()
    );
  const generic = /Process completed with exit code|Node\.js \d+ is deprecated/;
  const patterns = [
    /^##\[error\]/,
    /\bFAIL\b/,
    /\b(Error|AssertionError|TypeError|RangeError):/,
    /\bREFUSED\b|\brefused\b/,
  ];
  for (const pattern of patterns) {
    const hit = lines.find((line) => pattern.test(line) && !generic.test(line));
    if (hit)
      return hit
        .replace(/^##\[error\]/, '')
        .trim()
        .slice(0, 300);
  }
  return null;
}

async function api(path, token, { text = false } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} for ${path}`);
  return text ? res.text() : res.json();
}

/**
 * previous certificate result on main, newest first, passing over runs where
 * it did not run. When no run in the paged history executed the certificate,
 * the answer is unknown, which alerts: an unread history is never a pass.
 */
export async function readPrevious({ token, repo, workflowFile, runId, jobName, read = api }) {
  try {
    let examined = 0;
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const runs = await read(
        `/repos/${repo}/actions/workflows/${encodeURIComponent(workflowFile)}/runs` +
          `?branch=main&status=completed&per_page=${PER_PAGE}&page=${page}`,
        token
      );
      const listed = runs.workflow_runs || [];
      const candidates = listed
        .filter((run) => String(run.id) !== String(runId))
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      for (const run of candidates) {
        examined += 1;
        const jobs = await read(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, token);
        const conclusion = certificateConclusion(jobs, jobName);
        if (conclusion === 'unknown')
          return { previous: 'unknown', error: `job list of run ${run.id} unreadable` };
        if (conclusion) return { previous: conclusion, runId: run.id, runUrl: run.html_url };
      }
      if (listed.length < PER_PAGE) break;
    }
    return {
      previous: 'unknown',
      error: `no run that executed ${jobName} among ${examined} completed runs on main`,
    };
  } catch (error) {
    return { previous: 'unknown', error: error.message };
  }
}

/** Failed steps and first error line of this run's certificate job. */
export async function readDetail({ token, repo, runId, attempt, jobName, read = api }) {
  try {
    const jobs = await read(
      `/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`,
      token
    );
    const job = (jobs.jobs || []).filter((j) => j && j.name === jobName).pop();
    if (!job) return null;
    const steps = (job.steps || [])
      .filter((step) => FAILED.has(step.conclusion))
      .map((step) => step.name);
    let error = null;
    try {
      error = firstErrorLine(
        await read(`/repos/${repo}/actions/jobs/${job.id}/logs`, token, { text: true })
      );
    } catch {
      error = null;
    }
    return { steps, error };
  } catch {
    return null;
  }
}

async function main() {
  const env = process.env;
  const need = (key) => {
    const value = (env[key] || '').trim();
    if (!value) throw new Error(`${key} is missing`);
    return value;
  };
  const token = (env.GH_TOKEN || env.GITHUB_TOKEN || '').trim();
  const repo = need('GITHUB_REPOSITORY');
  const runId = need('RUN_ID');
  const attempt = (env.RUN_ATTEMPT || '1').trim();
  const workflowFile = need('WORKFLOW_FILE');
  const jobName = need('CERT_JOB');
  const result = need('CERT_RESULT');

  let previous = { previous: 'unknown', error: 'no GitHub token' };
  if (token && result !== PASSED && result !== 'skipped')
    previous = await readPrevious({ token, repo, workflowFile, runId, jobName });
  const outcome = decide({ result, previous: previous.previous });

  const lines = [];
  if (outcome.record && result !== PASSED) {
    const detail = token ? await readDetail({ token, repo, runId, attempt, jobName }) : null;
    lines.push(
      `Failed steps: ${detail && detail.steps.length ? detail.steps.join(', ') : 'could not tell'}`
    );
    lines.push(`First error: ${(detail && detail.error) || 'could not tell'}`);
    if (previous.runUrl) lines.push(`Previous failed run: ${previous.runUrl}`);
    if (previous.error) lines.push(`History not read: ${previous.error}`);
  }

  console.log(
    `${outcome.record ? 'RECORD' : 'HOLD'}  ${jobName} ${result}; previous ${previous.previous}: ${outcome.reason}`
  );
  for (const line of lines) console.log(`      ${line}`);
  if (env.GITHUB_OUTPUT) {
    const delimiter = `streak_${runId}_${Date.now()}`;
    appendFileSync(
      env.GITHUB_OUTPUT,
      `record=${outcome.record ? 'yes' : 'no'}\ndetail<<${delimiter}\n${lines.join('\n')}\n${delimiter}\n`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    // A decision this step could not make still admits the verdict: recording
    // on doubt is the loud direction.
    console.error(`COULD NOT TELL  ${error.message}; recording the verdict`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'record=yes\n');
  });
}
