#!/usr/bin/env node
/**
 * READ-ONLY MIGRATION QUERY PLAN INSPECTOR (2026-11-26, post-incident 37a45c05).
 *
 * WHY. Empty CI databases make O(N*M) correlated subqueries and hot-table
 * Seq Scans look instantaneous (~1 ms), only for cold production data to blow
 * past the 12 s install budget (`MergedMigrationNotInstalled`, incident 37a45c05).
 *
 * WHAT. Given a migration SQL file (or saved `EXPLAIN (FORMAT JSON)` output):
 *   1. Statically extracts every `CREATE [OR REPLACE] FUNCTION/PROCEDURE/VIEW`
 *      definition via `extractRoutineAndViewDefinitions()` and runs
 *      `migrationCostRisks()` (including `correlatedHotTableSubqueries()`).
 *   2. Parses any `EXPLAIN (FORMAT JSON)` plan tree (via `--plan-json <path>`
 *      or via a strictly read-only `psql` session using `--db-url-env <VAR>`
 *      wrapped in `BEGIN READ ONLY; SET LOCAL statement_timeout = '5s';
 *      EXPLAIN (FORMAT JSON, VERBOSE) ...; ROLLBACK;` — NEVER `ANALYZE`).
 *   3. Flags hot-table `Seq Scan`, correlated `SubPlan` over a hot table,
 *      `Nested Loop` with an inner `Seq Scan` on a hot table, and plans
 *      exceeding `--max-cost` (default 100000).
 *
 * SAFETY:
 *   - NEVER runs `EXPLAIN ANALYZE` (zero table reads, planner estimates only).
 *   - NEVER sources `.env` or prints connection strings.
 *   - Read-only transaction (`BEGIN READ ONLY ... ROLLBACK`) on any DB query.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  HOT_QUERY_TABLES,
  extractRoutineAndViewDefinitions,
  migrationCostRisks,
} from './migration-cost-shape.mjs';

export const DEFAULT_MAX_PLAN_COST = 100_000;

export const EXPLAIN_HOT_TABLES = Object.freeze([
  ...HOT_QUERY_TABLES,
  'tournament_players',
  'table_seats',
  'hand_atomic_commits',
]);

/**
 * Pure. Extract standalone SELECT / WITH ... SELECT queries from CREATE VIEW
 * definitions (directly explainable) and SQL/PLpgSQL function definitions
 * (flagging whether they contain unbound routine parameters).
 */
export function extractExplainableQueries(sql) {
  const defs = extractRoutineAndViewDefinitions(sql);
  const queries = [];
  for (const def of defs) {
    if (def.kind === 'view') {
      const q = def.body.trim().replace(/;\s*$/, '');
      if (/^(?:with|select)\b/i.test(q)) {
        queries.push({
          source: `view ${def.name}`,
          kind: 'view',
          sql: q,
          parameterized: false,
        });
      }
      continue;
    }
    // Split function body into semicolon-delimited statements and pick SELECT / WITH queries.
    const body = def.body;
    let cur = '';
    let inStr = false;
    const stmts = [];
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (inStr) {
        cur += ch;
        if (ch === "'" && body[i + 1] === "'") {
          cur += body[i + 1];
          i += 1;
          continue;
        }
        if (ch === "'") inStr = false;
        continue;
      }
      if (ch === "'") {
        inStr = true;
        cur += ch;
        continue;
      }
      if (ch === ';') {
        if (cur.trim()) stmts.push(cur.trim());
        cur = '';
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) stmts.push(cur.trim());

    let idx = 0;
    for (const rawStmt of stmts) {
      const cleaned = rawStmt
        .replace(/^\s*return\s+query\s+/i, '')
        .replace(/^\s*perform\s+/i, 'SELECT ')
        .trim();
      if (!/^(?:with|select)\b/i.test(cleaned)) continue;
      // Ignore trivial scalar assignments like SELECT INTO ... without FROM.
      if (!/\bfrom\b/i.test(cleaned)) continue;
      idx += 1;
      const parameterized =
        /\$\d+\b/.test(cleaned) ||
        /\b(?:p|v)_[a-z][a-z0-9_]*\b/i.test(cleaned) ||
        /\binto\s+(?:strict\s+)?[a-z_][a-z0-9_]*\b/i.test(cleaned);
      queries.push({
        source: `${def.kind} ${def.name} #${idx}`,
        kind: def.kind,
        sql: cleaned,
        parameterized,
      });
    }
  }
  return queries;
}

/**
 * Pure. Recursively inspect a PostgreSQL `EXPLAIN (FORMAT JSON)` document and
 * flag hot-table Seq Scans, correlated SubPlans over hot tables, Nested Loops
 * with inner hot-table Seq Scans, and plans exceeding `maxCost`.
 */
export function analyzeExplainPlan(planJson, opts = {}) {
  const maxCost = Number.isFinite(opts.maxCost) ? Number(opts.maxCost) : DEFAULT_MAX_PLAN_COST;
  const hotTables = new Set((opts.hotTables ?? EXPLAIN_HOT_TABLES).map((t) => String(t).toLowerCase()));
  const rootEntries = Array.isArray(planJson) ? planJson : [planJson];
  const findings = [];
  const hotScans = [];
  const subPlans = [];
  let maxObservedCost = 0;
  let rootPlanRows = 0;

  function findHotRelationBelow(node) {
    if (!node || typeof node !== 'object') return null;
    const rel = typeof node['Relation Name'] === 'string' ? node['Relation Name'].toLowerCase() : null;
    if (rel && hotTables.has(rel)) return rel;
    for (const child of node.Plans ?? []) {
      const found = findHotRelationBelow(child);
      if (found) return found;
    }
    return null;
  }

  function walk(node, ctx = { insideSubPlan: false, subPlanName: null, parentType: null, childIndex: 0 }) {
    if (!node || typeof node !== 'object') return;
    const nodeType = String(node['Node Type'] ?? 'Unknown');
    const rel = typeof node['Relation Name'] === 'string' ? node['Relation Name'].toLowerCase() : null;
    const totalCost = Number(node['Total Cost'] ?? 0);
    const planRows = Number(node['Plan Rows'] ?? 0);
    const parentRel = String(node['Parent Relationship'] ?? '');
    const subplanName = typeof node['Subplan Name'] === 'string' ? node['Subplan Name'] : null;

    if (totalCost > maxObservedCost) maxObservedCost = totalCost;

    const isCorrelatedSubPlan =
      parentRel === 'SubPlan' && (subplanName === null || !subplanName.startsWith('InitPlan'));
    const nextSubPlan = isCorrelatedSubPlan ? subplanName || 'SubPlan' : ctx.subPlanName;
    const insideSubPlan = ctx.insideSubPlan || isCorrelatedSubPlan;

    if (isCorrelatedSubPlan) {
      const hotRel = findHotRelationBelow(node);
      if (hotRel) {
        subPlans.push({ subplanName: nextSubPlan, table: hotRel, nodeType, totalCost });
        findings.push({
          severity: 'error',
          code: 'CORRELATED_SUBPLAN_HOT_TABLE',
          table: hotRel,
          message: `Correlated ${nextSubPlan} executes per outer row against hot table ${hotRel} (node=${nodeType}, cost=${totalCost}). Rewrite as a single-pass GROUP BY CTE or LEFT JOIN.`,
        });
      }
    }

    if (rel && hotTables.has(rel)) {
      if (nodeType === 'Seq Scan') {
        hotScans.push({ table: rel, nodeType, totalCost, planRows });
        findings.push({
          severity: 'error',
          code: 'SEQ_SCAN_HOT_TABLE',
          table: rel,
          message: `Seq Scan on hot table ${rel} (estimated rows=${planRows}, cost=${totalCost}). Add or use a selective index.`,
        });
      }
      if (ctx.parentType === 'Nested Loop' && ctx.childIndex > 0 && nodeType === 'Seq Scan') {
        findings.push({
          severity: 'error',
          code: 'NESTED_LOOP_INNER_SEQ_SCAN',
          table: rel,
          message: `Nested Loop inner Seq Scan on hot table ${rel} (cost=${totalCost}) — O(N*M) scaling hazard.`,
        });
      }
    }

    const children = Array.isArray(node.Plans) ? node.Plans : [];
    for (let idx = 0; idx < children.length; idx += 1) {
      walk(children[idx], {
        insideSubPlan,
        subPlanName: nextSubPlan,
        parentType: nodeType,
        childIndex: idx,
      });
    }
  }

  for (const entry of rootEntries) {
    const plan = entry?.Plan ?? entry;
    if (plan && typeof plan === 'object') {
      rootPlanRows = Math.max(rootPlanRows, Number(plan['Plan Rows'] ?? 0));
      walk(plan);
    }
  }

  if (maxObservedCost > maxCost) {
    findings.push({
      severity: 'warning',
      code: 'EXCESSIVE_PLAN_COST',
      table: null,
      message: `Estimated total plan cost ${maxObservedCost} exceeds threshold ${maxCost}.`,
    });
  }

  return {
    ok: findings.every((f) => f.severity !== 'error'),
    findings,
    stats: {
      totalCost: maxObservedCost,
      planRows: rootPlanRows,
      hotScans,
      subPlans,
    },
  };
}

/**
 * Execute read-only `EXPLAIN (FORMAT JSON, VERBOSE)` (NEVER ANALYZE) via `psql`
 * inside `BEGIN READ ONLY; SET LOCAL statement_timeout = '5s'; ... ROLLBACK;`.
 */
export function runReadOnlyExplain(querySql, dbUrl, psqlBin = 'psql') {
  if (/\b(?:insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(querySql)) {
    throw new Error('Refusing to EXPLAIN a non-SELECT statement');
  }
  const wrapped = [
    'BEGIN READ ONLY;',
    "SET LOCAL statement_timeout = '5s';",
    "SET LOCAL lock_timeout = '2s';",
    `EXPLAIN (FORMAT JSON, VERBOSE) ${querySql.replace(/;\s*$/, '')};`,
    'ROLLBACK;',
  ].join('\n');
  const out = execFileSync(psqlBin, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', dbUrl], {
    input: wrapped,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(out.trim());
}

function parseArgs(argv) {
  const opts = { file: null, planJson: null, dbUrlEnv: null, maxCost: DEFAULT_MAX_PLAN_COST, psqlBin: 'psql' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--plan-json') opts.planJson = argv[++i];
    else if (a === '--db-url-env') opts.dbUrlEnv = argv[++i];
    else if (a === '--max-cost') opts.maxCost = Number(argv[++i]);
    else if (a === '--psql-bin') opts.psqlBin = argv[++i];
    else if (!a.startsWith('-')) opts.file = a;
  }
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.file && !opts.planJson) {
    console.error(
      'Usage: node scripts/ci/explain-migration-queries.mjs <migration.sql> [--db-url-env VAR] [--max-cost N]\n' +
        '       node scripts/ci/explain-migration-queries.mjs --plan-json <explain.json> [--max-cost N]'
    );
    process.exit(2);
  }

  const report = {
    ok: true,
    file: opts.file,
    staticRisks: [],
    extractedQueries: [],
    planAnalyses: [],
  };

  if (opts.file) {
    const sql = readFileSync(opts.file, 'utf8');
    report.staticRisks = migrationCostRisks(basename(opts.file), sql);
    if (report.staticRisks.length > 0) report.ok = false;
    const queries = extractExplainableQueries(sql);
    report.extractedQueries = queries.map((q) => ({
      source: q.source,
      kind: q.kind,
      parameterized: q.parameterized,
    }));

    if (opts.dbUrlEnv) {
      const dbUrl = process.env[opts.dbUrlEnv];
      if (!dbUrl) {
        console.error(`Environment variable ${opts.dbUrlEnv} is not set.`);
        process.exit(2);
      }
      for (const q of queries) {
        if (q.parameterized) {
          report.planAnalyses.push({
            source: q.source,
            status: 'skipped_parameterized',
          });
          continue;
        }
        const planJson = runReadOnlyExplain(q.sql, dbUrl, opts.psqlBin);
        const analysis = analyzeExplainPlan(planJson, { maxCost: opts.maxCost });
        if (!analysis.ok) report.ok = false;
        report.planAnalyses.push({ source: q.source, status: 'explained', ...analysis });
      }
    }
  }

  if (opts.planJson) {
    const planJson = JSON.parse(readFileSync(opts.planJson, 'utf8'));
    const analysis = analyzeExplainPlan(planJson, { maxCost: opts.maxCost });
    if (!analysis.ok) report.ok = false;
    report.planAnalyses.push({ source: opts.planJson, status: 'explained', ...analysis });
  }

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}
