-- 20261120011743_a_cron_proof_needs_a_migration_that_redefines_the_function.sql
--
-- WHAT THIS CHANGES, AND WHY (Phase 2 hardening of 20261119234324, the
-- controller's recovery runbooks):
--
-- cron_proof_run treats "the cause has been fixed" as: a migration authored
-- after the failed run is installed and its statements contain the job
-- function's name. Verified live at 01:14 UTC on 2026-11-20, the first pass on
-- incident 316ed735 named 20261119234324 as the fix for fn_ca_alarm_drill: that
-- is the controller's own install, which only MENTIONS the drill (its
-- allowlist and its proof call). The real fix (20261119183127) was also
-- installed, so the decision was right, but a migration that merely names a
-- function would let a broken job be run again on no evidence.
--
-- The evidence is now a migration that REDEFINES the function: CREATE [OR
-- REPLACE] FUNCTION [public.]fn_x( or an anchored edit reading
-- pg_get_functiondef('[public.]fn_x()'). Nothing else in the runbook changes.
-- Proven by scripts/ci/test-reliability-runbooks.py (a naming-only migration is
-- not evidence) and pinned by tests/the-controller-runs-recovery-runbooks.law.test.ts.
--
-- @probe-exempt: smarter_private.reliability_runbook_cron_proof_run runs public.fn_ca_alarm_drill, which locks live money rows for up to 110 s; the native proof runs it against a stub
-- @live-proof: strpos(pg_get_functiondef('smarter_private.reliability_runbook_cron_proof_run(uuid,boolean,jsonb,timestamp with time zone)'::regprocedure), 'A FIX REDEFINES THE FUNCTION (20261120011743)') > 0 AND NOT has_function_privilege('authenticated', 'smarter_private.reliability_runbook_cron_proof_run(uuid,boolean,jsonb,timestamp with time zone)', 'EXECUTE')

BEGIN;

SET LOCAL lock_timeout = '4s';

CREATE OR REPLACE FUNCTION smarter_private.reliability_runbook_cron_proof_run(
  p_incident_id uuid, p_dry_run boolean, p_limits jsonb, p_now timestamptz)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '5s'
AS $function$
DECLARE
  c_allow jsonb := coalesce(p_limits->'allow_functions', '[]'::jsonb);
  c_from time := coalesce((p_limits->>'window_from')::time, time '04:05');
  c_to time := coalesce((p_limits->>'window_to')::time, time '05:55');
  v_job text;
  v_command text;
  v_fn text;
  v_failed_at timestamptz;
  v_last_proof timestamptz;
  v_last_md5 text;
  v_md5 text;
  v_fix text;
  v_history text := 'supabase_migrations.schema_migrations';
  v_running boolean;
  v_local time := (p_now AT TIME ZONE 'America/Chicago')::time;
  v_out jsonb;
  v_recorded boolean;
  v_base jsonb;
BEGIN
  SELECT i.scope->>'jobname' INTO v_job FROM smarter_private.reliability_incidents i WHERE i.id = p_incident_id;
  SELECT j.command INTO v_command FROM cron.job j WHERE j.jobname = v_job AND j.active;
  IF v_command IS NULL THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do', 'summary', format('job %s is not an active cron job', coalesce(v_job, '?')));
  END IF;
  IF v_command !~* '^\s*select\s+(public\.)?fn_[a-z0-9_]+\(\s*\)\s*;?\s*$' THEN
    RETURN jsonb_build_object('outcome', 'refused', 'summary', format('job %s is not one call of one function; a proof run is not defined for it', v_job));
  END IF;
  v_fn := substring(v_command FROM '(fn_[A-Za-z0-9_]+)\(');
  v_base := jsonb_build_object('jobname', v_job, 'function', v_fn);
  IF NOT (c_allow ? v_fn) THEN
    RETURN jsonb_build_object('outcome', 'refused', 'summary', format('%s is not on the on-demand allowlist %s', v_fn, c_allow)) || v_base;
  END IF;
  SELECT max(d.start_time) INTO v_failed_at FROM cron.job_run_details d
    JOIN cron.job j ON j.jobid = d.jobid
   WHERE j.jobname = v_job AND d.status = 'failed';
  IF v_failed_at IS NULL THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do', 'summary', format('job %s has no failed run on record', v_job)) || v_base;
  END IF;
  IF EXISTS (SELECT 1 FROM public.ca_detector_runs r WHERE r.detector = v_fn AND r.ran_at > v_failed_at) THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do',
      'summary', format('%s already recorded a completed run after the failed run at %s; the watch clears the job by itself', v_fn, v_failed_at)) || v_base;
  END IF;
  -- THE CAUSE HAS BEEN FIXED: a migration naming the function and authored
  -- after the failure is installed, and the function's body is not the one a
  -- previous proof run already ran without recording a completed run.
  v_md5 := md5(pg_get_functiondef(to_regprocedure('public.' || v_fn || '()')));
  SELECT a.started_at, a.detail->>'function_md5' INTO v_last_proof, v_last_md5
    FROM smarter_private.reliability_runbook_attempts a
   WHERE a.incident_id = p_incident_id AND a.runbook_key = 'cron_proof_run' AND a.outcome = 'acted'
   ORDER BY a.started_at DESC LIMIT 1;
  -- Dynamic on purpose, through a variable: supabase_migrations is Supabase's
  -- own schema, which the static plpgsql check's copy of production does not carry.
  -- A FIX REDEFINES THE FUNCTION (20261120011743): a migration that only
  -- names it (this controller's own install did) is not evidence; one that
  -- creates it or rewrites its live text by an anchored edit is.
  EXECUTE 'SELECT max(m.version) FROM ' || v_history || ' m'
       || ' WHERE m.version > $1 AND array_to_string(m.statements, '' '') ~* $2'
     INTO v_fix
    USING to_char(v_failed_at AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISS'),
          '(function\s+(public\.)?' || v_fn || '\s*\()|(pg_get_functiondef\(\s*''(public\.)?' || v_fn || '\(\)'')';
  v_base := v_base || jsonb_build_object('failed_run_at', v_failed_at, 'fix_migration', v_fix, 'last_proof_at', v_last_proof,
                                         'function_md5', v_md5);
  IF v_fix IS NULL THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do',
      'summary', format('no migration redefining %s was installed after the failed run at %s; the cause is not shown fixed, so no proof run', v_fn, v_failed_at)) || v_base;
  END IF;
  IF v_last_md5 IS NOT DISTINCT FROM v_md5 AND v_last_proof IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do',
      'summary', format('%s is unchanged since the proof run at %s recorded nothing; the next proof waits for a new fix to its body', v_fn, v_last_proof)) || v_base;
  END IF;
  IF v_local < c_from OR v_local >= c_to THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do',
      'summary', format('fix %s is installed; the proof run of %s waits for the closed window %s-%s America/Chicago', v_fix, v_fn, c_from, c_to)) || v_base;
  END IF;
  SELECT EXISTS (SELECT 1 FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
                  WHERE j.jobname = v_job AND d.status IN ('running', 'starting')
                    AND d.start_time > p_now - interval '15 minutes') INTO v_running;
  IF v_running THEN
    RETURN jsonb_build_object('outcome', 'nothing_to_do', 'summary', format('job %s is running now', v_job)) || v_base;
  END IF;
  IF p_dry_run THEN
    RETURN jsonb_build_object('outcome', 'observed', 'summary', format('would run %s() once to prove fix %s', v_fn, v_fix)) || v_base;
  END IF;
  -- The allowlist is the dispatch: one literal call per allowed function.
  IF v_fn = 'fn_ca_alarm_drill' THEN
    v_out := to_jsonb(public.fn_ca_alarm_drill());
  ELSE
    RETURN jsonb_build_object('outcome', 'refused', 'summary', format('%s has no compiled proof call', v_fn)) || v_base;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.ca_detector_runs r WHERE r.detector = v_fn AND r.ran_at > v_failed_at) INTO v_recorded;
  RETURN jsonb_build_object(
    'outcome', CASE WHEN v_recorded THEN 'proved' ELSE 'acted' END,
    'summary', CASE WHEN v_recorded
                    THEN format('%s() ran once and recorded a completed run; fn_ca_cron_failure_watch clears %s on its next pass', v_fn, v_job)
                    ELSE format('%s() ran once but recorded no completed run in ca_detector_runs, so the watch cannot clear %s; the next proof needs a newer fix', v_fn, v_job) END,
    'result', left(coalesce(v_out::text, 'null'), 600)) || v_base;
END
$function$;

REVOKE ALL ON FUNCTION smarter_private.reliability_runbook_cron_proof_run(uuid, boolean, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;

COMMIT;
