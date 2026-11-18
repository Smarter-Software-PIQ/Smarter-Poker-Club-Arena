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
import { readdirSync, readFileSync } from 'node:fs';
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
import { supersededBy } from './check-migrations-are-live.mjs';

export const MIGRATION_FILE = /^(\d{14})_[a-z0-9_]+\.sql$/;

/**
 * @param {{name: string, sql: string}[]} files  every migration file in the tree
 * @param {Set<string>} installed                 versions production holds
 * @param {Set<string>} [changed]                 file names the pull request adds or modifies
 */
export const PENDING_HORIZON_HOURS = 48;

/**
 * The oldest version still "pending" rather than history: PENDING_HORIZON_HOURS
 * before the newest version production holds. The tree carries ~1,000 old
 * files that production recorded under other versions or names (Supabase's
 * transport stamps its own; check-migrations-are-live.mjs matches them by name
 * and object), so "not in schema_migrations by version" alone named 1,003
 * "prerequisites" on 2026-11-18 and replayed months-old function bodies over
 * production's schema before the rehearsal judged anything. A file older than
 * this is not in any install queue.
 */
export function pendingFloor(installed) {
  const newest = [...installed]
    .filter((v) => /^\d{14}$/.test(v))
    .sort()
    .pop();
  if (!newest) return '00000000000000';
  const t =
    Date.UTC(
      +newest.slice(0, 4),
      +newest.slice(4, 6) - 1,
      +newest.slice(6, 8),
      +newest.slice(8, 10),
      +newest.slice(10, 12),
      +newest.slice(12, 14)
    ) -
    PENDING_HORIZON_HOURS * 3600e3;
  return new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

export function planRehearsal(files, installed, changed = new Set()) {
  const names = files.map((f) => f.name);
  const floor = pendingFloor(installed);
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
      // History, not a prerequisite (see pendingFloor); a changed file is always judged.
      if (m[1] >= floor || changed.has(name)) ordinary.push(name);
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

// CLI:
//   node scripts/ci/window-queue-rehearsal.mjs plan <migrations-dir> <installed-versions-file> [changed-names-file]
//   node scripts/ci/window-queue-rehearsal.mjs sql <migrations-dir> <file>
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, dir, a, b] = process.argv.slice(2);
  if (cmd === 'plan') {
    const installed = new Set(lines(a).filter((v) => /^\d{14}$/.test(v)));
    const changed = new Set(b ? lines(b).map((p) => p.replace(/^supabase\/migrations\//, '')) : []);
    process.stdout.write(JSON.stringify(planRehearsal(readTree(dir), installed, changed)) + '\n');
  } else if (cmd === 'sql') {
    process.stdout.write(rehearsalSQL(a, readFileSync(join(dir, a), 'utf8')));
  } else {
    console.error(
      'usage: window-queue-rehearsal.mjs plan <dir> <installed> [changed] | sql <dir> <file>'
    );
    process.exit(2);
  }
}
