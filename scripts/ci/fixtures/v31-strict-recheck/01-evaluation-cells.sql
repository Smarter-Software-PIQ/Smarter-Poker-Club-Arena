-- Byte-exact production definition (pg_get_functiondef, read 2026-11-06) and grants.
CREATE FUNCTION public.fn_gto_v31_evaluation_cells(p_dataset_id uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 500)
 RETURNS TABLE(dataset_id uuid, dataset_key text, dataset_checksum text, solver_version text, solver_binary_checksum text, pipeline_commit text, pipeline_bundle_checksum text, manifest_version text, manifest_checksum text, source_artifact_checksum text, source_combo_order_checksum text, range_bundle_checksum text, icm_model_checksum text, input_bundle_checksum text, cell_key_checksum text, cell_payload_checksum text, lineage_checksum text, quality_status text, dataset_state text, dataset_cells bigint, source_rows bigint, train_source_rows bigint, holdout_source_rows bigint, invalid_rows bigint, audited_at timestamp with time zone, street text, game_family text, objective text, utility_context text, table_size smallint, pot_type text, hero_position text, opponent_position text, depth_bucket integer, texture_class text, node_role text, facing_kind text, facing_size_bucket text, hand_matrix jsonb, action_specs jsonb, policy_ev_matrix jsonb, action_ev_matrix jsonb, feature_contract_version text, policy_export_schema text, policy_representation text, public_model jsonb, public_template jsonb, public_training_provenance jsonb, public_model_build_receipt jsonb, model_checksum text, template_checksum text, feature_schema_checksum text, training_provenance_checksum text, model_build_receipt_checksum text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT d.dataset_id,d.dataset_key,d.dataset_checksum,d.solver_version,
         d.solver_binary_checksum,d.pipeline_commit,d.pipeline_bundle_checksum,
         d.manifest_version,
         d.manifest_checksum,d.source_artifact_checksum,
         d.source_combo_order_checksum,d.range_bundle_checksum,d.icm_model_checksum,
         d.input_bundle_checksum,c.cell_key_checksum,c.cell_payload_checksum,
         c.lineage_checksum,d.quality_status,d.state,(d.coverage->>'cells')::bigint,
         d.source_rows,d.train_source_rows,d.holdout_source_rows,d.invalid_rows,
         d.audited_at,c.street,c.game_family,c.objective,c.utility_context,
         c.table_size,c.pot_type,c.hero_position,c.opponent_position,c.depth_bucket,
         c.texture_class,c.node_role,c.facing_kind,c.facing_size_bucket,
         c.hand_matrix,c.action_specs,c.policy_ev_matrix,c.action_ev_matrix,d.feature_contract_version,d.policy_export_schema,c.policy_representation,c.public_model,c.public_template,c.public_training_provenance,c.public_model_build_receipt,c.model_checksum,c.template_checksum,c.feature_schema_checksum,c.training_provenance_checksum,c.model_build_receipt_checksum
    FROM public.gto_v31_datasets d
    JOIN public.gto_v31_input_bundles b ON b.input_bundle_id=d.input_bundle_id
     AND b.approval_status='approved' AND b.bundle_checksum=d.input_bundle_checksum
     AND b.feature_contract_version IS NOT DISTINCT FROM d.feature_contract_version AND b.policy_export_schema IS NOT DISTINCT FROM d.policy_export_schema AND b.policy_representation IS NOT DISTINCT FROM d.policy_representation
    JOIN public.gto_v31_runtime_cells c ON c.dataset_id=d.dataset_id AND c.feature_contract_version IS NOT DISTINCT FROM d.feature_contract_version AND c.policy_export_schema IS NOT DISTINCT FROM d.policy_export_schema AND c.policy_representation IS NOT DISTINCT FROM d.policy_representation
   WHERE d.dataset_id=p_dataset_id AND d.state IN ('evaluating','candidate')
     AND d.quality_status='validated' AND d.invalid_rows=0
     AND d.dataset_checksum IS NOT NULL AND d.source_artifact_checksum IS NOT NULL
   ORDER BY c.street,c.game_family,c.objective,c.utility_context,c.table_size,
     c.pot_type,c.hero_position,c.opponent_position,c.depth_bucket,c.texture_class,
     c.node_role,c.facing_kind,c.facing_size_bucket
   OFFSET greatest(COALESCE(p_offset,0),0)
   LIMIT greatest(1,least(COALESCE(p_limit,500),CASE WHEN EXISTS(SELECT 1 FROM public.gto_v31_datasets WHERE dataset_id=p_dataset_id AND policy_representation='public_hist215_v1') THEN 1 ELSE 500 END));
$function$
;
REVOKE ALL ON FUNCTION public.fn_gto_v31_evaluation_cells(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_gto_v31_evaluation_cells(uuid,integer,integer) TO service_role;
