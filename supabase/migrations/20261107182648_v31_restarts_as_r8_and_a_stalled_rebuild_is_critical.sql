-- 20261107182648_v31_restarts_as_r8_and_a_stalled_rebuild_is_critical
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 18:26:48 UTC.
--
-- THE V31 PROGRAM RESTARTS AS R8, AND A STALLED REBUILD IS CRITICAL (2026-11-07)
--
-- Dan delegated the call: "YOU CAN DECIDE ON THE V31 SOLVER PIPELINE... BOTH
-- COMPUTERS ARE ON." 20261107130621 decided PARK at 13:06 UTC. This reverses
-- that decision to RESTART, as R8, on evidence the park did not weigh:
--
--   * Dan had already approved the R8 plan on 2026-11-06 (option A, a new
--     evaluation set), and its tooling has been landing on main since: contract
--     v3 certification on the playbook's own tables (#9807), ten times the
--     certification hands (#9735), the deal-pinned mood clock (#9734), the
--     strict replay-and-retest rule for any later engine (#9817, #9852) and the
--     density pre-flight that proves every certification run reaches 300
--     playbook decisions before a solver hour is spent (#9856). The park
--     recorded none of this.
--   * The park read solver_status, the legacy harvest table, as "M2 idle since
--     2026-08-16". The V31 worker liveness says otherwise: M1 completed R7
--     (6,099/6,099 rows, 0 invalid) at 2026-10-31 06:26 UTC and M2 completed
--     its holdout (856/856, 0 invalid) at 13:37 UTC the same day. Both hosts
--     answer on the LAN today (192.168.0.51 and 192.168.0.155, SSH open).
--   * R7's evidence is a measurement problem as much as a strategy problem.
--     Its cash league lost (-3.575 +/- 1.768 bb/100, 10,000 hands), but its
--     tourney_ev league WON (+0.566 +/- 0.258 bb/100, 2.2 sigma) while both
--     tournament paired replays read exactly 0.0 +/- 0.0. A paired replay that
--     never diverges never consulted the playbook: contract v2 played tables
--     R7's cells were not keyed for. Contract v3 exists because of that, and
--     R8 is the first playbook that can be certified under it.
--   * Nothing is served while it rebuilds. Promotion still requires every
--     contract v3 run to pass, and a later engine still needs an identical
--     replay digest and a passed re-check round. The cost of the restart is
--     solver hours on two machines that are otherwise idle.
--
-- WHAT CHANGES
--
-- gto_v31_program_state gains a third state, 'rebuilding': the program is
-- pursued, no certified dataset is active yet, and the live brain keeps the
-- legacy response inference labelled derived. fn_audit_gto_v31_certified
-- reports it as a WARN carrying the latest progress of every stage. It turns
-- CRITICAL (certified_v31_rebuild_stalled) when no stage has moved for
-- stall_after (72 hours): no worker or compactor heartbeat, no bundle
-- approval, no source artifact, no dataset transition, no evaluation receipt,
-- no execution anchor and no re-check round. A restart nobody is executing
-- is a defect, and it is the one finding a 'rebuilding' row must not hide.
--
-- Two corrections to the park's function, kept for every state:
--   * "serving" counts OPEN bindings (revoked_at IS NULL). Counting every row
--     would have raised certified_v31_parked_but_serving forever after the
--     first revoke.
--   * 'active' with no active dataset is the original certified_v31_missing
--     Critical, unchanged.
--
-- The exit condition is recorded with the decision: if the R8 candidate fails
-- contract v3 on its cash scope, the program returns to 'parked' carrying that
-- result, by a dated migration like this one.
--
-- Self-verifying: inside the same transaction the block below proves the
-- rebuilding warn, forces the stall path by shrinking stall_after, proves the
-- Critical, and restores the row. Nothing outside the transaction sees it.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.gto_v31_program_state
  DROP CONSTRAINT gto_v31_program_state_state_check;
ALTER TABLE public.gto_v31_program_state
  ADD CONSTRAINT gto_v31_program_state_state_check
  CHECK (state IN ('active','parked','rebuilding'));

ALTER TABLE public.gto_v31_program_state
  ADD COLUMN IF NOT EXISTS stall_after interval NOT NULL DEFAULT interval '72 hours'
  CHECK (stall_after > interval '0');

COMMENT ON COLUMN public.gto_v31_program_state.stall_after IS
  'While rebuilding: how long every V31 stage may stand still before fn_audit_gto_v31_certified reports certified_v31_rebuild_stalled as a Critical.';
COMMENT ON COLUMN public.gto_v31_program_state.reopen_condition IS
  'The condition that ends the current state: for parked, what re-opens the program; for rebuilding, what promotes or what returns it to parked.';

UPDATE public.gto_v31_program_state
   SET state = 'rebuilding',
       decided_at = now(),
       decided_by = 'claude (delegated by Dan, 2026-11-07: "YOU CAN DECIDE ON THE V31 SOLVER PIPELINE... BOTH COMPUTERS ARE ON"); supersedes the 13:06 UTC park',
       rationale = 'Restarted as R8 (Dan approved the R8 plan, option A, on 2026-11-06). R7 lost its cash league (-3.575 +/- 1.768 bb/100) but won tourney_ev league (+0.566 +/- 0.258), and both tournament paired replays read exactly zero because contract v2 played tables R7 was not keyed for. Contract v3 certifies a playbook on its own tables at ten times the hands, the density pre-flight proves every run reaches 300 playbook decisions before solving, and any later engine must replay identically and pass a re-check. Both solver hosts completed R7 on 2026-10-31 and are reachable. Nothing is served until R8 passes.',
       evidence = evidence || jsonb_build_object(
         'superseded_park_at', '2026-11-07T13:06:21Z',
         'r7_league_tourney_ev', jsonb_build_object('bb100',0.5658333333333334,'stderr',0.25776810178051063,'hands',10000,'verdict','win'),
         'r7_paired_replay_cash', jsonb_build_object('bb100',1.555,'stderr',2.3698554044344187,'hands',10000,'verdict','tie'),
         'm1_r7_completed_at', '2026-10-31T06:26:54Z', 'm1_r7_rows', 6099,
         'm2_r7_completed_at', '2026-10-31T13:37:38Z', 'm2_r7_rows', 856,
         'r8_plan_approved', '2026-11-06 (Dan, option A)',
         'r8_density_preflight', '100 cells (70 flop, 23 turn, 7 river); weakest run 450 expected decisions against the 300 floor'),
       reopen_condition = 'PROMOTE when the R8 candidate passes every contract v3 run (paired replay and league, every table, memory-off twins) and its execution anchor is recorded. RETURN TO PARKED, by a dated migration carrying the receipts, if R8 loses any contract v3 cash run.',
       stall_after = interval '72 hours'
 WHERE id;

CREATE OR REPLACE FUNCTION public.fn_audit_gto_v31_certified(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '[]'::jsonb;
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_latest jsonb;
  v_program public.gto_v31_program_state%ROWTYPE;
  v_served bigint := 0;
  v_progress jsonb;
  v_last timestamptz;
BEGIN
  SELECT * INTO v_dataset FROM public.gto_v31_datasets WHERE state='active' LIMIT 1;
  IF NOT FOUND THEN
    SELECT jsonb_build_object(
      'dataset_key',d.dataset_key,'state',d.state,'quality_status',d.quality_status,
      'source_rows',d.source_rows,'train_source_rows',d.train_source_rows,
      'holdout_source_rows',d.holdout_source_rows,'invalid_rows',d.invalid_rows,
      'runtime_cells',(SELECT count(*) FROM public.gto_v31_runtime_cells c
        WHERE c.dataset_id=d.dataset_id),
      'declared_cells',jsonb_array_length(d.declared_coverage),
      'coverage',d.coverage,'heldout_metrics',d.heldout_metrics,
      'input_approval_status',b.approval_status,
      'evaluation_receipts',(SELECT count(*) FROM public.gto_v31_release_evaluations e
        WHERE e.dataset_id=d.dataset_id),
      'passing_release_receipts',(SELECT count(*) FROM public.gto_v31_release_evaluations e
        WHERE e.dataset_id=d.dataset_id AND e.verdict IN ('pass','win','tie')),
      'created_at',d.created_at,'sealed_at',d.sealed_at,'candidate_at',d.candidate_at
    ) INTO v_latest
      FROM public.gto_v31_datasets d
      JOIN public.gto_v31_input_bundles b ON b.input_bundle_id=d.input_bundle_id
     ORDER BY d.created_at DESC LIMIT 1;

    -- Only an OPEN binding serves. A revoked one is history.
    SELECT count(*) INTO v_served FROM public.gto_v31_serving_bindings WHERE revoked_at IS NULL;
    SELECT * INTO v_program FROM public.gto_v31_program_state LIMIT 1;

    IF FOUND AND v_program.state IN ('parked','rebuilding') THEN
      IF v_served > 0 THEN
        RETURN jsonb_build_array(jsonb_build_object(
          'severity','critical','category','gto','code','certified_v31_serving_without_active_dataset',
          'title','No V31 dataset is active but ' || v_served || ' open serving binding(s) exist (program ' || v_program.state || ')',
          'evidence',jsonb_build_object('day',p_day,'open_serving_bindings',v_served,
            'program_state',v_program.state,'decided_at',v_program.decided_at,'decided_by',v_program.decided_by),
          'recommendation','A binding serves only a promoted dataset. Revoke the open bindings with fn_gto_v31_revoke_serving before the next deal.'
        ));
      END IF;

      IF v_program.state = 'parked' THEN
        RETURN jsonb_build_array(jsonb_build_object(
          'severity','info','category','gto','code','certified_v31_parked',
          'title','No certified V31 dataset is active, and that is the decision on record (parked)',
          'evidence',jsonb_build_object('day',p_day,'latest_dataset',v_latest,
            'decided_at',v_program.decided_at,'decided_by',v_program.decided_by,
            'park_evidence',v_program.evidence),
          'recommendation',v_program.rationale || ' RE-OPEN CONDITION: ' || v_program.reopen_condition
        ));
      END IF;

      -- 'rebuilding': report where every stage stands, and whether any moved.
      v_progress := jsonb_build_object(
        'decided_at', v_program.decided_at,
        'worker_heartbeat', (SELECT max(received_at) FROM public.solver_worker_liveness),
        'compactor_heartbeat', (SELECT max(received_at) FROM public.solver_compact_liveness),
        'bundle_approved', (SELECT max(approved_at) FROM public.gto_v31_input_bundles),
        'source_artifact', (SELECT max(ingested_at) FROM public.gto_v31_source_artifacts),
        'dataset_transition', (SELECT max(greatest(created_at, sealed_at, audited_at, candidate_at, promoted_at, retired_at))
                                 FROM public.gto_v31_datasets),
        'evaluation_receipt', (SELECT max(evaluated_at) FROM public.gto_v31_release_evaluations),
        'execution_anchor', (SELECT max(recorded_at) FROM public.gto_v31_execution_anchors),
        'recheck_round', (SELECT max(greatest(opened_at, closed_at)) FROM public.gto_v31_recheck_rounds));
      SELECT max((v #>> '{}')::timestamptz) INTO v_last
        FROM jsonb_each(v_progress) AS t(k, v)
       WHERE jsonb_typeof(v) = 'string';

      IF v_last IS NULL OR now() - v_last > v_program.stall_after THEN
        RETURN jsonb_build_array(jsonb_build_object(
          'severity','critical','category','gto','code','certified_v31_rebuild_stalled',
          'title','The V31 rebuild has not moved for ' ||
            coalesce(justify_hours(date_trunc('minute', now() - v_last))::text, 'ever') ||
            ' (limit ' || v_program.stall_after || ')',
          'evidence',jsonb_build_object('day',p_day,'last_progress',v_last,'stages',v_progress,
            'stall_after',v_program.stall_after,'latest_dataset',v_latest,
            'decided_by',v_program.decided_by),
          'recommendation','The program is recorded as rebuilding and no stage has moved. Run the next stage (' ||
            v_program.reopen_condition || ') or return the program to parked by a dated migration that says why.'
        ));
      END IF;

      RETURN jsonb_build_array(jsonb_build_object(
        'severity','warn','category','gto','code','certified_v31_rebuilding',
        'title','No certified V31 dataset is active yet; the program is rebuilding (last progress ' ||
          to_char(v_last AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC)',
        'evidence',jsonb_build_object('day',p_day,'last_progress',v_last,'stages',v_progress,
          'stall_after',v_program.stall_after,'latest_dataset',v_latest,
          'decided_at',v_program.decided_at,'decided_by',v_program.decided_by,
          'program_evidence',v_program.evidence),
        'recommendation',v_program.rationale || ' EXIT CONDITION: ' || v_program.reopen_condition
      ));
    END IF;

    RETURN jsonb_build_array(jsonb_build_object(
      'severity','critical','category','gto','code','certified_v31_missing',
      'title','No certified V31 solver dataset is active',
      'evidence',jsonb_build_object('day',p_day,'latest_dataset',v_latest),
      'recommendation','Keep the legacy response inference labeled derived. Restore both solver hosts, generate sealed source rows, pass held-out, paired replay and league gates, then promote exactly one dataset. If the program is deliberately rebuilding or stood down, record it in gto_v31_program_state so this reports the decision instead of a defect.'
    ));
  END IF;
  IF v_dataset.invalid_rows <> 0 OR v_dataset.quality_status <> 'validated'
     OR v_dataset.dataset_checksum IS NULL OR v_dataset.source_artifact_checksum IS NULL THEN
    v_result := v_result || jsonb_build_object(
      'severity','critical','category','gto','code','certified_v31_invalid',
      'title','The active V31 dataset is not fully sealed',
      'evidence',jsonb_build_object('dataset',v_dataset.dataset_key,'invalid_rows',v_dataset.invalid_rows,'quality',v_dataset.quality_status),
      'recommendation','Retire the dataset and fall back. An active cell may never be served without complete source and dataset checksums.'
    );
  ELSE
    v_result := v_result || jsonb_build_object(
      'severity','info','category','gto','code','certified_v31_active',
      'title','Certified V31 dataset is active',
      'evidence',jsonb_build_object('dataset',v_dataset.dataset_key,'checksum',v_dataset.dataset_checksum,'coverage',v_dataset.coverage,'heldout',v_dataset.heldout_metrics),
      'recommendation','Continue daily decision-level agreement and worker-liveness checks.'
    );
  END IF;
  RETURN v_result;
END;
$function$;

-- An audit read is not a public endpoint (unchanged from 20261107130621).
REVOKE ALL ON FUNCTION public.fn_audit_gto_v31_certified(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_audit_gto_v31_certified(date) TO service_role;

-- Self-verification, inside this transaction only.
DO $verify$
DECLARE
  v jsonb;
  v_keep interval;
  v_decided timestamptz;
BEGIN
  IF EXISTS (SELECT 1 FROM public.gto_v31_datasets WHERE state='active') THEN
    RAISE NOTICE 'an active dataset exists; the rebuilding branch is not reachable and is not exercised';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.gto_v31_serving_bindings WHERE revoked_at IS NULL) THEN
    RAISE EXCEPTION 'open serving bindings exist with no active dataset; resolve that before restarting the program';
  END IF;

  v := public.fn_audit_gto_v31_certified(current_date);
  IF v->0->>'code' <> 'certified_v31_rebuilding' OR v->0->>'severity' <> 'warn' THEN
    RAISE EXCEPTION 'expected certified_v31_rebuilding/warn, got %', v->0;
  END IF;

  SELECT stall_after, decided_at INTO v_keep, v_decided FROM public.gto_v31_program_state;
  -- now() is fixed for the transaction and the decision was stamped with it,
  -- so step the decision back one second and allow one microsecond.
  UPDATE public.gto_v31_program_state
     SET stall_after = interval '1 microsecond', decided_at = now() - interval '1 second' WHERE id;
  v := public.fn_audit_gto_v31_certified(current_date);
  IF v->0->>'code' <> 'certified_v31_rebuild_stalled' OR v->0->>'severity' <> 'critical' THEN
    RAISE EXCEPTION 'expected certified_v31_rebuild_stalled/critical, got %', v->0;
  END IF;
  UPDATE public.gto_v31_program_state SET stall_after = v_keep, decided_at = v_decided WHERE id;

  IF has_function_privilege('anon','public.fn_audit_gto_v31_certified(date)','execute')
     OR has_function_privilege('authenticated','public.fn_audit_gto_v31_certified(date)','execute') THEN
    RAISE EXCEPTION 'fn_audit_gto_v31_certified must not be executable by anon or authenticated';
  END IF;
END
$verify$;

COMMIT;
