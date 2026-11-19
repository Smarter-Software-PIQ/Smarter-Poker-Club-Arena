/**
 * THE DRILL REHEARSES THE RAKE AND MANIFEST GUARANTEES (2026-11-19).
 *
 * Incident d2d79c4f left three guarantees no production event had ever
 * exercised. 20261119052731 adds two arms to the weekly alarm drill; the
 * third (the DDL law) is proven in CI because proving it takes DDL. These
 * cases pin that every arm still unwinds, that each new arm keeps the drill's
 * silent-versus-could-not-arm reading, that the drill body is production's own
 * plus the arms, and that the DDL proof stays wired to every migration PR.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const FILE = '20261119052731_the_drill_rehearses_the_rake_and_manifest_guarantees.sql';
const sql = readFileSync(join(ROOT, 'supabase/migrations', FILE), 'utf8');
const workflow = readFileSync(
  join(ROOT, '.github/workflows/the-provenance-law-refuses-a-dropped-fallback.yml'),
  'utf8'
);
const script = readFileSync(join(ROOT, 'scripts/ci/test-provenance-law-refuses-a-dropped-fallback.sh'), 'utf8');

function arm(check: string): string {
  const start = sql.lastIndexOf('  v_ok := false;', sql.indexOf(`'check','${check}'`));
  return sql.slice(start, sql.indexOf('END IF;', sql.indexOf(`'check','${check}'`)) + 'END IF;'.length);
}

describe('the drill rehearses the rake and manifest guarantees', () => {
  it('keeps all nine existing arms and adds the two new ones before the record step', () => {
    for (const c of [
      'negative_balance', 'suspense_regression', 'mint_velocity', 'raise_scope_and_notify',
      'conservation_quarantine', 'journals_append_only', 'delete_journals_burn',
      'settlement_guard', 'correction_linkage',
      'rake_terminal_refusal_releases_its_table', 'manifest_refusal_is_named',
    ]) {
      expect(sql).toContain(`'check','${c}'`);
    }
    const record = sql.indexOf('INSERT INTO public.ca_alarm_drills');
    expect(sql.indexOf("'check','rake_terminal_refusal_releases_its_table'")).toBeLessThan(record);
    expect(sql.indexOf("'check','manifest_refusal_is_named'")).toBeLessThan(record);
  });

  it('unwinds both new arms and keeps a quiet detector silent rather than unarmed', () => {
    for (const c of ['rake_terminal_refusal_releases_its_table', 'manifest_refusal_is_named']) {
      const body = arm(c);
      expect(body).toContain("RAISE EXCEPTION 'CA_DRILL_UNWIND'");
      expect(body).toContain("IF SQLERRM <> 'CA_DRILL_UNWIND' THEN v_ok := false; v_note := left(SQLERRM, 120); END IF;");
      // Assertion failures go to detail, never note: an empty note is what
      // makes a quiet detector page critical.
      expect(body).not.toMatch(/v_note := '[a-z]/);
      expect(body).toContain("'detail',v_detail");
    }
  });

  it('refuses the rake deterministically and requires one alert and no re-ask', () => {
    const body = arm('rake_terminal_refusal_releases_its_table');
    expect(body).toContain('9999999999999');
    expect(body).toContain("source = 'bank_obligation_terminal_refusal'");
    expect(body).toContain('v_n <> 1');
    expect(body.match(/fn_ca_bank_pending_cash_rake\(v_drill_hand\)/g)?.length).toBe(2);
  });

  it('injects a defect the manifest capture does not own and requires one critical alert', () => {
    const body = arm('manifest_refusal_is_named');
    expect(body).toContain('alarm-drill-not-a-uuid');
    expect(body).toContain("'22P02'");
    expect(body).toContain("severity = 'critical'");
    expect(body).toContain('no live cash table lease to arm the manifest refusal');
  });

  it('is exempt from the install probe with its reason, and keeps service_role-only grants', () => {
    expect(sql).toMatch(/^-- @probe-exempt: public\.fn_ca_alarm_drill .{20,}$/m);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.fn_ca_alarm_drill() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.fn_ca_alarm_drill() TO service_role;');
  });

  it('proves the DDL law on every migration pull request against the guard\'s own bytes', () => {
    expect(workflow).toContain('supabase/migrations/**');
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).toContain('bash scripts/ci/test-provenance-law-refuses-a-dropped-fallback.sh');
    expect(script).toContain('CREATE OR REPLACE FUNCTION smarter_private.fn_cash_rake_provenance_law_guard()');
    expect(script).toContain('no longer protects');
  });
});
