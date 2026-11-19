/**
 * A MIGRATION THAT CANNOT FINISH INSIDE THE INSTALL BUDGET DOES NOT MERGE
 * (2026-11-07).
 *
 * apply-recorded-migration.mjs runs an ordinary migration under
 * transaction_timeout = TRANSACTION_BUDGET_SECONDS + 4 (12 s). On 2026-11-07
 * three merged migrations passed every correctness proof and were still
 * killed by that budget, nothing committed, the fix sitting merged but not
 * live:
 *
 *   20261107133350 (#9860)  idempotency_key LIKE 'union_close:...:%' on
 *                           chip_ledger: 41,340 ms for two rows (a bitmap heap
 *                           scan over 408,577 blocks of a 25.9M-row table).
 *   20261107163254 (#9890)  a week-wide predicate over 1,142,186 rows.
 *   20261107140005 (#9872)  idempotency_key LIKE 'bounty-only-...:%' on
 *                           chip_ledger, caught before it merged.
 *
 * chip_ledger's only index on idempotency_key is a plain btree in the
 * database's en_US.UTF-8 collation, which cannot answer a LIKE prefix, so any
 * such filter is a full scan of the largest table in the database. Every one
 * of these was fixed by naming the keys and using = / = ANY, which is an index
 * probe (0.202 ms for #9860's two rows).
 *
 * This is the merge-time question the applier also asks, so the two cannot
 * disagree (the same arrangement as migration-transaction-shape.mjs). It is a
 * floor, not a proof of cost: the timed, rolled-back production rehearsal is
 * still each author's job. Applies to migrations from COST_CHECKED_FROM on;
 * files already merged before it are not re-judged.
 */

/** Migrations at or after this version must pass migrationCostRisks. */
export const COST_CHECKED_FROM = '20261107200000';

const stripComments = (sql) => sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Every `idempotency_key [NOT] [I]LIKE '<literal>%' ...` whose statement reads
 * chip_ledger. The statement is the text between the surrounding semicolons,
 * so a LIKE on another table's key in the same file is not mistaken for one.
 */
function ledgerPrefixScans(text) {
  const found = [];
  const re = /idempotency_key\s+(?:NOT\s+)?I?LIKE\s+('(?:[^']|'')*%[^']*'|[^\s;)]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    const start = text.lastIndexOf(';', m.index) + 1;
    const endIdx = text.indexOf(';', m.index);
    const stmt = text.slice(start, endIdx === -1 ? text.length : endIdx);
    if (/\bchip_ledger\b/i.test(stmt)) found.push(m[0].replace(/\s+/g, ' ').slice(0, 120));
  }
  return found;
}

/**
 * @param {string} file the migration file name
 * @param {string} sql  the whole file
 * @returns {string[]} one reason per risk found; empty means none of the known
 *   budget killers is present
 */
export function migrationCostRisks(file, sql) {
  const reasons = [];
  for (const hit of ledgerPrefixScans(stripComments(sql))) {
    reasons.push(
      `${file}: ${hit} reads chip_ledger by a LIKE prefix - a full scan of the 25.9M-row ledger (41 s on 2026-11-07) that the 12 s install budget kills. Name the keys and use = or = ANY(...).`
    );
  }
  // A live-proof is a comment the merged-migration checker runs on production
  // (60 s cap); it is held to the same rule.
  for (const line of sql.split('\n').filter((l) => l.startsWith('-- @live-proof:'))) {
    for (const hit of ledgerPrefixScans(line.slice('-- @live-proof:'.length))) {
      reasons.push(`${file}: @live-proof ${hit} reads chip_ledger by a LIKE prefix - name the keys and use = or = ANY(...).`);
    }
  }
  for (const [fn, why] of overBudgetCalls(sql)) {
    reasons.push(
      `${file}: calls ${fn}(...) at install time (a probe, a DO block or a top-level statement), and ${why} - ` +
        'far past the ~12 s install budget, so the applier is killed by statement timeout. Prove the changed ' +
        'statement directly and name the function with -- @probe-exempt (scripts/ci/migration-function-probes.mjs).'
    );
  }
  return reasons;
}

/**
 * FUNCTIONS MEASURED OVER THE INSTALL BUDGET (2026-11-19).
 *
 * 20261119083000 (the fleet degraded run never shadows the digest) fixed an
 * ambiguous column in fn_sp_daily_metrics_compute correctly, then proved it
 * with the probe the probe law asks for: PERFORM fn_sp_daily_metrics_compute
 * (DATE '2099-01-01'), on the belief that an empty day reads no history. A
 * dozen sections of that function are not bounded by the day (lifetime
 * human totals, diamond circulation, admins, stuck tournaments, freshness
 * maxima), and production measures 238-264 s per call (cron
 * sp-daily-metrics-snapshot, 2026-11-19 06:15-09:45 UTC). The applier killed
 * the install at 10 s (run 44503916790, 10:20 UTC); the digest stayed broken
 * (incident dc479141). CI could not see it: its schema copy holds no rows.
 *
 * A call to one of these at install time can never fit. The executable text
 * is the file with comments, string literals and CREATE FUNCTION bodies
 * removed - a function body that calls one is fine, it is not run by the
 * install. Each entry names its measurement; add one when production
 * measures a function past the budget.
 */
export const OVER_BUDGET_FUNCTIONS = Object.freeze({
  'public.fn_sp_daily_metrics_compute':
    'production measured 238-264 s per call on 2026-11-19 (cron sp-daily-metrics-snapshot)',
  'public.fn_sp_daily_metrics_snapshot':
    'it runs public.fn_sp_daily_metrics_compute (238-264 s per call on production, 2026-11-19)',
});

/** The text an install executes: no comments, no string literals, no function definitions. */
export function installExecutedText(sql) {
  let text = stripComments(sql);
  // Remove each CREATE [OR REPLACE] FUNCTION/PROCEDURE ... AS $tag$ ... $tag$
  // definition whole: its header names the function without calling it, and
  // its body is not run by the install.
  const head = /create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/gi;
  let out = '';
  let at = 0;
  let m;
  while ((m = head.exec(text))) {
    const asAt = text.slice(m.index).search(/\bas\s+\$[A-Za-z_0-9]*\$/i);
    if (asAt < 0) break;
    const open = /\$[A-Za-z_0-9]*\$/.exec(text.slice(m.index + asAt));
    const bodyEnd = text.indexOf(open[0], m.index + asAt + open.index + open[0].length);
    if (bodyEnd < 0) break;
    out += text.slice(at, m.index);
    at = bodyEnd + open[0].length;
    head.lastIndex = at;
  }
  text = out + text.slice(at);
  return text.replace(/'(?:[^']|'')*'/g, "''");
}

/** [qualified name, why] for each over-budget function the install would call. */
export function overBudgetCalls(sql) {
  const text = installExecutedText(sql);
  const found = [];
  for (const [fn, why] of Object.entries(OVER_BUDGET_FUNCTIONS)) {
    const [schema, name] = fn.split('.');
    const qualified = new RegExp(`(?:\\b${schema}\\s*\\.\\s*|(?<![.\\w"]))"?${name}"?\\s*\\(`, 'i');
    if (qualified.test(text)) found.push([fn, why]);
  }
  return found;
}

/** True when this file is judged by migrationCostRisks. */
export const isCostChecked = (file) => String(file).slice(0, 14) >= COST_CHECKED_FROM;
