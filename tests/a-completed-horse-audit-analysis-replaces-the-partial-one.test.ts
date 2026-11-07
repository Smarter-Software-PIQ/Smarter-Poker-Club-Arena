/**
 * A completed horse audit analysis replaces the partial one it completes
 * (2026-11-07, migration 20261107191435). The 2026-11-06 analysis that
 * finished the 20-biggest-losses sweep went to the submissions log as
 * retained_existing and never reached the Hand Reviews panel, because the
 * save kept the first analysis written for a day. These pins keep both
 * halves of the rule: a submission that carries every stored flaw unchanged
 * and adds more replaces the stored one; any other differing submission is
 * still kept out of the audit row.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20261107191435_a_completed_horse_audit_analysis_replaces_the_partial_one.sql',
  'utf8'
);
const body = (name: string) => {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf('$f$;', start));
};

describe('a completed horse audit analysis replaces the partial one', () => {
  it('is one transaction with a live proof', () => {
    expect(SQL).toMatch(/^BEGIN;$/m);
    expect(SQL).toMatch(/^COMMIT;$/m);
    expect(SQL).toMatch(/^-- @live-proof: /m);
  });

  it('completion means every stored flaw kept exactly and strictly more flaws', () => {
    const f = body('fn_horse_audit_analysis_completes');
    expect(f).toContain("jsonb_array_length(p_next -> 'flaws') > jsonb_array_length(p_prior -> 'flaws')");
    expect(f).toContain('WHERE nf.flaw = pf.flaw');
  });

  it('the save replaces only on completion, and keeps first-write-wins otherwise', () => {
    const start = SQL.indexOf('CREATE OR REPLACE FUNCTION public.fn_horse_audit_set_agent_analysis(');
    const fn = SQL.slice(start, SQL.indexOf('$function$;', start));
    const completes = fn.indexOf('ELSIF public.fn_horse_audit_analysis_completes(v_audit.agent_analysis, p_analysis) THEN');
    const otherwise = fn.indexOf("v_outcome := 'retained_existing';");
    expect(completes).toBeGreaterThan(fn.indexOf("v_outcome := 'duplicate';"));
    expect(otherwise).toBeGreaterThan(completes);
    expect(fn.slice(completes, otherwise)).toContain("SET outcome = 'superseded'");
    expect(fn.slice(completes, otherwise)).toContain("v_outcome := 'completes_existing'");
    // The superseded analysis is re-marked, never deleted.
    expect(fn).not.toMatch(/DELETE\s+FROM/i);
    // The FOR UPDATE row lock still serialises concurrent saves.
    expect(fn).toContain('WHERE day = p_day FOR UPDATE');
  });

  it('the 2026-11-06 promotion is guarded on both md5s and uses the same rule', () => {
    expect(SQL).toContain("analysis_md5 = '3cd21f2c9cf07bf69465dfe9b2d0aba4'");
    expect(SQL).toContain("<> '1c32430beee1f03f415873b8f56d17ff'");
    expect(SQL).toContain('fn_horse_audit_analysis_completes(v_audit.agent_analysis, v_sub.analysis)');
  });
});
