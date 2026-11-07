import { ownerWindowPredicate } from './owner-window-migration.mjs';
/**
 * ===========================================================================
 *  A MIGRATION THAT NEEDS THE LIVE TABLES WAITS FOR THE DAILY BREAK
 * ===========================================================================
 *
 * WHY (2026-10-22). Sampling showed public.clubs, public.tables and
 * public.hand_history held by some transaction older than 200 ms in 150 of 150
 * samples during live play, so a migration that needs ACCESS EXCLUSIVE on them
 * cannot be installed while tables deal. The Midway rake-cap migration tried
 * twice (02:34 and 02:48 UTC) and its queued lock froze the hand commit path:
 * 32 engine kills on 30 tables. 20261022030326 made the database cancel any
 * direct session that keeps live writers waiting; this module gives such a
 * migration a route that works instead of one that is cancelled.
 *
 * THE ROUTE. A migration declares, on a line of its own:
 *
 *     -- @install-window: daily-maintenance
 *
 * The ordinary applier (apply-recorded-migration.mjs, Apply Merged Migration)
 * then refuses it with a message saying it is queued. "Queued" is durable and
 * needs no table: the file is on protected main and its version is not in
 * supabase_migrations.schema_migrations. The daily 03:30 America/Chicago run of
 * stage-engine-release.yml (the owner-requested daily engine preparation, the
 * one schedule that already exists for this window) reads that queue with
 * scripts/ci/install-window-migrations.mjs, waits once for the 04:00 break's
 * confirmed freeze, and sends each queued file through the same applier with
 * --maintenance-window, one transaction each, once.
 *
 * WHAT THE TRANSACTION CARRIES (windowTransactionSQL):
 *   - the documented break-window override with a reason, so the DDL guard
 *     admits it and records it in public.ca_break_window_migration_overrides;
 *   - lock_timeout 1s and statement_timeout 5s: a lock that is not free is a
 *     refusal and a rollback, never a queue behind live work;
 *   - an opening assertion that the daily break is in counting_down, its freeze
 *     is confirmed by fn_platform_frozen(), and at least START_RESERVE_SECONDS
 *     remain before break_ends_at;
 *   - a closing assertion, after the history row, that the whole transaction
 *     took at most TRANSACTION_BUDGET_SECONDS and that COMMIT_RESERVE_SECONDS
 *     still remain, so a commit can never land in the thaw's preparation
 *     (the engine begins thaw 90 s before break_ends_at).
 * The budget keeps every install far below the 15 s age at which
 * fn_ca_writer_lock_sentinel cancels a session, so the sentinel needs no
 * exemption, and a short install cannot delay the thaw or the restart.
 *
 * NO RETRY LOOP (CLAUDE.md section 2 rules 2 and 9, 10.12). Each queued file is
 * sent at most once per window. A refusal rolls that file back, leaves it
 * queued for the next day's window and fails the job naming it, while the
 * files behind it are still sent once each (2026-11-07; one lock refusal used
 * to hold every later file for a day). An UNKNOWN outcome stops the run. The
 * job is read by its summary and by the red-main detector (CLAUDE.md 10.83).
 */

export const WINDOW_ANNOTATION = '-- @install-window: daily-maintenance';
export const WINDOW_LOCK_TIMEOUT_MS = 1000;
export const WINDOW_STATEMENT_TIMEOUT_MS = 5000;
export const TRANSACTION_BUDGET_SECONDS = 8;
export const START_RESERVE_SECONDS = 150;
export const COMMIT_RESERVE_SECONDS = 100;
export const MAINTENANCE_TIME_ZONE = 'America/Chicago';

/**
 * HOW LONG THE FREEZE MUST HAVE SETTLED BEFORE THE ONE ATTEMPT (2026-11-07).
 *
 * On 2026-11-07 the 04:00 install took its single attempt 3 s after the break
 * opened and died on `55P03 canceling statement due to lock timeout`, so all
 * six queued migrations stayed queued and the engine release was refused for
 * the two functions the first of them defines.
 *
 * The tables were not the problem: engine_maintenance_break_log shows that
 * break ready_for_restart_at 0.363 s after break_started_at, with
 * unparked_at_countdown 0 and peak_unparked 0. The problem is the minute
 * boundary. This database runs about twenty `* * * * *` cron jobs, so the
 * instant a break opens on the hour is also the instant that burst fires, and
 * an ALTER TABLE wanting ACCESS EXCLUSIVE queues behind any one of them - and
 * blocks everything arriving after it - with only a 1 s lock_timeout to win in.
 *
 * So the attempt waits for the per-minute burst to drain. This is not a retry
 * and not a new schedule: still one bounded wait for one window, still one
 * attempt per file, still no sleep inside the transaction. It only moves that
 * single attempt off :00. START_RESERVE_SECONDS leaves the admissible start at
 * break_started_at + 150 s, so a 20 s settle still leaves over two minutes.
 */
export const WINDOW_SETTLE_SECONDS = 20;

const ANNOTATION_LINE = /^--[ \t]*@install-window:[ \t]*(\S*)[ \t]*$/gm;

/**
 * 'daily-maintenance' when the file declares the window, null when it does not.
 * A malformed or unknown declaration throws: a typo must not quietly turn a
 * window migration back into one the live tables cannot take.
 */
export function windowDeclaration(sql) {
  const found = [...String(sql).matchAll(ANNOTATION_LINE)].map((m) => m[1]);
  const loose = String(sql)
    .split('\n')
    .filter((line) => /@install-window/.test(line));
  if (found.length === 0 && loose.length === 0) return null;
  if (found.length !== 1 || loose.length !== 1 || found[0] !== 'daily-maintenance')
    throw new Error(
      `an install-window declaration must be exactly one line "${WINDOW_ANNOTATION}"`
    );
  return 'daily-maintenance';
}

/** Non-throwing form for readers that only classify. */
export function declaresMaintenanceWindow(sql) {
  try {
    return windowDeclaration(sql) === 'daily-maintenance';
  } catch {
    return false;
  }
}

/*
 * ===========================================================================
 *  A WINDOW MIGRATION NAMES THE LOCK IT NEEDS (2026-11-07)
 * ===========================================================================
 *
 * Since 2026-11-07 a refused file is skipped alone and the queue behind it
 * still installs, so the order the installer sends files in now decides which
 * files a single lost lock can take down with it. A window migration may say,
 * on a header line of its own, which hot relations its writer-blocking lock
 * needs:
 *
 *     -- @locks: public.clubs, public.tables
 *
 * Schema-qualified relation names, comma separated, nothing else. The line is
 * ADVISORY FOR ORDERING ONLY: it never widens a timeout, never earns a retry
 * and never changes the transaction the applier sends. The installer sends the
 * files that declare nothing first (oldest version first), then the files that
 * declare locks, grouped so that files sharing a relation are adjacent and
 * oldest first inside the group. A refused file is still skipped alone; its
 * SKIPPED line and the run's verdict now name the relation it lost when the
 * applier's refusal says which one (`could not obtain lock on relation "..."`),
 * or, for a lock_timeout refusal (55P03), the declared relation a live
 * transaction still held at the refusal.
 *
 * An unparseable @locks value is a static refusal before any wait, like every
 * other header the installer reads: a typo must not quietly reorder the queue.
 */
export const LOCKS_ANNOTATION = '-- @locks:';
const LOCKS_LINE = /^--[ \t]*@locks:[ \t]*(.*?)[ \t]*$/gm;
const RELATION = /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The relations a window file declares with `-- @locks:`, lower-cased and
 * de-duplicated, in declaration order; [] when the file declares none. Throws
 * on a malformed declaration (two lines, an empty list, an unqualified or
 * otherwise unparseable name).
 */
export function windowLocks(sql) {
  const text = String(sql);
  const found = [...text.matchAll(LOCKS_LINE)].map((m) => m[1]);
  const loose = text.split('\n').filter((line) => /^--[ \t]*@locks/i.test(line));
  if (found.length === 0 && loose.length === 0) return [];
  if (found.length !== 1 || loose.length !== 1)
    throw new Error(
      `a locks declaration must be exactly one line "${LOCKS_ANNOTATION} schema.relation[, schema.relation...]"`
    );
  const parts = found[0]
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0 || parts.some((p) => !RELATION.test(p)))
    throw new Error(
      `"${LOCKS_ANNOTATION} ${found[0]}" is not a comma-separated list of schema-qualified relations`
    );
  return [...new Set(parts.map((p) => p.toLowerCase()))];
}

/**
 * The order the installer sends a queue in. `entries` is [{ file, locks }]
 * with `locks` from windowLocks. Files declaring no locks come first, oldest
 * version first (their order among themselves is unchanged). Files declaring
 * locks follow, grouped so that files sharing any relation (transitively) are
 * adjacent; groups are ordered by their oldest member, files inside a group by
 * version. Pure, deterministic, and never drops or duplicates a file.
 */
export function orderWindowQueue(entries) {
  const byVersion = (a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0);
  const independent = entries.filter((e) => !e.locks || e.locks.length === 0).sort(byVersion);
  const locked = entries.filter((e) => e.locks && e.locks.length > 0).sort(byVersion);
  // Union-find over relations: two files sharing a relation share a group.
  const parent = new Map();
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (a, b) => parent.set(find(a), find(b));
  for (const e of locked) {
    for (const rel of e.locks) if (!parent.has(rel)) parent.set(rel, rel);
    for (const rel of e.locks.slice(1)) union(e.locks[0], rel);
  }
  const groups = new Map();
  for (const e of locked) {
    const root = find(e.locks[0]);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(e);
  }
  const ordered = [...groups.values()]
    .map((g) => g.sort(byVersion))
    .sort((a, b) => byVersion(a[0], b[0]))
    .flat();
  return [...independent, ...ordered];
}

/**
 * The relation a refused window install lost, read from the applier's own
 * stderr: PostgreSQL's NOWAIT refusal names it outright. A lock_timeout
 * refusal (55P03 "canceling statement due to lock timeout") does not, so the
 * caller then names the declared relation a live transaction still held
 * (lostDeclaredRelations). Returns [] when the text names nothing.
 */
export function lostRelationsFromRefusal(stderrText) {
  const out = new Set();
  for (const m of String(stderrText).matchAll(
    /could not obtain lock on relation "((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)"/g
  ))
    out.add((m[1].includes('.') ? m[1] : `public.${m[1]}`).toLowerCase());
  return [...out];
}

/** True when the applier's stderr reports a lock_timeout refusal. */
export function isLockTimeoutRefusal(stderrText) {
  return /\b55P03\b/.test(String(stderrText));
}

/**
 * For a 55P03 refusal: the declared relations a conflicting transaction held
 * at the refusal (from QUIET_HOLDERS_QUERY's holders), or, when nothing
 * readable singles one out, every declared relation.
 */
export function lostDeclaredRelations(declared, holders) {
  if (!declared || declared.length === 0) return [];
  const held = new Set((holders || []).map((h) => String(h.relation).toLowerCase()));
  const named = declared.filter((r) => held.has(r));
  return named.length > 0 ? named : [...declared];
}

/** Blank comments and dollar-quoted bodies' tags are kept; only `--` text goes. */
const uncommented = (sql) => String(sql).replace(/--[^\n]*/g, ' ');

function durationMs(raw) {
  const m = /^\s*'?\s*(\d+(?:\.\d+)?)\s*(ms|s|min)?\s*'?\s*$/i.exec(String(raw));
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] || 'ms').toLowerCase();
  return unit === 'ms' ? n : unit === 's' ? n * 1000 : n * 60000;
}

/**
 * Static admission for a window migration. Throws with the reason; the caller
 * turns it into a REFUSED that sends nothing.
 */
export function validateWindowMigration(file, sql, opts = {}) {
  if (windowDeclaration(sql) !== 'daily-maintenance')
    throw new Error(`${file} does not declare "${WINDOW_ANNOTATION}"`);
  try {
    windowLocks(sql);
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
  if (opts.preamble && opts.preamble.length > 0)
    throw new Error(
      `${file}: a window migration cannot carry CREATE INDEX CONCURRENTLY; build the index in an ordinary migration first`
    );
  for (const [flag, on] of Object.entries({
    recovery: opts.recovery,
    'final-table pages': opts.batches,
    'settlement lane': opts.settlementLane,
    'maintenance thaw repair': opts.thawRepair,
    'rake report qualification': opts.rakeHistory,
    'accounting admission': opts.accountingAdmission,
  }))
    if (on) throw new Error(`${file}: a window migration cannot be combined with ${flag}`);

  const code = uncommented(sql);
  if ((code.match(/^[ \t]*BEGIN[ \t]*;/gim) || []).length !== 1)
    throw new Error(`${file}: a window migration is exactly one BEGIN; ... COMMIT; transaction`);
  if ((code.match(/^[ \t]*COMMIT[ \t]*;/gim) || []).length !== 1)
    throw new Error(`${file}: a window migration is exactly one BEGIN; ... COMMIT; transaction`);
  if (/\b(ROLLBACK|SAVEPOINT|RELEASE\s+SAVEPOINT|START\s+TRANSACTION)\b/i.test(code))
    throw new Error(`${file}: a window migration cannot manage its own transaction`);
  if (/\bpg_sleep\b/i.test(code))
    throw new Error(`${file}: a window migration never sleeps; it refuses instead of waiting`);
  if (/\bpg_advisory(_xact)?_lock(_shared)?\s*\(/i.test(code))
    throw new Error(
      `${file}: a window migration never waits on an advisory lock; use pg_try_advisory_xact_lock and refuse`
    );
  for (const loop of code.match(/\bLOOP\b[\s\S]*?\bEND\s+LOOP\b/gi) || [])
    if (/\bLOCK\s+TABLE\b/i.test(loop))
      throw new Error(`${file}: a window migration never retries LOCK TABLE in a loop`);
  if (/ca\.break_window_migration_override/i.test(code))
    throw new Error(
      `${file}: the window installer supplies the break-window override and its reason; the file must not`
    );
  if (/app\.freeze_bypass/i.test(code))
    throw new Error(
      `${file}: a window migration cannot bypass the platform freeze; money and seat rows stay frozen`
    );
  if (
    /\bset_config\s*\(\s*'(lock_timeout|statement_timeout|transaction_timeout|idle_in_transaction_session_timeout)'/i.test(
      code
    )
  )
    throw new Error(`${file}: a window migration sets its timeouts with SET LOCAL only`);
  const sets = [
    ...code.matchAll(
      /\bSET\s+(LOCAL\s+|SESSION\s+)?(lock_timeout|statement_timeout|transaction_timeout|idle_in_transaction_session_timeout)\s*(?:=|\bTO\b)\s*([^;]+);/gi
    ),
  ];
  for (const s of sets) {
    const scope = (s[1] || '').trim().toUpperCase();
    const name = s[2].toLowerCase();
    if (scope !== 'LOCAL')
      throw new Error(`${file}: ${name} may only be SET LOCAL inside a window migration`);
    const ms = durationMs(s[3]);
    const cap =
      name === 'lock_timeout'
        ? WINDOW_LOCK_TIMEOUT_MS
        : name === 'statement_timeout'
          ? WINDOW_STATEMENT_TIMEOUT_MS
          : null;
    if (cap === null)
      throw new Error(`${file}: a window migration does not set ${name}; the installer bounds it`);
    if (ms === null || ms <= 0 || ms > cap)
      throw new Error(
        `${file}: SET LOCAL ${name} = ${s[3].trim()} exceeds the window cap of ${cap} ms`
      );
  }
  return true;
}

/**
 * The one definition of "the daily window is open", as a boolean SQL
 * expression. It is read by the waiting installer and asserted inside every
 * install transaction, so the two cannot disagree.
 */
export function windowOpenPredicate(reserveSeconds) {
  const r = Number(reserveSeconds);
  if (!Number.isInteger(r) || r < 0 || r > 300) throw new Error('invalid window reserve');
  return `(public.fn_platform_frozen()
  AND EXISTS (
    SELECT 1 FROM public.engine_maintenance_break b
     WHERE b.enforce_freeze
       AND b.phase = 'counting_down'
       AND b.break_started_at IS NOT NULL
       AND b.break_ends_at IS NOT NULL
       AND b.break_started_at <= clock_timestamp()
       AND clock_timestamp() - b.break_started_at
           >= make_interval(secs => ${WINDOW_SETTLE_SECONDS})
       AND b.break_ends_at - clock_timestamp() >= make_interval(secs => ${r})
       AND (b.break_started_at AT TIME ZONE '${MAINTENANCE_TIME_ZONE}')::time >= time '03:55'
       AND (b.break_started_at AT TIME ZONE '${MAINTENANCE_TIME_ZONE}')::time < time '04:05'))`;
}

export const WINDOW_STATE_QUERY = `SELECT ${windowOpenPredicate(START_RESERVE_SECONDS)} AS open,
  public.fn_platform_frozen() AS frozen,
  (SELECT row_to_json(b)::text FROM public.engine_maintenance_break b) AS break_row,
  clock_timestamp() AS observed_at`;

export function overrideReason(file) {
  if (!/^\d{14}_[a-z0-9_]+\.sql$/.test(file)) throw new Error('invalid migration filename');
  return (
    `daily-maintenance window install of ${file}: it needs exclusive locks on live tables, ` +
    `so it is installed once inside the confirmed 04:00 ${MAINTENANCE_TIME_ZONE} freeze ` +
    `(scripts/ci/install-window-migrations.mjs, budget ${TRANSACTION_BUDGET_SECONDS}s)`
  );
}

/**
 * Wrap the exact atomic transaction (the file plus its history row) with the
 * window prelude after BEGIN and the window close before the final COMMIT.
 */
export function windowTransactionSQL(file, atomicSQL, ownerWindow = null) {
  const predicate = (reserve) =>
    ownerWindow ? ownerWindowPredicate(reserve, ownerWindow) : windowOpenPredicate(reserve);
  const reason = ownerWindow
    ? `owner-ordered ${ownerWindow.id}: ${ownerWindow.ownerOrder}; migration ${file}; same certified freeze and 8s budget`
    : overrideReason(file);
  const prelude = `
SET LOCAL ca.break_window_migration_override = '${reason.replaceAll("'", "''")}';
SET LOCAL lock_timeout = '${WINDOW_LOCK_TIMEOUT_MS}ms';
SET LOCAL statement_timeout = '${WINDOW_STATEMENT_TIMEOUT_MS}ms';
SET LOCAL idle_in_transaction_session_timeout = '${TRANSACTION_BUDGET_SECONDS}s';
DO $ca_install_window_open$
BEGIN
  IF NOT ${predicate(START_RESERVE_SECONDS)} THEN
    RAISE EXCEPTION 'install_window_closed: the daily maintenance break is not in a confirmed freeze with ${START_RESERVE_SECONDS}s to spare; nothing was installed'
      USING ERRCODE = '55000';
  END IF;
END $ca_install_window_open$;
`;
  const close = `
DO $ca_install_window_close$
BEGIN
  IF clock_timestamp() - transaction_timestamp() > make_interval(secs => ${TRANSACTION_BUDGET_SECONDS}) THEN
    RAISE EXCEPTION 'install_window_budget_exceeded: the install took longer than ${TRANSACTION_BUDGET_SECONDS}s; rolled back'
      USING ERRCODE = '55000';
  END IF;
  IF NOT ${predicate(COMMIT_RESERVE_SECONDS)} THEN
    RAISE EXCEPTION 'install_window_closed_before_commit: fewer than ${COMMIT_RESERVE_SECONDS}s remained before the thaw; rolled back'
      USING ERRCODE = '55000';
  END IF;
END $ca_install_window_close$;
`;
  if (/\$ca_install_window_(open|close)\$/.test(atomicSQL))
    throw new Error('migration conflicts with the reserved window delimiters');
  const opened = atomicSQL.replace(/^([ \t]*BEGIN[ \t]*;)/im, (m) => m + prelude);
  if (opened === atomicSQL) throw new Error('window transaction has no initial BEGIN');
  const closed = opened.replace(/COMMIT\s*;\s*$/i, () => close + 'COMMIT;');
  if (closed === opened) throw new Error('window transaction has no final COMMIT');
  return closed;
}

/**
 * Daily windows near `at`: 04:00-04:05 America/Chicago, DST aware, the same
 * computation as server/src/maintenance/maintenanceSchedule.ts.
 */
const chicagoHour = new Intl.DateTimeFormat('en-US', {
  timeZone: MAINTENANCE_TIME_ZONE,
  hour: '2-digit',
  hourCycle: 'h23',
});
const DAY_MS = 86_400_000;
export function dailyWindows(at) {
  const midnight = Math.floor(at / DAY_MS) * DAY_MS;
  const out = [];
  for (let day = -1; day <= 2; day++)
    for (const utcHour of [9, 10]) {
      const startsAt = midnight + day * DAY_MS + utcHour * 3_600_000;
      if (Number(chicagoHour.format(startsAt)) !== 4) continue;
      out.push({ startsAt, endsAt: startsAt + 5 * 60_000 });
    }
  return out.sort((a, b) => a.startsAt - b.startsAt);
}

/**
 * The window this run serves: the next one that can still admit an install
 * (start + 300 - START_RESERVE seconds), if it begins within `horizonMs`.
 */
export function windowToServe(at, horizonMs = 3 * 3_600_000) {
  const lastStart = (w) => w.endsAt - START_RESERVE_SECONDS * 1000;
  return dailyWindows(at).find((w) => lastStart(w) > at && w.startsAt - at <= horizonMs) ?? null;
}

/*
 * ===========================================================================
 *  A WINDOW INSTALL ASKS FOR ITS LOCK IN A QUIET MOMENT (2026-11-07)
 * ===========================================================================
 *
 * WHY. A window file gets ONE lock request with a 1 s lock_timeout, and the
 * freeze stops writers to money and seat rows, not readers. ACCESS EXCLUSIVE
 * waits on every reader, so a request that arrives while a reader is in the
 * middle of a multi-second transaction on the same table is refused, and the
 * first refusal holds every later file for a day. Measured on production
 * 2026-11-07 (read-only: cron.job_run_details, pg_locks, pg_stat_activity):
 *   - the 04:00 Chicago window opens on minute 0 of a UTC hour, so every
 *     every-minute, every-5-minute and every-10-minute pg_cron job starts at 10:00:00.15-0.45Z,
 *     the same second the installer sends its first file. Two of them read
 *     public.clubs for up to 3.9 s (ca-quick-reconcile-5m, 0.89 s that day,
 *     max 3.88 s; ca-mint-velocity-5m, 0.74 s, max 3.38 s);
 *   - sp_prune_hand_history_10m is one transaction of 7-11 s every 10 s,
 *     holding ACCESS SHARE on hand_history, tables and tournaments, with a
 *     gap of about 3 s between runs;
 *   - ca-table-stall-watch-10s runs back to back during the break (13-18 s per
 *     transaction, 17 ms apart) holding tables, table_seats, tournaments and
 *     tournament_players.
 * A lock request sent at an arbitrary instant into that is a coin flip.
 *
 * WHAT. Before the one attempt, the installer reads pg_locks (read-only; it
 * requests no lock and queues nothing behind it) for the relations the file
 * will lock, and waits until no other transaction older than
 * QUIET_HOLDER_AGE_MS holds a mode that conflicts with what the file asks
 * for, then sends the file once, exactly as before. The wait is bounded
 * (QUIET_WAIT_MAX_SECONDS per file) and, while the release that may need this
 * file's doors can still be admitted, it never runs past
 * DOOR_INSTALL_DEADLINE_SECONDS into the break. When the bound passes it
 * sends anyway: never worse than before, never a second attempt, no LOCK
 * retry, the 1 s lock_timeout and the stop-at-first-refusal rule unchanged.
 *
 * THE DEADLINE IS DERIVED FROM THE BREAK CLOCKS, not chosen. The release's
 * certificate admits it only while BREAK_ADMISSION_MIN_BREAK_MS (260000) of
 * the 300000 ms break remain (server/scripts/engine-release-transaction.sh),
 * so a door must be visible to the engine within the first 40 s. From that:
 * the schema cache reload PostgREST runs after the DDL (measured 1.4-5.9 s
 * over 151 reloads on 2026-11-07, so 6 s) and one in-break door poll (3 s
 * sleep plus the certificate and status reads, so 6 s) leave 28 s. The
 * arithmetic is pinned against the transaction's own constants by
 * tests/a-window-install-asks-for-its-lock-in-a-quiet-moment.law.test.ts.
 */
export const RELEASE_ADMISSION_SECONDS = 40;
export const SCHEMA_CACHE_RELOAD_SECONDS = 6;
export const RELEASE_DOOR_POLL_SECONDS = 6;
export const DOOR_INSTALL_DEADLINE_SECONDS =
  RELEASE_ADMISSION_SECONDS - SCHEMA_CACHE_RELOAD_SECONDS - RELEASE_DOOR_POLL_SECONDS;
export const QUIET_WAIT_MAX_SECONDS = 12;
export const QUIET_HOLDER_AGE_MS = 250;
export const QUIET_POLL_MS = 200;

const LOCK_STRENGTH = ['ShareLock', 'ShareRowExclusiveLock', 'AccessExclusiveLock'];
/** The held modes each requested mode waits on (PostgreSQL's conflict table). */
export const CONFLICTS = {
  AccessExclusiveLock: [
    'AccessShareLock',
    'RowShareLock',
    'RowExclusiveLock',
    'ShareUpdateExclusiveLock',
    'ShareLock',
    'ShareRowExclusiveLock',
    'ExclusiveLock',
    'AccessExclusiveLock',
  ],
  ShareRowExclusiveLock: [
    'RowExclusiveLock',
    'ShareUpdateExclusiveLock',
    'ShareLock',
    'ShareRowExclusiveLock',
    'ExclusiveLock',
    'AccessExclusiveLock',
  ],
  ShareLock: [
    'RowExclusiveLock',
    'ShareUpdateExclusiveLock',
    'ShareRowExclusiveLock',
    'ExclusiveLock',
    'AccessExclusiveLock',
  ],
};
const LOCK_MODE_WORDS = {
  'ACCESS SHARE': null,
  'ROW SHARE': null,
  'ROW EXCLUSIVE': null,
  'SHARE UPDATE EXCLUSIVE': null,
  SHARE: 'ShareLock',
  'SHARE ROW EXCLUSIVE': 'ShareRowExclusiveLock',
  EXCLUSIVE: 'AccessExclusiveLock',
  'ACCESS EXCLUSIVE': 'AccessExclusiveLock',
};

const IDENT = String.raw`(?:"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\.\s*)?"?([A-Za-z_][A-Za-z0-9_]*)"?`;

/**
 * The relations a window file will lock with a mode that waits on live
 * traffic, and the strongest such mode per relation, read from its SQL:
 *   ALTER TABLE, DROP TRIGGER ... ON, DROP TABLE, TRUNCATE   ACCESS EXCLUSIVE
 *   LOCK TABLE ... [IN <mode> MODE]                          that mode
 *   CREATE TRIGGER ... ON, ... REFERENCES <table>            SHARE ROW EXCLUSIVE
 *   CREATE INDEX ... ON                                      SHARE
 * Comments and dollar-quoted bodies are ignored. EXCLUSIVE is treated as
 * ACCESS EXCLUSIVE (it differs only for plain readers; waiting on them too is
 * the conservative side). A statement this reader does not know contributes
 * nothing: the file is then sent exactly as it was before this gate existed.
 * Returns [{ relation: 'schema.name', mode }], sorted.
 */
export function lockTargets(sql) {
  const code = String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g, ' ');
  const found = new Map();
  const add = (schema, name, mode) => {
    if (!mode) return;
    const key = `${(schema || 'public').toLowerCase()}.${name.toLowerCase()}`;
    const prior = found.get(key);
    if (!prior || LOCK_STRENGTH.indexOf(mode) > LOCK_STRENGTH.indexOf(prior)) found.set(key, mode);
  };
  const each = (re, fn) => {
    for (const m of code.matchAll(re)) fn(m);
  };
  each(new RegExp(String.raw`\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?${IDENT}`, 'gi'), (m) =>
    add(m[1], m[2], 'AccessExclusiveLock')
  );
  each(
    new RegExp(String.raw`\bDROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?[A-Za-z_][A-Za-z0-9_]*"?\s+ON\s+(?:ONLY\s+)?${IDENT}`, 'gi'),
    (m) => add(m[1], m[2], 'AccessExclusiveLock')
  );
  each(new RegExp(String.raw`\b(?:DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?|TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?)${IDENT}`, 'gi'), (m) =>
    add(m[1], m[2], 'AccessExclusiveLock')
  );
  each(/\bLOCK\s+(?:TABLE\s+)?(?:ONLY\s+)?([^;]+?)(?:\s+IN\s+([A-Z ]+?)\s+MODE)?\s*(?:NOWAIT\s*)?;/gi, (m) => {
    const mode = m[2] ? LOCK_MODE_WORDS[m[2].trim().toUpperCase().replace(/\s+/g, ' ')] : 'AccessExclusiveLock';
    for (const part of m[1].split(',')) {
      const id = new RegExp(String.raw`^\s*${IDENT}\s*$`).exec(part);
      if (id) add(id[1], id[2], mode);
    }
  });
  each(
    new RegExp(
      String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+"?[A-Za-z_][A-Za-z0-9_]*"?\s[\s\S]*?\bON\s+(?:ONLY\s+)?${IDENT}`,
      'gi'
    ),
    (m) => add(m[1], m[2], 'ShareRowExclusiveLock')
  );
  each(new RegExp(String.raw`\bREFERENCES\s+${IDENT}`, 'gi'), (m) => add(m[1], m[2], 'ShareRowExclusiveLock'));
  each(
    new RegExp(
      String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"?[A-Za-z_][A-Za-z0-9_]*"?\s+)?ON\s+(?:ONLY\s+)?${IDENT}`,
      'gi'
    ),
    (m) => add(m[1], m[2], 'ShareLock')
  );
  return [...found.entries()]
    .map(([relation, mode]) => ({ relation, mode }))
    .sort((a, b) => a.relation.localeCompare(b.relation));
}

/**
 * One read-only statement: who, right now, holds a conflicting lock on the
 * targets in a transaction older than $3 ms, and how far into the daily break
 * the database clock is. $1 relations, $2 requested modes, $3 minimum age.
 */
export const QUIET_HOLDERS_QUERY = `WITH t AS (
  SELECT to_regclass(u.rel) AS oid, u.rel, u.mode
    FROM unnest($1::text[], $2::text[]) AS u(rel, mode))
SELECT
  (SELECT extract(epoch FROM clock_timestamp() - b.break_started_at)::float8
     FROM public.engine_maintenance_break b) AS into_break_s,
  (SELECT extract(epoch FROM b.break_ends_at - clock_timestamp())::float8
     FROM public.engine_maintenance_break b) AS remaining_s,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'relation', t.rel, 'mode', l.mode, 'pid', l.pid,
      'application', a.application_name, 'role', a.usename,
      'xact_ms', round(extract(epoch FROM clock_timestamp() - a.xact_start) * 1000),
      'query', left(regexp_replace(COALESCE(a.query, ''), '\\s+', ' ', 'g'), 120))
      ORDER BY a.xact_start)
     FROM t
     JOIN pg_locks l ON l.relation = t.oid AND l.granted
     LEFT JOIN pg_stat_activity a ON a.pid = l.pid
    WHERE l.pid IS DISTINCT FROM pg_backend_pid()
      AND l.mode = ANY (CASE t.mode
            WHEN 'AccessExclusiveLock' THEN ARRAY['${CONFLICTS.AccessExclusiveLock.join("','")}']
            WHEN 'ShareRowExclusiveLock' THEN ARRAY['${CONFLICTS.ShareRowExclusiveLock.join("','")}']
            ELSE ARRAY['${CONFLICTS.ShareLock.join("','")}'] END)
      AND (a.xact_start IS NULL
           OR a.xact_start < clock_timestamp() - make_interval(secs => $3::float8 / 1000))),
    '[]'::jsonb) AS holders`;

/**
 * How long this file may wait for a quiet moment, in ms from now, given the
 * database's own clock: QUIET_WAIT_MAX_SECONDS, never past
 * DOOR_INSTALL_DEADLINE_SECONDS while the release can still be admitted, and
 * never past the last instant the window still admits an install.
 */
export function quietWaitBudgetMs(intoBreakSeconds, remainingSeconds) {
  if (!Number.isFinite(intoBreakSeconds) || !Number.isFinite(remainingSeconds)) return 0;
  let budget = QUIET_WAIT_MAX_SECONDS * 1000;
  if (intoBreakSeconds < DOOR_INSTALL_DEADLINE_SECONDS)
    budget = Math.min(budget, (DOOR_INSTALL_DEADLINE_SECONDS - intoBreakSeconds) * 1000);
  // The applier's opening assertion needs START_RESERVE_SECONDS; keep 2 s for
  // its own connection and prelude.
  budget = Math.min(budget, (remainingSeconds - START_RESERVE_SECONDS - 2) * 1000);
  return Math.max(0, Math.floor(budget));
}

export function describeHolders(holders) {
  return (holders || [])
    .map(
      (h) =>
        `${h.relation} ${h.mode} pid ${h.pid ?? 'prepared'} ${h.application || h.role || 'unknown'} ` +
        `${h.xact_ms ?? '?'} ms: ${h.query || ''}`.trim()
    )
    .join('; ');
}
