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
// one comment. A receiver run that posted no cycle (a private fleet observation, a withdrawal) gets no receipt.
//
// The receipt never starts with "Cycle:" and never carries a "Result:" or "Sealed SHA:" line, so the release
// tools that read the log (scripts/release/cycle-without-outcome.py, the receiver's previous-seal reader) can
// never take it for a cycle result.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createRealDeps, REPO_ROOT } from './post-cutover-audit.mjs';
import { runPostCutoverAudit } from './post-cutover-audit-lib.mjs';

export const LOG_ISSUE = '11599';
export const RECEIPT_PREFIX = 'Post-cutover audit';
const CYCLE_RE = /^Cycle: ([^\n]+)\r?\nResult: ([A-Z][A-Z-]*(?: [A-Z][A-Z-]*)*)/;
const SEALED_RE = /^Sealed SHA: `([0-9a-f]{40})`/m;

/** Pure. The cutover-log comment the receiver run posted: a "Cycle:/Result:" comment naming the run. */
export function findCutoverComment(comments, runId) {
  const id = String(runId);
  if (!/^[1-9][0-9]*$/.test(id)) return null;
  const runRe = new RegExp(`/actions/runs/${id}(?![0-9])`);
  for (const c of [...(comments ?? [])].reverse()) {
    const body = typeof c?.body === 'string' ? c.body : '';
    const m = CYCLE_RE.exec(body);
    if (m && runRe.test(body)) {
      const sealed = m[2] === 'SEALED' ? (SEALED_RE.exec(body)?.[1] ?? null) : null;
      return { id: c.id ?? null, cycle: m[1].trim(), result: m[2], sealedSha: sealed };
    }
  }
  return null;
}

/** Pure. True when a receipt for this receiver run is already on the log. */
export function receiptAlreadyPosted(comments, runId) {
  const tag = `receiver run ${String(runId)}`;
  return (comments ?? []).some(
    (c) => typeof c?.body === 'string' && c.body.startsWith(RECEIPT_PREFIX) && c.body.includes(tag)
  );
}

/** Pure. The receipt text. One line per check, its first failure or warning beside it. */
export function formatReceipt({ cycle, result, runId, report }) {
  const lines = [
    `${RECEIPT_PREFIX} for receiver run ${runId} (cycle ${cycle}, ${result}): OVERALL ${report.overallStatus}`,
    `Audited release: \`${report.releaseSha ?? 'unknown'}\` at ${report.auditedAt}`,
  ];
  for (const check of report.checks ?? []) {
    const note = (check.failures ?? [])[0] ?? (check.warnings ?? [])[0] ?? '';
    lines.push(
      `- ${check.name}: ${String(check.status).toUpperCase()}${note ? ` (${String(note).slice(0, 300)})` : ''}`
    );
  }
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
  const runIdArg = argv[argv.indexOf('--run-id') + 1];
  const runId = argv.includes('--run-id') ? runIdArg : process.env.RECEIVER_RUN_ID;
  const repo = process.env.GITHUB_REPOSITORY || 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
  if (!/^[1-9][0-9]*$/.test(String(runId ?? '')))
    throw new Error('--run-id <receiver run id> (or RECEIVER_RUN_ID) is required');
  const dbUrlEnv = process.env.AUDIT_DB_URL_ENV || '';
  const dbUrl = dbUrlEnv ? process.env[dbUrlEnv] || '' : '';
  if (dbUrlEnv && !dbUrl) throw new Error(`AUDIT_DB_URL_ENV names ${dbUrlEnv}, which is empty`);

  const since = new Date(Date.now() - 12 * 3_600_000).toISOString();
  const comments = JSON.parse(
    gh(['api', `repos/${repo}/issues/${LOG_ISSUE}/comments?since=${since}&per_page=100`])
  );
  const cut = findCutoverComment(comments, runId);
  if (!cut) {
    process.stdout.write(`No cutover-log comment names receiver run ${runId}: nothing to audit.\n`);
    return 0;
  }
  if (receiptAlreadyPosted(comments, runId)) {
    process.stdout.write(`A receipt for receiver run ${runId} is already on #${LOG_ISSUE}.\n`);
    return 0;
  }
  const deps = createRealDeps({ cwd: REPO_ROOT, dbUrl: dbUrl || null });
  const report = await auditWithOneSettleRetry(
    { expectShas: cut.sealedSha ? [cut.sealedSha] : [] },
    deps
  );
  const body = formatReceipt({ cycle: cut.cycle, result: cut.result, runId, report });
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
