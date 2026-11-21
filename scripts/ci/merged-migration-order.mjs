/**
 * AN OLDER MERGED MIGRATION INSTALLS FIRST (incident 90972d77, 2026-11-21).
 *
 * Each merged pull request has its own dispatcher run, and each file its own
 * Apply Merged Migration run (concurrency is per file). When several merges
 * are held behind the same boundary they are released in the same second:
 * at 04:15 UTC on 2026-11-21 four runs started within two seconds and
 * 20261121024624 installed before 20261121005533, whose chain guard then
 * refused it, and the install watch paged MergedMigrationNotInstalled.
 *
 * Before an ordinary install sends anything it reads the merged files the
 * install watch knows are still waiting with a LOWER version (merged in the
 * last day, not installed, not retired, not superseded, not a window file)
 * and waits for them, bounded. Those files were released by the same
 * boundary and are installing in their own runs, so the wait is normally a
 * minute. When the budget ends with an older file still waiting, the install
 * proceeds exactly as it did before this gate, so a refused older file can
 * never hold a later fix hostage: the order is preserved for the race, not
 * imposed on a file that cannot install.
 */

export const ORDER_WAIT_BUDGET_MS = 150_000;
export const ORDER_POLL_MS = 5_000;

export const OLDER_WAITING_SQL = `
  SELECT w.version, w.file
    FROM smarter_private.ca_merged_migration_watch w
   WHERE w.version < $1
     AND w.installed_seen_at IS NULL
     AND w.retired_at IS NULL
     AND w.superseded_by IS NULL
     AND NOT w.window_install
     AND w.merged_at > now() - interval '1 day'
     AND NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations s WHERE s.version = w.version)
   ORDER BY w.version`;

/** Only 14-digit versions strictly below `version`, oldest first. */
export function olderWaiting(rows, version) {
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && /^\d{14}$/.test(String(r.version)) && String(r.version) < String(version))
    .map((r) => ({ version: String(r.version), file: String(r.file ?? '') }))
    .sort((a, b) => (a.version < b.version ? -1 : a.version > b.version ? 1 : 0));
}

/**
 * Wait (bounded) until no older merged file is waiting. Returns
 * { waitedMs, stillWaiting } and never throws for an unreadable watch: an
 * unreadable answer is reported as such and the install continues as before.
 */
export async function awaitOlderMergedMigrations(client, version, opts = {}) {
  const budget = opts.budgetMs ?? ORDER_WAIT_BUDGET_MS;
  const poll = opts.pollMs ?? ORDER_POLL_MS;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? ((m) => console.log(m));
  const started = now();
  let waiting = [];
  for (;;) {
    try {
      const { rows } = await client.query(OLDER_WAITING_SQL, [version]);
      waiting = olderWaiting(rows, version);
    } catch (e) {
      log(`[apply]   order gate COULD NOT TELL (${e.message}); continuing without it`);
      return { waitedMs: now() - started, stillWaiting: null };
    }
    if (waiting.length === 0) return { waitedMs: now() - started, stillWaiting: [] };
    const elapsed = now() - started;
    if (elapsed >= budget) {
      log(
        `[apply]   order gate: ${waiting.map((w) => w.version).join(', ')} still not installed after ${Math.round(elapsed / 1000)} s; installing anyway`
      );
      return { waitedMs: elapsed, stillWaiting: waiting };
    }
    if (elapsed === 0)
      log(
        `[apply]   order gate: waiting for older merged ${waiting.map((w) => w.version).join(', ')}`
      );
    await sleep(Math.min(poll, budget - elapsed));
  }
}
