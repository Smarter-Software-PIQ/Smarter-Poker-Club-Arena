#!/usr/bin/env node
/**
 * AN OLDER MERGED MIGRATION INSTALLS FIRST, BY CONSTRUCTION
 * (incident 90972d77, 2026-11-21).
 *
 * Every merged migration file gets its own Apply Merged Migration run, and
 * that workflow's queue step runs them one at a time in RUN-ID order, which is
 * DISPATCH order. Dispatch order is not version order: merges held behind the
 * same boundary wake together, and at 04:15 UTC on 2026-11-21 the run for
 * 20261121024624 was created before the run for 20261121005533, installed
 * first, and 20261121005533's own chain guard then refused it.
 *
 * PR #11619 answered with a dispatcher-side wait (await-older-merged-applies)
 * bounded at 300 s. That made the race rarer, not impossible: an older run
 * slower than the budget, or an older dispatch that had not been sent yet,
 * still inverted the order. This replaces it with a rule that does not depend
 * on any clock:
 *
 *   When a run is asked to install version V, it first installs every OLDER
 *   ordinary migration on main that production does not hold, oldest first,
 *   each exactly once through the same applier (apply-recorded-migration.mjs),
 *   and only then V.
 *
 * Because the applier runs are already serialized (the queue step), whichever
 * run reaches the database first installs the older file before the newer one.
 * The older file's own run later answers ALREADY-APPLIED and sends nothing.
 * tests/an-older-merged-migration-installs-first.law.test.ts proves this for
 * every dispatch order.
 *
 * WHAT COUNTS AS "OLDER AND PENDING" (pendingOlderFiles):
 *   - a 14-digit migration file in supabase/migrations on this checkout of
 *     main, with ORDER_FLOOR <= version < V;
 *   - not held by production the way the applier itself reads it (version, or
 *     name, or the name's 55-character truncation), so this never picks a file
 *     the applier would answer ALREADY-APPLIED;
 *   - not a "-- @install-window: daily-maintenance" file: those stay QUEUED for
 *     the 04:00 window route and are never sent here, exactly as before, and
 *     they do not hold a later ordinary file back (only the files' own chain
 *     guards decide that, unchanged);
 *   - not marked "SUPERSEDED BY <version>": such a file must never run
 *     (check-migrations-are-live.mjs supersededBy, the applier's own parser).
 *
 * ORDER_FLOOR. Before November 2026 some migrations were recorded under a
 * version or name Supabase stamped, not the file's own (the reason
 * check-migrations-are-live.mjs does not trust names). Re-sending one of those
 * would apply it twice. 20261110000000 is the first version wholly inside the
 * era of migration-install-watch (20261109182123), which pages any merged
 * ordinary file that is neither installed by its exact version, retired nor
 * superseded; every file from the floor on is therefore installed, queued for
 * the window, superseded, or already paging.
 *
 * OUTCOMES (CLAUDE.md 10.86 rule 1), the applier's own codes:
 *   0  every older file APPLIED or ALREADY-APPLIED (or none was pending);
 *      the workflow then installs V.
 *   1  REFUSED: an older file was refused, or production's history could not
 *      be read, or more than MAX_OLDER files are pending. V is NOT sent: sending
 *      it would be exactly the inversion this exists to prevent. The fix for a
 *      refused older file is the file (fix it in place, or mark it SUPERSEDED BY
 *      its successor), never sending V over it.
 *   3  UNKNOWN: an older file's outcome is unknown. V is not sent.
 *
 * Not a watcher, timer, retry or repair job (CLAUDE.md 10.11, 10.12): it runs
 * only inside a dispatched applier run, sends each file at most once, and
 * retries nothing.
 *
 * usage: DATABASE_URL=... node scripts/ci/install-older-merged-first.mjs \
 *          --migration <file> --ssl-root-cert <path> [--dry-run]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { supersededBy } from './check-migrations-are-live.mjs';
import { declaresMaintenanceWindow } from './maintenance-window-migrations.mjs';

export const ORDER_FLOOR = '20261110000000';
// One run installs at most this many older files before V, so the applier
// job's 35-minute timeout (queue 15 + one DDL admission wait 12 + sends) holds.
// A longer backlog is REFUSED with nothing sent and names the oldest file:
// dispatching that one first drains the backlog in order.
export const MAX_OLDER = 5;
const FILE = /^(\d{14})_([a-z0-9_]+)\.sql$/;

/**
 * The older ordinary files production does not hold, oldest first.
 * `installed` is the rows of supabase_migrations.schema_migrations ({version, name}).
 */
export function pendingOlderFiles({ target, files, readSql, installed }) {
  const t = FILE.exec(target);
  if (!t) throw new Error(`"${target}" is not a migration filename`);
  const versions = new Set();
  const names = new Set();
  for (const r of installed) {
    versions.add(String(r.version));
    names.add(String(r.name));
  }
  const install = [];
  const windowQueued = [];
  const superseded = [];
  for (const f of [...files].sort()) {
    const m = FILE.exec(f);
    if (!m) continue;
    const [, version, slug] = m;
    if (version < ORDER_FLOOR || version >= t[1]) continue;
    if (versions.has(version) || names.has(slug) || names.has(slug.slice(0, 55))) continue;
    const sql = readSql(f);
    if (supersededBy(sql, files)) {
      superseded.push(f);
      continue;
    }
    if (declaresMaintenanceWindow(sql)) {
      windowQueued.push(f);
      continue;
    }
    install.push(f);
  }
  return { install, windowQueued, superseded };
}

/**
 * Send each older pending file once, oldest first, through `send` (the
 * applier); stop at the first that does not install. Returns the run's code:
 * 0 means the target may be sent next, anything else means it must not be.
 */
export function installOlderFirst({ target, plan, send, log }) {
  if (plan.install.length === 0) {
    log(`[order] no older ordinary migration is pending; installing ${target}.`);
    return 0;
  }
  if (plan.install.length > MAX_OLDER) {
    log(
      `[order] REFUSED: ${plan.install.length} older migrations are pending (${plan.install.join(', ')}), more than one run installs (${MAX_OLDER}). Nothing was sent. Dispatch apply-merged-migration for ${plan.install[0]} first; each run installs the oldest pending files in order.`
    );
    return 1;
  }
  log(
    `[order] ${plan.install.length} older migration(s) pending; installing them first, oldest first: ${plan.install.join(', ')}`
  );
  for (const f of plan.install) {
    log(`[order] --- older ${f} ---`);
    const code = send(f);
    if (code !== 0) {
      const verdict = code === 1 ? 'REFUSED' : 'UNKNOWN';
      log(
        `[order] ${verdict}: older ${f} did not install (exit ${code}), so ${target} was NOT sent: installing it over a missing older file is the inversion this order prevents. Fix ${f} in place or mark it SUPERSEDED BY its successor; its fix's run then installs both in order.`
      );
      return code === 1 ? 1 : 3;
    }
  }
  log(`[order] every older pending migration is installed; installing ${target}.`);
  return 0;
}

async function readInstalled() {
  const conn = new URL(process.env.DATABASE_URL);
  const sslRoot = argValue('--ssl-root-cert');
  const ssl = { rejectUnauthorized: true };
  if (sslRoot && sslRoot !== 'system') ssl.ca = readFileSync(sslRoot, 'utf8');
  for (const key of ['sslmode', 'ssl', 'sslrootcert']) conn.searchParams.delete(key);
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: conn.toString(),
    ssl,
    application_name: 'install-older-merged-first',
  });
  await client.connect();
  try {
    // A plain SELECT, never list_migrations (CLAUDE.md section 2 rule 8).
    const { rows } = await client.query(
      'SELECT version, name FROM supabase_migrations.schema_migrations'
    );
    return rows;
  } finally {
    await client.end().catch(() => {});
  }
}

const args = process.argv.slice(2);
function argValue(n) {
  const i = args.indexOf(n);
  return i === -1 ? null : args[i + 1] || null;
}

async function main() {
  const target = argValue('--migration') || '';
  const dryRun = args.includes('--dry-run');
  const DIR = 'supabase/migrations';
  if (!FILE.exec(target)) {
    // The applier refuses a malformed name itself, with its own sentence.
    console.log(`[order] "${target}" is not a migration filename; the applier answers for it.`);
    return 0;
  }
  let installed;
  try {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
    installed = await readInstalled();
  } catch (e) {
    console.log(
      `[order] REFUSED: could not read production's migration history (${e.message}), so whether an older file is still pending is unread. Nothing was sent; dispatch again.`
    );
    return 1;
  }
  const files = readdirSync(DIR);
  const plan = pendingOlderFiles({
    target,
    files,
    readSql: (f) => readFileSync(join(DIR, f), 'utf8'),
    installed,
  });
  for (const f of plan.windowQueued)
    console.log(`[order] older ${f} is QUEUED for the daily maintenance window; not sent here.`);
  for (const f of plan.superseded)
    console.log(`[order] older ${f} is marked SUPERSEDED; it never installs.`);
  return installOlderFirst({
    target,
    plan,
    log: (m) => console.log(m),
    send: (f) => {
      const r = spawnSync(
        process.execPath,
        [
          'scripts/ci/apply-recorded-migration.mjs',
          '--ssl-root-cert',
          argValue('--ssl-root-cert') || 'system',
          '--migration',
          f,
          ...(dryRun ? ['--dry-run'] : []),
        ],
        { stdio: 'inherit' }
      );
      return r.status === null ? 3 : r.status;
    },
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      // Something failed before or between sends; an older file may have been sent.
      console.log(
        `[order] UNKNOWN: ${e?.message || e}. Inspect schema_migrations before another dispatch.`
      );
      process.exit(3);
    }
  );
}
