/**
 * THE DRILL SKIPS DELETE-PROTECTED CLUBS, AND A PROVEN JOB CLEARS ITS FAILURE
 * (2026-11-19, incident 316ed735, drift incident 28e0b04d).
 *
 * 20261119171234 let the weekly alarm drill choose its club and taught
 * fn_ca_cron_failure_watch to raise a weekly job whose newest run failed. Two
 * defects followed:
 *
 * - KINGS CLUB had no eligible house horse, so the drill chose Deep Stack
 *   Society, whose club_members rows carry trg_deep_stack_members_are_protected.
 *   Arm 7 (delete_journals_burn) was refused before its detector ran.
 * - The watch re-raised the old 2026-11-16 failure every 30 minutes, and only
 *   the next weekly cron run could clear it, though the cause was already
 *   fixed and run live.
 *
 * The newest migration that defines each function is the one production runs,
 * so these laws read that one. A later redefinition that drops either rule
 * fails here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const DIR = join(ROOT, 'supabase/migrations');
const FIX = '20261120222900';

function newestBody(head: string) {
  const file = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => readFileSync(join(DIR, f), 'utf8').includes(head))
    .pop()!;
  const sql = readFileSync(join(DIR, file), 'utf8');
  const start = sql.indexOf(head);
  return { file, sql, body: sql.slice(start, sql.indexOf('$function$;', start)) };
}

const drill = newestBody('CREATE OR REPLACE FUNCTION public.fn_ca_alarm_drill()');
const watch = newestBody('CREATE OR REPLACE FUNCTION public.fn_ca_cron_failure_watch()');
const choiceAt = drill.body.indexOf('INTO c_midway_club, c_cert_user');
const choice = drill.body.slice(choiceAt, drill.body.indexOf('LIMIT 1;', choiceAt));

describe('the drill skips delete-protected clubs', () => {
  it('is defined no earlier than the fix', () => {
    expect(drill.file >= FIX).toBe(true);
  });

  it('chooses its subject from a club no BEFORE DELETE trigger on club_members names', () => {
    expect(choice).toContain('AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t');
    expect(choice).toContain("t.tgrelid = 'public.club_members'::regclass");
    expect(choice).toContain('NOT t.tgisinternal');
    expect(choice).toContain("t.tgenabled <> 'D'");
    expect(choice).toContain('(t.tgtype & 8) <> 0');
    expect(choice).toContain(
      "pg_catalog.pg_get_triggerdef(t.oid) LIKE '%' || cm.club_id::text || '%'"
    );
    expect(choice).toContain(
      "pg_catalog.pg_get_functiondef(t.tgfoid) LIKE '%' || cm.club_id::text || '%'"
    );
  });

  it('never turns the Deep Stack teardown switch on to get its delete through', () => {
    expect(drill.body).not.toContain('app.deep_stack_teardown');
  });

  it('still drills the burn on delete, and keeps its choice repeatable and in scope', () => {
    expect(drill.body).toContain("'check','delete_journals_burn'");
    expect(choice).toContain('public.fn_ca_is_midway_scope(NULL, cm.club_id, NULL, NULL, NULL)');
    expect(choice).toMatch(
      /ORDER BY \(cm\.club_id = 'a41434bb-8d0c-400a-8f0d-e8b3d65afed4'\) DESC, cm\.club_id, cm\.user_id/
    );
  });

  it('records a completed run only after every arm ran, never on the no-subject path', () => {
    const record =
      "INSERT INTO public.ca_detector_runs (detector, detail)\n  VALUES ('fn_ca_alarm_drill'";
    expect(drill.body.split(record)).toHaveLength(2);
    const noSubject = drill.body.slice(
      drill.body.indexOf('IF c_cert_user IS NULL THEN'),
      drill.body.indexOf('SET LOCAL lock_timeout')
    );
    expect(noSubject).not.toContain('ca_detector_runs');
    const lastArm = drill.body.indexOf("'check','manifest_refusal_is_named'");
    expect(drill.body.indexOf(record)).toBeGreaterThan(lastArm);
  });
});

describe('a proven job clears its weekly failure', () => {
  it('is defined no earlier than the fix', () => {
    expect(watch.file >= FIX).toBe(true);
  });

  it('still hears a weekly job immediately on its own last failed run and sorts it ahead of frequent failures', () => {
    expect(watch.body).toContain(
      "count(*) FILTER (WHERE x.status IN ('failed', 'succeeded')) AS runs_7d"
    );
    expect(watch.body).toContain(
      'OR ((day.runs_24h = 0 OR day.runs_7d = 1) AND day.last_finished_failed'
    );
    expect(watch.body).toContain(
      'ORDER BY ((day.runs_24h = 0 OR day.runs_7d = 1) AND day.last_finished_failed) DESC, day.fails DESC, day.jobname'
    );
    expect(watch.body).toContain("'cron-failing:' || r.jobname || ':run:'");
  });

  it("does not raise it once the job's one function recorded a completed run after the failure", () => {
    const rule = watch.body.slice(
      watch.body.indexOf('OR ((day.runs_24h = 0 OR day.runs_7d = 1) AND day.last_finished_failed')
    );
    expect(rule).toContain('AND NOT EXISTS (');
    expect(rule).toContain('SELECT 1 FROM public.ca_detector_runs pr');
    expect(rule).toContain(
      "day.command ~* '^\\s*select\\s+(public\\.)?fn_[a-z0-9_]+\\(\\s*\\)\\s*;?\\s*$'"
    );
    expect(rule).toContain("pr.detector = substring(day.command from '(fn_[A-Za-z0-9_]+)\\(')");
    expect(rule).toContain('pr.ran_at > day.last_finished_at');
    expect(rule).toContain("COALESCE((pr.detail->>'pass')::boolean, true)");
    expect(watch.body).toContain('SELECT j.jobid, j.jobname, j.command,');
    expect(watch.body).toContain('GROUP BY j.jobid, j.jobname, j.command');
  });

  it('keeps the daily rules free of the proof, so a daily job is judged on its runs alone', () => {
    const where = watch.body.slice(
      watch.body.indexOf('WHERE (day.finished = 3'),
      watch.body.indexOf('OR ((day.runs_24h = 0 OR day.runs_7d = 1)')
    );
    expect(where).not.toContain('ca_detector_runs');
  });

  it('is declared, probed before commit and service_role only', () => {
    expect(watch.sql).toContain(
      "SELECT public.fn_ca_declare_guard_redefinition('fn_ca_cron_failure_watch'"
    );
    expect(watch.sql).toMatch(/^-- @probe-for: public\.fn_ca_cron_failure_watch$/m);
    expect(watch.sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_cron_failure_watch() TO service_role;'
    );
    expect(drill.sql).toMatch(/^-- @probe-exempt: public\.fn_ca_alarm_drill /m);
    expect(drill.sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.fn_ca_alarm_drill() TO service_role;'
    );
    expect(drill.sql).toMatch(/^BEGIN;$/m);
    expect(drill.sql.trim().endsWith('COMMIT;')).toBe(true);
  });
});
