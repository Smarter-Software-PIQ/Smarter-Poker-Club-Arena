/**
 * PRE-DDL TRANSIENT LOCK-CONTENTION BACKOFF
 *
 * Before opening BEGIN on a migration that alters or locks an existing table,
 * performs a read-only check on pg_locks + pg_stat_activity for conflicting
 * active locks (AccessExclusiveLock, ShareLock, ExclusiveLock, or long-running
 * DDL / autovacuum wraparound) on the migration's target tables.
 *
 * If a conflicting lock is actively held, waits briefly (bounded: up to
 * PRE_DDL_LOCK_MAX_CHECKS = 3 checks x PRE_DDL_LOCK_INTERVAL_MS = 5000ms,
 * max 15s total) before opening BEGIN, logging blocking PID and wait_event
 * cleanly. NEVER retries after BEGIN has been sent (preserves exact
 * one-attempt transactional semantics in apply-recorded-migration.mjs).
 */

export const PRE_DDL_LOCK_MAX_CHECKS = 3;
export const PRE_DDL_LOCK_INTERVAL_MS = 5_000;
export const PRE_DDL_LOCK_QUERY_TIMEOUT_MS = 2_000;

export const PRE_DDL_LOCK_CHECK_SQL = `
SELECT
  l.pid,
  l.relation::regclass::text AS relation,
  l.mode,
  COALESCE(a.wait_event_type, '') AS wait_event_type,
  COALESCE(a.wait_event, '') AS wait_event,
  COALESCE(a.state, '') AS state,
  COALESCE(a.backend_type, '') AS backend_type,
  COALESCE(a.application_name, '') AS application_name,
  EXTRACT(EPOCH FROM (clock_timestamp() - COALESCE(a.query_start, a.xact_start, clock_timestamp())))::integer AS age_seconds
FROM pg_catalog.pg_locks l
JOIN pg_catalog.pg_stat_activity a ON a.pid = l.pid
WHERE l.locktype = 'relation'
  AND l.database = (SELECT oid FROM pg_catalog.pg_database WHERE datname = current_database())
  AND l.relation = ANY(
    ARRAY(
      SELECT to_regclass(t)
      FROM unnest($1::text[]) AS t
      WHERE to_regclass(t) IS NOT NULL
    )
  )
  AND l.pid IS DISTINCT FROM pg_catalog.pg_backend_pid()
  AND l.granted = true
  AND (
    l.mode IN ('AccessExclusiveLock', 'ShareLock', 'ExclusiveLock')
    OR (a.backend_type = 'autovacuum worker' AND a.query ILIKE '%to prevent wraparound%')
    OR (
      l.mode = 'ShareUpdateExclusiveLock'
      AND a.state = 'active'
      AND a.query_start < clock_timestamp() - interval '5 seconds'
      AND (
        a.query ~* '^\\s*(ALTER|CREATE\\s+INDEX|REINDEX|VACUUM|CLUSTER)\\b'
        OR a.backend_type = 'autovacuum worker'
      )
    )
  )
ORDER BY l.pid, l.relation;
`.trim();

const NAME_RE = String.raw`((?:"?[A-Za-z_][A-Za-z0-9_$]*"?\.)?"?[A-Za-z_][A-Za-z0-9_$]*"?)`;
const SAFE_QUALIFIED = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

function qualifyTable(raw) {
  const clean = String(raw || '').replace(/"/g, '').trim().toLowerCase();
  if (!clean) return null;
  const full = clean.includes('.') ? clean : `public.${clean}`;
  if (full.startsWith('pg_temp.')) return null;
  return SAFE_QUALIFIED.test(full) ? full : null;
}

/**
 * Strip SQL comments, single-quoted string literals, and CREATE FUNCTION /
 * PROCEDURE bodies while descending into DO blocks so only install-time
 * table-locking DDL targets are returned.
 */
function installTimeDdlText(sql) {
  const s = String(sql);
  let out = '';
  let i = 0;
  let stmtStart = 0;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (c === '-' && n === '-') {
      const e = s.indexOf('\n', i);
      i = e < 0 ? s.length : e;
      continue;
    }
    if (c === '/' && n === '*') {
      const e = s.indexOf('*/', i + 2);
      i = e < 0 ? s.length : e + 2;
      out += ' ';
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      for (;;) {
        const k = s.indexOf("'", j);
        if (k < 0) {
          j = s.length;
          break;
        }
        if (s[k + 1] === "'") {
          j = k + 2;
          continue;
        }
        j = k + 1;
        break;
      }
      out += "''";
      i = j;
      continue;
    }
    if (c === '$' && !/[A-Za-z0-9_$]/.test(s[i - 1] ?? ' ')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const close = s.indexOf(tag, i + tag.length);
        const body = s.slice(i + tag.length, close < 0 ? s.length : close);
        const stmtHeader = out.slice(stmtStart).trim();
        if (/^DO\b/i.test(stmtHeader)) {
          out = out.slice(0, stmtStart) + ' ' + installTimeDdlText(body) + ';';
          stmtStart = out.length;
        } else if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i.test(stmtHeader)) {
          out = out.slice(0, stmtStart);
        } else {
          out += '$$';
        }
        i = close < 0 ? s.length : close + tag.length;
        continue;
      }
    }
    if (c === ';') stmtStart = out.length + 1;
    out += c;
    i++;
  }
  return out;
}

/**
 * Extract schema-qualified target tables that install-time DDL in `sql` will
 * alter or lock.
 */
export function extractLockTargetTables(sql) {
  const text = installTimeDdlText(sql);
  const targets = new Set();
  const add = (raw) => {
    const q = qualifyTable(raw);
    if (q) targets.add(q);
  };

  const singleTablePatterns = [
    new RegExp(`\\bALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?${NAME_RE}`, 'gi'),
    new RegExp(
      `\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:[A-Za-z0-9_"]+\\s+)?ON\\s+(?:ONLY\\s+)?${NAME_RE}`,
      'gi'
    ),
    new RegExp(
      `\\bCREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:CONSTRAINT\\s+)?TRIGGER\\s+[A-Za-z0-9_"]+\\s+(?:BEFORE|AFTER|INSTEAD\\s+OF)\\s+[^;]*?\\bON\\s+${NAME_RE}`,
      'gi'
    ),
    new RegExp(`\\bDROP\\s+TRIGGER\\s+(?:IF\\s+EXISTS\\s+)?[A-Za-z0-9_"]+\\s+ON\\s+${NAME_RE}`, 'gi'),
    new RegExp(`\\bREINDEX\\s+TABLE\\s+(?:CONCURRENTLY\\s+)?${NAME_RE}`, 'gi'),
    new RegExp(`\\bCLUSTER\\s+(?:VERBOSE\\s+)?${NAME_RE}`, 'gi'),
  ];
  for (const re of singleTablePatterns) {
    for (const m of text.matchAll(re)) add(m[1]);
  }

  // Multi-table statements: DROP TABLE ..., TRUNCATE [TABLE] ..., LOCK [TABLE] ...
  const multiPatterns = [
    /\bDROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+)/gi,
    /\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?([^;]+)/gi,
    /\bLOCK\s+(?:TABLE\s+)?(?:ONLY\s+)?([^;]+)/gi,
  ];
  for (const re of multiPatterns) {
    for (const m of text.matchAll(re)) {
      const head = m[1]
        .replace(/\b(?:IN\s+[A-Z ]+\s+MODE|NOWAIT|CASCADE|RESTRICT|RESTART\s+IDENTITY|CONTINUE\s+IDENTITY)\b[\s\S]*/i, '')
        .trim();
      for (const item of head.split(',')) {
        const nm = new RegExp(`^(?:ONLY\\s+)?${NAME_RE}$`, 'i').exec(item.trim());
        if (nm) add(nm[1]);
      }
    }
  }

  return [...targets];
}

function formatBlocker(row) {
  const wait =
    row.wait_event_type || row.wait_event
      ? `${row.wait_event_type || 'none'}:${row.wait_event || 'none'}`
      : 'none';
  return (
    `pid=${row.pid} relation=${row.relation} mode=${row.mode} ` +
    `wait_event=${wait} state=${row.state || 'unknown'} backend=${row.backend_type || 'unknown'} ` +
    `age=${row.age_seconds ?? 0}s`
  );
}

/**
 * Check for active conflicting locks on target tables before opening BEGIN.
 * Bounded to at most `maxChecks` checks x `intervalMs` wait (default 3 x 5s = 15s).
 */
export async function waitForPreDdlLocks(client, sql, opts = {}) {
  const targetTables = extractLockTargetTables(sql);
  if (targetTables.length === 0) {
    return {
      checked: false,
      cleared: true,
      checks: 0,
      waitedMs: 0,
      targetTables: [],
      blockers: [],
    };
  }

  const maxChecks = Math.max(
    1,
    Math.min(PRE_DDL_LOCK_MAX_CHECKS, Number(opts.maxChecks ?? PRE_DDL_LOCK_MAX_CHECKS))
  );
  const intervalMs = Math.max(
    0,
    Math.min(PRE_DDL_LOCK_INTERVAL_MS, Number(opts.intervalMs ?? PRE_DDL_LOCK_INTERVAL_MS))
  );
  const queryTimeoutMs = Number(opts.queryTimeoutMs ?? PRE_DDL_LOCK_QUERY_TIMEOUT_MS);
  const log = opts.log ?? ((msg) => console.log(msg));
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  let waitedMs = 0;
  let lastBlockers = [];

  for (let check = 1; check <= maxChecks; check++) {
    let rows;
    try {
      const res = await client.query({
        text: PRE_DDL_LOCK_CHECK_SQL,
        values: [targetTables],
        query_timeout: queryTimeoutMs,
      });
      rows = Array.isArray(res?.rows) ? res.rows : [];
    } catch (e) {
      log(
        `[apply] pre-DDL lock check skipped (${e?.message || 'query failed'}); proceeding with single transaction attempt`
      );
      return {
        checked: true,
        cleared: false,
        checks: check,
        waitedMs,
        targetTables,
        blockers: lastBlockers,
        error: e?.message || String(e),
      };
    }

    if (rows.length === 0) {
      if (check > 1) {
        log(
          `[apply] pre-DDL lock contention cleared after ${waitedMs}ms (${check - 1} wait(s)); opening single transaction`
        );
      }
      return {
        checked: true,
        cleared: true,
        checks: check,
        waitedMs,
        targetTables,
        blockers: [],
      };
    }

    lastBlockers = rows;
    log(
      `[apply] pre-DDL lock contention check ${check}/${maxChecks} on [${targetTables.join(', ')}]: ` +
        `${rows.map(formatBlocker).join('; ')} — backing off ${intervalMs}ms before BEGIN`
    );
    await sleep(intervalMs);
    waitedMs += intervalMs;
  }

  log(
    `[apply] pre-DDL lock contention persisted after ${maxChecks} checks (${waitedMs}ms max); ` +
      `proceeding to single transaction attempt (database lock_timeout will enforce): ` +
      lastBlockers.map(formatBlocker).join('; ')
  );
  return {
    checked: true,
    cleared: false,
    checks: maxChecks,
    waitedMs,
    targetTables,
    blockers: lastBlockers,
  };
}
