#!/usr/bin/env node
/**
 * EVERY CYCLE GETS AN OWNER (2026-11-26, release custody).
 *
 * A cutover cycle is prepared only when a Stage run created inside its
 * election window claims it. GitHub delivers few of Stage's scheduled runs
 * here (8 of 96 a day on 2026-11-25) and creates no workflow_run for a Backup
 * the job token started, so a window with no merge to main has no owner. That
 * cost the 10:00 Chicago cycles of 2026-11-25 and 2026-11-26; since O32 such a
 * cycle is announced, but it is still lost.
 *
 * The runbook already names the remedy (docs/ENGINE-RELEASE-RUNBOOK.md 4.1,
 * "Operator fallback"): when no Stage run owns the cycle shortly after its
 * preparation opens, an authenticated user sends the `prepare-daily-engine`
 * dispatch once. Stage admits that run to the same election as every other;
 * it supplies no SHA, date or receiver input, cannot reserve early and cannot
 * displace an earlier owner. Nobody was awake to do it.
 *
 * This script is that operator step on a real clock: an OpenClaw cron on the
 * Mac Studio (ops/openclaw/ca-cutover-operator-preparation.json; CLAUDE.md
 * 10.85: a real cron, never the Claude scheduler) runs it three and eleven
 * minutes after each preparation opens. It is the scheduled preparation the
 * owner ordered (CLAUDE.md section 13), made punctual; it starts nothing else.
 *
 * What it does, in order:
 *   1. Outside [cutoff, cutoff + 20 min) of a scheduled cycle: nothing.
 *   2. Reads the Stage runs of the election window. If one that can own the
 *      cycle exists (eligible event and title, on main, still running or
 *      finished after the cutoff): nothing. FOLLOW <run id>.
 *   3. Otherwise sends the dispatch once. SENT.
 *   4. If the run list cannot be read it still sends: a second eligible run is
 *      refused by the election by name, a cycle with no owner is lost. The
 *      output says UNKNOWN, never "no owner" (CLAUDE.md 10.86).
 *
 * It is self-contained (node and gh only) so the installed copy on the Mac
 * needs no checkout. Exit 0: nothing owed, followed or sent. Exit 2: the
 * dispatch itself failed.
 */
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const REPO = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
export const EVENT_TYPE = 'prepare-daily-engine';
export const CYCLE_HOURS = Object.freeze([1, 4, 7, 10, 13, 16, 19, 22]);
export const PREPARATION_LEAD_MINUTES = 30;
export const PREPARATION_WINDOW_MINUTES = 20;
export const RESERVATION_LOOKBACK_MINUTES = 100;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const chicagoHour = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: 'numeric',
  hourCycle: 'h23',
});
const hourIn = (ms) => Number(chicagoHour.format(new Date(ms)));
const chicagoClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/**
 * The cycle whose preparation window holds nowMs: { start, cutoff, end,
 * reservation } in epoch ms, or null. Real epoch hours; a repeated fall-back
 * hour is one cycle, the first (as Stage and the selector count it).
 */
export function preparationWindow(nowMs) {
  if (!Number.isFinite(nowMs)) throw new Error('nowMs must be a finite epoch millisecond');
  const hour0 = Math.floor(nowMs / HOUR) * HOUR;
  for (let offset = 0; offset <= 1; offset += 1) {
    const start = hour0 + offset * HOUR;
    const local = hourIn(start);
    if (!CYCLE_HOURS.includes(local) || hourIn(start - HOUR) === local) continue;
    const cutoff = start - PREPARATION_LEAD_MINUTES * MINUTE;
    const end = cutoff + PREPARATION_WINDOW_MINUTES * MINUTE;
    if (nowMs >= cutoff && nowMs < end) {
      return { start, cutoff, end, reservation: cutoff - RESERVATION_LOOKBACK_MINUTES * MINUTE };
    }
  }
  return null;
}

/**
 * True when a Stage run can own the cycle of `window`: the election's own
 * eligibility (stage-engine-release.yml admission), and either still running
 * or finished after the cutoff. A run that finished before the cutoff claimed
 * nothing (O25): an owner holds its job open until the cutoff.
 */
export function canOwn(run, window) {
  if (!run || run.head_branch !== 'main') return false;
  const created = Date.parse(run.created_at);
  if (!Number.isFinite(created) || created < window.reservation || created >= window.end)
    return false;
  const inOriginalWindow = created >= window.cutoff;
  const title = run.display_title;
  const ordinary =
    (run.event === 'push' || run.event === 'schedule') &&
    (title === 'Daily engine reservation' || inOriginalWindow);
  const backup = run.event === 'workflow_run' && title === 'Automatic Backup daily reservation';
  const operator =
    run.event === 'repository_dispatch' &&
    inOriginalWindow &&
    run.actor?.type === 'User' &&
    title === 'Original operator daily preparation';
  if (!ordinary && !backup && !operator) return false;
  if (run.status !== 'completed') return true;
  const finished = Date.parse(run.updated_at);
  return Number.isFinite(finished) && finished >= window.cutoff && run.conclusion === 'success';
}

/**
 * The decision for nowMs given the Stage runs (an array, or null when the
 * list could not be read): { action: 'none'|'follow'|'send', reason, runId? }.
 */
export function decide(nowMs, runs) {
  const window = preparationWindow(nowMs);
  if (!window) return { action: 'none', reason: 'outside every preparation window' };
  const cycle = chicagoClock.format(new Date(window.start));
  if (!Array.isArray(runs)) {
    return {
      action: 'send',
      window,
      reason: `UNKNOWN: the Stage run list could not be read for the ${cycle} cycle; sending, the election refuses a second owner`,
    };
  }
  const owners = runs.filter((run) => canOwn(run, window)).sort((a, b) => a.id - b.id);
  if (owners.length > 0) {
    return {
      action: 'follow',
      window,
      runId: owners[0].id,
      reason: `FOLLOW: Stage run ${owners[0].id} (${owners[0].event}) can own the ${cycle} cycle`,
    };
  }
  return {
    action: 'send',
    window,
    reason: `NO OWNER: no Stage run can own the ${cycle} cycle ${Math.round((nowMs - window.cutoff) / MINUTE)} min after its preparation opened`,
  };
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** The Stage runs created since the reservation opened, or null when unreadable. */
export function readStageRuns(window, run = gh) {
  try {
    const since = new Date(window.reservation).toISOString().replace(/\.\d+Z$/, 'Z');
    const out = run([
      'api',
      `repos/${REPO}/actions/workflows/stage-engine-release.yml/runs?branch=main&per_page=100&created=${encodeURIComponent(`>=${since}`)}`,
    ]);
    const body = JSON.parse(out);
    if (!Array.isArray(body.workflow_runs) || typeof body.total_count !== 'number') return null;
    if (body.total_count > body.workflow_runs.length) return null;
    return body.workflow_runs;
  } catch {
    return null;
  }
}

export function main({ nowMs = Date.now(), run = gh, log = console.log } = {}) {
  const window = preparationWindow(nowMs);
  if (!window) {
    log('[cutover-operator-preparation] outside every preparation window; nothing to do');
    return 0;
  }
  const verdict = decide(nowMs, readStageRuns(window, run));
  log(`[cutover-operator-preparation] ${verdict.reason}`);
  if (verdict.action !== 'send') return 0;
  try {
    run(['api', '--method', 'POST', `repos/${REPO}/dispatches`, '-f', `event_type=${EVENT_TYPE}`]);
    log(`[cutover-operator-preparation] SENT: ${EVENT_TYPE} (Stage elects it like any other run)`);
    return 0;
  } catch (error) {
    log(
      `[cutover-operator-preparation] SEND FAILED: ${String(error?.message ?? error).split('\n')[0]}`
    );
    return 2;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
