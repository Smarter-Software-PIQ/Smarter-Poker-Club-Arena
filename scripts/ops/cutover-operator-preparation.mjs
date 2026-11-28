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
 * THE FALLBACK OUTLASTS A SPENT QUOTA (2026-11-27). gh on the Mac uses the
 * user login every agent there shares, so its 5,000-an-hour REST quota can be
 * spent by other lanes. For the 13:00 Chicago cycle of 2026-11-27 both runs
 * (12:33 and 12:41) fell inside an exhausted quota: the read and the send were
 * refused and the log kept only "Command failed". So, before the read, it asks
 * `gh api rate_limit` (free: GitHub's REST docs for GET /rate_limit say
 * "Accessing this endpoint does not count against your REST API rate limit",
 * https://docs.github.com/en/rest/rate-limit/rate-limit). When fewer than two
 * core calls remain and the quota resets before the last useful moment of the
 * cycle (the preparation window's end, less SEND_MARGIN_MS for the dispatched
 * run to be created inside it), it waits ONCE until the reset, then reads once
 * and sends at most once. A reset after that moment sends nothing and exits 4,
 * naming both times. An unreadable rate_limit proceeds as before. A waiting
 * instance holds a per-cycle lock, so the cron's second firing does not wait
 * beside it and send a second dispatch. Every gh failure is logged with gh's
 * own last stderr line (tokens redacted), never just "Command failed".
 *
 * It is self-contained (node and gh only) so the installed copy on the Mac
 * needs no checkout. Exit 0: nothing owed, followed or sent. Exit 2: the
 * dispatch itself failed. Exit 4: rate limited past the deadline, nothing sent.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REPO = 'Smarter-Software-PIQ/Smarter-Poker-Club-Arena';
export const EVENT_TYPE = 'prepare-daily-engine';
export const CYCLE_HOURS = Object.freeze([1, 4, 7, 10, 13, 16, 19, 22]);
export const PREPARATION_LEAD_MINUTES = 30;
export const PREPARATION_WINDOW_MINUTES = 20;
export const RESERVATION_LOOKBACK_MINUTES = 100;
/** Core calls one firing needs: the run-list read and the dispatch. */
export const CALLS_NEEDED = 2;
/** Wake this long after the quota's reset, so the new bucket is in force. */
export const RESET_SETTLE_MS = 5_000;
/** Send at least this long before the window ends, so the dispatched run is created inside it. */
export const SEND_MARGIN_MS = 60_000;
export const EXIT_RATE_LIMITED_PAST_DEADLINE = 4;
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

const chicagoTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});
/** "HH:MM CST" (or CDT) for an epoch millisecond. */
export function chicagoHHMM(ms) {
  const parts = Object.fromEntries(
    chicagoTime.formatToParts(new Date(ms)).map((p) => [p.type, p.value])
  );
  return `${parts.hour}:${parts.minute} ${parts.timeZoneName}`;
}

/** The last moment a dispatch is still useful for this window's cycle. */
export function sendDeadline(window) {
  return window.end - SEND_MARGIN_MS;
}

const SECRET = /gh[pousr]_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+/g;
/**
 * The meaningful reason a gh call failed: the last non-empty line of its
 * stderr (gh's own message), else of error.message; tokens redacted.
 */
export function failureReason(error) {
  const lastLine = (text) =>
    String(text ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop();
  const reason = lastLine(error?.stderr) ?? lastLine(error?.message ?? error) ?? 'unknown failure';
  return reason.replace(SECRET, '[redacted]');
}
const isRateLimit = (reason) => /rate limit/i.test(reason);

/**
 * The core REST quota, { remaining, resetMs }, from `gh api rate_limit` (which
 * does not spend the quota), or null when it cannot be read.
 */
export function readRateLimit(run = gh) {
  try {
    const core = JSON.parse(run(['api', 'rate_limit']))?.resources?.core;
    const remaining = core?.remaining;
    const reset = core?.reset;
    if (!Number.isFinite(remaining) || !Number.isFinite(reset)) return null;
    return { remaining, resetMs: reset * 1000 };
  } catch {
    return null;
  }
}

/**
 * What the quota allows: { action: 'go' } (enough left, or unreadable),
 * { action: 'wait', untilMs } (reset before the deadline), or
 * { action: 'give-up', reason } (reset after the deadline).
 */
export function quotaPlan(nowMs, window, quota) {
  if (!quota || quota.remaining >= CALLS_NEEDED) return { action: 'go' };
  const untilMs = Math.max(nowMs, quota.resetMs + RESET_SETTLE_MS);
  const deadline = sendDeadline(window);
  if (untilMs <= deadline) return { action: 'wait', untilMs };
  return {
    action: 'give-up',
    reason: `RATE LIMITED until ${chicagoHHMM(quota.resetMs)} after the deadline ${chicagoHHMM(deadline)} (${quota.remaining} core calls left); nothing sent`,
  };
}

function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * A per-cycle lock held while one instance waits out the quota, so a second
 * cron firing of the same cycle does not wait beside it and send twice. Returns
 * a release function, or null when a live instance already holds it.
 */
export function takeCycleLock(window, dir = tmpdir()) {
  const path = join(dir, `ca-cutover-operator-preparation-${window.start}.lock`);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(path);
        } catch {
          /* already gone */
        }
      };
    } catch {
      let holder = NaN;
      try {
        holder = Number(readFileSync(path, 'utf8'));
      } catch {
        /* unreadable: treat as stale */
      }
      let alive = false;
      if (Number.isInteger(holder) && holder > 0) {
        try {
          process.kill(holder, 0);
          alive = true;
        } catch (e) {
          alive = e?.code === 'EPERM';
        }
      }
      if (alive) return null;
      try {
        unlinkSync(path);
      } catch {
        /* raced */
      }
    }
  }
  return null;
}

function gh(args) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** The Stage runs created since the reservation opened, or null when unreadable. */
export function readStageRuns(window, run = gh, onError = () => {}) {
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
  } catch (error) {
    onError(failureReason(error));
    return null;
  }
}

export function main({
  nowMs = Date.now(),
  run = gh,
  log = console.log,
  sleep = sleepSync,
  clock = Date.now,
  lockDir = tmpdir(),
} = {}) {
  const prefix = '[cutover-operator-preparation]';
  const window = preparationWindow(nowMs);
  if (!window) {
    log(`${prefix} outside every preparation window; nothing to do`);
    return 0;
  }
  let now = nowMs;
  const plan = quotaPlan(now, window, readRateLimit(run));
  if (plan.action === 'give-up') {
    log(`${prefix} ${plan.reason}`);
    return EXIT_RATE_LIMITED_PAST_DEADLINE;
  }
  let release = () => {};
  if (plan.action === 'wait') {
    const held = takeCycleLock(window, lockDir);
    if (!held) {
      log(
        `${prefix} FOLLOW: another instance is waiting out the quota for this cycle; nothing sent`
      );
      return 0;
    }
    release = held;
    log(
      `${prefix} RATE LIMITED until ${chicagoHHMM(plan.untilMs - RESET_SETTLE_MS)}; waiting once, then one read and at most one send before ${chicagoHHMM(sendDeadline(window))}`
    );
    sleep(plan.untilMs - now);
    now = Math.max(plan.untilMs, clock());
  }
  try {
    const runs = readStageRuns(window, run, (reason) =>
      log(`${prefix} READ FAILED: ${isRateLimit(reason) ? 'RATE LIMITED: ' : ''}${reason}`)
    );
    const verdict = decide(now, runs);
    log(`${prefix} ${verdict.reason}`);
    if (verdict.action !== 'send') return 0;
    try {
      run([
        'api',
        '--method',
        'POST',
        `repos/${REPO}/dispatches`,
        '-f',
        `event_type=${EVENT_TYPE}`,
      ]);
      log(`${prefix} SENT: ${EVENT_TYPE} (Stage elects it like any other run)`);
      return 0;
    } catch (error) {
      const reason = failureReason(error);
      let named = reason;
      if (isRateLimit(reason)) {
        const quota = readRateLimit(run);
        named = `RATE LIMITED until ${quota ? chicagoHHMM(quota.resetMs) : 'an unreadable reset'}: ${reason}`;
      }
      log(`${prefix} SEND FAILED: ${named}`);
      return 2;
    }
  } finally {
    release();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main());
}
