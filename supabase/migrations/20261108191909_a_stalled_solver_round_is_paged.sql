-- 20261108191909_a_stalled_solver_round_is_paged
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-08 19:19:09 UTC.
--
-- ============================================================================
-- A STALLED SOLVER ROUND IS PAGED
-- ============================================================================
--
-- THE BLIND SPOT, measured on production (kuklfnapbkmacvwxktbh) 2026-11-08:
-- the R8 round (dataset 1dc9a1b8, gto_v31_program_state 'rebuilding') finished
-- its M1 capture at 07:47:48Z (5,700 rows, 0 invalid) and then nothing moved:
-- no M1 packaging, no model preparation, no M2 holdout, no new source row,
-- for more than 11 hours. Nothing paged. The only reader of the solver
-- pipeline, fn_audit_solver_pipeline_liveness, runs once a day inside the
-- horse daily audit and reads "both hosts completed" as a normal parked
-- pipeline (warn), and the program's own stall_after is 72 hours. A session
-- then read its agent terminal's macOS Local Network denial as "the PCs are
-- off" and asked Dan to wake machines that had been up since October.
--
-- WHAT THIS CHANGES: fn_gto_v31_round_stall_check(p_hours) pages ONE warning
-- financial_alerts row (source fn_gto_v31_round_stall_check) when the V31
-- program is 'rebuilding' and its round has recorded no progress for
-- p_hours. Progress is the newest of: the program decision; the round
-- dataset's created/sealed/candidate/audited stamps; its newest ingested
-- source row, model preparation, model freeze, runtime cell, evaluation epoch
-- and evaluation receipt; and the newest solver worker or compactor
-- heartbeat. The round dataset is the newest one created at or after the
-- program decision that is neither promoted nor retired (none yet = the
-- decision itself is the last progress). While the stall continues it raises
-- nothing more. The page is resolved when any newer progress is recorded or
-- the program leaves 'rebuilding'. It reads only; it never starts, retries or
-- changes solver work, datasets, engines or money.
--
-- Scheduled hourly at minute 17 (outside the :50-:03 break window).
-- periodic-work: this is detection, not compensation. It restarts, retries and settles nothing; a stalled round is resumed by its single writer. The schedule exists only because an idle round leaves no other reader that would page anyone before the 72-hour program stall.
-- Native proof: scripts/ci/test-a-stalled-solver-round-is-paged.py.
--
-- @live-proof: (SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gto-v31-round-stall-check-hourly' AND schedule = '17 * * * *' AND active) AND to_regprocedure('public.fn_gto_v31_round_stall_check(integer)') IS NOT NULL AND NOT has_function_privilege('anon','public.fn_gto_v31_round_stall_check(integer)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_gto_v31_round_stall_check(integer)','EXECUTE') AND has_function_privilege('service_role','public.fn_gto_v31_round_stall_check(integer)','EXECUTE'))

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

CREATE FUNCTION public.fn_gto_v31_round_stall_check(p_hours integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
DECLARE
  v_hours      integer := GREATEST(COALESCE(p_hours, 6), 1);
  v_program    record;
  v_dataset    record;
  v_last_at    timestamptz;
  v_last_kind  text;
  v_rows       jsonb := '{}'::jsonb;
  v_open       uuid;
  v_open_last  timestamptz;
  v_raised     integer := 0;
  v_resolved   integer := 0;
BEGIN
  SELECT p.state, p.decided_at INTO v_program
    FROM public.gto_v31_program_state p
   LIMIT 1;

  SELECT fa.id, (fa.context->>'last_progress_at')::timestamptz INTO v_open, v_open_last
    FROM public.financial_alerts fa
   WHERE fa.source = 'fn_gto_v31_round_stall_check' AND NOT fa.resolved
   ORDER BY fa.created_at DESC
   LIMIT 1;

  IF v_program.state IS DISTINCT FROM 'rebuilding' THEN
    IF v_open IS NOT NULL THEN
      UPDATE public.financial_alerts fa
         SET resolved = true, resolved_at = now(),
             resolution = format('Re-measured by fn_gto_v31_round_stall_check at %s: the V31 program is %s, '
                                 || 'no longer rebuilding, so no solver round is in flight.',
                                 now(), COALESCE(v_program.state, 'absent'))
       WHERE fa.id = v_open AND NOT fa.resolved;
      GET DIAGNOSTICS v_resolved = ROW_COUNT;
    END IF;
    RETURN jsonb_build_object('ok', true, 'checked_at', now(), 'state', 'no_round',
                              'program_state', v_program.state, 'resolved', v_resolved);
  END IF;

  SELECT d.dataset_id, d.dataset_key, d.state, d.created_at, d.sealed_at, d.candidate_at, d.audited_at
    INTO v_dataset
    FROM public.gto_v31_datasets d
   WHERE d.created_at >= v_program.decided_at
     AND d.promoted_at IS NULL AND d.retired_at IS NULL
   ORDER BY d.created_at DESC
   LIMIT 1;

  SELECT x.at, x.kind INTO v_last_at, v_last_kind
    FROM (VALUES
      (v_program.decided_at, 'program decision'),
      (v_dataset.created_at, 'dataset registered'),
      (v_dataset.sealed_at, 'dataset sealed'),
      (v_dataset.candidate_at, 'dataset marked candidate'),
      (v_dataset.audited_at, 'dataset audited'),
      ((SELECT max(a.ingested_at) FROM public.gto_v31_source_artifacts a WHERE a.dataset_id = v_dataset.dataset_id), 'solver source row ingested'),
      ((SELECT max(m.prepared_at) FROM public.gto_v31_model_preparations m WHERE m.dataset_id = v_dataset.dataset_id), 'model prepared'),
      ((SELECT max(f.frozen_at) FROM public.gto_v31_model_freezes f WHERE f.dataset_id = v_dataset.dataset_id), 'model frozen'),
      ((SELECT max(c.built_at) FROM public.gto_v31_runtime_cells c WHERE c.dataset_id = v_dataset.dataset_id), 'runtime cell built'),
      ((SELECT max(e.opened_at) FROM public.gto_v31_evaluation_epochs e WHERE e.dataset_id = v_dataset.dataset_id), 'evaluation epoch opened'),
      ((SELECT max(r.evaluated_at) FROM public.gto_v31_release_evaluations r WHERE r.dataset_id = v_dataset.dataset_id), 'evaluation recorded'),
      ((SELECT max(w.received_at) FROM public.solver_worker_heartbeats w), 'solver host heartbeat'),
      ((SELECT max(k.received_at) FROM public.solver_compact_heartbeats k), 'compactor heartbeat')
    ) AS x(at, kind)
   WHERE x.at IS NOT NULL
   ORDER BY x.at DESC
   LIMIT 1;

  IF v_dataset.dataset_id IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(s.machine_id, s.n), '{}'::jsonb) INTO v_rows
      FROM (SELECT COALESCE(a.machine_id, '?') AS machine_id, count(*) AS n
              FROM public.gto_v31_source_artifacts a
             WHERE a.dataset_id = v_dataset.dataset_id
             GROUP BY 1) s;
  END IF;

  -- Progress newer than the progress the open page named: that stall is over.
  IF v_open IS NOT NULL AND (v_open_last IS NULL OR v_last_at > v_open_last) THEN
    UPDATE public.financial_alerts fa
       SET resolved = true, resolved_at = now(),
           resolution = format('Re-measured by fn_gto_v31_round_stall_check at %s: the round moved again '
                               || '(%s at %s; the page named %s).', now(), v_last_kind, v_last_at, v_open_last)
     WHERE fa.id = v_open AND NOT fa.resolved;
    GET DIAGNOSTICS v_resolved = ROW_COUNT;
    v_open := NULL;
  END IF;

  IF v_last_at < now() - make_interval(hours => v_hours) AND v_open IS NULL THEN
    INSERT INTO public.financial_alerts (severity, source, message, context)
    VALUES ('warning', 'fn_gto_v31_round_stall_check',
            format('The V31 solver round has made no progress for %s hours: the last step was %s at %s. '
                   || 'Dataset %s is %s with source rows %s. Resume it through the round''s single writer '
                   || '(HORSE-LANES-STATUS.md). Reach M1/M2 only with ~/.smarter-poker/ops/solver-host.sh check; '
                   || 'a plain ping or ssh from the agent terminal always reads them as down.',
                   floor(extract(epoch FROM now() - v_last_at) / 3600)::int, v_last_kind, v_last_at,
                   COALESCE(v_dataset.dataset_key, v_dataset.dataset_id::text, '(none registered yet)'),
                   COALESCE(v_dataset.state, 'absent'), v_rows),
            jsonb_build_object('checked_at', now(), 'window_hours', v_hours,
                               'program_state', v_program.state, 'program_decided_at', v_program.decided_at,
                               'dataset_id', v_dataset.dataset_id, 'dataset_key', v_dataset.dataset_key,
                               'dataset_state', v_dataset.state, 'source_rows', v_rows,
                               'last_progress_at', v_last_at, 'last_progress_kind', v_last_kind));
    GET DIAGNOSTICS v_raised = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('ok', true, 'checked_at', now(),
                            'state', CASE WHEN v_last_at < now() - make_interval(hours => v_hours) THEN 'stalled'
                                          ELSE 'moving' END,
                            'dataset_id', v_dataset.dataset_id, 'dataset_state', v_dataset.state,
                            'last_progress_at', v_last_at, 'last_progress_kind', v_last_kind,
                            'source_rows', v_rows, 'raised', v_raised, 'resolved', v_resolved);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_gto_v31_round_stall_check(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_round_stall_check(integer) TO service_role;

DO $schedule$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gto-v31-round-stall-check-hourly') THEN
    PERFORM cron.unschedule('gto-v31-round-stall-check-hourly');
  END IF;
  PERFORM cron.schedule('gto-v31-round-stall-check-hourly', '17 * * * *',
                        'select public.fn_gto_v31_round_stall_check(6);');
END
$schedule$;

COMMIT;
