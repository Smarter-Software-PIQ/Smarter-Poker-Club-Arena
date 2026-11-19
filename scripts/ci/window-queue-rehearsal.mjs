/**
 * A WINDOW MIGRATION IS REHEARSED BEFORE IT MERGES (owner instruction, 11:04
 * Chicago 2026-11-17: everything the 04:00 cutover needs must be present
 * before it, and the daily route must run by itself).
 *
 * "-- @install-window: daily-maintenance" files install only inside the 04:00
 * Chicago break (install-window-migrations.mjs). On 2026-11-13, 2026-11-14
 * and 2026-11-17 the "Install Queued Daily-Maintenance Migrations" job found
 * their defects there for the first time: on 2026-11-17 all seven queued files
 * were refused, the first with "function public.fn_ca_promo_integrity_immutable()
 * does not exist" (Stage 44034697186). Nothing installed them earlier against
 * production's schema, so a missing dependency surfaced only at 04:00.
 *
 * This is the pure half of the pull-request gate
 * (.github/workflows/window-migrations-install-before-merge.yml): which files
 * the rehearsal installs and in what order. The queue is every window file
 * production has not installed (main's plus the pull request's), in the
 * installer's own order (orderWindowQueue), after the ordinary migrations
 * production has not installed yet, which install before 04:00 on their own
 * route. A superseded file is never queued (same parser as the installer).
 * The shell half (rehearse-window-queue.sh) installs them, one transaction
 * each, into a throwaway database restored from production's schema.
 *
 * It reads no network and holds no credential.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  WINDOW_LOCK_TIMEOUT_MS,
  WINDOW_STATEMENT_TIMEOUT_MS,
  declaresMaintenanceWindow,
  orderWindowQueue,
  overrideReason,
  validateWindowMigration,
  windowLocks,
} from './maintenance-window-migrations.mjs';
import { matchedByName, supersededBy } from './check-migrations-are-live.mjs';
import { loadAliases } from './migration-aliases.mjs';

export const MIGRATION_FILE = /^(\d{14})_[a-z0-9_]+\.sql$/;

export const PENDING_HORIZON_HOURS = 48;

const stamp = (ms) => new Date(ms).toISOString().replace(/[-:T]/g, '').slice(0, 14);
const msOf = (v) =>
  Date.UTC(
    +v.slice(0, 4),
    +v.slice(4, 6) - 1,
    +v.slice(6, 8),
    +v.slice(8, 10),
    +v.slice(10, 12),
    +v.slice(12, 14)
  );

/**
 * The time bound of "pending": PENDING_HORIZON_HOURS before the newest version
 * production holds, and never later than PENDING_HORIZON_HOURS before NOW, so
 * one future-stamped installed version cannot turn every pending file into
 * history. It is only an additional bound (see isPending): a file at or after
 * it is pending; a file before it is pending too when the evidence says so.
 */
export function pendingFloor(installed, now = Date.now()) {
  const newest = [...installed]
    .filter((v) => /^\d{14}$/.test(v))
    .sort()
    .pop();
  const cap = now - PENDING_HORIZON_HOURS * 3600e3;
  if (!newest) return stamp(cap);
  return stamp(Math.min(msOf(newest) - PENDING_HORIZON_HOURS * 3600e3, cap));
}

/**
 * IS AN UNINSTALLED FILE PENDING, OR HISTORY? (2026-11-18, incident 075013fd)
 * "Not in schema_migrations by version" alone named 1,003 prerequisites on
 * 2026-11-18 and replayed months-old function bodies over production's schema:
 * Supabase's transport stamps its own version, so ~1,000 files are recorded
 * under another version or name. Decided from evidence, as
 * check-migrations-are-live.mjs decides it:
 *   - HISTORY when production recorded it by name (matchedByName: its slug,
 *     its whole stem, or the 55-character truncation) or
 *     applied-migration-aliases.json maps it to an installed version;
 *   - otherwise PENDING when git says it was first added to main within the
 *     recent window (a file merged late with an old stamp is pending, however
 *     old the stamp), or its version is at or after pendingFloor;
 *   - otherwise HISTORY: added long ago and never recorded by version, name
 *     or alias (the pre-ledger estate).
 * Evidence that could not be gathered is null and simply does not count; a
 * file the pull request changes is always judged.
 * @param {{recordedNames?: Set<string>|null, aliasedFiles?: Set<string>|null,
 *          recentlyAdded?: Set<string>|null, now?: number}} evidence
 */
export function isPending(name, version, installed, evidence = {}) {
  const names = evidence.recordedNames;
  if (names && names.size) {
    const prefixes = new Set([...names].map((n) => n.slice(0, 55)));
    if (matchedByName(name, names, prefixes)) return false;
  }
  if (evidence.aliasedFiles?.has(name)) return false;
  if (evidence.recentlyAdded?.has(name)) return true;
  return version >= pendingFloor(installed, evidence.now);
}

/**
 * @param {{name: string, sql: string}[]} files  every migration file in the tree
 * @param {Set<string>} installed                 versions production holds
 * @param {Set<string>} [changed]                 file names the pull request adds or modifies
 * @param {object} [evidence]                     see isPending
 */
export function planRehearsal(files, installed, changed = new Set(), evidence = {}) {
  const names = files.map((f) => f.name);
  const ordinary = [];
  const windows = [];
  const superseded = [];
  const invalid = [];
  for (const { name, sql } of [...files].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )) {
    const m = MIGRATION_FILE.exec(name);
    if (!m || installed.has(m[1])) continue;
    const by = supersededBy(sql, names);
    if (by) {
      superseded.push({ name, by });
      continue;
    }
    if (!declaresMaintenanceWindow(sql)) {
      // History is not a prerequisite (isPending); a changed file is always judged.
      if (changed.has(name) || isPending(name, m[1], installed, evidence)) ordinary.push(name);
      continue;
    }
    try {
      validateWindowMigration(name, sql);
    } catch (e) {
      invalid.push({ name, reason: e.message, changed: changed.has(name) });
      continue;
    }
    windows.push({ file: name, locks: windowLocks(sql) });
  }
  const window = orderWindowQueue(windows).map((e) => e.file);
  return {
    ordinary,
    window,
    changedWindow: window.filter((n) => changed.has(n)),
    superseded,
    invalid,
  };
}

/**
 * The file's own transaction with the installer's session settings after its
 * first BEGIN: the DDL guard's override reason, and the window's lock and
 * statement bounds. The live window-open predicate is not asserted: there is
 * no break in a rehearsal, and it is the installer's runtime check.
 */
export function rehearsalSQL(file, sql) {
  const prelude = `
SET LOCAL ca.break_window_migration_override = '${overrideReason(file).replaceAll("'", "''")}';
SET LOCAL lock_timeout = '${WINDOW_LOCK_TIMEOUT_MS}ms';
SET LOCAL statement_timeout = '${WINDOW_STATEMENT_TIMEOUT_MS}ms';
`;
  const opened = String(sql).replace(/^([ \t]*BEGIN[ \t]*;)/im, (m) => m + prelude);
  if (opened === sql) throw new Error(`${file}: window transaction has no initial BEGIN`);
  return opened;
}

export function readTree(dir) {
  return readdirSync(dir)
    .filter((n) => MIGRATION_FILE.test(n))
    .map((name) => ({ name, sql: readFileSync(join(dir, name), 'utf8') }));
}

const lines = (path) =>
  readFileSync(path, 'utf8')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The evidence isPending reads, from what the jobs hand over:
 *   RECORDED_NAMES  file of "<version>\t<name>" lines from schema_migrations
 *                   (the capture's installed-names.tsv)
 *   RECENTLY_ADDED  file of migration file names first added to main within
 *                   the recent window (migrations-added-recently.sh)
 * and applied-migration-aliases.json from the repository. A missing or empty
 * source is null: no evidence, never a guess.
 */
export function evidenceFromEnv(env = process.env, repo) {
  const read = (p) => (p && existsSync(p) ? readFileSync(p, 'utf8') : null);
  const namesText = read(env.RECORDED_NAMES);
  const recordedNames = namesText
    ? new Set(
        namesText
          .split('\n')
          .map((l) => (l.split('\t')[1] ?? '').trim())
          .filter(Boolean)
      )
    : null;
  const addedText = read(env.RECENTLY_ADDED);
  const recentlyAdded = addedText
    ? new Set(
        addedText
          .split('\n')
          .map((l) => l.trim().replace(/^supabase\/migrations\//, ''))
          .filter(Boolean)
      )
    : null;
  const aliases = loadAliases(repo);
  const aliasedFiles = aliases.error
    ? null
    : new Set([...aliases.byFile.keys()].map((f) => String(f).split('/').pop()));
  return {
    recordedNames: recordedNames && recordedNames.size ? recordedNames : null,
    recentlyAdded: recentlyAdded && recentlyAdded.size ? recentlyAdded : null,
    aliasedFiles,
  };
}

// CLI:
//   node scripts/ci/window-queue-rehearsal.mjs plan <migrations-dir> <installed-versions-file> [changed-names-file]
//   node scripts/ci/window-queue-rehearsal.mjs sql <migrations-dir> <file>
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, dir, a, b] = process.argv.slice(2);
  if (cmd === 'plan') {
    const installed = new Set(lines(a).filter((v) => /^\d{14}$/.test(v)));
    const changed = new Set(b ? lines(b).map((p) => p.replace(/^supabase\/migrations\//, '')) : []);
    process.stdout.write(
      JSON.stringify(planRehearsal(readTree(dir), installed, changed, evidenceFromEnv())) + '\n'
    );
  } else if (cmd === 'sql') {
    process.stdout.write(rehearsalSQL(a, readFileSync(join(dir, a), 'utf8')));
  } else {
    console.error(
      'usage: window-queue-rehearsal.mjs plan <dir> <installed> [changed] | sql <dir> <file>'
    );
    process.exit(2);
  }
}
