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
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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

export const REHEARSAL_SCHEMA_ONLY_EXEMPT_RE =
  /^[ \t]*--[ \t]*@rehearsal-schema-only-exempt:[ \t]*(.+)$/im;

/**
 * Return the trimmed justification when a migration explicitly declares
 * `-- @rehearsal-schema-only-exempt: <reason >= 20 chars>` because its
 * install-time DO block genuinely depends on live production rows absent from
 * a schema-only restore. Returns null if absent or shorter than 20 chars.
 */
export function rehearsalSchemaOnlyExemptReason(sql) {
  const m = REHEARSAL_SCHEMA_ONLY_EXEMPT_RE.exec(String(sql));
  if (!m) return null;
  const reason = m[1].trim();
  return reason.length >= 20 ? reason : null;
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

export const HOT_TABLES = Object.freeze([
  'hand_history',
  'chip_ledger',
  'diamonds_ledger',
  'table_seats',
  'tournaments',
]);

export const HOT_TABLE_ROW_THRESHOLD = 50_000;
const ALLOWED_STATS_SCHEMAS = new Set(['public', 'smarter_private']);
const SAFE_PG_IDENT = /^[a-z_][a-z0-9_]*$/;
const DEFAULT_BYTES_PER_PAGE = 8192;

/**
 * Parse and validate non-sensitive table cardinality metadata captured from
 * pg_stat_user_tables + pg_class. Malformed or unsafe identifiers are dropped.
 */
export function parseTableStats(raw) {
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const schemaname = String(row.schemaname ?? '').trim();
    const relname = String(row.relname ?? '').trim();
    if (!ALLOWED_STATS_SCHEMAS.has(schemaname) || !SAFE_PG_IDENT.test(relname)) continue;
    const estRows = Math.max(0, Math.floor(Number(row.est_rows ?? 0) || 0));
    const relBytes = Math.max(0, Math.floor(Number(row.rel_bytes ?? 0) || 0));
    const rawPages = Number(row.rel_pages ?? 0);
    const relPages =
      Number.isFinite(rawPages) && rawPages > 0
        ? Math.floor(rawPages)
        : relBytes > 0
          ? Math.max(1, Math.round(relBytes / DEFAULT_BYTES_PER_PAGE))
          : estRows > 0
            ? Math.max(1, Math.ceil(estRows / 100))
            : 0;
    out.push({
      schemaname,
      relname,
      est_rows: estRows,
      rel_bytes: relBytes,
      rel_pages: relPages,
    });
  }
  return out;
}

/**
 * Emit idempotent SQL that seeds pg_catalog.pg_class.reltuples and relpages in
 * the throwaway rehearsal database so EXPLAIN chooses production-scale plans.
 */
export function seedTableStatsSQL(stats) {
  const rows = Array.isArray(stats) ? stats : [];
  const linesOut = ['BEGIN;'];
  for (const row of rows) {
    if (!ALLOWED_STATS_SCHEMAS.has(row.schemaname) || !SAFE_PG_IDENT.test(row.relname)) continue;
    if (!(row.est_rows > 0)) continue;
    const pages = Math.max(
      1,
      Math.floor(
        row.rel_pages && row.rel_pages > 0
          ? row.rel_pages
          : row.rel_bytes > 0
            ? Math.round(row.rel_bytes / DEFAULT_BYTES_PER_PAGE)
            : Math.ceil(row.est_rows / 100)
      )
    );
    linesOut.push(
      `UPDATE pg_catalog.pg_class c SET reltuples = ${Math.floor(row.est_rows)}::real, relpages = ${pages}::integer ` +
        `FROM pg_catalog.pg_namespace n WHERE c.relnamespace = n.oid AND n.nspname = '${row.schemaname}' ` +
        `AND c.relname = '${row.relname}' AND c.relkind IN ('r', 'p', 'm');`
    );
  }
  linesOut.push('COMMIT;');
  return linesOut.join('\n') + '\n';
}

/**
 * Iteratively strip leading PL/pgSQL block and control-flow headers so DML/DDL
 * statements nested inside DO blocks (DECLARE/BEGIN/IF/ELSIF/ELSE/FOR/LOOP/
 * EXCEPTION/WHEN) are exposed cleanly.
 */
export function stripPlpgsqlHeaders(rawStmt) {
  let stmt = String(rawStmt || '').trim();
  for (;;) {
    const next = stmt
      .replace(/^<<[A-Za-z_][A-Za-z0-9_]*>>\s*/i, '')
      .replace(/^DECLARE\b[^;]*;\s*/i, '')
      .replace(/^DECLARE\b\s+(?=BEGIN\b)/i, '')
      .replace(/^(?:BEGIN|ELSE|LOOP|EXCEPTION)\b\s*/i, '')
      .replace(/^(?:IF|ELSIF|WHEN)\b[\s\S]*?\bTHEN\b\s*/i, '')
      .replace(/^FOR\b[\s\S]*?\bLOOP\b\s*/i, '')
      .trim();
    if (next === stmt) break;
    stmt = next;
  }
  return stmt;
}

function collectPlpgsqlVars(body) {
  const vars = new Set();
  const declMatch = /\bDECLARE\b([\s\S]*?)\bBEGIN\b/i.exec(body);
  if (declMatch) {
    for (const part of declMatch[1].split(';')) {
      const m = /^\s*([a-z_][a-z0-9_]*)\s+[a-z_]/i.exec(part);
      if (m && !/^(?:BEGIN|IF|END|DECLARE|CONSTANT|ALIAS)$/i.test(m[1])) {
        vars.add(m[1].toLowerCase());
      }
    }
  }
  for (const m of body.matchAll(/\bFOR\s+([a-z_][a-z0-9_]*)\s+IN\b/gi)) {
    vars.add(m[1].toLowerCase());
  }
  return vars;
}

/**
 * Strip SQL comments while keeping single-quoted and dollar-quoted literals
 * intact, and split into top-level semicolon-terminated statements.
 */
function splitSqlStatementsPreservingQuotes(sql) {
  const s = String(sql);
  const stmts = [];
  let cur = '';
  let i = 0;
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
      cur += ' ';
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
      cur += s.slice(i, j);
      i = j;
      continue;
    }
    if (c === '$' && !/[A-Za-z0-9_$]/.test(s[i - 1] ?? ' ')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(s.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const close = s.indexOf(tag, i + tag.length);
        const end = close < 0 ? s.length : close + tag.length;
        cur += s.slice(i, end);
        i = end;
        continue;
      }
    }
    if (c === ';') {
      const trimmed = cur.trim();
      if (trimmed) stmts.push(trimmed);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

/**
 * Extract the dollar-quoted body of a `DO [LANGUAGE ...] $tag$ ... $tag$`
 * statement, or null if `stmt` is not a dollar-quoted DO block.
 */
function extractDoBlockBody(stmt) {
  if (!/^DO\b/i.test(stmt)) return null;
  let i = 0;
  while (i < stmt.length) {
    if (stmt[i] === "'") {
      let j = i + 1;
      for (;;) {
        const k = stmt.indexOf("'", j);
        if (k < 0) return null;
        if (stmt[k + 1] === "'") {
          j = k + 2;
          continue;
        }
        i = k + 1;
        break;
      }
      continue;
    }
    if (stmt[i] === '$' && !/[A-Za-z0-9_$]/.test(stmt[i - 1] ?? ' ')) {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(stmt.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const close = stmt.indexOf(tag, i + tag.length);
        return stmt.slice(i + tag.length, close < 0 ? stmt.length : close);
      }
    }
    i++;
  }
  return null;
}

/**
 * Extract install-time SELECT / UPDATE / DELETE / INSERT (including CTE WITH ...)
 * statements targeting any table in `hotTablesSet`, along with preceding DDL
 * statements from the same migration so EXPLAIN sees newly created columns,
 * indexes, tables, or helper functions inside a rolled-back transaction.
 */
export function extractHotTableInstallStatements(sql, hotTablesSet = new Set(HOT_TABLES)) {
  const found = [];
  const precedingDdl = [];

  const visit = (chunk, fromDoBlock, inheritedVars) => {
    const stmts = splitSqlStatementsPreservingQuotes(chunk);
    for (const rawStmt of stmts) {
      const trimmed = rawStmt.trim();
      if (!trimmed) continue;

      const doBody = extractDoBlockBody(trimmed);
      if (doBody !== null) {
        const blockVars = new Set([...inheritedVars, ...collectPlpgsqlVars(doBody)]);
        visit(doBody, true, blockVars);
        continue;
      }

      const stmt = stripPlpgsqlHeaders(trimmed);
      if (!stmt) continue;

      if (/^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i.test(stmt)) {
        // Keep function/procedure definition as preceding DDL (without scanning its body).
        precedingDdl.push(stmt);
        continue;
      }

      if (/^(?:CREATE|ALTER|DROP|COMMENT|GRANT|REVOKE)\b/i.test(stmt)) {
        precedingDdl.push(stmt);
        continue;
      }

      if (!/^(?:WITH|SELECT|UPDATE|DELETE|INSERT)\b/i.test(stmt)) continue;
      if (/^SELECT\s+set_config\s*\(/i.test(stmt)) continue;

      const matched = [];
      for (const tbl of hotTablesSet) {
        const re = new RegExp(
          `(?:\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(?:ONLY\\s+)?(?:(?:public|smarter_private)\\s*\\.\\s*)?"?${tbl}"?\\b)`,
          'i'
        );
        if (re.test(stmt)) matched.push(tbl);
      }
      if (matched.length > 0) {
        found.push({
          statement: stmt,
          tables: matched,
          precedingDdl: [...precedingDdl],
          fromDoBlock,
          declaredVars: [...inheritedVars],
        });
      }
    }
  };

  visit(sql, false, new Set());
  return found;
}

/**
 * True when the migration carries an explicit `-- @probe-exempt` covering
 * `tableName` (or a general/query-plan exemption, not an unrelated function
 * exemption like `-- @probe-exempt: public.fn_other ...`).
 */
export function isHotTablePlanExempt(sql, tableName) {
  const linesList = String(sql).split('\n');
  const tbl = String(tableName || '').toLowerCase();
  for (const rawLine of linesList) {
    const m = /^--[ \t]*@probe-exempt(?::[ \t]*(.*))?$/i.exec(rawLine.trim());
    if (!m) continue;
    const rest = (m[1] ?? '').trim().toLowerCase();
    if (!rest) return true;
    if (tbl && new RegExp(`\\b${tbl}\\b`).test(rest)) return true;
    if (/\b(query-plan|seq-scan|hot-table)\b/.test(rest)) return true;
    // If it explicitly names a function (public.fn_* / smarter_private.fn_*),
    // treat it as scoped to that function probe rather than hot-table plans.
    if (/^(?:public|smarter_private)\.[a-z0-9_]+\b/.test(rest)) continue;
    return true;
  }
  return false;
}

/**
 * Walk a PostgreSQL EXPLAIN (FORMAT JSON) output and return every Seq Scan
 * targeting a high-cardinality hot table (est_rows >= HOT_TABLE_ROW_THRESHOLD).
 */
export function analyzeExplainPlan(explainJson, hotTableStats) {
  const findings = [];
  const lookup =
    hotTableStats instanceof Map
      ? hotTableStats
      : new Map(
          (Array.isArray(hotTableStats) ? hotTableStats : []).map((r) => [
            String(r.relname).toLowerCase(),
            r,
          ])
        );
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node.Plan) walk(node.Plan);
    const nodeType = node['Node Type'];
    const relName = typeof node['Relation Name'] === 'string' ? node['Relation Name'].toLowerCase() : null;
    if (nodeType === 'Seq Scan' && relName) {
      const stat = lookup.get(relName);
      if (stat && Number(stat.est_rows) >= HOT_TABLE_ROW_THRESHOLD) {
        findings.push({
          table: relName,
          schema: node.Schema ?? stat.schemaname ?? 'public',
          estRows: Number(stat.est_rows),
          nodeType,
          filter: node.Filter ?? null,
          totalCost: node['Total Cost'] ?? null,
          planRows: node['Plan Rows'] ?? null,
        });
      }
    }
    if (Array.isArray(node.Plans)) {
      for (const child of node.Plans) walk(child);
    }
  };
  walk(explainJson);
  return findings;
}

/**
 * True when an EXPLAIN failure is strictly caused by an unbound PL/pgSQL local
 * variable, SELECT ... INTO target, or positional parameter ($1) inside a DO
 * block — as opposed to a real SQL/schema error that must be surfaced visibly.
 */
export function isPlpgsqlVariableExplainError(
  error,
  { fromDoBlock = false, declaredVars = [], statement = '' } = {}
) {
  const msg = String(error || '');
  if (!msg) return false;
  if (/there is no parameter \$\d+/i.test(msg)) return true;
  if (!fromDoBlock) return false;
  if (/\bINTO\b/i.test(statement) && /syntax error at or near "INTO"/i.test(msg)) return true;
  const varSet = new Set((declaredVars || []).map((v) => String(v).toLowerCase()));
  const colMatch = /column "([^"]+)" does not exist/i.exec(msg);
  if (colMatch && varSet.has(colMatch[1].toLowerCase())) return true;
  const tblMatch = /missing FROM-clause entry for table "([^"]+)"/i.exec(msg);
  if (tblMatch && varSet.has(tblMatch[1].toLowerCase())) return true;
  const recMatch = /record "([^"]+)" is not assigned yet/i.exec(msg);
  if (recMatch && varSet.has(recMatch[1].toLowerCase())) return true;
  return false;
}

/**
 * Build the rolled-back SQL script that executes same-migration preceding DDL
 * (normalizing CREATE INDEX CONCURRENTLY so it can run inside a transaction)
 * before running EXPLAIN (FORMAT JSON) on the target statement.
 */
export function buildExplainSql(statement, precedingDdl = []) {
  const linesOut = ['BEGIN;', 'SET LOCAL client_min_messages = warning;'];
  for (const ddl of precedingDdl || []) {
    const normalized = String(ddl)
      .trim()
      .replace(/;+$/, '')
      .replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i, 'CREATE $1INDEX');
    if (normalized) linesOut.push(`${normalized};`);
  }
  linesOut.push('SET LOCAL enable_seqscan = off;');
  linesOut.push(`EXPLAIN (FORMAT JSON) ${String(statement).trim().replace(/;+$/, '')};`);
  linesOut.push('ROLLBACK;');
  return linesOut.join('\n') + '\n';
}

/**
 * Evaluate install-time statements in a single migration against production
 * row-scale stats using `runExplain(statement, file, ctx) => plan | { plan, error } | null`.
 */
export function evaluateHotTablePlans(file, sql, stats, runExplain) {
  const highCardHot = new Map();
  for (const row of stats) {
    const rel = String(row.relname).toLowerCase();
    if (HOT_TABLES.includes(rel) && Number(row.est_rows) >= HOT_TABLE_ROW_THRESHOLD) {
      highCardHot.set(rel, row);
    }
  }
  if (highCardHot.size === 0) {
    return {
      ok: true,
      file,
      checkedStatements: 0,
      skippedExempt: 0,
      skippedVariableExplain: 0,
      violations: [],
      explainErrors: [],
    };
  }
  const candidates = extractHotTableInstallStatements(sql, new Set(highCardHot.keys()));
  const violations = [];
  const explainErrors = [];
  let checkedStatements = 0;
  let skippedExempt = 0;
  let skippedVariableExplain = 0;
  for (const { statement, tables, precedingDdl, fromDoBlock, declaredVars } of candidates) {
    if (tables.every((t) => isHotTablePlanExempt(sql, t))) {
      skippedExempt++;
      continue;
    }
    checkedStatements++;
    const rawResult = runExplain(statement, file, { precedingDdl, fromDoBlock, declaredVars });
    const plan = Array.isArray(rawResult)
      ? rawResult
      : rawResult && typeof rawResult === 'object' && 'plan' in rawResult
        ? rawResult.plan
        : null;
    const error =
      rawResult && typeof rawResult === 'object' && 'error' in rawResult ? rawResult.error : null;
    if (!plan) {
      if (error) {
        if (isPlpgsqlVariableExplainError(error, { fromDoBlock, declaredVars, statement })) {
          skippedVariableExplain++;
        } else {
          explainErrors.push({
            file,
            tables,
            error: String(error).trim(),
            statement: statement.replace(/\s+/g, ' ').slice(0, 240),
          });
        }
      }
      continue;
    }
    for (const hit of analyzeExplainPlan(plan, highCardHot)) {
      if (isHotTablePlanExempt(sql, hit.table)) continue;
      violations.push({
        file,
        ...hit,
        statement: statement.replace(/\s+/g, ' ').slice(0, 240),
      });
    }
  }
  return {
    ok: violations.length === 0,
    file,
    checkedStatements,
    skippedExempt,
    skippedVariableExplain,
    violations,
    explainErrors,
  };
}

function runExplainViaPsql(psqlArgv, statement, precedingDdl = []) {
  // On a schema-only restore (0 physical heap blocks), Postgres's planner
  // scales reltuples by RelationGetNumberOfBlocks() = 0 unless seqscan is
  // discouraged. Setting enable_seqscan = off inside the rolled-back EXPLAIN
  // transaction forces Postgres to pick any usable index and fall back to
  // Seq Scan ONLY when no selective index can answer the predicate.
  const explainSql = buildExplainSql(statement, precedingDdl);
  const res = spawnSync(psqlArgv[0], [...psqlArgv.slice(1), '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
    input: explainSql,
    encoding: 'utf8',
    timeout: 15_000,
  });
  if (res.status !== 0) {
    return {
      plan: null,
      error: (res.stderr || res.stdout || `psql exited with status ${res.status}`).trim(),
    };
  }
  const trimmed = (res.stdout || '').trim();
  if (!trimmed) {
    return { plan: null, error: 'EXPLAIN produced empty output' };
  }
  try {
    return { plan: JSON.parse(trimmed), error: null };
  } catch (err) {
    return {
      plan: null,
      error: `invalid EXPLAIN JSON output: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// CLI:
//   node scripts/ci/window-queue-rehearsal.mjs plan <migrations-dir> <installed-versions-file> [changed-names-file]
//   node scripts/ci/window-queue-rehearsal.mjs sql <migrations-dir> <file>
//   node scripts/ci/window-queue-rehearsal.mjs seed-stats <table-stats.json>
//   node scripts/ci/window-queue-rehearsal.mjs check-plans <migrations-dir> <table-stats.json> (<changed-names-file> | --file <name>)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, dir, a, b, c] = process.argv.slice(2);
  if (cmd === 'plan') {
    const installed = new Set(lines(a).filter((v) => /^\d{14}$/.test(v)));
    const changed = new Set(b ? lines(b).map((p) => p.replace(/^supabase\/migrations\//, '')) : []);
    process.stdout.write(
      JSON.stringify(planRehearsal(readTree(dir), installed, changed, evidenceFromEnv())) + '\n'
    );
  } else if (cmd === 'sql') {
    process.stdout.write(rehearsalSQL(a, readFileSync(join(dir, a), 'utf8')));
  } else if (cmd === 'schema-only-exempt') {
    const reason = rehearsalSchemaOnlyExemptReason(readFileSync(join(dir, a), 'utf8'));
    if (reason) process.stdout.write(reason + '\n');
  } else if (cmd === 'seed-stats') {
    const stats = parseTableStats(readFileSync(dir, 'utf8'));
    process.stdout.write(seedTableStatsSQL(stats));
  } else if (cmd === 'check-plans') {
    const stats = parseTableStats(readFileSync(a, 'utf8'));
    const singleMode = b === '--file';
    const changedNames = singleMode
      ? [String(c || '').trim().replace(/^supabase\/migrations\//, '')].filter(Boolean)
      : lines(b).map((p) => p.replace(/^supabase\/migrations\//, ''));
    const psqlStr = (process.env.REHEARSAL_PSQL || '').trim();
    if (!psqlStr) {
      console.error('REHEARSAL_PSQL is required for check-plans');
      process.exit(2);
    }
    const psqlArgv = psqlStr.split(/\s+/);
    const reports = [];
    const allViolations = [];
    const allExplainErrors = [];
    for (const name of changedNames) {
      if (!MIGRATION_FILE.test(name)) continue;
      const fullPath = join(dir, name);
      if (!existsSync(fullPath)) continue;
      const sql = readFileSync(fullPath, 'utf8');
      const rep = evaluateHotTablePlans(name, sql, stats, (stmt, _file, ctx) =>
        runExplainViaPsql(psqlArgv, stmt, ctx?.precedingDdl ?? [])
      );
      reports.push(rep);
      allViolations.push(...rep.violations);
      allExplainErrors.push(...rep.explainErrors);
    }
    if (process.env.EVIDENCE) {
      mkdirSync(process.env.EVIDENCE, { recursive: true });
      const jsonPath = join(process.env.EVIDENCE, 'hot-table-plans.json');
      let existing = { statsCount: stats.length, reports: [], violations: [], explainErrors: [] };
      if (singleMode && existsSync(jsonPath)) {
        try {
          const prev = JSON.parse(readFileSync(jsonPath, 'utf8'));
          if (prev && typeof prev === 'object') {
            existing = {
              statsCount: stats.length,
              reports: Array.isArray(prev.reports) ? prev.reports : [],
              violations: Array.isArray(prev.violations) ? prev.violations : [],
              explainErrors: Array.isArray(prev.explainErrors) ? prev.explainErrors : [],
            };
          }
        } catch {
          // Ignore malformed prior JSON and overwrite cleanly.
        }
      }
      writeFileSync(
        jsonPath,
        JSON.stringify(
          {
            statsCount: stats.length,
            reports: [...existing.reports, ...reports],
            violations: [...existing.violations, ...allViolations],
            explainErrors: [...existing.explainErrors, ...allExplainErrors],
          },
          null,
          2
        ) + '\n'
      );
    }
    for (const e of allExplainErrors) {
      console.error(
        `[hot-table-plan] EXPLAIN-ERROR ${e.file} (${e.tables.join(', ')}): ${e.error} — ${e.statement}`
      );
    }
    if (allViolations.length > 0) {
      for (const v of allViolations) {
        console.error(
          `[hot-table-plan] REFUSED ${v.file}: Seq Scan on high-cardinality hot table ${v.schema}.${v.table} ` +
            `(est_rows=${v.estRows} >= ${HOT_TABLE_ROW_THRESHOLD}) without selective index or -- @probe-exempt: ${v.statement}`
        );
      }
      process.exit(1);
    }
    const errSuffix =
      allExplainErrors.length > 0
        ? ` (${allExplainErrors.length} non-variable EXPLAIN error(s) — see log)`
        : '';
    console.log(
      `[hot-table-plan] OK: ${reports.reduce((acc, r) => acc + r.checkedStatements, 0)} install-time hot-table statement(s) checked against ${stats.length} table stat(s); 0 Seq Scan violations${errSuffix}.`
    );
  } else {
    console.error(
      'usage: window-queue-rehearsal.mjs plan <dir> <installed> [changed] | sql <dir> <file> | seed-stats <stats.json> | check-plans <dir> <stats.json> (<changed> | --file <name>)'
    );
    process.exit(2);
  }
}
