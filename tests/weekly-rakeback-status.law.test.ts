/**
 * WEEKLY RAKEBACK STATUS ONLY READS (owner, 2026-11-15)
 *
 * 20261116020505 adds public.ca_union_weekly_rakeback_status for the Union
 * Statements page. The weekly payout runs while union owners watch this
 * screen, so the law is: one new function, plain SELECTs only (no row locks,
 * no writes, no advisory locks), its own short limits, exactly the statement
 * board's caller rule and grants, and a client that polls once a minute only
 * while the payout is in progress. Behaviour is proved on native PostgreSQL
 * 17 by scripts/ci/test-weekly-rakeback-status-postgres.py.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = 'supabase/migrations';
const name = readdirSync(dir).filter((file) =>
  file.endsWith('_weekly_rakeback_status_for_union_owners.sql')
);
if (name.length !== 1) throw new Error('Expected One Weekly Rakeback Status Migration');
const sql = readFileSync(`${dir}/${name[0]}`, 'utf8');
const code = sql.replace(/--[^\n]*/g, '');
const client = readFileSync('src/components/union/WeeklyRakebackStatus.tsx', 'utf8');
const SIG = 'public.ca_union_weekly_rakeback_status(uuid,timestamptz)';

describe('weekly rakeback status only reads', () => {
  it('is one transaction with short limits and a single-line live proof', () => {
    expect(code.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.trim().endsWith('COMMIT;')).toBe(true);
    expect(code).toMatch(
      /BEGIN;\s*SET LOCAL lock_timeout='1s';\s*SET LOCAL statement_timeout='20s';/
    );
    expect(sql.match(/^-- @live-proof: .+$/gm)).toHaveLength(1);
  });

  it('creates exactly one new function and changes nothing that exists', () => {
    expect(code).not.toMatch(/CREATE\s+OR\s+REPLACE/i);
    expect(code.match(/CREATE (FUNCTION|TABLE|TRIGGER|VIEW|INDEX)/g)).toEqual(['CREATE FUNCTION']);
    expect(code).toContain(
      'CREATE FUNCTION public.ca_union_weekly_rakeback_status(p_union_id uuid, p_period_end timestamptz DEFAULT NULL)'
    );
    expect(code).not.toMatch(/\b(ALTER|DROP)\s/i);
  });

  it('only reads: no writes, no row locks, no advisory locks, own limits', () => {
    expect(code).not.toMatch(
      /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|TRUNCATE|PERFORM)\b/i
    );
    expect(code).not.toMatch(/\bFOR\s+(UPDATE|SHARE|NO\s+KEY|KEY\s+SHARE)\b/i);
    expect(code).not.toMatch(/advisory|LOCK\s+TABLE|cron\./i);
    expect(code).toMatch(
      /STABLE SECURITY DEFINER\s+SET search_path TO 'public'\s+SET statement_timeout TO '5s'\s+SET lock_timeout TO '1s'/
    );
  });

  it('uses the Union Statements board caller rule and grants', () => {
    expect(code).toContain(
      "IF NOT ca_can_oversee_union(p_union_id) THEN\n    RAISE EXCEPTION 'not authorized for this union' USING ERRCODE = '42501';\n  END IF;"
    );
    expect(code).toContain(`REVOKE ALL ON FUNCTION ${SIG} FROM PUBLIC,anon;`);
    expect(code).toContain(`GRANT EXECUTE ON FUNCTION ${SIG} TO authenticated,service_role;`);
  });

  it('polls once a minute only while the payout is in progress', () => {
    expect(readFileSync('src/utils/weeklyRakebackStatus.ts', 'utf8')).toContain(
      'export const WEEKLY_RAKEBACK_REFRESH_MS = 60_000;'
    );
    expect(client.match(/setTimeout\(/g)).toHaveLength(1);
    expect(client).toMatch(
      /if \(next\?\.in_progress\) \{\s+timer\.current = setTimeout\(\(\) => void load\(\), WEEKLY_RAKEBACK_REFRESH_MS\);/
    );
    expect(client).not.toMatch(/setInterval/);
    expect(client).toContain("from '../../pages/UnionStatementsPage.module.css'");
    expect(client).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i);
  });

  it('derives Late only from deadlines the payout code enforces, never an invented threshold', () => {
    // The only interval constants: the week arithmetic (1 day) and the
    // automatic payout window (run time + 24 hours, weekly_payout_next_round).
    expect([...code.matchAll(/interval '([^']+)'/g)].map((m) => m[1]).sort()).toEqual([
      '-5 hours',
      '-5 hours',
      '-5 hours',
      '1 day',
      '24 hours',
    ]);
    expect(code).toContain("v_window_end := v_due + interval '24 hours';");
    expect(code).toContain('v_deadline := v_money_deadline;');
    // Stages with no authoritative deadline carry none and are never late.
    for (const key of ['statements_sent', 'invoices_match', 'books_closed']) {
      const block = code.slice(code.indexOf(`'key', '${key}'`));
      expect(block.slice(0, block.indexOf(');'))).toContain("'deadline_at', NULL");
    }
  });

  it('shows the verification stages green only from their records', () => {
    expect(code).toContain("v_state := 'not_checked';");
    expect(code).toMatch(/IF st\.mismatched \+ st\.unread > 0 THEN\s+v_state := 'failed';/);
    expect(code).toMatch(/ELSIF st\.n > 0 AND st\.ok = st\.n THEN\s+v_state := 'done';/);
    expect(code).toContain(
      "IF v_bk_status = 'complete' AND v_bk_finished IS NOT NULL AND v_bk_success = 'true' THEN"
    );
    expect(code).toContain("'time_zone', 'America/Chicago'");
  });

  it('carries no banned dash character', () => {
    expect(sql).not.toMatch(/[‒-―]/);
    expect(client).not.toMatch(/[‒-―]/);
  });
});
