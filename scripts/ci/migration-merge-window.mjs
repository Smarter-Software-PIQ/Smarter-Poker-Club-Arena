/**
 * AN ORDINARY MIGRATION MERGES ONLY IN ITS INSTALL WINDOW (2026-11-26).
 *
 * The merge dispatcher installs an ordinary migration only in
 * [cycle start + 10 min, cycle start + 30 min) of a three-hourly cutover
 * (04:15-04:30 for the 04:00 anchor; merged-migration-dispatch.mjs O3/O21).
 * A file merged at any other minute sits uninstalled on main for up to 150
 * minutes, and the Backup refuses to certify a commit that carries an
 * uninstalled migration (backup-engine.yml O7), so every later engine commit
 * waits for the next window. On 2026-11-25 that left the 1 PM to 10 PM Chicago
 * cycles without a certifiable candidate.
 *
 * This answers, for the migration files a pull request adds or changes, whether
 * a merge NOW installs at once: the dispatcher's own admission rule
 * (admissibleAt) must hold now and MERGE_MARGIN_MINUTES later, so a merge made
 * within a few minutes of a green answer still lands in the window. Files that
 * declare `-- @install-window: daily-maintenance` install in the 04:00 break and
 * never block a certificate; a pull request with no ordinary migration is
 * always open. It reads no clock but the one it is given and writes nothing.
 *
 *   node scripts/ci/migration-merge-window.mjs check <files> <sql-dir> [now-ms] [--schedule <freq>]
 *     <files>: one "<status>\t<path>" per line (merged-migration-dispatch.mjs
 *     parseFileList format); <sql-dir>: where the pull request's migration
 *     files are read (data only). Exit 0 open, 1 closed, 2 usage.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  admissibleAt,
  changedPaths,
  parseFileList,
  planDispatch,
} from './merged-migration-dispatch.mjs';

/** A merge made this many minutes after a green answer still installs at once. */
export const MERGE_MARGIN_MINUTES = 5;
/** How far ahead the next window is looked for (the worst wait is 345 minutes). */
export const MERGE_SEARCH_HOURS = 24;
const STEP_MS = 15_000;

const chicago = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZoneName: 'short',
});
export function chicagoLabel(ms) {
  const p = Object.fromEntries(chicago.formatToParts(ms).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute} ${p.timeZoneName}`;
}

/** True when a merge at `ms` installs at once and still would MERGE_MARGIN_MINUTES later. */
export function mergeOpenAt(ms, count, preamble, schedule) {
  if (count === 0) return true;
  return (
    admissibleAt(ms, count, preamble, schedule) &&
    admissibleAt(ms + MERGE_MARGIN_MINUTES * 60_000, count, preamble, schedule)
  );
}

/**
 * { open, closesAt, opensAt, nextClosesAt } for `count` ordinary files at `now`
 * (epoch ms, 15 s resolution). When open, closesAt is the first instant it is
 * no longer open; when closed, opensAt/nextClosesAt bound the next window
 * (null when none within MERGE_SEARCH_HOURS).
 */
export function mergeWindow(now, count, preamble, schedule) {
  const horizon = now + MERGE_SEARCH_HOURS * 3_600_000;
  const firstFrom = (from, want) => {
    for (let t = from; t <= horizon; t += STEP_MS) {
      if (mergeOpenAt(t, count, preamble, schedule) === want) return t;
    }
    return null;
  };
  if (mergeOpenAt(now, count, preamble, schedule)) {
    return { open: true, closesAt: count === 0 ? null : firstFrom(now, false) };
  }
  const opensAt = firstFrom(now, true);
  return {
    open: false,
    opensAt,
    nextClosesAt: opensAt === null ? null : firstFrom(opensAt, false),
  };
}

/** The verdict and the plain lines the check prints, for one pull request. */
export function verdictFor(fileListText, readSql, now, schedule) {
  const { added, modified } = changedPaths(parseFileList(fileListText));
  const plan = planDispatch(added, readSql, now, modified, schedule);
  const count = plan.dispatch.length;
  const w = mergeWindow(now, count, plan.preamble, schedule);
  const lines = [];
  if (count === 0) {
    lines.push(
      plan.windowQueued.length
        ? `No ordinary migration: ${plan.windowQueued.join(', ')} install in the 04:00 break and never block a Backup certificate.`
        : 'No ordinary migration in this pull request.'
    );
  } else if (w.open) {
    lines.push(
      `OPEN: ${count} ordinary migration(s) (${plan.dispatch.join(', ')}) install at once if merged before ${w.closesAt === null ? 'the window closes' : chicagoLabel(w.closesAt)}.`
    );
  } else {
    const next =
      w.opensAt === null
        ? `no window within ${MERGE_SEARCH_HOURS} hours`
        : `the next merge window is ${chicagoLabel(w.opensAt)} to ${w.nextClosesAt === null ? 'unknown' : chicagoLabel(w.nextClosesAt)} (America/Chicago)`;
    lines.push(
      `CLOSED: merged now, ${count} ordinary migration(s) (${plan.dispatch.join(', ')}) would sit uninstalled on main and every later engine commit would be uncertifiable until the next install window; ${next}.`,
      'Re-run this check inside that window (push, re-run, or toggle a label), then merge at once.'
    );
  }
  if (plan.malformed.length) {
    lines.push(`Unreadable install-window declarations: ${plan.malformed.map((m) => m.name).join(', ')}.`);
  }
  return { open: w.open && plan.malformed.length === 0, window: w, plan, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const raw = process.argv.slice(2);
  let schedule = null;
  const pos = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--schedule') schedule = raw[++i] ?? null;
    else pos.push(raw[i]);
  }
  const [cmd, files, dir, nowArg] = pos;
  if (cmd !== 'check' || !files || !dir) {
    console.error('usage: migration-merge-window.mjs check <files> <sql-dir> [now-ms] [--schedule <freq>]');
    process.exit(2);
  }
  const readSql = (name) => {
    const p = join(dir, name);
    return existsSync(p) ? readFileSync(p, 'utf8') : null;
  };
  const v = verdictFor(readFileSync(files, 'utf8'), readSql, nowArg ? Number(nowArg) : Date.now(), schedule);
  for (const line of v.lines) console.log(line);
  process.exit(v.open ? 0 : 1);
}
