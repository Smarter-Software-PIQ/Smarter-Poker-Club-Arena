#!/usr/bin/env node
/**
 * IMMEDIATE MIGRATION APPLY REFUSAL ALERT (2026-11-26, post-incident 37a45c05).
 *
 * WHY. On 2026-11-26, `Apply Merged Migration` refused #12129 (run 45903772035)
 * at 22:18 UTC with FATAL 25P04 after 12,156 ms. Because nothing listened to
 * failed applier runs, the refusal went unnoticed until `migration-install-watch`
 * fired CRITICAL `MergedMigrationNotInstalled` an hour later (23:20 UTC),
 * stalling the next 3-hourly Backup certification and engine cutover (O7).
 *
 * WHO RUNS IT (2026-11-27). The apply run reports its own refusal: the
 * `report-refusal` job of `.github/workflows/apply-merged-migration.yml` runs
 * this, in the same run, when its `apply` job concluded `failure`. The first
 * version listened for `workflow_run` instead, and never heard one: the merge
 * dispatcher starts the applier with the Actions job token, and GitHub raises
 * no `workflow_run` event for a run the job token started. Apply run
 * 46054847104 refused 20261127172908 at 2026-11-27 13:13 CST and no alert was
 * posted anywhere (CLAUDE.md 10.83). `migration-apply-refusal-alert.yml` stays
 * as the hand door (re-report a run by id) and for runs a person or an App
 * started.
 *
 * Because the report job runs INSIDE the run it reports, the run's own
 * conclusion is still null. So the decision is read from the JOB: the run's
 * apply job completed with conclusion `failure`. The jobs API shows a
 * completed job's conclusion while the run is in progress, and a completed
 * job's log is readable then too (`GET /actions/jobs/{id}/logs` answers once
 * that job has completed; only the run-level log archive waits for the run).
 *
 * WHAT. It:
 *   1. reads the failed run's metadata, job steps, and error log via the
 *      GitHub API (using only `github.token`; zero DB secrets, zero DB calls);
 *   2. resolves the merged PR that introduced/modified the migration on `main`;
 *   3. posts ONE deduplicated alert comment on the owning PR (if found) and
 *      ONE deduplicated alert comment on release custody issue #11599.
 *
 * SAFETY BOUNDARIES:
 *   - Reporting only: never retries, dispatches, mutates DB, or advances any release.
 *   - Never emits a line starting with `Cycle:`, `Result:`, `Sealed SHA:`, or
 *     `Serving SHA:` on issue #11599, so cutover-log parsers (`cycle-without-outcome.py`,
 *     `post-cutover-receipt.mjs`) never mistake it for a cutover outcome.
 *   - Deduplicates by run ID (`<!-- migration-apply-refusal:<runId> -->`) so
 *     manual re-runs, and the two doors together, never double-post.
 *   - A job log that could not be read is said so in the comment
 *     ("detail unread"); it is never rendered as an alert with nothing wrong.
 *
 * A TIMED-OUT APPLY IS REPORTED (2026-11-27). A job that reaches its
 * `timeout-minutes` is cancelled by GitHub ("The maximum number of minutes to
 * let a job run before GitHub automatically cancels it", workflow syntax), so
 * its conclusion is `cancelled`, never `failure`, and the first version of the
 * report job never ran for one. A timeout is the UNKNOWN outcome: the SQL may
 * or may not have committed. A cancelled apply job is therefore reported when
 * the applier was reached, and skipped, with its reason, when nothing can have
 * been sent. What tells them apart was read off this repository's cancelled
 * runs, not assumed:
 *   - cancelled while queued, before any job existed (43707103923, 40143306489
 *     and most of the 69 cancelled runs): the jobs list is empty;
 *   - job never started (38717981247, 37872820690): no runner, no steps;
 *   - cancelled before the apply step ran (42760192569): `Apply the migration`
 *     is `skipped`, the cancel landed in the Postgres client install;
 *   - cancelled inside the apply step but in its queue wait (42692313645 after
 *     7 min, 42693377171): the step is `cancelled` and its log holds only
 *     `[queue] ... waiting` lines, no `[order]` or `[apply]` line, because the
 *     gate in front of the applier loops before any database connection;
 *   - reached the applier (46054847104, the refusal of 20261127172908): the log
 *     holds `[order] ... installing <file>` then `[apply] <file>`.
 * A timeout and a person's cancel leave the same job shape and log ("The
 * operation was canceled."); only the elapsed time tells them apart, so the
 * cause is TIMED OUT when the job ran at least APPLY_JOB_MIN_TIMEOUT_MINUTES.
 *
 * THE OWNING PR IS THE ONE THE RUN APPLIED (2026-11-27). The owning commit is
 * the latest non-revert commit on the migration path AT OR BEFORE the apply
 * run was created. Unbounded, a late re-report of 46054847104 named #12245
 * (merged 22:11 UTC, after the run) instead of #12217 (merged 19:10 UTC, the
 * merge that dispatched the run at 19:10:48 UTC).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const LOG_ISSUE = '11599';
export const APPLY_WORKFLOW_PATH = '.github/workflows/apply-merged-migration.yml';
export const ALERT_PREFIX = 'Migration apply refusal alert';
/**
 * The jobs API names a job by its rendered `name:`, never by its YAML key. The
 * applier's job is `Apply <file>`; the job that runs this script is named
 * REPORT_JOB_NAME. tests/the-apply-run-reports-its-own-refusal.law.test.ts
 * holds the workflow to both, so the report job is never read as the failure.
 */
export const APPLY_JOB_NAME_PREFIX = 'Apply ';
export const REPORT_JOB_NAME = 'Report a refused install';
/** The apply job's step that runs the queue gate and then the applier. */
export const APPLY_STEP_NAME = 'Apply the migration';
/**
 * The shortest `timeout-minutes` the apply job carries (one named file gets
 * more). A cancelled apply job that ran at least this long was stopped by its
 * timeout. tests/the-apply-run-reports-its-own-refusal.law.test.ts holds the
 * workflow to it.
 */
export const APPLY_JOB_MIN_TIMEOUT_MINUTES = 35;
export const GH_ALLOW_ESCAPES_FLAG = '--allow-escape-sequences';
// CSI (colour and cursor), OSC (title/hyperlink) and two-byte escapes.
const ANSI_ESCAPE_RE = /\x1b(?:\[[0-?]*[ -\/]*[@-~]|\][^\x07\x1b]*\x07?|[@-Z^_])/g;

/** Pure. Remove terminal escape sequences so a coloured log line parses like a plain one. */
export const stripAnsi = (text) => String(text ?? '').replace(ANSI_ESCAPE_RE, '');
const MIGRATION_FILE_RE = /\b(\d{14}_[a-z0-9_]+\.sql)\b/;
const FORBIDDEN_LOG_LINE_RE = /^(?:Cycle|Result|Sealed SHA|Serving SHA):/i;
const REVERT_SUBJECT_RE = /^revert(?:\s*\(|:|\s+")/i;
const PR_NUM_IN_SUBJECT_RE = /\(#(\d+)\)\s*$/;

/** Pure. Deduplication HTML marker embedded in every posted comment. */
export const dedupMarker = (runId) => `<!-- migration-apply-refusal:${String(runId)} -->`;

/** Pure. True when a comment list already has an alert for this run ID. */
export function alreadyReported(comments, runId) {
  const id = String(runId);
  const marker = dedupMarker(id);
  const prefix = `${ALERT_PREFIX} for run ${id}`;
  return (comments ?? []).some(
    (c) => typeof c?.body === 'string' && (c.body.includes(marker) || c.body.startsWith(prefix))
  );
}

/** Pure. Extract the migration filename from the run title or job names. */
export function extractMigrationFile(run, jobs = []) {
  const candidates = [run?.display_title, run?.name, ...(jobs ?? []).map((j) => j?.name)];
  for (const text of candidates) {
    if (typeof text !== 'string') continue;
    const m = MIGRATION_FILE_RE.exec(text);
    if (m) return m[1];
  }
  return null;
}

/** Pure. Strip ANSI codes, a byte-order mark and the GitHub Actions ISO timestamp prefix from a log line. */
function cleanLogLine(line) {
  return stripAnsi(line)
    .replace(/^\uFEFF/, '')
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s+/, '')
    .trim();
}

/**
 * Pure. The apply job that FAILED, or null. Only a completed job named
 * `Apply <file>` with conclusion `failure` qualifies: the report job (in
 * progress while it asks, and named REPORT_JOB_NAME) and any other job are
 * never chosen, whatever their conclusion.
 */
export function pickFailedApplyJob(jobs) {
  return (
    (jobs ?? []).find(
      (j) =>
        typeof j?.name === 'string' &&
        j.name !== REPORT_JOB_NAME &&
        j.name.startsWith(APPLY_JOB_NAME_PREFIX) &&
        (j.status === undefined || j.status === 'completed') &&
        j.conclusion === 'failure'
    ) ?? null
  );
}

/**
 * Pure. The apply job to report, or null: a completed `Apply <file>` job that
 * concluded `failure` (a refusal) or `cancelled` (a timeout or a cancel, which
 * the caller then judges by its step and log). Never the report job.
 */
export function pickReportableApplyJob(jobs) {
  return (
    (jobs ?? []).find(
      (j) =>
        typeof j?.name === 'string' &&
        j.name !== REPORT_JOB_NAME &&
        j.name.startsWith(APPLY_JOB_NAME_PREFIX) &&
        (j.status === undefined || j.status === 'completed') &&
        (j.conclusion === 'failure' || j.conclusion === 'cancelled')
    ) ?? null
  );
}

/**
 * Pure. True when the job's `Apply the migration` step started: it is running
 * or concluded anything but `skipped`. A step GitHub never reached is listed
 * `skipped` (42760192569) or not at all.
 */
export function applyStepStarted(job) {
  const step = (job?.steps ?? []).find((s) => s?.name === APPLY_STEP_NAME);
  if (!step) return false;
  if (step.status === 'in_progress') return true;
  return step.conclusion != null && step.conclusion !== 'skipped';
}

/** Pure. The conclusion of the job's `Apply the migration` step, or null. */
export function applyStepConclusion(job) {
  return (job?.steps ?? []).find((s) => s?.name === APPLY_STEP_NAME)?.conclusion ?? null;
}

/**
 * Pure. True when the log shows the queue gate let the run through to the
 * ordering step or the applier: a line that BEGINS with `[order]` or `[apply]`
 * once the timestamp is stripped. The step's echoed shell source carries
 * `echo "[apply] ...`, which begins with `echo` and is never counted.
 */
export function logShowsApplierReached(logText) {
  return stripAnsi(logText)
    .split(/\r?\n/)
    .some((raw) => /^\[(?:apply|order)\]/.test(cleanLogLine(raw)));
}

/**
 * Pure. The last `[order]` or `[apply]` line in the log (credential-redacted,
 * at most 280 characters), or null: where the applier was when it stopped.
 */
export function lastApplierLine(logText) {
  let last = null;
  for (const raw of stripAnsi(logText).split(/\r?\n/)) {
    const line = cleanLogLine(raw);
    if (/^\[(?:apply|order)\]/.test(line)) last = line;
  }
  if (last == null) return null;
  return last
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '<redacted-db-url>')
    .replace(/(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]+/g, '<redacted-token>')
    .slice(0, 280);
}

/** Pure. Milliseconds the job ran, or null when either end is unreadable. */
export function jobElapsedMs(job) {
  const start = Date.parse(job?.started_at ?? '');
  const end = Date.parse(job?.completed_at ?? '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}

/**
 * Pure. Why a cancelled apply job stopped: TIMED OUT when it ran at least the
 * shortest apply timeout, otherwise CANCELLED (a person or the platform).
 */
export function cancelledCause(job) {
  const ms = jobElapsedMs(job);
  return ms != null && ms >= APPLY_JOB_MIN_TIMEOUT_MINUTES * 60_000 ? 'TIMED OUT' : 'CANCELLED';
}

/**
 * Pure. Extract concise verdict, duration, and root error lines from an
 * `Apply Merged Migration` job log, ignoring shell script source echo lines.
 */
export function extractFailureSummary(logText) {
  const rawLines = stripAnsi(logText).split(/\r?\n/);
  let verdict = 'FAILED';
  let durationMs = null;
  const errorLines = [];
  const seen = new Set();

  for (const raw of rawLines) {
    const line = cleanLogLine(raw);
    if (!line) continue;
    // Skip shell script source echoed by GitHub Actions before execution.
    if (
      line.startsWith('#') ||
      line.startsWith('echo ') ||
      line.startsWith('1) echo ') ||
      line.startsWith('3) echo ') ||
      line.includes('echo "[apply]') ||
      line.includes('echo "') ||
      line.includes("echo '")
    ) {
      continue;
    }

    const durMatch = /^\[apply\]\s+(REFUSED|UNKNOWN)\s+after\s+(\d+)ms\b/i.exec(line);
    if (durMatch) {
      verdict = durMatch[1].toUpperCase();
      durationMs = Number(durMatch[2]);
    } else if (/^\[apply\]\s+REFUSED\b/i.test(line)) {
      verdict = 'REFUSED';
    } else if (/^\[apply\]\s+UNKNOWN\b/i.test(line)) {
      verdict = 'UNKNOWN';
    }

    const isSignal =
      /^\[apply\]\s+(?:REFUSED|UNKNOWN|ERROR|FATAL)\b/i.test(line) ||
      /^(?:psql:.*)?(?:FATAL|ERROR|DETAIL|HINT):\s+/.test(line) ||
      /^::error::/.test(line) ||
      /\b(?:transaction_timeout|statement_timeout|lock_timeout|25P04|57014|55P03|migration_adds_a_shared_write|hand_path_door_missing)\b/i.test(
        line
      );

    if (isSignal) {
      const sanitized = line
        .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '<redacted-db-url>')
        .replace(/(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]+/g, '<redacted-token>')
        .slice(0, 280);
      if (!seen.has(sanitized)) {
        seen.add(sanitized);
        errorLines.push(sanitized);
      }
    }
  }

  return {
    verdict,
    durationMs,
    // Keep the most diagnostic tail (at most 8 lines) so comments stay crisp.
    summaryLines: errorLines.slice(-8),
  };
}

/** Pure. Format an ISO timestamp in America/Chicago wall time. */
export function chicagoTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown time';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'short',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

/** Pure. Ensure no line in a #11599 comment can ever be misread as a cutover receipt. */
function guardCutoverLogLine(line) {
  return FORBIDDEN_LOG_LINE_RE.test(line) ? `  ${line}` : line;
}

/** Pure. Render the comment for the owning merged PR. */
export function formatPrComment({
  runId,
  runUrl,
  migrationFile,
  verdict,
  durationMs,
  failedSteps = [],
  summaryLines = [],
  observedAt,
  detailUnread = null,
  outcomeUnread = false,
  elapsedMs = null,
}) {
  const dur = outcomeUnread
    ? elapsedMs != null
      ? ` after ${Math.round(elapsedMs / 60_000)} min`
      : ''
    : durationMs != null
      ? ` after ${durationMs}ms`
      : '';
  const lines = [
    `### ${ALERT_PREFIX} — \`${migrationFile ?? 'unknown migration'}\` (${verdict}${dur})`,
    '',
    `- **Apply run:** [#${runId}](${runUrl}) (${chicagoTime(observedAt)})`,
    `- **Failed step(s):** ${failedSteps.length ? failedSteps.join(', ') : 'unknown'}`,
    outcomeUnread
      ? `- **Impact:** The apply job was stopped after the applier was reached, so whether this migration committed is **UNREAD**. ${unreadInstruction(migrationFile)} Until it is read, treat the next Backup certification and engine cutover (O7) as blocked.`
      : `- **Impact:** This merged migration is **NOT installed** on production and will block the next Backup certification and engine cutover (O7) until fixed or reverted.`,
  ];
  if (detailUnread) {
    lines.push(`- **Detail unread:** ${detailUnread} Open the apply run for the verdict.`);
  }
  if (summaryLines.length) {
    lines.push('', '```text', ...summaryLines, '```');
  }
  lines.push(
    '',
    outcomeUnread
      ? 'Read the outcome first. If the version is recorded the migration installed; if it is not, fix the migration at source (or revert this merge if it cannot fit inside the install budget) and verify `Apply Merged Migration` succeeds.'
      : 'Fix the migration at source (or revert this merge if it cannot fit inside the install budget) and verify `Apply Merged Migration` succeeds.',
    '',
    dedupMarker(runId)
  );
  return lines.join('\n');
}

/**
 * Pure. Render the concise comment for release custody issue #11599.
 * Never starts any line with `Cycle:`, `Result:`, `Sealed SHA:`, or `Serving SHA:`.
 */
export function formatLogIssueComment({
  runId,
  runUrl,
  migrationFile,
  verdict,
  durationMs,
  owningPrNumber = null,
  owningPrUrl = null,
  summaryLines = [],
  observedAt,
  detailUnread = null,
  outcomeUnread = false,
  elapsedMs = null,
}) {
  const dur = outcomeUnread
    ? elapsedMs != null
      ? ` after ${Math.round(elapsedMs / 60_000)} min`
      : ''
    : durationMs != null
      ? ` after ${durationMs}ms`
      : '';
  const prPart =
    owningPrNumber != null
      ? owningPrUrl
        ? ` (PR [#${owningPrNumber}](${owningPrUrl}))`
        : ` (PR #${owningPrNumber})`
      : '';
  const lines = [
    `${ALERT_PREFIX} for run ${runId}: \`${migrationFile ?? 'unknown migration'}\` ${verdict}${dur}${prPart}`,
    `- Observed: ${chicagoTime(observedAt)} — [Apply Merged Migration #${runId}](${runUrl})`,
    outcomeUnread
      ? `- Custody note: the outcome is UNREAD (the apply job stopped after the applier was reached). ${unreadInstruction(migrationFile)}`
      : `- Custody note: merged migration did not install; upcoming Backup certification / engine cutover is blocked until resolved or reverted.`,
  ];
  if (detailUnread) {
    lines.push(`- Detail unread: ${detailUnread} Open the apply run for the verdict.`);
  }
  for (const errLine of summaryLines.slice(0, 4)) {
    lines.push(`- Detail: \`${errLine.replace(/`/g, "'")}\``);
  }
  lines.push(dedupMarker(runId));
  return lines.map(guardCutoverLogLine).join('\n');
}

/** Pure. What to read before any other operation when the outcome is unread. */
function unreadInstruction(migrationFile) {
  const version = /^(\d{14})_/.exec(migrationFile ?? '')?.[1];
  const query = version
    ? `\`SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '${version}'\``
    : '`supabase_migrations.schema_migrations`';
  return `Check ${query} before any other operation: no re-dispatch, no hand apply and no revert until it is read.`;
}

/** Pure. The commit's own date (a squash merge's is the merge time), or NaN. */
const commitTime = (c) => Date.parse(c?.commit?.committer?.date ?? c?.commit?.author?.date ?? '');

/**
 * Pure. Choose the owning commit for a migration file (skipping revert
 * commits). With `until`, a commit dated after it (a later merge touching the
 * same file) is never chosen; a commit with no readable date is kept.
 */
export function pickOwningCommit(commits, { until = null } = {}) {
  if (!Array.isArray(commits) || commits.length === 0) return null;
  const bound = Date.parse(until ?? '');
  if (Number.isFinite(bound)) {
    const bounded = commits.filter((c) => !(commitTime(c) > bound));
    if (bounded.length === 0) return null;
    commits = bounded;
  }
  for (const c of commits) {
    const subject = String(c?.commit?.message ?? '')
      .split('\n')[0]
      .trim();
    if (!REVERT_SUBJECT_RE.test(subject)) return c;
  }
  return commits[0];
}

/** Pure. Resolve PR number from commit pulls list or commit subject `(#12345)`. */
export function resolveOwningPr(commit, pulls = []) {
  const merged = (pulls ?? []).filter((p) => p && (p.merged_at || p.state === 'closed'));
  const chosen = merged[0] ?? (pulls ?? [])[0];
  if (chosen?.number) {
    return { number: Number(chosen.number), url: chosen.html_url ?? null };
  }
  const subject = String(commit?.commit?.message ?? '')
    .split('\n')[0]
    .trim();
  const m = PR_NUM_IN_SUBJECT_RE.exec(subject);
  if (m) return { number: Number(m[1]), url: null };
  return null;
}

/** Pure. True when this gh is too old to know GH_ALLOW_ESCAPES_FLAG. */
function ghRefusedTheFlag(err) {
  const text = `${err?.stderr ?? ''}\n${err?.message ?? ''}`;
  return text.includes('unknown flag') && text.includes(GH_ALLOW_ESCAPES_FLAG);
}

/**
 * Read a non-JSON GitHub REST body (a job log) as text.
 *
 * A job log carries terminal colour codes. gh from 2.97 refuses to print a
 * non-JSON body that holds them ("the response contains terminal escape
 * sequences") unless passed GH_ALLOW_ESCAPES_FLAG; older gh prints them and
 * does not know the flag ("unknown flag", refused by the argument parser
 * before any request is made). The log is parsed here as data and never
 * written to a terminal, so the flag is always asked for, and the ONE answer
 * "unknown flag" selects the old form. Any other failure is thrown as it is:
 * it is not retried. Same rule as gh_api_get_text in
 * scripts/release/three-hourly-readiness.py.
 *
 * `run(file, args, options)` has execFileSync's shape, so a test can stand in
 * for gh.
 */
export function ghApiText(endpoint, run = execFileSync) {
  const options = {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    // stderr is captured so the "unknown flag" answer can be read off the error.
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const base = ['api', endpoint];
  try {
    return run('gh', [...base, GH_ALLOW_ESCAPES_FLAG], options);
  } catch (err) {
    if (!ghRefusedTheFlag(err)) throw err;
    return run('gh', base, options);
  }
}

/** Real GitHub API implementation backed by `gh api` using GH_TOKEN. */
export function createGhDeps({ run = execFileSync } = {}) {
  const apiJson = (endpoint) => {
    const out = run('gh', ['api', endpoint], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(out);
  };
  const apiText = (endpoint) => ghApiText(endpoint, run);
  const postComment = (repo, issueNumber, body) => {
    const out = run(
      'gh',
      [
        'api',
        '--method',
        'POST',
        `repos/${repo}/issues/${issueNumber}/comments`,
        '-f',
        `body=${body}`,
      ],
      { encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 }
    );
    return JSON.parse(out);
  };
  return {
    getRun: (repo, runId) => apiJson(`repos/${repo}/actions/runs/${runId}`),
    getJobs: (repo, runId) => apiJson(`repos/${repo}/actions/runs/${runId}/jobs`).jobs ?? [],
    getJobLog: (repo, jobId) => apiText(`repos/${repo}/actions/jobs/${jobId}/logs`),
    getMigrationCommits: (repo, file, until = null) =>
      apiJson(
        `repos/${repo}/commits?path=${encodeURIComponent(`supabase/migrations/${file}`)}&sha=main&per_page=5${until ? `&until=${encodeURIComponent(until)}` : ''}`
      ),
    getCommitPulls: (repo, sha) => apiJson(`repos/${repo}/commits/${sha}/pulls`),
    listIssueComments: (repo, issueNumber) =>
      apiJson(`repos/${repo}/issues/${issueNumber}/comments?per_page=100`),
    postComment,
  };
}

/** Pure. One short, credential-free line saying why a read failed. */
function describeReadError(err) {
  const text = stripAnsi(`${err?.stderr ?? ''}`.trim() || `${err?.message ?? err ?? ''}`.trim());
  const last = text.split(/\r?\n/).filter(Boolean).pop() ?? 'no reason given';
  return last
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '<redacted-db-url>')
    .replace(/(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]+/g, '<redacted-token>')
    .replace(/`/g, "'")
    .slice(0, 200);
}

/**
 * Orchestrate refusal alert reporting for a single Apply Merged Migration run.
 * Pure with respect to `deps` so unit tests cover every branch without network.
 */
export async function reportMigrationApplyRefusal({
  repo,
  runId,
  dryRun = false,
  logIssue = LOG_ISSUE,
  deps = createGhDeps(),
}) {
  const id = String(runId ?? '').trim();
  if (!/^[1-9][0-9]*$/.test(id)) {
    throw new Error(`Invalid apply_run_id: ${id || '(empty)'}`);
  }
  const run = await deps.getRun(repo, id);
  if (run?.path !== APPLY_WORKFLOW_PATH) {
    return {
      status: 'skipped',
      reason: `run ${id} belongs to ${run?.path ?? 'unknown'}, not ${APPLY_WORKFLOW_PATH}`,
    };
  }
  // A run that has finished any other way is not a refusal. A run still in
  // progress has no conclusion yet (this script is then running inside it),
  // so that case is decided by the apply job below, not here.
  const runCompleted = run?.status === 'completed' || run?.conclusion != null;
  if (runCompleted && run?.conclusion !== 'failure' && run?.conclusion !== 'cancelled') {
    return {
      status: 'skipped',
      reason: `run ${id} conclusion is ${run?.conclusion ?? 'unknown'}, not failure or cancelled`,
    };
  }

  const jobs = (await deps.getJobs(repo, id)) ?? [];
  const failedJob = pickReportableApplyJob(jobs);
  if (!failedJob) {
    return {
      status: 'skipped',
      reason: `run ${id} has no apply job that concluded failure or cancelled`,
    };
  }
  const jobCancelled = failedJob.conclusion === 'cancelled';
  if (jobCancelled && !applyStepStarted(failedJob)) {
    return {
      status: 'skipped',
      reason: `run ${id}'s apply job was cancelled before its "${APPLY_STEP_NAME}" step ran, so nothing was sent`,
    };
  }
  // The cancel landed after the applier had answered (38654273566: every step
  // success, "[apply] APPLIED", job cancelled). The outcome was read.
  if (jobCancelled && applyStepConclusion(failedJob) === 'success') {
    return {
      status: 'skipped',
      reason: `run ${id}'s apply job was cancelled after its "${APPLY_STEP_NAME}" step concluded success, so the outcome was read, not unknown`,
    };
  }
  // A step that concluded failure read the applier's refusal before the
  // cancel: that is reported as the refusal it is. Only a step stopped by the
  // cancel (or the timeout) leaves the outcome unread.
  const cancelled = jobCancelled && applyStepConclusion(failedJob) !== 'failure';
  const migrationFile = extractMigrationFile(run, jobs);
  const failedSteps = (failedJob.steps ?? [])
    .filter((s) => s?.conclusion === 'failure' || s?.conclusion === 'cancelled')
    .map((s) => s.name);

  // An unreadable or empty log is UNREAD, and the comment says so. It is
  // never passed on as an empty log, which would read as "failed, no cause".
  let logText = '';
  let detailUnread = null;
  if (!failedJob.id) {
    detailUnread = 'the failed apply job carried no id, so its log was not requested.';
  } else {
    try {
      logText = await deps.getJobLog(repo, failedJob.id);
      if (typeof logText !== 'string' || !logText.trim()) {
        logText = '';
        detailUnread = 'the job log came back empty.';
      }
    } catch (err) {
      logText = '';
      detailUnread = `the job log could not be read (${describeReadError(err)}).`;
    }
  }
  // A cancel inside the step's queue wait sent nothing (42692313645). An
  // unread log is not that proof, so it is reported as UNKNOWN.
  if (cancelled && !detailUnread && !logShowsApplierReached(logText)) {
    return {
      status: 'skipped',
      reason: `run ${id}'s apply job was cancelled while "${APPLY_STEP_NAME}" waited in the applier queue; its log has no [order] or [apply] line, so nothing was sent`,
    };
  }
  const summary = extractFailureSummary(logText);
  const { durationMs } = summary;
  let { summaryLines } = summary;
  if (cancelled) {
    // Where the applier was when the job stopped, last in the list.
    const last = lastApplierLine(logText);
    if (last) summaryLines = [...summaryLines.filter((l) => l !== last), last].slice(-8);
  }
  const elapsedMs = cancelled ? jobElapsedMs(failedJob) : null;
  const verdict = cancelled ? `${cancelledCause(failedJob)} / UNKNOWN` : summary.verdict;
  if (!detailUnread && !cancelled && summaryLines.length === 0) {
    detailUnread = 'the job log was read and held no refusal or error line this script recognizes.';
  }

  let owningPr = null;
  if (migrationFile) {
    try {
      // Bounded to the run's creation: a later merge touching the same file
      // is not the merge this run applied. With nothing at or before it, no
      // PR is named (the #11599 alert still posts) rather than a later one.
      const until = run.created_at ?? null;
      const commits = await deps.getMigrationCommits(repo, migrationFile, until);
      const commit = pickOwningCommit(commits, { until });
      if (commit?.sha) {
        let pulls = [];
        try {
          pulls = await deps.getCommitPulls(repo, commit.sha);
        } catch {
          pulls = [];
        }
        owningPr = resolveOwningPr(commit, pulls);
      }
    } catch {
      owningPr = null;
    }
  }

  const observedAt =
    failedJob.completed_at || run.updated_at || run.created_at || new Date().toISOString();
  const runUrl = run.html_url || `https://github.com/${repo}/actions/runs/${id}`;
  const owningPrUrl =
    owningPr?.url ||
    (owningPr?.number ? `https://github.com/${repo}/pull/${owningPr.number}` : null);

  const prBody = owningPr
    ? formatPrComment({
        runId: id,
        runUrl,
        migrationFile,
        verdict,
        durationMs,
        failedSteps,
        summaryLines,
        observedAt,
        detailUnread,
        outcomeUnread: cancelled,
        elapsedMs,
      })
    : null;
  const logBody = formatLogIssueComment({
    runId: id,
    runUrl,
    migrationFile,
    verdict,
    durationMs,
    owningPrNumber: owningPr?.number ?? null,
    owningPrUrl,
    summaryLines,
    observedAt,
    detailUnread,
    outcomeUnread: cancelled,
    elapsedMs,
  });

  const actions = { pr: 'none', logIssue: 'none' };

  if (owningPr && prBody) {
    const existingPrComments = await deps.listIssueComments(repo, owningPr.number);
    if (alreadyReported(existingPrComments, id)) {
      actions.pr = 'already_reported';
    } else if (dryRun) {
      actions.pr = 'dry_run';
    } else {
      await deps.postComment(repo, owningPr.number, prBody);
      actions.pr = 'posted';
    }
  }

  const existingLogComments = await deps.listIssueComments(repo, logIssue);
  if (alreadyReported(existingLogComments, id)) {
    actions.logIssue = 'already_reported';
  } else if (dryRun) {
    actions.logIssue = 'dry_run';
  } else {
    await deps.postComment(repo, logIssue, logBody);
    actions.logIssue = 'posted';
  }

  return {
    status: dryRun ? 'dry_run' : 'reported',
    runId: id,
    migrationFile,
    verdict,
    durationMs,
    elapsedMs,
    outcomeUnread: cancelled,
    failedSteps,
    owningPrNumber: owningPr?.number ?? null,
    summaryLines,
    detailUnread,
    actions,
    prBody,
    logBody,
  };
}

// CLI entrypoint
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.REPO || process.env.GITHUB_REPOSITORY;
  const runId = process.env.APPLY_RUN_ID;
  const dryRun =
    process.argv.includes('--dry-run') ||
    String(process.env.DRY_RUN ?? '').toLowerCase() === 'true';

  if (!repo || !runId) {
    console.error('REPO (or GITHUB_REPOSITORY) and APPLY_RUN_ID are required');
    process.exit(2);
  }

  reportMigrationApplyRefusal({ repo, runId, dryRun })
    .then((result) => {
      const summary = [
        `## Migration Apply Refusal Alert (${result.status})`,
        `- Run ID: \`${runId}\``,
        `- Migration: \`${result.migrationFile ?? 'unknown'}\``,
        `- Verdict: \`${result.verdict ?? result.status}\`${result.durationMs != null ? ` (${result.durationMs}ms)` : ''}`,
        `- Owning PR: ${result.owningPrNumber ? `#${result.owningPrNumber}` : 'none found'}`,
        ...(result.reason ? [`- Skipped because: ${result.reason}`] : []),
        ...(result.detailUnread ? [`- Detail unread: ${result.detailUnread}`] : []),
        `- Actions: PR=\`${result.actions?.pr ?? 'none'}\`, #${LOG_ISSUE}=\`${result.actions?.logIssue ?? 'none'}\``,
      ].join('\n');
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (process.env.GITHUB_STEP_SUMMARY) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n');
      }
    })
    .catch((err) => {
      console.error(err?.stack || String(err));
      process.exit(1);
    });
}
