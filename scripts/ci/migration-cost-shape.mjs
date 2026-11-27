/**
 * A MIGRATION THAT CANNOT FINISH INSIDE THE INSTALL BUDGET DOES NOT MERGE
 * (2026-11-07; hardened 2026-11-19 and 2026-11-26 after incident 37a45c05).
 *
 * apply-recorded-migration.mjs runs an ordinary migration under
 * transaction_timeout = TRANSACTION_BUDGET_SECONDS + 4 (12 s). Migrations that
 * pass every correctness check in CI's empty PostgreSQL can still die on
 * production under that 12 s budget (or abort on cold I/O), leaving a merged
 * file uninstalled (`MergedMigrationNotInstalled`) and blocking every engine
 * release behind it (O7):
 *
 *   2026-11-07  20261107133350 (#9860)  idempotency_key LIKE 'union_close:...:%'
 *               on chip_ledger: 41,340 ms for two rows (full scan of 25.9M rows).
 *   2026-11-19  20261119083000 (incident dc479141, run 44503916790) called
 *               fn_sp_daily_metrics_compute (238-264 s on production) in its
 *               probe; applier killed it at 10 s.
 *   2026-11-26  20261126203947 (#12129, incident 37a45c05, alert 449405, run
 *               45903772035) set SET LOCAL statement_timeout = '30s' inside a
 *               12 s ordinary transaction, ran an inline 24 h rake_records +
 *               bbj_contributions scan alongside two calls to bbj_drift_since
 *               (10.7-10.9 s cold on production), and gated on a 5,000 ms
 *               clock_timestamp() wall-clock assertion. Killed by FATAL 25P04
 *               at 12,156 ms, paging MergedMigrationNotInstalled and blocking
 *               the 19:00 CST engine cutover until revert #12154.
 *   2026-11-26  20261126195422 (#12120, run 45903604551) read
 *               v_spin_reserve_health inside DO $post$ with a 5,000 ms
 *               clock_timestamp() assertion and SET LOCAL statement_timeout =
 *               '20s'; cold cache took 6,229 ms and refused the install.
 *
 * This is the merge-time question the applier also asks, so the two cannot
 * disagree (the same arrangement as migration-transaction-shape.mjs). It is a
 * floor, not a proof of cost: the timed, rolled-back production rehearsal is
 * still each author's job. Applies to migrations from COST_CHECKED_FROM on;
 * files already merged before it are not re-judged.
 */
import {
  DEFAULT_INSTALL_BUDGET_MS,
  declaredInstallBudgetSeconds,
} from './migration-install-budget.mjs';
import { declaresMaintenanceWindow } from './maintenance-window-migrations.mjs';

/** Migrations at or after this version must pass migrationCostRisks. */
export const COST_CHECKED_FROM = '20261107200000';

/**
 * Migrations at or after this version (and synthetic non-dated test files)
 * must not declare SET [LOCAL] statement_timeout above the applier's real
 * transaction budget (12 s for undeclared ordinary files, or the file's
 * declared offline budget). Historical already-installed files before this
 * version are not re-judged.
 */
export const STATEMENT_TIMEOUT_CHECKED_FROM = '20261127020000';

/**
 * Frozen historical exceptions (already installed in production before this
 * guard existed). Closed set: never add a new filename here. Using a closed
 * historical set instead of a future version cutoff guarantees open PRs with
 * older reserved timestamps (e.g. #12141) are still caught.
 */
const GRANDFATHERED_WALL_CLOCK_AND_VIEW_PROOFS = new Set([
  '20261108215333_horses_are_refunded_exactly_as_humans.sql',
  '20261109024332_the_horse_back_refund_picks_its_charges_before_it_reads_the_.sql',
  '20261109234320_prove_all_original_posthand_pending_escrow_completions.sql',
  '20261110023653_admit_single_full_wallet_spins_and_guarantee_earned_payouts.sql',
  '20261118163436_owner_pauses_free_buy_starts_until_the_hand_delay_is_fixed.sql',
  '20261119120000_a_roster_edge_reads_only_its_own_rake.sql',
  '20261119174500_lightning_wait_is_judged_against_the_pool_that_could_end_it.sql',
  '20261126195422_the_spin_reserve_gauge_reads_each_table_once.sql',
]);

const baseName = (file) => String(file).split('/').pop();
const versionOf = (file) => {
  const m = /^(\d{14})_/.exec(baseName(file));
  return m ? m[1] : null;
};

/**
 * Strip SQL line (-- ...) and nested block (/* ... *\/) comments while leaving
 * single-quoted and dollar-quoted string literals intact.
 */
function stripComments(sql) {
  const s = String(sql);
  let out = '';
  let i = 0;
  let blockDepth = 0;
  while (i < s.length) {
    if (blockDepth > 0) {
      if (s[i] === '/' && s[i + 1] === '*') {
        blockDepth += 1;
        out += '  ';
        i += 2;
      } else if (s[i] === '*' && s[i + 1] === '/') {
        blockDepth -= 1;
        out += '  ';
        i += 2;
      } else {
        out += s[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    if (s[i] === "'") {
      out += s[i++];
      while (i < s.length) {
        out += s[i];
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            out += s[i + 1];
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (s[i] === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(s.slice(i));
      if (m) {
        const tag = m[0];
        const close = s.indexOf(tag, i + tag.length);
        if (close >= 0) {
          out += s.slice(i, close + tag.length);
          i = close + tag.length;
          continue;
        }
      }
    }
    if (s[i] === '-' && s[i + 1] === '-') {
      while (i < s.length && s[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (s[i] === '/' && s[i + 1] === '*') {
      blockDepth = 1;
      out += '  ';
      i += 2;
      continue;
    }
    out += s[i++];
  }
  return out;
}

/**
 * Scan forward from `pos` to the next top-level semicolon (skipping single-
 * quoted and dollar-quoted literals). Returns the index right after `;`, or
 * `text.length` if none is found.
 */
function skipToStatementEnd(text, pos) {
  let i = pos;
  while (i < text.length) {
    if (text[i] === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (text[i] === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(text.slice(i));
      if (m) {
        const tag = m[0];
        const close = text.indexOf(tag, i + tag.length);
        if (close >= 0) {
          i = close + tag.length;
          continue;
        }
      }
    }
    if (text[i] === ';') return i + 1;
    i += 1;
  }
  return text.length;
}

/**
 * Skip a CREATE [OR REPLACE] FUNCTION/PROCEDURE statement cleanly without ever
 * crossing its terminating semicolon into a following DO block. Handles
 * dollar-quoted bodies (`AS $tag$...$tag$`), single-quoted bodies (`AS '...'`),
 * and SQL-standard `BEGIN ATOMIC ... END;` bodies.
 */
function skipRoutineDefinition(text, start) {
  let i = start;
  let atomicDepth = 0;
  while (i < text.length) {
    if (text[i] === "'") {
      i += 1;
      while (i < text.length) {
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (text[i] === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(text.slice(i));
      if (m) {
        const tag = m[0];
        const close = text.indexOf(tag, i + tag.length);
        if (close >= 0) {
          i = close + tag.length;
          continue;
        }
      }
    }
    if (/[A-Za-z_]/.test(text[i])) {
      const prev = i > 0 ? text[i - 1] : ' ';
      if (!/[A-Za-z_0-9$]/.test(prev)) {
        const rest = text.slice(i);
        const atomic = /^BEGIN\s+ATOMIC\b/i.exec(rest);
        if (atomic) {
          atomicDepth += 1;
          i += atomic[0].length;
          continue;
        }
        if (atomicDepth > 0) {
          const endKw = /^END\b/i.exec(rest);
          if (endKw) {
            atomicDepth -= 1;
            i += endKw[0].length;
            continue;
          }
        }
      }
    }
    if (text[i] === ';' && atomicDepth === 0) return i + 1;
    i += 1;
  }
  return text.length;
}

/**
 * Strip comments and nested dollar-quoted string literals inside a DO block
 * body (where the outer tag is `outerTag`), leaving executable PL/pgSQL and
 * single-quoted literals intact.
 */
function stripDoBodyInnerDollarQuotes(body, outerTag) {
  const s = stripComments(body);
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === "'") {
      out += s[i++];
      while (i < s.length) {
        out += s[i];
        if (s[i] === "'") {
          if (s[i + 1] === "'") {
            out += s[i + 1];
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (s[i] === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(s.slice(i));
      if (m && m[0] !== outerTag) {
        const tag = m[0];
        const close = s.indexOf(tag, i + tag.length);
        if (close >= 0) {
          out += "''";
          i = close + tag.length;
          continue;
        }
      }
    }
    out += s[i++];
  }
  return out;
}

/**
 * Executable SQL statements at install time, with comments, CREATE FUNCTION /
 * PROCEDURE definitions, CREATE VIEW definitions, and nested dollar-quoted
 * string literals removed, while keeping single-quoted literals intact (so
 * statement_timeout values and chip_ledger LIKE literals remain readable).
 * Also returns each DO block's body separately for block-scoped checks.
 */
function extractInstallExecutable(sql) {
  const text = stripComments(sql);
  let out = '';
  const doBlocks = [];
  let i = 0;
  while (i < text.length) {
    // Preserve single-quoted string literals at top level.
    if (text[i] === "'") {
      out += text[i++];
      while (i < text.length) {
        out += text[i];
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            out += text[i + 1];
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    // Check statement-level CREATE FUNCTION/PROCEDURE/VIEW or DO blocks.
    if (/[A-Za-z_]/.test(text[i]) && (i === 0 || !/[A-Za-z_0-9$."]/.test(text[i - 1]))) {
      const rest = text.slice(i);
      const routine = /^create\s+(?:or\s+replace\s+)?(?:function|procedure)\b/i.exec(rest);
      if (routine) {
        i = skipRoutineDefinition(text, i);
        out += ' ; ';
        continue;
      }
      const view =
        /^create\s+(?:or\s+replace\s+)?(?:(?:temp|temporary)\s+)?(?:recursive\s+)?view\b/i.exec(
          rest
        );
      if (view) {
        i = skipToStatementEnd(text, i);
        out += ' ; ';
        continue;
      }
      const doMatch = /^do\b(?:\s+language\s+[a-z_0-9"']+)?\s*(\$[A-Za-z_0-9]*\$)/i.exec(rest);
      if (doMatch) {
        const tag = doMatch[1];
        const bodyStart = i + doMatch[0].length;
        const bodyEnd = text.indexOf(tag, bodyStart);
        if (bodyEnd >= 0) {
          const cleaned = stripDoBodyInnerDollarQuotes(text.slice(bodyStart, bodyEnd), tag);
          // Capture any immediately preceding `-- @probe-for: ...` annotation
          // from the original SQL (stripComments preserves offsets 1:1).
          const beforeLine = String(sql).slice(Math.max(0, i - 240), i);
          const probeHeader =
            /--[ \t]*@probe-for:[ \t]*([^\n]+)\n[ \t]*$/i.exec(beforeLine)?.[1]?.trim() ?? null;
          doBlocks.push({ body: cleaned, probeFor: probeHeader });
          out += ' DO ' + cleaned + ' ';
          i = bodyEnd + tag.length;
          continue;
        }
      }
    }
    // Non-DO dollar-quoted literal at top level (e.g. a string argument): blank it.
    if (text[i] === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(text.slice(i));
      if (m) {
        const tag = m[0];
        const close = text.indexOf(tag, i + tag.length);
        if (close >= 0) {
          out += "''";
          i = close + tag.length;
          continue;
        }
      }
    }
    out += text[i++];
  }
  return { withStrings: out, doBlocks };
}

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
  const base = baseName(file);
  const grandfatheredProof = GRANDFATHERED_WALL_CLOCK_AND_VIEW_PROOFS.has(base);

  for (const hit of ledgerPrefixScans(stripComments(sql))) {
    reasons.push(
      `${file}: ${hit} reads chip_ledger by a LIKE prefix - a full scan of the 25.9M-row ledger (41 s on 2026-11-07) that the 12 s install budget kills. Name the keys and use = or = ANY(...).`
    );
  }
  // A live-proof is a comment the merged-migration checker runs on production
  // (60 s cap); it is held to the same rule.
  for (const line of String(sql)
    .split('\n')
    .filter((l) => l.startsWith('-- @live-proof:'))) {
    for (const hit of ledgerPrefixScans(line.slice('-- @live-proof:'.length))) {
      reasons.push(
        `${file}: @live-proof ${hit} reads chip_ledger by a LIKE prefix - name the keys and use = or = ANY(...).`
      );
    }
  }
  for (const [fn, why] of overBudgetCalls(sql)) {
    reasons.push(
      `${file}: calls ${fn}(...) at install time (a probe, a DO block or a top-level statement), and ${why} - ` +
        'at or past the ~12 s install budget, so the applier is killed by transaction/statement timeout. Prove the changed ' +
        'statement directly and name the function with -- @probe-exempt (scripts/ci/migration-function-probes.mjs).'
    );
  }
  if (!grandfatheredProof) {
    for (const [rel, why] of overBudgetRelationReads(sql)) {
      reasons.push(
        `${file}: queries ${rel} at install time (a DO block or top-level statement), and ${why} - ` +
          'cold cache I/O during install risks tripping the 12 s ordinary transaction budget or refusing the migration. ' +
          'Verify definition/shape/privileges in the install transaction and measure live read latency out-of-band.'
      );
    }
    for (const gate of wallClockLatencyGates(sql)) {
      reasons.push(
        `${file}: aborts the install transaction on wall-clock duration (${gate}) - ` +
          'empty CI databases always pass in ~1 ms while cold production cache or concurrent load trips the gate and leaves a merged migration uninstalled (incidents 37a45c05 / run 45903604551). ' +
          'Log duration with RAISE NOTICE or prove the plan/index shape instead of RAISE EXCEPTION on wall-clock ms.'
      );
    }
  }
  for (const scan of wideLiveTableScans(sql)) {
    reasons.push(
      `${file}: scans ${scan} over a time window at install time (outside CREATE FUNCTION/VIEW) - ` +
        'multi-million-row live tables cannot be range-scanned cold inside the 12 s ordinary transaction budget (incident 37a45c05, run 45903772035). ' +
        'Prove equivalence read-only before merge, or use a point-key lookup.'
    );
  }
  for (const problem of overBudgetStatementTimeouts(file, sql)) {
    reasons.push(`${file}: ${problem}`);
  }
  return reasons;
}

/**
 * FUNCTIONS MEASURED AT OR OVER THE INSTALL BUDGET (2026-11-19, 2026-11-26).
 *
 * Calling any of these at install time (a probe, a DO block, or a top-level
 * statement) risks killing the ordinary 12 s install transaction on cold
 * production data, causing MergedMigrationNotInstalled and blocking every
 * engine release behind it (O7).
 *
 * The executable text excludes comments, string literals, CREATE VIEW bodies,
 * and CREATE FUNCTION/PROCEDURE definitions - redefining, granting, revoking,
 * altering, or commenting on these functions is allowed; calling them at
 * install time is refused. Each entry names its measurement.
 */
export const OVER_BUDGET_FUNCTIONS = Object.freeze({
  'public.fn_sp_daily_metrics_compute':
    'production measured 238-264 s per call on 2026-11-19 (cron sp-daily-metrics-snapshot)',
  'public.fn_sp_daily_metrics_snapshot':
    'it runs public.fn_sp_daily_metrics_compute (238-264 s per call on production, 2026-11-19)',
  'public.bbj_drift_since':
    'production measured 10.7 s old / 10.9 s new cold on 2026-11-26 (run 45903772035 killed by FATAL 25P04 at 12,156 ms; incident 37a45c05)',
  'public.fn_tournament_money_conservation':
    'production measured 8.3-24.9 s cold on 2026-11-26 (docs/changelog/2026-11-26-statement-timeouts-lane.md)',
  'public.fn_bbj_reconcile':
    'production measured ~18 s across chip_ledger legs for BBJ pools',
  'public.fn_bbj_reconcile_all':
    'it calls public.fn_bbj_reconcile across all BBJ pools (~18 s+ on production)',
  'public.fn_bbj_promo_bank_check':
    'production measured 5.3-25 s across 6M+ bbj_contributions rows (20261022062934)',
});

/**
 * VIEWS MEASURED AT OR NEAR THE INSTALL BUDGET ON COLD PRODUCTION CACHE
 * (2026-11-26, run 45903604551).
 */
export const OVER_BUDGET_RELATIONS = Object.freeze({
  'public.v_spin_reserve_health':
    'production measured >90 s old / 6,229 ms cold new on 2026-11-26 (run 45903604551 refused P0001 on cold install read)',
});

/**
 * Multi-million-row live tables that must never be range-scanned by created_at
 * inside an ordinary migration's install-time SQL (DO block or top-level query).
 */
const WIDE_SCAN_TABLES = Object.freeze([
  'rake_records',
  'bbj_contributions',
  'hand_histories',
]);

/**
 * The text an install executes: no comments, no string literals, no function
 * or view definitions, and no nested non-DO dollar-quoted string literals.
 */
export function installExecutedText(sql) {
  const { withStrings } = extractInstallExecutable(sql);
  return withStrings.replace(/'(?:[^']|'')*'/g, "''");
}

/** [qualified name, why] for each over-budget function the install would call. */
export function overBudgetCalls(sql) {
  const text = installExecutedText(sql);
  const found = [];
  for (const [fn, why] of Object.entries(OVER_BUDGET_FUNCTIONS)) {
    const [schema, name] = fn.split('.');
    const qualified = new RegExp(
      `(?:\\b${schema}\\s*\\.\\s*|(?<![.\\w"]))"?${name}"?\\s*\\(`,
      'gi'
    );
    let m;
    while ((m = qualified.exec(text))) {
      // GRANT/REVOKE/ALTER/DROP/COMMENT ON FUNCTION|PROCEDURE|ROUTINE names
      // the signature without executing it.
      if (/\b(?:function|procedure|routine)\s+(?:if\s+exists\s+)?$/i.test(text.slice(0, m.index))) {
        continue;
      }
      found.push([fn, why]);
      break;
    }
  }
  return found;
}

/** [qualified name, why] for each over-budget view/relation queried at install time. */
export function overBudgetRelationReads(sql) {
  const text = installExecutedText(sql);
  const found = [];
  for (const [rel, why] of Object.entries(OVER_BUDGET_RELATIONS)) {
    const [schema, name] = rel.split('.');
    const re = new RegExp(
      `\\b(?:from|join)\\s+(?:only\\s+)?(?:\\b${schema}\\s*\\.\\s*|(?<![.\\w"]))"?${name}"?(?![\\w"])`,
      'i'
    );
    if (re.test(text)) found.push([rel, why]);
  }
  return found;
}

/**
 * Detect install-time wall-clock latency gates (`clock_timestamp()` /
 * `statement_timestamp()` elapsed duration feeding a `RAISE EXCEPTION` in the
 * same DO block). Returns short descriptions of each hit.
 */
export function wallClockLatencyGates(sql) {
  const { doBlocks } = extractInstallExecutable(sql);
  const found = [];
  const elapsedExpr =
    /\b(?:clock_timestamp|statement_timestamp)\s*\(\s*\)\s*-\s*(?!interval\b)[a-z_][a-z0-9_]*|\bage\s*\(\s*(?:clock_timestamp|statement_timestamp)\s*\(\s*\)\s*,/i;
  for (const { body: rawBlock, probeFor } of doBlocks) {
    // tests/the-union-sweep-proves-its-budget-before-commit.law.test.ts
    // explicitly mandates a timed whole-sweep probe for fn_union_integrity_sweep.
    if (probeFor && /^public\.fn_union_integrity_sweep(?:_all)?\b/i.test(probeFor)) continue;
    const block = rawBlock.replace(/'(?:[^']|'')*'/g, "''");
    if (!elapsedExpr.test(block)) continue;
    // Direct inline check: IF ... (clock_timestamp() - v_t0) ... > ... THEN RAISE EXCEPTION
    if (
      /\bif\b[^;]*\b(?:clock_timestamp|statement_timestamp)\s*\(\s*\)\s*-\s*(?!interval\b)[a-z_][a-z0-9_]*[^;]*\bthen\s+raise\s+exception\b/i.test(
        block
      )
    ) {
      found.push('IF ... clock_timestamp() - ... THEN RAISE EXCEPTION');
      continue;
    }
    // Variable-assigned elapsed check:
    //   v_ms := extract(epoch FROM clock_timestamp() - v_t0) * 1000;
    //   IF v_ms > 5000 THEN RAISE EXCEPTION ...
    const assignedVars = new Set();
    for (const m of block.matchAll(
      /\b([a-z_][a-z0-9_]*)\s*(?::=|=)[^;]*\b(?:clock_timestamp|statement_timestamp)\s*\(\s*\)\s*-\s*(?!interval\b)[a-z_][a-z0-9_]*/gi
    )) {
      assignedVars.add(m[1].toLowerCase());
    }
    for (const m of block.matchAll(
      /\binto\s+(?:strict\s+)?([a-z_][a-z0-9_]*)\b/gi
    )) {
      const before = block.slice(Math.max(0, block.lastIndexOf(';', m.index) + 1), m.index);
      if (elapsedExpr.test(before)) assignedVars.add(m[1].toLowerCase());
    }
    for (const v of assignedVars) {
      const gate = new RegExp(
        `\\bif\\b[^;]*\\b${v}\\b[^;]*(?:>|>=)[^;]*\\bthen\\s+raise\\s+exception\\b`,
        'i'
      );
      if (gate.test(block)) {
        found.push(`IF ${v} > ... THEN RAISE EXCEPTION (measured via clock_timestamp())`);
        break;
      }
    }
  }
  return found;
}

/**
 * Detect install-time time-window scans on multi-million-row live tables
 * (`rake_records`, `bbj_contributions`, `hand_histories`) outside CREATE
 * FUNCTION/VIEW definitions.
 */
export function wideLiveTableScans(sql) {
  const text = installExecutedText(sql);
  const found = [];
  const tablePattern = new RegExp(
    `\\b(?:from|join)\\s+(?:only\\s+)?(?:public\\s*\\.\\s*)?"?(${WIDE_SCAN_TABLES.join('|')})"?(?![\\w"])`,
    'i'
  );
  const timeWindow =
    /\bcreated_at\s*(?:>=?|between)\b|\b(?:now|clock_timestamp|current_timestamp)\s*\(\s*\)\s*-\s*interval\b/i;
  const pointKey =
    /\b(?:[\w"]+\s*\.\s*)?(?:id|hand_id)\s*=\s*(?:''|[0-9]+|v_[a-z0-9_]+|p_[a-z0-9_]+)\b/i;
  for (const stmt of text.split(';')) {
    const tm = tablePattern.exec(stmt);
    if (!tm) continue;
    if (timeWindow.test(stmt) && !pointKey.test(stmt)) {
      found.push(`public.${tm[1].toLowerCase()}`);
    }
  }
  return [...new Set(found)];
}

/**
 * Parse a PostgreSQL duration literal (e.g. '30s', '5000ms', '2min', '0') to
 * milliseconds, or NaN if unparseable.
 */
function parseDurationMs(raw) {
  const m = /^\s*'?\s*(\d+(?:\.\d+)?)\s*(ms|s|min|h|d)?\s*'?\s*$/i.exec(String(raw));
  if (!m) return NaN;
  const unit = (m[2] || 'ms').toLowerCase();
  const scale = { ms: 1, s: 1000, min: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return Number(m[1]) * scale;
}

/**
 * Ordinary migrations run under transaction_timeout = 12 s (or an admitted
 * offline -- @install-budget-seconds: up to 60 s). Setting SET LOCAL
 * statement_timeout (or set_config('statement_timeout', ...)) above that cap
 * hides the real budget from authors and turns clean statement cancellations
 * (57014) into abrupt connection kills (FATAL 25P04). Enforced from
 * STATEMENT_TIMEOUT_CHECKED_FROM on (and for synthetic non-dated test names).
 */
export function overBudgetStatementTimeouts(file, sql) {
  const ver = versionOf(file);
  if (ver !== null && ver < STATEMENT_TIMEOUT_CHECKED_FROM) return [];
  if (declaresMaintenanceWindow(sql)) return [];
  let budgetMs = DEFAULT_INSTALL_BUDGET_MS;
  try {
    const declared = declaredInstallBudgetSeconds(sql);
    if (declared !== null) budgetMs = declared * 1000;
  } catch {
    // Malformed budget declarations are refused by migration-install-budget.mjs.
    return [];
  }
  const { withStrings } = extractInstallExecutable(sql);
  // Replace every single-quoted literal with a placeholder token so SQL inside
  // cron.schedule('...', 'SET statement_timeout = ...') is never scanned as
  // top-level DDL, while keeping the literal's decoded value addressable.
  const strings = [];
  const tokenized = withStrings.replace(/'((?:[^']|'')*)'/g, (_m, inner) => {
    const idx = strings.length;
    strings.push(inner.replace(/''/g, "'"));
    return `__STR_${idx}__`;
  });
  const resolveVal = (token) => {
    const m = /^__STR_(\d+)__$/.exec(token.trim());
    return m ? strings[Number(m[1])] : token.trim();
  };
  const problems = [];
  const checkValue = (rawDisplay, valStr) => {
    if (/^default$/i.test(valStr.trim())) return;
    const ms = parseDurationMs(valStr);
    if (Number.isFinite(ms) && (ms === 0 || ms > budgetMs)) {
      problems.push(
        `sets statement_timeout = ${rawDisplay} (${ms === 0 ? 'disabled' : `${ms / 1000} s`}) inside an ordinary migration whose applier transaction_timeout is ${budgetMs / 1000} s - ` +
          `keep SET LOCAL statement_timeout <= '${budgetMs / 1000}s' (e.g. '8s' or '10s') so a slow statement cancels cleanly (57014) before the applier kills the connection (FATAL 25P04, incident 37a45c05).`
      );
    }
  };
  for (const stmt of tokenized.split(';')) {
    // Function/procedure/role/database-level SET statement_timeout is runtime
    // config, not an install-time session timeout.
    if (/^\s*alter\s+(?:function|procedure|role|user|database)\b/i.test(stmt)) continue;
    for (const m of stmt.matchAll(
      /\bset\s+(?:(?:local|session)\s+)?statement_timeout\s*(?:=|to)\s*(__STR_\d+__|[^\s;]+(?:\s+[a-z]+)?)/gi
    )) {
      const val = resolveVal(m[1]);
      checkValue(`'${val}'`, val);
    }
    for (const m of stmt.matchAll(
      /\bset_config\s*\(\s*(__STR_\d+__)\s*,\s*(__STR_\d+__)\s*,/gi
    )) {
      if (resolveVal(m[1]).trim().toLowerCase() === 'statement_timeout') {
        const val = resolveVal(m[2]);
        checkValue(`'${val}'`, val);
      }
    }
  }
  return problems;
}

/** True when this file is judged by migrationCostRisks. */
export const isCostChecked = (file) => String(file).slice(0, 14) >= COST_CHECKED_FROM;
