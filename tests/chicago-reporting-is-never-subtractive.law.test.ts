/**
 * LAW — CHICAGO REPORTING FUNCTIONS ARE PURELY ADDITIVE (NEVER SUBTRACTIVE)
 *
 * Incident 2026-11-19:
 * Subtracting raw `ca_hand_facts` edge slices from UTC-bucketed
 * `member_record_daily_facts` / `ca_stats_member_record_daily_facts` /
 * `ca_member_record_daily_facts` fails whenever post-commit `rake_attributions`
 * arrives after the `ca_hand_facts` insert trigger updated the UTC daily rollup
 * under the table's union club. At read time, `fn_member_record_fact_club(f)`
 * resolves to the player's club, so subtracting the raw edge from a zero club
 * rollup produces negative hand counts (e.g. hands = -1) and phantom positive
 * winnings (e.g. +$5.00 on a day with 0 hands).
 *
 * Every Chicago-boundary reporting function MUST use purely additive disjoint
 * interval decomposition: complete interior UTC days from daily rollups PLUS
 * partial-day slices directly from `ca_hand_facts`.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations');
const ADDITIVE_CASH_MIGRATION =
  '20261119180000_chicago_cash_windows_add_partial_days_instead_of_subtracting.sql';
const ADDITIVE_MEMBER_FACTS_MIGRATION =
  '20261119174407_member_chicago_facts_add_partial_days_instead_of_subtracting.sql';

const REQUIRED_ADDITIVE_CASH_FUNCTIONS = [
  'ca_club_member_chicago_today_cash',
  'ca_club_member_chicago_cash',
  'ca_club_members_cash_window',
];

/**
 * Strip SQL line comments (-- ...) and block comments (/* ... *\/) outside
 * quoted literals so pattern checks cannot be fooled or bypassed by comments.
 */
function stripSqlComments(sql: string): string {
  let out = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    // Line comment
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (sql[i] === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    // Single-quoted string
    if (sql[i] === "'") {
      out += sql[i++];
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          out += "''";
          i += 2;
        } else if (sql[i] === "'") {
          out += sql[i++];
          break;
        } else {
          out += sql[i++];
        }
      }
      continue;
    }
    out += sql[i++];
  }
  return out;
}

/**
 * Extract the latest CREATE [OR REPLACE] FUNCTION declaration for every
 * function defined across supabase/migrations/*.sql in chronological order.
 */
function collectLatestFunctionDefinitions(): Map<string, { file: string; body: string }> {
  const latest = new Map<string, { file: string; body: string }>();
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const headerRe =
    /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?([a-zA-Z0-9_]+)"?\s*\(/gi;

  for (const file of files) {
    const raw = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // Fast prefilter: only parse files that define a function mentioning
    // either Chicago cash/facts names or member_record_daily_facts + ca_hand_facts.
    if (
      !raw.includes('ca_club_member_chicago_') &&
      !raw.includes('ca_club_members_cash_window') &&
      !raw.includes('ca_member_record_chicago_facts') &&
      !(raw.includes('member_record_daily_facts') && raw.includes('ca_hand_facts'))
    ) {
      continue;
    }

    headerRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = headerRe.exec(raw)) !== null) {
      const fnName = m[1].toLowerCase();
      const start = m.index;
      // Locate the AS $<tag>$ ... $<tag>$ body terminator.
      const asMatch = /\bAS\s+(\$[a-zA-Z0-9_]*\$)/i.exec(raw.slice(start));
      if (!asMatch) continue;
      const tag = asMatch[1];
      const bodyStart = start + asMatch.index + asMatch[0].length;
      const bodyEnd = raw.indexOf(tag, bodyStart);
      if (bodyEnd === -1) continue;
      const decl = raw.slice(start, bodyEnd + tag.length);
      latest.set(fnName, { file, body: decl });
      headerRe.lastIndex = bodyEnd + tag.length;
    }
  }
  return latest;
}

/**
 * Detect subtractive edge-math patterns against daily_facts + ca_hand_facts.
 */
function hasSubtractiveEdgeMath(rawDecl: string): boolean {
  const sql = stripSqlComments(rawDecl);
  // Pattern 1: `(SELECT ... daily_facts ...) - (SELECT ... ca_hand_facts ...)`
  if (/member_record_daily_facts[\s\S]*?\)\s*-\s*\(\s*SELECT[\s\S]*?ca_hand_facts/i.test(sql)) {
    return true;
  }
  // Pattern 2: `coalesce(d.net, 0) - coalesce(r.net, 0)` (removed edge CTE)
  if (/coalesce\s*\(\s*[a-z_]+\.net\s*,\s*0\s*\)\s*-\s*coalesce\s*\(/i.test(sql)) {
    return true;
  }
  // Pattern 3: negative sign multiplier (`-1,`, `-coalesce(f.net`) in UNION ALL edge slice
  if (/ca_hand_facts[\s\S]*?-\s*coalesce\s*\(\s*f\.(?:net|rake_paid)/i.test(sql)) {
    return true;
  }
  if (/VALUES\s*\(\s*b\.u[st][^)]*\)\s*,\s*\(\s*b\.c[es]/i.test(sql)) {
    return true;
  }
  return false;
}

describe('Chicago reporting functions are purely additive (never subtractive)', () => {
  const latest = collectLatestFunctionDefinitions();

  it('converts all three Chicago cash window functions to purely additive decomposition', () => {
    for (const fn of REQUIRED_ADDITIVE_CASH_FUNCTIONS) {
      const entry = latest.get(fn);
      expect(entry, `missing latest definition for ${fn}`).toBeDefined();
      expect(
        hasSubtractiveEdgeMath(entry!.body),
        `${fn} (last defined in ${entry!.file}) still uses subtractive ca_hand_facts edge math`
      ).toBe(false);
    }
  });

  it('forbids ANY function in supabase/migrations from subtracting ca_hand_facts from member_record_daily_facts', () => {
    const memberFactsAdditiveMerged = existsSync(
      join(MIGRATIONS_DIR, ADDITIVE_MEMBER_FACTS_MIGRATION)
    );
    const offenders: string[] = [];

    for (const [fnName, { file, body }] of latest.entries()) {
      // If PR #11420 (20261119174407) is not yet merged on this branch, skip only
      // ca_member_record_chicago_facts; once merged, it is enforced permanently too.
      if (!memberFactsAdditiveMerged && fnName === 'ca_member_record_chicago_facts') {
        continue;
      }
      const clean = stripSqlComments(body);
      if (
        /member_record_daily_facts/i.test(clean) &&
        /ca_hand_facts/i.test(clean) &&
        hasSubtractiveEdgeMath(body)
      ) {
        offenders.push(`${fnName} (${file})`);
      }
    }

    expect(
      offenders,
      `Subtractive Chicago reporting functions found: ${offenders.join(', ')}`
    ).toEqual([]);
  });

  it('preserves security, timeouts, private ACLs, and @live-proof checks in the additive cash migration', () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, ADDITIVE_CASH_MIGRATION), 'utf8');
    expect(sql).toContain("SET LOCAL lock_timeout = '1s';");
    expect(sql).toContain("SET LOCAL statement_timeout = '8s';");
    expect(sql).toContain('-- @live-proof:');
    for (const fn of REQUIRED_ADDITIVE_CASH_FUNCTIONS) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}(`);
    }
    expect(sql).toContain('STABLE SECURITY DEFINER');
    expect(sql).toContain("SET search_path TO 'public', 'pg_temp'");
    expect(sql).toContain('public.ca_stats_member_record_daily_facts');
  });
});
