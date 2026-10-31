import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * On 2026-10-30 an owner start hold let 79 tournaments start against a
 * seven-day median of 10,507, and the daily analysis could not attribute the
 * 94 layer warnings that followed. The audit now names the collapse.
 */
const ROOT = path.resolve(__dirname, '..');
const FILE = 'supabase/migrations/20261031230756_the_audit_names_a_tournament_start_collapse.sql';
const MIGRATION = fs.readFileSync(path.join(ROOT, FILE), 'utf8');

describe('the audit names a tournament start collapse', () => {
  it('compares the day starts with half the seven-day median', () => {
    expect(MIGRATION).toContain('if v_median >= 100 and v_started < v_median * 0.5 then');
    expect(MIGRATION).toContain("'code','tournament_starts_collapsed'");
  });

  it('carries the cancellations and the start hold as evidence', () => {
    expect(MIGRATION).toContain("'cancelled', v_cancelled");
    expect(MIGRATION).toContain('from ca_tournament_start_hold h where h.singleton');
  });

  it('keeps the scoreboard and its missing-rows finding', () => {
    expect(MIGRATION).toContain("'code','tournament_results_missing'");
    expect(MIGRATION).toContain("'code','tournament_results'");
  });

  it('replaces only the body it was written against and keeps the grants', () => {
    expect(MIGRATION).toContain("IS DISTINCT FROM 'b68ce5ad03f94cd1c0f8a78eef1316a7'");
    expect(MIGRATION).toMatch(/^BEGIN;$/m);
    expect(MIGRATION).toMatch(/^COMMIT;$/m);
    expect(MIGRATION).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_audit_tournament_results(date) TO service_role;'
    );
  });
});
