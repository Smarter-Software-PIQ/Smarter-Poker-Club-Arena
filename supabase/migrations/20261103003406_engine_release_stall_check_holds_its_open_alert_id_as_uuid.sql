-- 20261103003406_engine_release_stall_check_holds_its_open_alert_id_as_uuid
--
-- Reserved by scripts/new-migration.mjs on 2026-11-03 00:34:06 UTC.
--
-- ============================================================================
-- THE ENGINE RELEASE STALL CHECK HOLDS ITS OPEN ALERT ID AS A UUID
-- ============================================================================
--
-- THE DEFECT, measured on production (kuklfnapbkmacvwxktbh) 2026-11-03:
-- 20261102135212_a_stalled_engine_replacement_is_paged declared
-- `v_open bigint` and then ran
--   SELECT fa.id, ... INTO v_open, v_open_version FROM public.financial_alerts fa
-- financial_alerts.id is a uuid. While no page is open the SELECT finds no row
-- and the bug is invisible; the first time the check raised its page
-- (bbec606c-47a3-4094-902b-09c9f1260420, 2026-11-02 16:23Z) every later run
-- failed with `invalid input syntax for type bigint`. cron job
-- ca-engine-release-stall-check-hourly (514) failed at 17:23, 18:23 ... 00:23,
-- so the check could neither re-measure nor resolve its own page, and
-- fn_ca_cron_failure_watch paged on it. Issue #9413.
--
-- WHAT THIS CHANGES: one declaration, bigint -> uuid. The function body is
-- otherwise byte-identical to the live definition (prosrc md5
-- c55d8def6182267ba755513da572f8b6 before this migration). Signature,
-- defaults, SECURITY DEFINER, search_path, timeout, grants and the cron
-- schedule are unchanged. It touches no releases, engines, freezes or money.
--
-- @live-proof: (SELECT (SELECT prosrc FROM pg_proc WHERE oid = 'public.fn_ca_engine_release_stall_check(integer,integer)'::regprocedure) ~ 'v_open\s+uuid;' AND NOT has_function_privilege('anon','public.fn_ca_engine_release_stall_check(integer,integer)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_engine_release_stall_check(integer,integer)','EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE OR REPLACE FUNCTION public.fn_ca_engine_release_stall_check(p_hours integer DEFAULT 6, p_min_failures integer DEFAULT 3)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_hours     integer := GREATEST(COALESCE(p_hours, 6), 1);
  v_min       integer := GREATEST(COALESCE(p_min_failures, 3), 1);
  v_since     timestamptz := now() - make_interval(hours => GREATEST(COALESCE(p_hours, 6), 1));
  v_version   text;
  v_beat      timestamptz;
  v_failures  integer := 0;
  v_runs      integer := 0;
  v_targets   jsonb := '[]'::jsonb;
  v_first     timestamptz;
  v_last      record;
  v_open      uuid;
  v_open_version text;
  v_raised    integer := 0;
  v_resolved  integer := 0;
BEGIN
  SELECT l.engine_version, l.heartbeat_at INTO v_version, v_beat
    FROM public.engine_leader l
   ORDER BY l.heartbeat_at DESC NULLS LAST
   LIMIT 1;

  IF v_version IS NULL OR v_beat IS NULL OR v_beat < now() - interval '5 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'checked_at', now(), 'state', 'leader_unknown',
                              'engine_version', v_version, 'heartbeat_at', v_beat);
  END IF;

  SELECT count(*), count(DISTINCT e.run_id), min(e.recorded_at),
         COALESCE(jsonb_agg(DISTINCT left(e.target_sha, 8)), '[]'::jsonb)
    INTO v_failures, v_runs, v_first, v_targets
    FROM public.engine_deploy_exit_paths e
   WHERE e.recorded_at >= v_since
     AND e.outcome = 'failure'
     AND left(COALESCE(e.target_sha, ''), 8) IS DISTINCT FROM left(v_version, 8);

  SELECT e.run_id, left(COALESCE(e.target_sha, ''), 8) AS target, e.stage, left(COALESCE(e.error, ''), 200) AS error,
         e.recorded_at
    INTO v_last
    FROM public.engine_deploy_exit_paths e
   WHERE e.recorded_at >= v_since
     AND e.outcome = 'failure'
     AND left(COALESCE(e.target_sha, ''), 8) IS DISTINCT FROM left(v_version, 8)
   ORDER BY e.recorded_at DESC
   LIMIT 1;

  SELECT fa.id, fa.context->>'serving_version' INTO v_open, v_open_version
    FROM public.financial_alerts fa
   WHERE fa.source = 'fn_ca_engine_release_stall_check' AND NOT fa.resolved
   ORDER BY fa.created_at DESC
   LIMIT 1;

  -- A different engine leads than the one the open page named: that stall is
  -- over. Close it first; a new stall below pages afresh.
  IF v_open IS NOT NULL AND left(COALESCE(v_open_version, ''), 8) IS DISTINCT FROM left(v_version, 8) THEN
    UPDATE public.financial_alerts fa
       SET resolved = true,
           resolved_at = now(),
           resolution = format('Re-measured by fn_ca_engine_release_stall_check at %s: engine %s now leads '
                               || '(the page named %s); %s failed attempt(s) to replace it in the last %s hour(s).',
                               now(), left(v_version, 8), left(COALESCE(v_open_version, ''), 8), v_failures, v_hours)
     WHERE fa.id = v_open AND NOT fa.resolved;
    GET DIAGNOSTICS v_resolved = ROW_COUNT;
    v_open := NULL;
  END IF;

  IF v_failures >= v_min THEN
    IF v_open IS NULL THEN
      INSERT INTO public.financial_alerts (severity, source, message, context)
      VALUES ('critical', 'fn_ca_engine_release_stall_check',
              format('Engine replacement is stalled: %s failed release attempts (%s runs, targets %s) '
                     || 'in the last %s hour(s) while engine %s keeps serving. Latest: run %s target %s '
                     || 'failed at %s (%s) at %s. Read the host release journal for that run; a stranded '
                     || 'owner or a refused cutover repeats every hour until its cause is fixed.',
                     v_failures, v_runs, v_targets, v_hours, left(v_version, 8),
                     v_last.run_id, v_last.target, v_last.stage, v_last.error, v_last.recorded_at),
              jsonb_build_object('checked_at', now(), 'window_hours', v_hours, 'min_failures', v_min,
                                 'serving_version', v_version, 'leader_heartbeat_at', v_beat,
                                 'failures', v_failures, 'runs', v_runs, 'targets', v_targets,
                                 'first_failure_at', v_first, 'latest_run', v_last.run_id,
                                 'latest_target', v_last.target, 'latest_stage', v_last.stage,
                                 'latest_error', v_last.error, 'latest_at', v_last.recorded_at));
      GET DIAGNOSTICS v_raised = ROW_COUNT;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true, 'checked_at', now(), 'state',
                            CASE WHEN v_failures >= v_min THEN 'stalled'
                                 WHEN v_open IS NOT NULL THEN 'stalled_open'
                                 ELSE 'clear' END,
                            'serving_version', left(v_version, 8), 'failures', v_failures, 'runs', v_runs,
                            'targets', v_targets, 'raised', v_raised, 'resolved', v_resolved);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_engine_release_stall_check(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_engine_release_stall_check(integer, integer) TO service_role;

COMMIT;
