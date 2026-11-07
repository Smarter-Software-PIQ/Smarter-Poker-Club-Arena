CREATE OR REPLACE FUNCTION public.ca_gto_v31_certification_status(p_dataset_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_datasets jsonb;
  v_active jsonb;
  v_agreement jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND NOT public.fn_is_horse_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT COALESCE(jsonb_agg(item ORDER BY item->>'created_at' DESC),'[]'::jsonb)
    INTO v_datasets
    FROM (
      SELECT jsonb_build_object(
        'dataset_id',d.dataset_id,
        'dataset_key',d.dataset_key,
        'state',d.state,
        'quality_status',d.quality_status,
        'dataset_checksum',d.dataset_checksum,
        'source_artifact_checksum',d.source_artifact_checksum,
        'solver_version',d.solver_version,
        'solver_binary_checksum',d.solver_binary_checksum,
        'pipeline_commit',d.pipeline_commit,
        'pipeline_bundle_checksum',d.pipeline_bundle_checksum,
        'manifest_version',d.manifest_version,
        'manifest_checksum',d.manifest_checksum,
        'input_bundle_checksum',d.input_bundle_checksum,
        'input_approval_status',b.approval_status,
        'machine_ids',d.machine_ids,
        'source_rows',d.source_rows,
        'train_source_rows',d.train_source_rows,
        'holdout_source_rows',d.holdout_source_rows,
        'invalid_rows',d.invalid_rows,
        'ingested_source_artifacts',(SELECT count(*)
          FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=d.dataset_id),
        'ingested_source_nodes',COALESCE((SELECT sum(a.node_count)
          FROM public.gto_v31_source_artifacts a WHERE a.dataset_id=d.dataset_id),0),
        'runtime_cells',(SELECT count(*) FROM public.gto_v31_runtime_cells c
          WHERE c.dataset_id=d.dataset_id),
        'source_receipt_rows',(SELECT count(*) FROM public.gto_v31_cell_source_receipts r
          WHERE r.dataset_id=d.dataset_id),
        'source_max_at',(SELECT max(a.solved_at) FROM public.gto_v31_source_artifacts a
          WHERE a.dataset_id=d.dataset_id),
        'coverage',d.coverage,
        'heldout_metrics',d.heldout_metrics,
        'created_at',d.created_at,
        'sealed_at',d.sealed_at,
        'candidate_at',d.candidate_at,
        'promoted_at',d.promoted_at,
        'current_epoch',(SELECT jsonb_build_object('epoch_id',p.epoch_id,'epoch_no',p.epoch_no,'engine_commit',p.engine_commit,
            'opened_at',p.opened_at,'opened_by',p.opened_by,'reason',p.reason,
            'promoted_at',p.promoted_at,'promoted_serving_commit',p.promoted_serving_commit)
            FROM public.gto_v31_evaluation_epochs p
           WHERE p.dataset_id=d.dataset_id AND p.superseded_at IS NULL),
        'evaluation_epochs',COALESCE((SELECT jsonb_agg(jsonb_build_object('epoch_id',p.epoch_id,'epoch_no',p.epoch_no,'engine_commit',p.engine_commit,
            'opened_at',p.opened_at,'opened_by',p.opened_by,'reason',p.reason,
            'superseded_at',p.superseded_at,'superseded_by_epoch_no',p.superseded_by_epoch_no,
            'superseded_candidate',p.superseded_candidate,'promoted_at',p.promoted_at,
            'promoted_serving_commit',p.promoted_serving_commit) ORDER BY p.epoch_no)
            FROM public.gto_v31_evaluation_epochs p WHERE p.dataset_id=d.dataset_id),'[]'::jsonb),
        'evaluations',COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'evaluation_id',e.evaluation_id,
            'kind',e.evaluation_kind,
            'game_family',e.game_family,
            'verdict',e.verdict,
            'metrics',e.metrics,
            'result_checksum',e.result_checksum,
            'evaluated_at',e.evaluated_at,
            'evaluation_epoch_id',e.evaluation_epoch_id,
            'evaluation_engine_commit',e.evaluation_engine_commit
          ) ORDER BY e.evaluation_kind,e.game_family)
            FROM public.gto_v31_release_evaluations e
           WHERE e.dataset_id=d.dataset_id
        ),'[]'::jsonb)
      ) AS item
        FROM public.gto_v31_datasets d
        JOIN public.gto_v31_input_bundles b ON b.input_bundle_id=d.input_bundle_id
       WHERE (p_dataset_id IS NULL OR d.dataset_id=p_dataset_id)
       ORDER BY d.created_at DESC
       LIMIT CASE WHEN p_dataset_id IS NULL THEN 20 ELSE 1 END
    ) recent;

  SELECT item INTO v_active
    FROM jsonb_array_elements(v_datasets) item
   WHERE item->>'state'='active' LIMIT 1;
  SELECT to_jsonb(a) INTO v_agreement
    FROM public.horse_solver_agreement a
   ORDER BY a.run_date DESC,a.created_at DESC LIMIT 1;

  RETURN jsonb_build_object(
    'contract','smarter-poker.gto-v31-certification-status.v1',
    'generated_at',now(),
    'active_dataset',v_active,
    'datasets',v_datasets,
    'workers',COALESCE((SELECT jsonb_agg(to_jsonb(w) ORDER BY w.machine_id)
      FROM public.solver_worker_liveness w),'[]'::jsonb),
    'compactor',(SELECT to_jsonb(c) FROM public.solver_compact_liveness c WHERE singleton),
    'latest_agreement',v_agreement
  );
END;
$function$
;
