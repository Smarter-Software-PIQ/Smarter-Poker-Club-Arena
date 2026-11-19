/**
 * THE DRILL CHOOSES ITS CLUB, AND A WEEKLY FAILURE IS HEARD (2026-11-19).
 *
 * The weekly alarm drill aborted every run from 2026-11-09: it pinned its
 * subject to KINGS CLUB, which stopped holding an eligible house horse, and
 * the exception reached only cron.job_run_details. fn_ca_cron_failure_watch
 * never raised it, because it only considered jobs that ran in the last 24
 * hours. 20261119171234 fixes both; these cases pin the shape of each fix.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const FILE = '20261119171234_the_drill_chooses_its_club_and_weekly_failures_are_heard.sql';
const sql = readFileSync(join(ROOT, 'supabase/migrations', FILE), 'utf8');

const drill = sql.slice(
  sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_alarm_drill()'),
  sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_cron_failure_watch()')
);
const watch = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_ca_cron_failure_watch()'));

describe('the drill chooses its club', () => {
  it('no longer pins KINGS CLUB as a constant', () => {
    expect(drill).not.toMatch(/c_midway_club\s+constant/);
    expect(drill).toMatch(/c_midway_club uuid;/);
  });

  it('chooses the club with the subject, inside the Midway union and incident scope', () => {
    expect(drill).toContain('SELECT cm.club_id, cm.user_id INTO c_midway_club, c_cert_user');
    expect(drill).toContain("c.union_id = 'fade0000-0000-0000-0000-000000000001'");
    expect(drill).toContain('public.union_clubs');
    expect(drill).toContain('AND cm.club_id <> c_other_club');
    expect(drill).toContain('public.fn_ca_is_midway_scope(NULL, cm.club_id, NULL, NULL, NULL)');
    expect(drill).toMatch(/ORDER BY \(cm\.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'\) DESC, cm\.club_id, cm\.user_id/);
  });

  it('records a failing drill and pages when no subject exists, instead of throwing', () => {
    expect(drill).not.toContain('ALARM_DRILL_NO_SUBJECT');
    const noSubject = drill.slice(drill.indexOf('IF c_cert_user IS NULL THEN'), drill.indexOf('SET LOCAL lock_timeout'));
    expect(noSubject).toContain("VALUES (false, ARRAY['no_subject'], v_results)");
    expect(noSubject).toContain("'critical'");
    expect(noSubject).toContain("'alarm-drill-failed:'");
    expect(noSubject).toContain('RETURN jsonb_build_object');
  });

  it('keeps every arm, the existing exemption and service_role-only grants', () => {
    for (const c of [
      'negative_balance', 'correction_linkage',
      'rake_terminal_refusal_releases_its_table', 'manifest_refusal_is_named',
    ]) {
      expect(drill).toContain(`'check','${c}'`);
    }
    expect(sql).toMatch(/^-- @probe-exempt: public\.fn_ca_alarm_drill /m);
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.fn_ca_alarm_drill() FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.fn_ca_alarm_drill() TO service_role;');
  });
});

describe('a weekly failure is heard', () => {
  it('reads the newest finished run in the same single 7-day pass', () => {
    expect(watch.match(/FROM cron\.job_run_details/g)).toHaveLength(1);
    expect(watch).toContain("WHERE d.start_time > now() - interval '7 days'");
    expect(watch).toContain("bool_or(x.finished_rank = 1 AND x.status = 'failed') AS last_finished_failed");
    expect(watch).toContain("OR bool_or(x.finished_rank = 1 AND x.status = 'failed')");
  });

  it('raises a job that has not run in 24h and whose last run failed, keyed to that run', () => {
    expect(watch).toContain('OR (day.runs_24h = 0 AND day.last_finished_failed)');
    expect(watch).toContain("'cron-failing:' || r.jobname || ':run:'");
    expect(watch).toContain("ELSE 'cron-failing:' || r.jobname || ':' || CURRENT_DATE::text END");
  });

  it('is probed before commit and keeps service_role-only grants', () => {
    expect(sql).toMatch(/^-- @probe-for: public\.fn_ca_cron_failure_watch$/m);
    expect(sql).toContain('PERFORM public.fn_ca_cron_failure_watch();');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.fn_ca_cron_failure_watch() TO service_role;');
  });
});
