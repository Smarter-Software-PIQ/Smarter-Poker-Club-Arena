/**
 * IS AN ENGINE RELEASE IN FLIGHT? ONE SHARED, ADVISORY ANSWER (2026-11-09).
 *
 * Other lanes (migration installs, hand dispatches of Apply Merged Migration,
 * owner-window bookings) need to know when not to change production schema:
 * an install that lands after the Backup certificate was read, or inside the
 * 03:30-04:05 Chicago preparation and cutover, makes the certified schema and
 * production disagree. Until now each lane guessed from run lists.
 *
 * This reads only what the release lane already writes: GitHub's own run and
 * job state of stage-engine-release.yml and auto-deploy-hetzner.yml. It adds
 * no status, file or record, and nothing reads its answer as a gate:
 *
 *   ADVISORY ONLY. It never blocks, waits, retries, dispatches or cancels
 *   anything, and no workflow may use it to admit or refuse a release.
 *
 * In flight means one of:
 *   - a Stage run whose admitted reservation is waiting for, or past, its
 *     cutoff (step "Wait once for the reserved cutoff ..." started), or whose
 *     window-migrations / selection / signal job is running;
 *   - a receiver run whose release preflight or Hetzner publish job is running
 *     (private Horse observation and withdrawal runs are not releases).
 *
 * Output: one JSON object on stdout, {"inFlight": true|false, "advisory",
 * "runs": [...]}. Exit 0 either way. When GitHub cannot be read it prints
 * {"inFlight": null, ...} and exits 2: unknown is not "no" (CLAUDE.md 10.86),
 * so treat it as in flight.
 *
 * Usage: GH_TOKEN=... node scripts/ci/engine-release-in-flight.mjs
 *        (GITHUB_REPOSITORY defaults to this repository)
 * Pinned by tests/an-engine-release-in-flight-is-advisory.law.test.ts.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const STAGE_WORKFLOW = 'stage-engine-release.yml';
export const RECEIVER_WORKFLOW = 'auto-deploy-hetzner.yml';
export const STAGE_DETECT_JOB = 'Prove Whether The Server Tree Changed';
export const STAGE_WAIT_STEP_PREFIX = 'Wait once for the reserved cutoff';
export const STAGE_LATER_JOBS = [
  'Install Queued Daily-Maintenance Migrations',
  'Record the daily release evidence',
  'Dispatch The Exact Main SHA',
];
export const RECEIVER_RELEASE_JOBS = [
  'Verify the exact prepared engine release request',
  'Prove The Exact Engine Has Every Production Door',
  'Publish Through Hetzner Club Arena',
];

const started = (x) => x && (x.status === 'in_progress' || x.status === 'completed');

/** The phase a Stage run's jobs show, or null when it is not in flight. */
export function stagePhase(jobs) {
  for (const job of jobs) {
    if (job.status !== 'in_progress') continue;
    if (STAGE_LATER_JOBS.includes(job.name)) return job.name;
    if (job.name === STAGE_DETECT_JOB) {
      const wait = (job.steps ?? []).find(
        (s) => typeof s.name === 'string' && s.name.startsWith(STAGE_WAIT_STEP_PREFIX)
      );
      if (started(wait)) return 'reserved, waiting for or binding the cutoff';
    }
  }
  return null;
}

/** The phase a receiver run's jobs show, or null when it is not a release in flight. */
export function receiverPhase(jobs) {
  const job = jobs.find(
    (j) => j.status === 'in_progress' && RECEIVER_RELEASE_JOBS.includes(j.name)
  );
  return job ? job.name : null;
}

export function verdict(runs) {
  const inFlight = runs.length > 0;
  return {
    inFlight,
    advisory: inFlight
      ? 'An engine release is in flight: do not install or hand-dispatch migrations until it ends. Advisory only; nothing is blocked.'
      : 'No engine release is in flight. Advisory only; the applier and window guards still decide.',
    runs,
  };
}

function gh(path) {
  const out = execFileSync('gh', ['api', path], {
    encoding: 'utf8',
    timeout: 20_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

export function read(repo, api = gh) {
  const runs = [];
  for (const [workflow, phaseOf] of [
    [STAGE_WORKFLOW, stagePhase],
    [RECEIVER_WORKFLOW, receiverPhase],
  ]) {
    const list = api(
      `repos/${repo}/actions/workflows/${workflow}/runs?status=in_progress&per_page=30`
    );
    if (!Array.isArray(list.workflow_runs)) throw new Error(`no workflow_runs for ${workflow}`);
    for (const run of list.workflow_runs) {
      const page = api(`repos/${repo}/actions/runs/${run.id}/jobs?per_page=50`);
      if (!Array.isArray(page.jobs)) throw new Error(`no jobs for run ${run.id}`);
      const phase = phaseOf(page.jobs);
      if (phase)
        runs.push({
          workflow,
          id: run.id,
          url: run.html_url,
          event: run.event,
          createdAt: run.created_at,
          phase,
        });
    }
  }
  return verdict(runs);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const repo = process.env.GITHUB_REPOSITORY || 'Smarter-Poker/Smarter-Poker-Club-Arena';
  try {
    process.stdout.write(`${JSON.stringify(read(repo), null, 2)}\n`);
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({ inFlight: null, advisory: `Could not read GitHub (${err.message.split('\n')[0]}); treat a release as in flight.`, runs: [] }, null, 2)}\n`
    );
    process.exit(2);
  }
}
