/**
 * A MERGED MIGRATION IS DISPATCHED BY ITS MERGER (2026-10-25).
 *
 * apply-merged-migration.yml is dispatch-only by design: "THE READER is the
 * person who dispatches it". The autopilot merges pull requests itself (it arms
 * protected squash auto-merge, and GitHub completes the merge as the autopilot
 * App), so for an automatically merged PR there was no person, and nothing
 * dispatched the applier. PR #7971 merged at 01:48 UTC on 2026-10-25 with
 * 20261024231549_lightning_voided_hand_returns_its_blind_stamps.sql and the
 * file sat uninstalled until an agent dispatched it by hand at 02:30 UTC.
 *
 * .github/workflows/dispatch-merged-migrations.yml reacts to every merge into
 * the default branch (the native pull_request_target `closed` event of a
 * same-repository PR, whoever merged it - 2026-11-07) and sends one
 * repository dispatch per migration file the PR added. This module is the
 * pure half: which files, which are skipped and why, and the earliest instant
 * at which the applier will admit them, so the merger waits once, bounded,
 * instead of dispatching into a refusal that leaves the file uninstalled.
 *
 * MODIFIED FILES TOO (2026-11-08). A migration that merged, was REFUSED at
 * install (nothing applied, no schema_migrations row) and was then fixed in
 * place by a later PR is "modified", not "added", in that later PR: #10026 and
 * #10029 fixed 20261108011659 that way and the dispatcher said "no ordinary
 * migration to dispatch". A file the PR modified is now dispatched as well.
 * This job holds no database credential (only the job token), so it cannot
 * read schema_migrations; the applier does, and answers ALREADY-APPLIED
 * (exit 0, "Nothing sent. This run changed nothing.") for a version that is
 * already installed, so dispatching a modified file that is already installed
 * is harmless. A removed file is never dispatched, and a rename's old name
 * (previous_filename) is never read.
 *
 * It sends nothing and reads no network. The shell half is
 * .github/scripts/dispatch-merged-migrations.sh.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { windowDeclaration } from './maintenance-window-migrations.mjs';
import { splitConcurrentPreamble } from './migration-concurrent-preamble.mjs';

/** The applier's own filename shape (apply-recorded-migration.mjs). */
export const MIGRATION_PATH = /^supabase\/migrations\/(\d{14}_[a-z0-9_]+\.sql)$/;

/**
 * The applier refuses at minute-of-hour >= 50 or <= 3 UTC
 * (apply-recorded-migration.mjs: `minute >= 50 || minute <= 3`), so the first
 * minute it admits is :04.
 */
export const FIRST_ADMITTED_MINUTE = 4;
export const WINDOW_OPENS_MINUTE = 50;
/** apply-recorded-migration.mjs PREAMBLE_MINUTES_NEEDED. */
export const PREAMBLE_MINUTES_NEEDED = 12;
/**
 * Headroom between the dispatch and the applier reading the clock: runner
 * start-up (~30 s measured) plus the applier's own one-at-a-time queue, about
 * a minute per earlier file (02:23-02:25 UTC 2026-10-25: 30-60 s per run).
 */
export const BASE_SLACK_MINUTES = 2;
export const PER_FILE_SLACK_MINUTES = 1;
/**
 * The daily engine maintenance (CLAUDE.md 13): 03:58 announcement, 04:00-04:05
 * break, then its thaw. 04:00 Chicago is always a whole UTC hour, so the fixed
 * :50-:03 minutes already cover 03:50-04:03; the database's dynamic refusal
 * (fn_ca_break_window_refuses_migrations) holds DDL on through the break and
 * its durable release, so the merger also stays clear until 04:10 Chicago.
 */
export const DAILY_GUARD_CHICAGO = { from: [3, 50], until: [4, 10] };
/**
 * THE NIGHTLY COPY MUST STILL EQUAL PRODUCTION AT 03:30 (owner instruction,
 * 11:04 Chicago 2026-11-17: the 04:00 cutover "IS SUPPOSED TO RUN
 * AUTOMATICALLY AT 4AM CST EVERY DAY"). The 03:30 selector admits only a
 * Backup certificate whose restored copy holds every migration production has
 * installed (select-daily-engine.py: "Backup copy lacks installed
 * migration"). On 2026-11-16 and 2026-11-17 ordinary installs after the last
 * copy stranded every candidate, and the routine run kept serving. The
 * nightly Backup refresh runs at 00:07 Chicago (backup-engine.yml schedule,
 * three chances to 00:41), so an ordinary merged migration is held from 23:45
 * until the seal has had its chance (04:15): it waits once, inside this same
 * dispatcher run, and installs at 04:15. Nothing is retried or watched; the
 * merge's own run is the one bounded wait. Window files keep their 04:00
 * route; a hand dispatch of Apply Merged Migration stays the outage route
 * (it stales that night's certificate, and the selector then keeps serving).
 * The range wraps midnight.
 */
export const RELEASE_SCHEMA_FREEZE_CHICAGO = { from: [23, 45], until: [4, 15] };
/**
 * AUTOMATIC PER-CYCLE PRE-CUTOFF DEFERRAL FOR THREE-HOURLY ENGINE CUTOVERS
 * (2026-11-21, Optimization O3).
 *
 * When the serving engine runs the three-hourly cadence (01, 04, 07, 10, 13,
 * 16, 19, 22 America/Chicago; server/src/maintenance/maintenanceSchedulePolicy.json),
 * an ordinary migration installed between the Backup DB refresh and the :30
 * preparation cutoff breaks `Backup copy migrations == production installed
 * migrations`. Deferring merges inside [cycleStart - 150m, cycleStart + 10m)
 * until cycleStart + 10m (strictly :10 UTC, outside the :50-:03 DDL refusal
 * window) inside this same single bounded dispatcher run eliminates manual
 * cross-chat migration holds without adding any cron, watcher or retry loop.
 *
 * 150 minutes since 2026-11-25 (O21 part 2; part 1, the install watch's SQL
 * helper smarter_private.ca_three_hourly_deferral_clears_at, installed
 * 20261124162837 first so no healthy file is paged before it may be sent).
 * At 90 minutes a migration merged 94 to 133 minutes before a cycle installed
 * after the candidate's Backup copy and cost the cycle (2026-11-22 23:22Z,
 * 2026-11-23 01:47Z and 02:17Z, 2026-11-24 05:26Z). Now an ordinary file
 * installs only in [cycleStart + 10m, cycleStart + 30m) (and 04:15-04:30):
 * cycleStart + 30m is the next cycle's - 150m, so the windows never meet and
 * a certified copy cannot go stale between cycles. Seven open windows a day,
 * 135 minutes; worst daytime wait 160 minutes, worst nightly 345 (a merge at
 * 22:30 Chicago is released at 04:15). Outage installs keep their override.
 * The 04:00 anchor remains covered by the wider RELEASE_SCHEMA_FREEZE_CHICAGO
 * (23:45-04:15 America/Chicago).
 */
export const THREE_HOURLY_START_HOURS = [1, 4, 7, 10, 13, 16, 19, 22];
export const THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES = 150;
export const THREE_HOURLY_POST_SEAL_CLEAR_MINUTE = 10;
/**
 * The one bounded wait the merger may spend outside the nightly release
 * schema freeze and three-hourly cycle deferral. It covers every ordinary file
 * at any minute of the day: the worst hourly case is a merge at :49 waiting to
 * :04 (15 min). Only a CONCURRENTLY-preamble file merged late in the hour can
 * exceed it, and that is refused out loud. A hold by
 * RELEASE_SCHEMA_FREEZE_CHICAGO (worst: 270 min on daily, 345 min when the 01:00
 * three-hourly deferral opening at 22:30 meets 23:45) has its own bound,
 * RELEASE_FREEZE_WAIT_BUDGET_MINUTES (job timeout 360 minutes); a daytime
 * non-04:00 three-hourly deferral (worst: 160 min) has
 * THREE_HOURLY_DEFER_WAIT_BUDGET_MINUTES.
 */
export const WAIT_BUDGET_MINUTES = 22;
/** The longer bounded wait allowed for a daytime non-04:00 three-hourly cutover deferral. */
export const THREE_HOURLY_DEFER_WAIT_BUDGET_MINUTES = 175;
/** The longer bounded wait allowed only for a hold by the nightly release schema freeze. */
export const RELEASE_FREEZE_WAIT_BUDGET_MINUTES = 345;
/** How far ahead the planner looks for an admitted instant. */
export const SEARCH_HORIZON_MINUTES = 360;

const chicago = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const chicagoHourOnly = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: '2-digit',
  hourCycle: 'h23',
});
function chicagoMinuteOfDay(ms) {
  const parts = Object.fromEntries(chicago.formatToParts(ms).map((p) => [p.type, p.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}
function chicagoHour(ms) {
  return Number(chicagoHourOnly.format(ms));
}
const inDailyGuard = (ms) => {
  const m = chicagoMinuteOfDay(ms);
  const [fh, fm] = DAILY_GUARD_CHICAGO.from;
  const [uh, um] = DAILY_GUARD_CHICAGO.until;
  return m >= fh * 60 + fm && m < uh * 60 + um;
};
/** True inside the nightly release schema freeze (wraps midnight). */
export function inReleaseSchemaFreeze(ms) {
  const m = chicagoMinuteOfDay(ms);
  const from = RELEASE_SCHEMA_FREEZE_CHICAGO.from[0] * 60 + RELEASE_SCHEMA_FREEZE_CHICAGO.from[1];
  const until = RELEASE_SCHEMA_FREEZE_CHICAGO.until[0] * 60 + RELEASE_SCHEMA_FREEZE_CHICAGO.until[1];
  return from > until ? m >= from || m < until : m >= from && m < until;
}

/** True when `schedule` explicitly selects the three-hourly cutover cadence. */
export function isThreeHourlySchedule(schedule) {
  if (!schedule) return false;
  if (schedule === 'three-hourly') return true;
  if (typeof schedule === 'object') {
    return schedule.frequency === 'three-hourly' || schedule.threeHourly === true;
  }
  return false;
}

/**
 * True when whole-UTC-hour `hourMs` is a scheduled three-hourly cycle start
 * (DST-aware: only the first 01:00 on fall-back day; never an invented hour).
 */
function isThreeHourlyCycleStart(hourMs) {
  const hour = chicagoHour(hourMs);
  if (!THREE_HOURLY_START_HOURS.includes(hour)) return false;
  return chicagoHour(hourMs - 3_600_000) !== hour;
}

/**
 * If `ms` falls inside [cycleStart - 150m, cycleStart + 10m) for any non-04:00
 * three-hourly cycle, return details of that cycle deferral window; else null.
 * The 04:00 anchor is already covered by RELEASE_SCHEMA_FREEZE_CHICAGO.
 */
export function threeHourlyDeferralWindow(ms) {
  const baseHour = Math.floor(ms / 3_600_000) * 3_600_000;
  const deferMs = THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES * 60_000;
  const clearMs = THREE_HOURLY_POST_SEAL_CLEAR_MINUTE * 60_000;
  // Look as many whole hours ahead as the deferral reaches: the hour holding
  // cycleStart - 150m starts at cycleStart - 3h. A fixed `offset <= 2` (right
  // for 90 minutes) silently shortened a 150-minute deferral to 120.
  const lookAheadHours = Math.ceil(THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES / 60);
  for (let offset = 0; offset <= lookAheadHours; offset++) {
    const cycleStartMs = baseHour + offset * 3_600_000;
    if (!isThreeHourlyCycleStart(cycleStartMs)) continue;
    const cycleHour = chicagoHour(cycleStartMs);
    if (cycleHour === 4) continue;
    if (ms >= cycleStartMs - deferMs && ms < cycleStartMs + clearMs) {
      const clearAtMs = cycleStartMs + clearMs;
      const cycleLabel = `${String(cycleHour).padStart(2, '0')}:00`;
      const clearLabel = `${String(cycleHour).padStart(2, '0')}:${String(THREE_HOURLY_POST_SEAL_CLEAR_MINUTE).padStart(2, '0')}`;
      return {
        cycleHour,
        cycleLabel,
        clearLabel,
        cycleStartMs,
        clearAtMs,
        cycleStartAt: new Date(cycleStartMs).toISOString(),
        clearAt: new Date(clearAtMs).toISOString(),
      };
    }
  }
  return null;
}

/** True when `ms` is inside a non-04:00 three-hourly pre-cutoff deferral window. */
export function inThreeHourlyCutoverDeferral(ms, schedule = 'three-hourly') {
  return isThreeHourlySchedule(schedule) && threeHourlyDeferralWindow(ms) !== null;
}

/** Minutes needed before :50 UTC for `count` files, preamble or not. */
export function minutesNeeded(count, preamble) {
  return (
    (preamble ? PREAMBLE_MINUTES_NEEDED : 0) + BASE_SLACK_MINUTES + PER_FILE_SLACK_MINUTES * count
  );
}

/** True when the applier will admit every file dispatched at `ms`. */
export function admissibleAt(ms, count, preamble, schedule = null) {
  const d = new Date(ms);
  const minute = d.getUTCMinutes() + d.getUTCSeconds() / 60;
  if (minute < FIRST_ADMITTED_MINUTE) return false;
  if (WINDOW_OPENS_MINUTE - minute < minutesNeeded(count, preamble)) return false;
  if (inDailyGuard(ms) || inReleaseSchemaFreeze(ms)) return false;
  if (isThreeHourlySchedule(schedule) && threeHourlyDeferralWindow(ms) !== null) return false;
  return true;
}

/**
 * The earliest instant at or after `now` (15 s resolution, six hours ahead)
 * at which a dispatch of `count` files is admitted, or null if none is.
 */
export function earliestDispatch(now, count, preamble, schedule = null) {
  if (count === 0) return now;
  for (let t = now; t <= now + SEARCH_HORIZON_MINUTES * 60_000; t += 15_000) {
    if (admissibleAt(t, count, preamble, schedule)) return t;
  }
  return null;
}

/** PR file statuses whose filename now holds the file's bytes on main. */
export const ADDED_STATUSES = ['added', 'renamed', 'copied'];
export const MODIFIED_STATUSES = ['modified'];

/**
 * Split a merged PR's file list ({filename, status} per GitHub's pulls/files)
 * into the paths it added and the paths it modified. "removed" (and anything
 * else) is neither; a rename contributes only its NEW filename, never its
 * previous_filename.
 *
 * @param {{filename: string, status: string}[]} files
 */
export function changedPaths(files) {
  const added = [];
  const modified = [];
  for (const f of files) {
    if (ADDED_STATUSES.includes(f.status)) added.push(f.filename);
    else if (MODIFIED_STATUSES.includes(f.status)) modified.push(f.filename);
  }
  return { added, modified };
}

/**
 * Parse the shell half's PR file list: one "<status>\t<filename>" per line.
 * A line with no tab is a bare path from the original format, read as added.
 */
export function parseFileList(text) {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return tab < 0
        ? { status: 'added', filename: line }
        : { status: line.slice(0, tab).trim(), filename: line.slice(tab + 1).trim() };
    });
}

/**
 * Classify the migration files a merged PR added or modified.
 *
 * @param {string[]} added   PR file paths whose status is added/renamed/copied
 * @param {(name: string) => string | null} readSql  file text on main, null if absent
 * @param {number} now       epoch ms
 * @param {string[]} [modified]  PR file paths whose status is "modified"
 * @param {string | { frequency?: string, threeHourly?: boolean } | null} [schedule]  serving engine schedule
 */
export function planDispatch(added, readSql, now, modified = [], schedule = null) {
  const nameOf = (p) => MIGRATION_PATH.exec(p)?.[1];
  const addedNames = new Set(added.map(nameOf).filter(Boolean));
  const modifiedNames = new Set(
    modified
      .map(nameOf)
      .filter(Boolean)
      .filter((n) => !addedNames.has(n))
  );
  const names = [...new Set([...addedNames, ...modifiedNames])].sort();
  const dispatch = [];
  const windowQueued = [];
  const notOnMain = [];
  const malformed = [];
  let preamble = false;
  for (const name of names) {
    const sql = readSql(name);
    if (sql === null) {
      notOnMain.push(name);
      continue;
    }
    let declared;
    try {
      declared = windowDeclaration(sql);
    } catch (e) {
      malformed.push({ name, reason: e.message });
      continue;
    }
    if (declared === 'daily-maintenance') {
      windowQueued.push(name);
      continue;
    }
    const shape = splitConcurrentPreamble(sql);
    if (shape.ok && shape.indexes.length > 0) preamble = true;
    dispatch.push(name);
  }
  const at = earliestDispatch(now, dispatch.length, preamble, schedule);
  const waitSeconds = at === null ? null : Math.ceil((at - now) / 1000);
  const heldForDailyRelease =
    dispatch.length > 0 &&
    at !== null &&
    (inReleaseSchemaFreeze(now) || (at > now && inReleaseSchemaFreeze(at - 60_000)));
  const threeHourlyWindow =
    dispatch.length > 0 && at !== null && isThreeHourlySchedule(schedule)
      ? threeHourlyDeferralWindow(now) || (at > now ? threeHourlyDeferralWindow(at - 60_000) : null)
      : null;
  const heldForThreeHourlyCutover = !heldForDailyRelease && threeHourlyWindow !== null;
  const budget =
    (heldForDailyRelease
      ? RELEASE_FREEZE_WAIT_BUDGET_MINUTES
      : heldForThreeHourlyCutover
        ? THREE_HOURLY_DEFER_WAIT_BUDGET_MINUTES
        : WAIT_BUDGET_MINUTES) * 60;
  return {
    dispatch,
    // The dispatched files this PR modified rather than added: the applier
    // answers ALREADY-APPLIED for any whose version is installed.
    modified: dispatch.filter((n) => modifiedNames.has(n)),
    windowQueued,
    notOnMain,
    malformed,
    preamble,
    dispatchAt: at === null ? null : new Date(at).toISOString(),
    waitSeconds,
    // The wait (if any) is the nightly release schema freeze, not the
    // ordinary :50-:03 break: the shell says so on the PR.
    heldForDailyRelease,
    // The wait (if any) is a daytime three-hourly pre-cutoff deferral.
    heldForThreeHourlyCutover,
    threeHourlyCycle: heldForThreeHourlyCutover ? threeHourlyWindow.cycleLabel : null,
    threeHourlyClearChicago: heldForThreeHourlyCutover ? threeHourlyWindow.clearLabel : null,
    withinBudget: waitSeconds !== null && waitSeconds <= budget,
  };
}

// CLI: node scripts/ci/merged-migration-dispatch.mjs plan <pr-files-file> [now-ms] [--schedule <freq>]
//        <pr-files-file>: one "<status>\t<filename>" per line (a bare path = added)
//      node scripts/ci/merged-migration-dispatch.mjs admitted <count> <preamble 0|1> [now-ms] [--schedule <freq>]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rawArgs = process.argv.slice(2);
  let schedule = null;
  const pos = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === '--schedule') {
      schedule = rawArgs[++i] ?? null;
    } else if (rawArgs[i].startsWith('--schedule=')) {
      schedule = rawArgs[i].slice('--schedule='.length);
    } else {
      pos.push(rawArgs[i]);
    }
  }
  const [cmd, a, b, c] = pos;
  const dir = join(process.cwd(), 'supabase', 'migrations');
  if (cmd === 'plan') {
    const { added, modified } = changedPaths(parseFileList(readFileSync(a, 'utf8')));
    const now = b ? Number(b) : Date.now();
    const readSql = (name) => {
      const p = join(dir, name);
      return existsSync(p) ? readFileSync(p, 'utf8') : null;
    };
    process.stdout.write(
      JSON.stringify(planDispatch(added, readSql, now, modified, schedule)) + '\n'
    );
  } else if (cmd === 'admitted') {
    const now = c ? Number(c) : Date.now();
    process.exit(admissibleAt(now, Number(a), b === '1', schedule) ? 0 : 1);
  } else {
    console.error(
      'usage: merged-migration-dispatch.mjs plan <file> [now] [--schedule <freq>] | admitted <count> <0|1> [now] [--schedule <freq>]'
    );
    process.exit(2);
  }
}
