#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  A HAND'S MONEY PATH NEVER WRITES A SHARED ROW - ASKED OF THE LIVE CATALOG
 * ═══════════════════════════════════════════════════════════════════════════
 * Incident 075013fd (2026-11-17): the third union-wide row in two months
 * (union_wallets, after club_wallets and clubs.total_rake) that every raked
 * hand waited on. Each was fixed one row at a time; nothing stopped the next.
 *
 * public.fn_ca_hand_path_shared_writes() walks the hand doors' call closure
 * and the triggers their writes fire and names every blocking exclusive
 * write, row lock or advisory lock on a union/club/pool-wide row
 * (scripts/ci/hand-path-shared-writes.mjs says exactly how). This asks it,
 * and compares the answer with scripts/ci/hand-path-shared-writes.allowlist.json,
 * the reasoned list of pre-existing ones that could not be removed yet.
 * Migrations are applied to production before their pull request merges
 * (check-migrations-applied.mjs), so the live catalog is the branch's truth.
 *
 * The applier enforces the same rule per migration, inside its transaction
 * (a migration that ADDS one is refused); this catches what the applier
 * cannot see: a definition changed outside a recorded migration.
 *
 * Usage:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/ci/check-hand-path-shared-writes.mjs
 *         node scripts/ci/check-hand-path-shared-writes.mjs --answer <file.json>   (judge a saved answer)
 * Exit:   0 holds (allowlisted debt is printed) · 1 a violation not on the list
 *         · 2 could not ask, or the answer cannot be judged (NEVER silently green)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { judge, allowlistProblems } from './hand-path-shared-writes.mjs';

const TAG = '[check-hand-path-shared-writes]';
const here = dirname(fileURLToPath(import.meta.url));
const allowlist = JSON.parse(readFileSync(join(here, 'hand-path-shared-writes.allowlist.json'), 'utf8'));

const problems = allowlistProblems(allowlist);
if (problems.length) {
  console.error(`${TAG} the allowlist is not reasoned:\n  ${problems.join('\n  ')}`);
  process.exit(2);
}

async function ask() {
  const i = process.argv.indexOf('--answer');
  if (i > 0) return JSON.parse(readFileSync(process.argv[i + 1], 'utf8'));
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    console.error(`${TAG} set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY`);
    process.exit(2);
  }
  const { supabaseServerHeaders } = await import('./supabase-auth-headers.mjs');
  let res;
  try {
    res = await fetch(`${URL}/rest/v1/rpc/fn_ca_hand_path_shared_writes`, {
      method: 'POST',
      headers: supabaseServerHeaders(KEY, { 'Content-Type': 'application/json' }),
      body: '{}',
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    console.error(`${TAG} could not ask: ${error?.message ?? error}`);
    process.exit(2);
  }
  if (!res.ok) {
    console.error(`${TAG} fn_ca_hand_path_shared_writes answered ${res.status}: ${await res.text()}`);
    process.exit(2);
  }
  return res.json();
}

const answer = await ask();
const verdict = judge(answer, allowlist);
if (!verdict) {
  console.error(`${TAG} malformed answer`, JSON.stringify(answer).slice(0, 500));
  process.exit(2);
}
if (verdict.unknown) {
  console.error(`${TAG} UNKNOWN - ${verdict.unknown}; the path cannot be judged without its doors.`);
  process.exit(2);
}
console.log(
  `${TAG} ${answer.closure} functions on the hand path, ${answer.violations.length} shared-row writes, ` +
    `${verdict.allowed.length} on the reasoned allowlist.`
);
for (const s of verdict.stale)
  console.log(`${TAG} note: allowlisted ${s.function} ${s.kind} ${s.target} is gone - remove its entry.`);
if (!verdict.unexpected.length) {
  console.log(`${TAG} OK - no hand path waits on a shared row beyond the reasoned list.`);
  process.exit(0);
}
console.error(`${TAG} BLOCKED - a hand's money path takes a blocking exclusive lock on a shared row:`);
for (const v of verdict.unexpected)
  console.error(`  ${v.function} ${v.kind} ${v.target}\n      via ${v.path ?? '?'}`);
console.error(
  '\n  One slow holder of that row queues every hand of the club or union behind it\n' +
    '  (incident 075013fd: union_wallets, 8,303 timeouts). Store the obligation in a\n' +
    "  per-hand row and bank it off the hot path with NOWAIT / try-lock (the pattern of\n" +
    '  fn_ca_bank_pending_cash_rake), or, if it truly cannot move yet, add a reasoned\n' +
    '  entry to scripts/ci/hand-path-shared-writes.allowlist.json in the same change.'
);
process.exit(1);
