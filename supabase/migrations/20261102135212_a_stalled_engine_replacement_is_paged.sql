-- 20261102135212_a_stalled_engine_replacement_is_paged
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-02 13:52:12 UTC.
--
-- ============================================================================
-- A STALLED ENGINE REPLACEMENT IS PAGED
-- ============================================================================
--
-- THE BLIND SPOT, measured on production (kuklfnapbkmacvwxktbh) 2026-11-02:
-- every host release attempt records its failure exit in
-- public.engine_deploy_exit_paths (fn_ca_record_engine_deploy_exit), but no
-- check reads that table. Between 2026-11-01 01:14Z and 2026-11-02 13:27Z
-- 25 consecutive attempts (25 distinct run ids, targets 655b3a29 ... 6d178de0)
-- failed while engine_leader stayed on eed06fe5, and one stranded receiver
-- retried 269 times. Nothing paged; the stall was found by hand.
--
-- WHAT THIS CHANGES: fn_ca_engine_release_stall_check(p_hours, p_min_failures)
-- reads only those two tables. When the engine leader is fresh and at least
-- p_min_failures failed attempts to deploy a DIFFERENT engine version than
-- the one leading were recorded inside p_hours, it raises ONE critical
-- financial_alerts row (source fn_ca_engine_release_stall_check) naming the
-- serving version, the failure count, distinct runs and targets, and the
-- latest stage/error. While the condition stays true it raises nothing more.
-- When the condition clears (a new version leads, or the window holds fewer
-- failures) the open alert is resolved with the re-measurement. A stale or
-- missing leader heartbeat is unknown, never "healthy": nothing is raised or
-- resolved. It never touches releases, engines, freezes or money.
--
-- Scheduled hourly at minute 23 (outside the :50-:03 break window).
-- periodic-work: this is detection, not compensation. It repairs, retries and settles nothing; the stalled release is fixed at its cause by its owner. The schedule exists only because a release that fails on the host leaves no other reader that would page anyone.
-- Native proof: scripts/ci/test-a-stalled-engine-replacement-is-paged.py.
--
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-engine-release-stall-check-hourly' AND schedule = '23 * * * *' AND active) AND to_regprocedure('public.fn_ca_engine_release_stall_check(integer,integer)') IS NOT NULL AND NOT has_function_privilege('anon','public.fn_ca_engine_release_stall_check(integer,integer)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_ca_engine_release_stall_check(integer,integer)','EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE FUNCTION public.fn_ca_engine_release_stall_check(p_hours integer DEFAULT 6, p_min_failures integer DEFAULT 3)
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
  v_open      bigint;
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

  SELECT fa.id INTO v_open
    FROM public.financial_alerts fa
   WHERE fa.source = 'fn_ca_engine_release_stall_check' AND NOT fa.resolved
   ORDER BY fa.created_at DESC
   LIMIT 1;

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
  ELSIF v_open IS NOT NULL THEN
    UPDATE public.financial_alerts fa
       SET resolved = true,
           resolved_at = now(),
           resolution = format('Re-measured by fn_ca_engine_release_stall_check at %s: engine %s leads and '
                               || '%s failed attempt(s) to replace it in the last %s hour(s) (threshold %s).',
                               now(), left(v_version, 8), v_failures, v_hours, v_min)
     WHERE fa.source = 'fn_ca_engine_release_stall_check' AND NOT fa.resolved;
    GET DIAGNOSTICS v_resolved = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'checked_at', now(), 'state',
                            CASE WHEN v_failures >= v_min THEN 'stalled' ELSE 'clear' END,
                            'serving_version', left(v_version, 8), 'failures', v_failures, 'runs', v_runs,
                            'targets', v_targets, 'raised', v_raised, 'resolved', v_resolved);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_engine_release_stall_check(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_engine_release_stall_check(integer, integer) TO service_role;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-engine-release-stall-check-hourly') THEN
    PERFORM cron.unschedule('ca-engine-release-stall-check-hourly');
  END IF;
  PERFORM cron.schedule('ca-engine-release-stall-check-hourly', '23 * * * *',
                        'select public.fn_ca_engine_release_stall_check(6, 3);');
END
$schedule$;

COMMIT;
