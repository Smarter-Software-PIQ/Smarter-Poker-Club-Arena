#!/usr/bin/env node
/**
 * AN OLDER MERGED MIGRATION INSTALLS FIRST (incident 90972d77, 2026-11-21).
 *
 * Each merged pull request has its own dispatcher run and each file its own
 * Apply Merged Migration run (concurrency is per file). Merges held behind the
 * same boundary wake together: at 04:15 UTC on 2026-11-21 four applier runs
 * started within two seconds and 20261121024624 installed before
 * 20261121005533, whose chain guard then refused it, and the install watch
 * paged MergedMigrationNotInstalled.
 *
 * Before a dispatcher sends its files it now watches the applier's own runs
 * for a minimum observation period (so a sibling dispatcher woken in the same
 * second has time to send) and keeps waiting while any applier run for an
 * OLDER version is queued or in progress. Bounded: when the budget ends it
 * sends exactly as before, so a stuck older run never holds a later fix
 * hostage. A list it cannot read is named COULD NOT TELL and the send goes on.
 *
 * usage: node scripts/ci/await-older-merged-applies.mjs <first file of this merge>
 */
import process from 'node:process';
import { pathToFileURL } from 'node:url';

export const OBSERVE_MS = 25_000;
export const BUDGET_MS = 300_000;
export const POLL_MS = 5_000;
const TITLE = /^Apply Merged Migration (\d{14})_/;

/** Versions of applier runs still queued or running that are older than `version`. */
export function olderInFlight(runs, version) {
  return (Array.isArray(runs) ? runs : [])
    .filter(
      (r) => r && ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(r.status)
    )
    .map((r) => TITLE.exec(String(r.display_title ?? r.name ?? ''))?.[1])
    .filter((v) => v && v < version)
    .sort();
}

export async function awaitOlderMergedApplies(version, deps) {
  const { listRuns, sleep, now, log } = deps;
  const budget = deps.budgetMs ?? BUDGET_MS;
  const observe = deps.observeMs ?? OBSERVE_MS;
  const poll = deps.pollMs ?? POLL_MS;
  const started = now();
  let older = [];
  for (;;) {
    let runs;
    try {
      runs = await listRuns();
    } catch (e) {
      log(`- order gate COULD NOT TELL (${e.message}); sending without it.`);
      return { older: null, waitedMs: now() - started };
    }
    older = olderInFlight(runs, version);
    const elapsed = now() - started;
    if (older.length === 0 && elapsed >= observe) return { older, waitedMs: elapsed };
    if (elapsed >= budget) {
      log(
        `- order gate: older install(s) ${older.join(', ')} still running after ${Math.round(elapsed / 1000)} s; sending anyway.`
      );
      return { older, waitedMs: elapsed };
    }
    if (older.length > 0)
      log(`- order gate: waiting for older install(s) ${older.join(', ')} to finish first.`);
    await sleep(Math.min(poll, budget - elapsed));
  }
}

async function main() {
  const first = process.argv[2] || '';
  const version = /^(?:supabase\/migrations\/)?(\d{14})_/.exec(first)?.[1];
  if (!version) {
    console.log('- order gate: no migration version given; nothing to order.');
    return;
  }
  const repo = process.env.REPO;
  const token = process.env.GH_TOKEN;
  const listRuns = async () => {
    const out = [];
    for (const status of ['queued', 'in_progress']) {
      const res = await fetch(
        `https://api.github.com/repos/${repo}/actions/workflows/apply-merged-migration.yml/runs?status=${status}&per_page=100`,
        { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } }
      );
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      const body = await res.json();
      if (!Array.isArray(body.workflow_runs)) throw new Error('no workflow_runs in the answer');
      out.push(...body.workflow_runs);
    }
    return out;
  };
  const r = await awaitOlderMergedApplies(version, {
    listRuns,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (m) => console.log(m),
  });
  if (r.older && r.older.length === 0)
    console.log(
      `- order gate: no older install in flight after ${Math.round(r.waitedMs / 1000)} s.`
    );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.log(`- order gate COULD NOT TELL (${e?.message || e}); sending without it.`);
  });
}
