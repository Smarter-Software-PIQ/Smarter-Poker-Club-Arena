/**
 * AN OFFLINE MIGRATION MAY DECLARE A LONGER INSTALL BUDGET (2026-11-07).
 *
 * apply-recorded-migration.mjs runs every ordinary migration under
 * transaction_timeout = TRANSACTION_BUDGET_SECONDS + 4 (12 s). That bound is
 * there because on 2026-11-02 an ordinary install's membership UPDATE held a
 * payout row for 22.7 s and live writers queued behind it: anything an
 * install locks, a live writer may be waiting on. That protection stays,
 * exactly as it was, for every file that does not say otherwise.
 *
 * On 2026-11-07 the V31 v2 SQL chain (20261108011659) was refused three times
 * by that 12 s bound (25P04 at ~12.3 s) although everything it writes is an
 * offline certification/solver store that no live writer ever waits on. The
 * owner's instruction (2026-11-07 21:14 CT): change the limit, safely.
 *
 * So a migration may DECLARE a larger budget, on its own line:
 *
 *   -- @install-budget-seconds: <n>        13 <= n <= INSTALL_BUDGET_CAP_SECONDS
 *
 * and it is admitted ONLY when, read statically,
 *   - every relation it writes, alters, locks or validates is public.gto_v31_*
 *     or public.solver_* (OFFLINE_RELATION_PREFIXES),
 *   - every function it creates, replaces, alters, drops, grants or comments
 *     is a public function named by OFFLINE_FUNCTION_PREFIXES,
 *   - it opens with SET LOCAL lock_timeout <= 2 s right after BEGIN; and never
 *     raises, disables or resets it, so it can never queue behind live writers,
 *   - it uses none of the statements this reader cannot judge (DROP ...
 *     CASCADE, row locks via FOR UPDATE/SHARE, ALTER DOMAIN/EXTENSION/ROLE,
 *     ...), and
 *   - it is new enough (PIN_CHECKED_FROM) to carry the stale-pin function
 *     snapshot the runtime check below reads.
 * The static reader scans the whole file - function bodies, DO blocks and
 * nested bodies included - with the lexer the repository's other migration
 * guards use (stripNoise, stripComments) and the window installer's lock
 * reader (lockTargets).
 *
 * Dynamic SQL (EXECUTE) and functions called at install time cannot be read
 * statically, so the installer also splices offlineScopeCheckSQL() into the
 * transaction, right before the history row and COMMIT: if this transaction
 * holds any lock stronger than ACCESS SHARE on a relation outside the
 * allowlist, or changed/created a function outside it, the install raises and
 * rolls back. Advisory locks are not judged: the file's own lock_timeout bounds
 * any wait for one, and the V31 functions key theirs by V31-only strings.
 * Anything else keeps exactly 12 s.
 */
import { stripNoise, QUALIFIED } from './check-unqualified-writes.mjs';
import { stripComments } from './check-money-trigger-declared.mjs';
import {
  lockTargets,
  durationMs,
  TRANSACTION_BUDGET_SECONDS,
} from './maintenance-window-migrations.mjs';
import { isPinChecked, PIN_CHECKED_FROM } from './migration-stale-pins.mjs';

export const INSTALL_BUDGET_ANNOTATION = '-- @install-budget-seconds:';
/** The ordinary budget every undeclared file keeps: 12 s. */
export const DEFAULT_INSTALL_BUDGET_MS = (TRANSACTION_BUDGET_SECONDS + 4) * 1000;
/** The hard cap on a declared budget. */
export const INSTALL_BUDGET_CAP_SECONDS = 60;
/** A declared file must wait at most this long for any lock. */
export const OFFLINE_LOCK_TIMEOUT_MAX_MS = 2000;
/** Relations (schema public) no live writer waits on. */
export const OFFLINE_RELATION_PREFIXES = Object.freeze(['gto_v31_', 'solver_']);
/**
 * Public functions an offline install may define or replace. The last entry is
 * the public215 branch of the V31 solver-agreement validator: owner-only, it is
 * patched by the v2 chain, and replacing a function body takes no lock a live
 * writer waits on.
 */
export const OFFLINE_FUNCTION_PREFIXES = Object.freeze([
  'fn_gto_v31_',
  'fn_solver_',
  'ca_gto_v31_',
  'fn_horse_solver_agreement_v31_public215_',
]);

const DECLARATION_LINE = /^[ \t]*--[ \t]*@install-budget-seconds\b(.*)$/gim;

/**
 * The declared budget in seconds, or null when the file declares none.
 * Throws on a malformed, repeated, pointless (<= 12 s) or over-cap declaration.
 */
export function declaredInstallBudgetSeconds(sql) {
  const lines = [...String(sql).matchAll(DECLARATION_LINE)];
  if (lines.length === 0) return null;
  if (lines.length > 1)
    throw new Error('install budget declared more than once; declare it on exactly one line');
  const m = /^:[ \t]*(\d+)[ \t]*$/.exec(lines[0][1]);
  if (!m)
    throw new Error(
      `malformed install budget declaration "${lines[0][0].trim()}"; write "${INSTALL_BUDGET_ANNOTATION} <whole seconds>"`
    );
  const seconds = Number(m[1]);
  if (seconds * 1000 <= DEFAULT_INSTALL_BUDGET_MS)
    throw new Error(
      `install budget ${seconds} s is not above the ordinary ${DEFAULT_INSTALL_BUDGET_MS / 1000} s; remove the declaration`
    );
  if (seconds > INSTALL_BUDGET_CAP_SECONDS)
    throw new Error(
      `install budget ${seconds} s exceeds the hard cap of ${INSTALL_BUDGET_CAP_SECONDS} s`
    );
  return seconds;
}

const nameParts = (qualified) =>
  qualified
    .split(/\s*\.\s*/)
    .map((p) => (p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p.toLowerCase()));

/** 'schema.name' for a written name; unqualified names are judged as public. */
function relationName(qualified) {
  const parts = nameParts(qualified.trim());
  if (parts.length === 1) return `public.${parts[0]}`;
  return parts.slice(-2).join('.');
}

export const isOfflineRelation = (relation) => {
  const [schema, name] = relation.split('.');
  return schema === 'public' && OFFLINE_RELATION_PREFIXES.some((p) => name.startsWith(p));
};
export const isOfflineFunction = (fn) => {
  const [schema, name] = fn.split('.');
  return schema === 'public' && OFFLINE_FUNCTION_PREFIXES.some((p) => name.startsWith(p));
};

/** The comma-separated items of `list` at parenthesis depth 0. */
function topLevelItems(list) {
  const items = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim()) items.push(current);
  return items;
}
/** The leading qualified name of one list item (a relation or a function signature). */
function leadingName(item) {
  const m = new RegExp(String.raw`^\s*(${QUALIFIED})`, 'i').exec(item);
  return m ? m[1] : null;
}

// Constructs whose reach this reader cannot bound. A declared file using one is
// refused; an undeclared file is untouched by this module.
const UNJUDGED = [
  [/\bDROP\b[^;]*\bCASCADE\b/i, 'DROP ... CASCADE (it can drop dependents on live tables)'],
  [/\bTRUNCATE\b[^;]*\bCASCADE\b/i, 'TRUNCATE ... CASCADE'],
  [
    /\bFOR\s+(?:NO\s+KEY\s+UPDATE|UPDATE|KEY\s+SHARE|SHARE)\b/i,
    'row locks (FOR UPDATE / FOR SHARE)',
  ],
  [
    /\b(?:CREATE|ALTER|DROP)\s+(?:DOMAIN|EXTENSION|SCHEMA|ROLE|USER|GROUP|PUBLICATION|SUBSCRIPTION|EVENT\s+TRIGGER|SERVER|FOREIGN\s+DATA\s+WRAPPER|TABLESPACE|DATABASE|COLLATION|CONVERSION|OPERATOR|CAST|AGGREGATE|LANGUAGE|TEXT\s+SEARCH|STATISTICS|ACCESS\s+METHOD|TRANSFORM)\b/i,
    'DDL outside tables, views, sequences, indexes, types and functions',
  ],
  [
    /\bALTER\s+(?:DEFAULT\s+PRIVILEGES|SYSTEM|LARGE\s+OBJECT)\b/i,
    'ALTER DEFAULT PRIVILEGES / SYSTEM',
  ],
  [/\b(?:REASSIGN|DROP)\s+OWNED\b/i, 'REASSIGN / DROP OWNED'],
  [/\bSECURITY\s+LABEL\b/i, 'SECURITY LABEL'],
  [/\b(?:VACUUM|CLUSTER|REINDEX)\b/i, 'VACUUM / CLUSTER / REINDEX'],
  [
    /\bON\s+ALL\s+(?:TABLES|SEQUENCES|FUNCTIONS|PROCEDURES|ROUTINES)\b/i,
    'GRANT/REVOKE ON ALL ... IN SCHEMA',
  ],
  [/\b(?:ROLLBACK|SAVEPOINT|START\s+TRANSACTION)\b/i, 'its own transaction control'],
];

/**
 * What a file writes, alters, locks or validates, read statically.
 * @returns {{ relations: string[], functions: string[], unjudged: string[] }}
 */
export function installTouches(sql) {
  // Literals and comments gone; every dollar-quoted body (function, DO, nested)
  // kept and flattened so its statements are read like top-level ones.
  const code = stripNoise(sql).replace(/\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/g, ' ; ');
  const relations = new Set(lockTargets(code).map((t) => t.relation));
  const functions = new Set();
  const unjudged = UNJUDGED.filter(([re]) => re.test(code)).map(([, why]) => why);
  const Q = `(${QUALIFIED})`;
  const each = (src, fn) => {
    for (const m of code.matchAll(new RegExp(src, 'gi'))) fn(m);
  };
  const rel = (name) => relations.add(relationName(name));
  const relList = (list) =>
    topLevelItems(list).forEach((item) => {
      const n = leadingName(item);
      if (n) rel(n);
    });
  const fnList = (list) =>
    topLevelItems(list).forEach((item) => {
      const n = leadingName(item);
      if (n) functions.add(relationName(n));
    });

  // Data writes.
  each(String.raw`\bINSERT\s+INTO\s+${Q}`, (m) => rel(m[1]));
  each(
    String.raw`\bUPDATE\s+(?:ONLY\s+)?${Q}(?:\s+(?:AS\s+)?[A-Za-z_][A-Za-z0-9_]*)?\s+SET\b`,
    (m) => rel(m[1])
  );
  each(String.raw`\bDELETE\s+FROM\s+(?:ONLY\s+)?${Q}`, (m) => rel(m[1]));
  each(String.raw`\bMERGE\s+INTO\s+(?:ONLY\s+)?${Q}`, (m) => rel(m[1]));
  each(String.raw`\bCOPY\s+${Q}`, (m) => rel(m[1]));
  each(String.raw`\bTRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?([^;]*)`, (m) =>
    relList(m[1].replace(/\b(?:RESTART|CONTINUE)\s+IDENTITY\b|\bRESTRICT\b/gi, ''))
  );
  each(String.raw`\bREFRESH\s+MATERIALIZED\s+VIEW\s+(?:CONCURRENTLY\s+)?${Q}`, (m) => rel(m[1]));
  each(String.raw`\bANALY[SZ]E\s+(?:\([^)]*\)\s*|VERBOSE\s+)?([^;]*)`, (m) => relList(m[1]));
  // Relation DDL the lock reader does not list.
  each(
    String.raw`\bCREATE\s+(?:(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP|TEMPORARY)\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${Q}`,
    (m) => {
      if (!/\b(?:TEMP|TEMPORARY)\s+TABLE/i.test(m[0])) rel(m[1]);
    }
  );
  each(
    String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP\s+|TEMPORARY\s+|RECURSIVE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?${Q}`,
    (m) => rel(m[1])
  );
  each(String.raw`\bCREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?${Q}`, (m) => rel(m[1]));
  each(String.raw`\b(?:CREATE|ALTER)\s+TYPE\s+${Q}`, (m) => rel(m[1]));
  each(
    String.raw`\bALTER\s+(?:VIEW|MATERIALIZED\s+VIEW|SEQUENCE|INDEX|FOREIGN\s+TABLE)\s+(?:IF\s+EXISTS\s+)?${Q}`,
    (m) => rel(m[1])
  );
  each(
    String.raw`\bDROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|INDEX|TYPE|FOREIGN\s+TABLE)\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?([^;]*)`,
    (m) => relList(m[1].replace(/\bRESTRICT\b/gi, ''))
  );
  each(
    String.raw`\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[A-Za-z_][A-Za-z0-9_]*\s+)?ON\s+(?:ONLY\s+)?${Q}`,
    (m) => rel(m[1])
  );
  each(String.raw`\b(?:PARTITION\s+OF|ATTACH\s+PARTITION|DETACH\s+PARTITION)\s+${Q}`, (m) =>
    rel(m[1])
  );
  each(String.raw`\bINHERITS\s*\(([^)]*)\)`, (m) => relList(m[1]));
  each(
    String.raw`\b(?:CREATE|ALTER|DROP)\s+(?:POLICY|RULE)\s+(?:IF\s+EXISTS\s+)?[A-Za-z_"][^;]*?\bON\s+${Q}`,
    (m) => rel(m[1])
  );
  each(
    String.raw`\bCOMMENT\s+ON\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|INDEX|FOREIGN\s+TABLE|TYPE)\s+${Q}`,
    (m) => rel(m[1])
  );
  each(String.raw`\bCOMMENT\s+ON\s+COLUMN\s+${Q}`, (m) => {
    const parts = m[1].split(/\s*\.\s*/);
    rel(parts.slice(0, -1).join('.'));
  });
  each(
    String.raw`\bCOMMENT\s+ON\s+(?:CONSTRAINT|TRIGGER|POLICY|RULE)\s+[^;]*?\bON\s+(?:DOMAIN\s+)?${Q}`,
    (m) => rel(m[1])
  );
  // Functions.
  each(
    String.raw`\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|ALTER\s+)(?:FUNCTION|PROCEDURE|ROUTINE)\s+${Q}`,
    (m) => functions.add(relationName(m[1]))
  );
  each(String.raw`\bDROP\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+(?:IF\s+EXISTS\s+)?([^;]*)`, (m) =>
    fnList(m[1].replace(/\bRESTRICT\b/gi, ''))
  );
  each(String.raw`\bCOMMENT\s+ON\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+${Q}`, (m) =>
    functions.add(relationName(m[1]))
  );
  // GRANT / REVOKE ... ON <object kind> <list> TO|FROM.
  each(String.raw`\b(?:GRANT|REVOKE)\b[^;]*?\bON\s+([^;]*?)\s+(?:TO|FROM)\b`, (m) => {
    const target = m[1].trim();
    const kind = /^(FUNCTION|PROCEDURE|ROUTINE|TABLE|SEQUENCE)\s+/i.exec(target);
    if (kind && /^(FUNCTION|PROCEDURE|ROUTINE)$/i.test(kind[1]))
      fnList(target.slice(kind[0].length));
    else if (kind) relList(target.slice(kind[0].length));
    else if (
      /^(?:SCHEMA|TYPE|DOMAIN|DATABASE|LANGUAGE|LARGE\s+OBJECT|FOREIGN|TABLESPACE|PARAMETER|ALL)\b/i.test(
        target
      )
    )
      unjudged.push(`GRANT/REVOKE ON ${target.split(/\s+/)[0].toUpperCase()}`);
    else relList(target);
  });
  return {
    relations: [...relations].sort(),
    functions: [...functions].sort(),
    unjudged: [...new Set(unjudged)],
  };
}

const TIMEOUT_SET = /\bSET\s+(LOCAL\s+|SESSION\s+)?lock_timeout\s*(?:=|\bTO\b)\s*([^;]+);/gi;

/** Reasons the file's own lock_timeout does not keep it from queuing behind live writers. */
export function lockTimeoutProblems(sql) {
  const code = stripComments(sql);
  const problems = [];
  const begin = /^[ \t]*BEGIN[ \t]*;/im.exec(code);
  if (!begin) return ['no BEGIN; opens the transaction'];
  // The SET LOCAL run right after BEGIN; must set lock_timeout before anything else.
  let rest = code.slice(begin.index + begin[0].length);
  let opening = null;
  for (;;) {
    const m = /^\s*SET\s+LOCAL\s+([A-Za-z_][A-Za-z0-9_.]*)\s*(?:=|\bTO\b)\s*([^;]+);/i.exec(rest);
    if (!m) break;
    if (m[1].toLowerCase() === 'lock_timeout' && opening === null) opening = m[2];
    rest = rest.slice(m[0].length);
  }
  if (opening === null)
    problems.push(
      `it does not SET LOCAL lock_timeout <= ${OFFLINE_LOCK_TIMEOUT_MAX_MS}ms in the SET LOCAL lines right after BEGIN;`
    );
  for (const m of code.matchAll(TIMEOUT_SET)) {
    const ms = durationMs(m[2]);
    if ((m[1] || '').trim().toUpperCase() !== 'LOCAL')
      problems.push(`lock_timeout may only be SET LOCAL (found ${m[0].trim()})`);
    else if (ms === null || ms <= 0 || ms > OFFLINE_LOCK_TIMEOUT_MAX_MS)
      problems.push(
        `SET LOCAL lock_timeout = ${m[2].trim()} is not within (0, ${OFFLINE_LOCK_TIMEOUT_MAX_MS}ms]`
      );
  }
  if (
    /\bRESET\s+(?:ALL|lock_timeout)\b/i.test(code) ||
    /\bset_config\s*\(\s*'lock_timeout'/i.test(code)
  )
    problems.push('it resets or set_config()s lock_timeout');
  return problems;
}

/**
 * The transaction budget (ms) the applier binds for an ordinary migration:
 * exactly DEFAULT_INSTALL_BUDGET_MS unless the file declares a budget and is
 * admitted. Throws, naming every reason, when a declaration is not admitted.
 */
export function ordinaryMigrationBudgetMs(file, sql) {
  let seconds;
  try {
    seconds = declaredInstallBudgetSeconds(sql);
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
  if (seconds === null) return DEFAULT_INSTALL_BUDGET_MS;
  const reasons = [];
  if (String(sql).includes('$ca_install_budget_scope$'))
    reasons.push('it uses the reserved $ca_install_budget_scope$ delimiter');
  if (!isPinChecked(file))
    reasons.push(
      `a declared budget needs a file from ${PIN_CHECKED_FROM} on (the runtime scope check reads its function snapshot)`
    );
  const touched = installTouches(sql);
  for (const r of touched.relations.filter((r) => !isOfflineRelation(r)))
    reasons.push(
      `it touches ${r}, which is not an offline relation (${OFFLINE_RELATION_PREFIXES.map((p) => `public.${p}*`).join(', ')})`
    );
  for (const f of touched.functions.filter((f) => !isOfflineFunction(f)))
    reasons.push(`it defines or changes function ${f}, which is not an offline function`);
  for (const u of touched.unjudged) reasons.push(`it uses ${u}, which this check cannot bound`);
  reasons.push(...lockTimeoutProblems(sql));
  if (reasons.length)
    throw new Error(
      `${file} declares "${INSTALL_BUDGET_ANNOTATION} ${seconds}" but is not admitted: ${reasons.join('; ')}. ` +
        `Undeclared files keep the ordinary ${DEFAULT_INSTALL_BUDGET_MS / 1000} s budget.`
    );
  return seconds * 1000;
}

const sqlArray = (xs) =>
  `ARRAY[${xs.map((x) => `'${x.replace(/_/g, '\\_')}%'`).join(',')}]::text[]`;

/**
 * The in-transaction backstop for a declared file, spliced in after the
 * stale-pin check and before the history row: it reads what the transaction
 * actually holds and changed, which dynamic SQL cannot hide from.
 */
export function offlineScopeCheckSQL() {
  return `
DO $ca_install_budget_scope$
DECLARE outside text; foreign_fn text;
BEGIN
 SELECT string_agg(DISTINCT n.nspname || '.' || bc.relname || ' (' || l.mode || ')', ', ')
   INTO outside
   FROM pg_catalog.pg_locks l
   JOIN pg_catalog.pg_class c ON c.oid = l.relation
   LEFT JOIN pg_catalog.pg_index i ON i.indexrelid = c.oid
   LEFT JOIN pg_catalog.pg_class owner_of_toast ON owner_of_toast.reltoastrelid = c.oid
   JOIN pg_catalog.pg_class bc ON bc.oid = COALESCE(i.indrelid, owner_of_toast.oid, c.oid)
   JOIN pg_catalog.pg_namespace n ON n.oid = bc.relnamespace
  WHERE l.locktype = 'relation' AND l.pid = pg_catalog.pg_backend_pid()
    AND l.database = (SELECT d.oid FROM pg_catalog.pg_database d WHERE d.datname = pg_catalog.current_database())
    AND l.mode <> 'AccessShareLock'
    AND n.nspname <> 'pg_catalog' AND n.nspname !~ '^pg_(toast_)?temp_'
    AND NOT (n.nspname = 'public' AND bc.relname LIKE ANY (${sqlArray(OFFLINE_RELATION_PREFIXES)}));
 IF outside IS NOT NULL THEN
  RAISE EXCEPTION 'install_budget_outside_offline_scope: this install holds % ; a declared install budget is only for offline relations', outside
   USING ERRCODE = '55000', HINT = 'Remove "${INSTALL_BUDGET_ANNOTATION}" to install under the ordinary ${DEFAULT_INSTALL_BUDGET_MS / 1000} s budget.';
 END IF;
 WITH before AS MATERIALIZED (
   SELECT e.key::oid AS oid, e.value->>1 AS catalog_md5
     FROM pg_catalog.jsonb_each(pg_catalog.current_setting('ca.stale_pin_before')::jsonb) e
 ), touched AS (
   SELECT p.oid FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN before b ON b.oid = p.oid
    WHERE n.nspname IN ('public', 'smarter_private') AND p.prokind IN ('f', 'p')
      AND (b.oid IS NULL OR pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) IS DISTINCT FROM b.catalog_md5)
   UNION ALL
   SELECT b.oid FROM before b WHERE NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid = b.oid)
 )
 SELECT string_agg(COALESCE(n.nspname || '.' || p.proname, 'dropped function ' || t.oid::text), ', ')
   INTO foreign_fn
   FROM touched t LEFT JOIN pg_catalog.pg_proc p ON p.oid = t.oid
   LEFT JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE p.oid IS NULL OR NOT (n.nspname = 'public' AND p.proname LIKE ANY (${sqlArray(OFFLINE_FUNCTION_PREFIXES)}));
 IF foreign_fn IS NOT NULL THEN
  RAISE EXCEPTION 'install_budget_outside_offline_scope: this install changed %; a declared install budget is only for offline functions', foreign_fn
   USING ERRCODE = '55000';
 END IF;
END $ca_install_budget_scope$;
`;
}
