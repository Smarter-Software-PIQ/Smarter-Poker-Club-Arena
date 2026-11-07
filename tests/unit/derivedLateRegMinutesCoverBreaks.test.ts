import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * 2026-11-07 (Dan: "FINISH THIS UP YOURSELF"). The final INSERT trigger wrote
 * late_reg_mins as the nominal length of the entry levels, and the :55 break
 * stops the level clock about ten minutes while that clock runs on, so every
 * break-taking event whose window crossed a break closed entry before its
 * advertised last level. Proven against a copy of the live trigger on
 * PostgreSQL 16 before merge (see the changelog). This pins the rule's shape.
 */
const sql = readFileSync(
  'supabase/migrations/20261107043847_derived_late_reg_minutes_cover_the_breaks.sql',
  'utf8'
);

describe('derived late-reg minutes cover the breaks', () => {
  it('is one transaction with bounded locks and a live proof', () => {
    expect(sql.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(sql.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(sql).toContain("SET LOCAL lock_timeout = '1s';");
    expect(sql.split('\n')[0]).toMatch(/^-- @live-proof: /);
  });

  it('patches the one authority that writes the value, refusing drift', () => {
    expect(sql).toContain(
      "pg_get_functiondef('public.fn_ca_tournament_level_clock_floor()'::regprocedure)"
    );
    expect(sql).toContain('source drift: expected one derived-minutes block');
    expect(sql).toContain('already carries the break allowance');
  });

  it('adds the allowance only for break-taking MTTs and never for Free Buys', () => {
    const guard = sql.slice(sql.indexOf('v_after text'), sql.indexOf('v_count integer'));
    expect(guard).toContain("NEW.format_contract::text IN (''mtt-v1'',''mtt-v2'')");
    expect(guard).toContain('NEW.synchronized_breaks IS DISTINCT FROM false');
    expect(guard).toContain('NOT coalesce(NEW.free_buy,false)');
    expect(guard).toContain("~ ''free ?buy''");
  });

  it('backfills only upcoming rows still carrying the derived value, through the sanctioned path', () => {
    const fill = sql.slice(sql.indexOf('$backfill$'));
    expect(fill).toContain("set_config('app.lock_level_clock', 'on', true)");
    expect(fill).toContain('t.started_at IS NULL');
    expect(fill).toContain('AND t.late_reg_mins = c.nominal');
    expect(fill).toContain('NOT coalesce(t.free_buy,false)');
  });

  it('allows ten minutes per break the grown window can cross', () => {
    // Mirror of fn_ca_late_registration_break_allowance, checked against the
    // values the migration's live proof asserts on production.
    const allowance = (nominal: number) => {
      if (nominal <= 0) return 0;
      let allow = 0;
      for (let i = 0; i < 10; i++) {
        const next = 10 * (Math.floor((nominal + allow) / 60) + 1);
        if (next === allow) break;
        allow = next;
      }
      return allow;
    };
    expect([allowance(60), allowance(108), allowance(120), allowance(0)]).toEqual([20, 30, 30, 0]);
    expect(sql).toContain('fn_ca_late_registration_break_allowance(120) = 30');
    expect(sql).toContain('fn_ca_late_registration_break_allowance(60) = 20');
  });
});
