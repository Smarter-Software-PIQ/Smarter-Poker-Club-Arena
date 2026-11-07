/**
 * A pending horse audit analysis that completes another is kept, and a save
 * racing the machine audit is never orphaned (2026-11-07, migration
 * 20261107213505). Follow-up to 20261107191435, which taught the direct save
 * the completion rule; these pins hold the same rule on the pending path and
 * the lock that closes the save/audit race. The installed behaviour is proved
 * by a rolled-back production probe recorded in
 * docs/changelog/2026-11-07-a-pending-horse-audit-analysis-that-completes-another-is-kept.md.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SQL = readFileSync(
  'supabase/migrations/20261107213505_a_pending_horse_audit_analysis_that_completes_another_is_kep.sql',
  'utf8'
);
const fn = (name: string) => {
  const start = SQL.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThan(-1);
  return SQL.slice(start, SQL.indexOf('$function$;', start));
};

describe('a pending horse audit analysis that completes another is kept', () => {
  it('is one transaction with a live proof', () => {
    expect(SQL).toMatch(/^BEGIN;$/m);
    expect(SQL).toMatch(/^COMMIT;$/m);
    expect(SQL).toMatch(/^-- @live-proof: /m);
  });

  it('the attach trigger walks every pending submission in order with the completion rule', () => {
    const t = fn('fn_horse_audit_attach_pending_analysis');
    expect(t).toContain('ORDER BY s.submitted_at ASC, s.id ASC');
    expect(t).toContain(
      'public.fn_horse_audit_analysis_completes(v_chosen.analysis, v_sub.analysis)'
    );
    expect(t).toContain("SET outcome = 'superseded'");
    expect(t).toContain("SET outcome = 'completes_existing'");
    expect(t).toContain("SET outcome = 'retained_existing'");
    // Only the analysis the walk ends on is written to the audit row.
    expect(t).toContain('NEW.agent_analysis := v_chosen.analysis;');
    expect(t).not.toMatch(/DELETE\s+FROM/i);
  });

  it('save and trigger share the day lock, and the trigger takes it only when attaching', () => {
    const t = fn('fn_horse_audit_attach_pending_analysis');
    const early = t.indexOf(
      "IF NEW.agent_analysis IS NOT NULL OR NEW.stats IS NULL OR NEW.stats = '{}'::jsonb THEN"
    );
    const lock = t.indexOf(
      'pg_advisory_xact_lock(public.fn_horse_audit_analysis_day_lock(NEW.day))'
    );
    expect(early).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(early);
    const s = fn('fn_horse_audit_set_agent_analysis');
    const firstRead = s.indexOf('WHERE day = p_day FOR UPDATE;');
    const saveLock = s.indexOf(
      'pg_advisory_xact_lock(public.fn_horse_audit_analysis_day_lock(p_day))'
    );
    const pending = s.indexOf("v_outcome := 'pending_machine_audit';");
    // The save locks only on the no-usable-row path, then reads again before deciding "pending".
    expect(saveLock).toBeGreaterThan(firstRead);
    expect(pending).toBeGreaterThan(saveLock);
    expect(s.slice(saveLock, pending)).toContain('WHERE day = p_day FOR UPDATE;');
  });

  it('the direct save keeps the completion rule from 20261107191435', () => {
    const s = fn('fn_horse_audit_set_agent_analysis');
    const completes = s.indexOf(
      'ELSIF public.fn_horse_audit_analysis_completes(v_audit.agent_analysis, p_analysis) THEN'
    );
    const otherwise = s.indexOf("v_outcome := 'retained_existing';");
    expect(completes).toBeGreaterThan(s.indexOf("v_outcome := 'duplicate';"));
    expect(otherwise).toBeGreaterThan(completes);
  });
});
