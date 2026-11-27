#!/usr/bin/env node
// scripts/ops/post-cutover-receipt.mjs
//
// THE CUTOVER POSTS ITS OWN AUDIT RECEIPT (Horse SWITCH lane, 2026-11-26).
//
// WHY. After every 3-hourly engine cutover a chat woke up on a timer, ran scripts/ops/post-cutover-audit.mjs and
// posted the result by hand. A receipt then depended on a chat being alive at the right minute, and a missed
// wake-up was silence that looked like a pass. The audit is read-only and needs nothing a CI runner lacks, so it
// now runs right after the receiver that sealed or refused the release.
//
// WHAT. .github/workflows/post-cutover-receipt.yml runs this when "Auto-Deploy Hetzner Engine (on server/
// changes)" completes. It finds that receiver's comment on the cutover log (issue #11599: the one whose
// "Receiver:" line names the run), audits production with the sealed SHA as --expect-sha when the cycle sealed,
// and answers the comment ONCE. It never dispatches, retries or advances a release and writes nothing but that
// one comment. A run that posted no cycle (a private fleet observation, a
// withdrawal, a Stage tick before its cutoff) gets no receipt. KEEP-SERVING is posted by Stage, not the receiver,
// so Stage completions are followed too; a secret-free gate job decides with --find before the audit starts.
//
// The receipt never starts with "Cycle:" and never carries a "Result:" or "Sealed SHA:" line, so the release
// tools that read the log (scripts/release/cycle-without-outcome.py, the receiver's previous-seal reader) can
// never take it for a cycle result.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRealDeps, REPO_ROOT } from './post-cutover-audit.mjs';
import { runPostCutoverAudit } from './post-cutover-audit-lib.mjs';

export const LOG_ISSUE = '11599';
export const RECEIPT_PREFIX = 'Post-cutover audit';
const CYCLE_RE = /^Cycle: ([^\n]+)\r?\nResult: ([A-Z][A-Z-]*(?: [A-Z][A-Z-]*)*)/;
const SEALED_RE = /^Sealed SHA: `([0-9a-f]{40})`/m;
const SERVING_RE = /^Serving SHA: `([0-9a-f]{40})`/m;
const RUN_LINE_RE =
  /^(?:Receiver|Stage): https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/actions\/runs\/([1-9][0-9]*)/m;

// THE SWEEP (2026-11-26). GitHub can skip or delay a workflow_run event, and then a cycle silently gets no
// receipt. Stage completes about four times an hour, so every gate also looks back over the log: the oldest cycle
// result that is at least ORPHAN_AGE_MS old and still has no receipt is audited and answered late. No timer and
// no release control is involved; the sweep rides the runs that already happen. Cycles posted before the
// workflow existed (RECEIPTS_START) are never swept.
export const RECEIPTS_START = '2026-11-27T02:30:00Z';
export const ORPHAN_AGE_MS = 15 * 60_000;

/** Pure. The run a cycle comment names on its "Receiver:" or "Stage:" line, or null. */
export function cycleRunId(body) {
  return typeof body === 'string' && CYCLE_RE.test(body)
    ? (RUN_LINE_RE.exec(body)?.[1] ?? null)
    : null;
}

/** Pure. The oldest swept-window cycle result that is old enough and has no receipt yet: its run id, or null. */
export function findOrphanCycle(comments, nowMs) {
  const start = Date.parse(RECEIPTS_START);
  const list = [...(comments ?? [])].sort(
    (a, b) => Date.parse(a?.created_at ?? '') - Date.parse(b?.created_at ?? '')
  );
  for (const c of list) {
    const at = Date.parse(c?.created_at ?? '');
    if (!Number.isFinite(at) || at < start || nowMs - at < ORPHAN_AGE_MS) continue;
    const runId = cycleRunId(c?.body);
    if (runId && !receiptAlreadyPosted(comments, runId)) return runId;
  }
  return null;
}

/**
 * Pure. Which run the audit job answers: this run when it posted a cycle with no receipt, otherwise the oldest
 * orphan the sweep finds, otherwise none.
 */
export function chooseReceiptRun(comments, runId, nowMs) {
  const own = findCutoverComment(comments, runId);
  if (own && !receiptAlreadyPosted(comments, runId)) return { runId: String(runId), late: false };
  const orphan = findOrphanCycle(comments, nowMs);
  return orphan ? { runId: orphan, late: true } : null;
}

/**
 * Pure. The cutover-log comment a run posted: a "Cycle:/Result:" comment naming the run. The receiver names
 * itself on its "Receiver:" line (SEALED, REFUSED); Stage names itself on its "Stage:" line (KEEP-SERVING).
 */
export function findCutoverComment(comments, runId) {
  const id = String(runId);
  if (!/^[1-9][0-9]*$/.test(id)) return null;
  const runRe = new RegExp(`/actions/runs/${id}(?![0-9])`);
  for (const c of [...(comments ?? [])].reverse()) {
    const body = typeof c?.body === 'string' ? c.body : '';
    const m = CYCLE_RE.exec(body);
    if (m && runRe.test(body)) {
      const sealed = m[2] === 'SEALED' ? (SEALED_RE.exec(body)?.[1] ?? null) : null;
      // The release that must be live after this cycle: the sealed one, or the one that kept serving.
      const serving = m[2] === 'KEEP-SERVING' ? (SERVING_RE.exec(body)?.[1] ?? null) : null;
      return {
        id: c.id ?? null,
        cycle: m[1].trim(),
        result: m[2],
        sealedSha: sealed,
        expectSha: sealed ?? serving,
      };
    }
  }
  return null;
}

/** Pure. True when a receipt for this run is already on the log. */
export function receiptAlreadyPosted(comments, runId) {
  const tag = `${RECEIPT_PREFIX} for run ${String(runId)} (`;
  return (comments ?? []).some((c) => typeof c?.body === 'string' && c.body.startsWith(tag));
}

/** Pure. An ISO time as Chicago wall time, the time every reader of the log uses ("2026-11-26 19:10 CST"). */
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

/** Pure. The report a receipt carries when the audit itself could not run. */
export function auditErrorReport(err, now) {
  const msg = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').trim();
  return {
    overallStatus: 'ERROR',
    passed: false,
    releaseSha: null,
    auditedAt: now.toISOString(),
    checks: [
      {
        name: 'audit',
        status: 'error',
        failures: [`the audit could not run: ${msg}`],
        warnings: [],
      },
    ],
  };
}

/** Pure. The receipt text. One line per check, its first failure or warning beside it. */
export const RECORDS_REPAIR =
  'Records repair: node scripts/ops/horse-option-switch.mjs records (opens the docs-only records PR).';

export function formatReceipt({ cycle, result, runId, report, late = false }) {
  const lines = [
    `${RECEIPT_PREFIX} for run ${runId} (cycle ${cycle}, ${result}): OVERALL ${report.overallStatus}`,
    `Audited release: \`${report.releaseSha ?? 'unknown'}\` at ${chicagoTime(report.auditedAt)}`,
  ];
  for (const check of report.checks ?? []) {
    const note = (check.failures ?? [])[0] ?? (check.warnings ?? [])[0] ?? '';
    lines.push(
      `- ${check.name}: ${String(check.status).toUpperCase()}${note ? ` (${String(note).slice(0, 300)})` : ''}`
    );
  }
  if (late) {
    lines.push(
      'Late receipt (the sweep): no receipt followed this cycle in time, so this audits production as it is now.'
    );
  }
  const records = (report.checks ?? []).find((c) => c.name === 'switch_records');
  if (records && records.status !== 'pass') lines.push(RECORDS_REPAIR);
  lines.push(
    'Read-only: scripts/ops/post-cutover-audit.mjs, run by .github/workflows/post-cutover-receipt.yml.'
  );
  const text = `${lines.join('\n')}\n`;
  if (CYCLE_RE.test(text) || /^(Result|Sealed SHA|Cycle):/m.test(text)) {
    throw new Error('a receipt must never read as a cutover-log cycle result');
  }
  return text;
}

function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    input,
    timeout: 60_000,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** The last 12 hours of the cutover log, every page (at most 10 pages of 100). */
function readLogComments(repo) {
  const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const all = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = JSON.parse(
      gh([
        'api',
        `repos/${repo}/issues/${LOG_ISSUE}/comments?since=${since}&per_page=100&page=${page}`,
      ])
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs the audit once, and once more 90 s later when the only failure is live health: right after a boot
 * the engine can still report its maintenance countdown for a minute.
 */
export async function auditWithOneSettleRetry(
  options,
  deps,
  wait = sleep,
  run = runPostCutoverAudit
) {
  let report = await run(options, deps);
  const failed = (report.checks ?? []).filter((c) => c.status === 'fail').map((c) => c.name);
  if (failed.length === 1 && failed[0] === 'live_health') {
    await wait(90_000);
    report = await run(options, deps);
  }
  return report;
}

async function main(argv) {
  const dryRun = argv.includes('--dry-run');
  // --find: only answer whether this run posted a cycle that still needs a receipt (no database, no audit).
  // The workflow's secret-free gate job uses it, so the audit job only starts for a real cycle result.
  const findOnly = argv.includes('--find');
  const runIdArg = argv[argv.indexOf('--run-id') + 1];
  const runId = argv.includes('--run-id') ? runIdArg : process.env.RECEIVER_RUN_ID;
  const repo = process.env.GITHUB_REPOSITORY || 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  if (!/^[1-9][0-9]*$/.test(String(runId ?? '')))
    throw new Error('--run-id <receiver or Stage run id> (or RECEIVER_RUN_ID) is required');
  const dbUrlEnv = process.env.AUDIT_DB_URL_ENV || '';
  const dbUrl = dbUrlEnv ? process.env[dbUrlEnv] || '' : '';
  if (dbUrlEnv && !dbUrl) throw new Error(`AUDIT_DB_URL_ENV names ${dbUrlEnv}, which is empty`);

  const comments = readLogComments(repo);
  if (findOnly) {
    const pick = chooseReceiptRun(comments, runId, Date.now());
    const out = pick ? `needed=true\nrun_id=${pick.runId}\nlate=${pick.late}\n` : 'needed=false\n';
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
    process.stdout.write(
      pick
        ? `receipt needed for run ${pick.runId}${pick.late ? ' (late, found by the sweep)' : ''}\n`
        : `no receipt needed (run ${runId}, sweep clear)\n`
    );
    return 0;
  }
  const late = process.env.RECEIPT_LATE === 'true';
  const cut = findCutoverComment(comments, runId);
  const needed = !!cut && !receiptAlreadyPosted(comments, runId);
  if (!cut) {
    process.stdout.write(`No cutover-log comment names run ${runId}: nothing to audit.\n`);
    return 0;
  }
  if (!needed) {
    process.stdout.write(`A receipt for run ${runId} is already on #${LOG_ISSUE}.\n`);
    return 0;
  }
  const deps = createRealDeps({ cwd: REPO_ROOT, dbUrl: dbUrl || null });
  let report;
  try {
    report = await auditWithOneSettleRetry(
      { expectShas: cut.expectSha ? [cut.expectSha] : [] },
      deps
    );
  } catch (err) {
    // A crashed audit still answers the cycle, so the sweep never retries it on every Stage run.
    report = auditErrorReport(err, new Date());
  }
  const body = formatReceipt({ cycle: cut.cycle, result: cut.result, runId, report, late });
  process.stdout.write(body);
  if (!dryRun) {
    gh(
      ['api', '--method', 'POST', `repos/${repo}/issues/${LOG_ISSUE}/comments`, '-F', 'body=@-'],
      body
    );
    process.stdout.write(`Posted the receipt to #${LOG_ISSUE}.\n`);
  }
  return report.passed ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    }
  );
}
