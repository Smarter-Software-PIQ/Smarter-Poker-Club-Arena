-- V31 human replay: read a page of the sealed cells of one V31 dataset with
-- the SAME columns, joins, filters and order as fn_gto_v31_evaluation_cells
-- (the RPC GtoPostflopV31Loader.loadGtoPostflopV31Evaluation reads; it is
-- granted to service_role only, so a read-only session selects its body
-- directly). The replay then installs the rows through
-- replaceGtoPostflopV31Evaluation, the engine's own full seal and payload
-- checksum validation, so a drifted copy of this body is refused there rather
-- than measured. Page :OFFSET by :LIMIT until no row returns. Read-only (one
-- SELECT); rendered and run by scripts/horse-measure/v31-human-replay-fetch.mjs.
select to_jsonb(r) as cell from (
  select d.dataset_id, d.dataset_key, d.dataset_checksum, d.solver_version,
         d.solver_binary_checksum, d.pipeline_commit, d.pipeline_bundle_checksum,
         d.manifest_version,
         d.manifest_checksum, d.source_artifact_checksum,
         d.source_combo_order_checksum, d.range_bundle_checksum, d.icm_model_checksum,
         d.input_bundle_checksum, c.cell_key_checksum, c.cell_payload_checksum,
         c.lineage_checksum, d.quality_status, d.state as dataset_state,
         (d.coverage->>'cells')::bigint as dataset_cells,
         d.source_rows, d.train_source_rows, d.holdout_source_rows, d.invalid_rows,
         d.audited_at, c.street, c.game_family, c.objective, c.utility_context,
         c.table_size, c.pot_type, c.hero_position, c.opponent_position, c.depth_bucket,
         c.texture_class, c.node_role, c.facing_kind, c.facing_size_bucket,
         c.hand_matrix, c.action_specs, c.policy_ev_matrix, c.action_ev_matrix,
         d.feature_contract_version, d.policy_export_schema, c.policy_representation,
         c.public_model, c.public_template, c.public_training_provenance,
         c.public_model_build_receipt, c.model_checksum, c.template_checksum,
         c.feature_schema_checksum, c.training_provenance_checksum, c.model_build_receipt_checksum
    from public.gto_v31_datasets d
    join public.gto_v31_input_bundles b on b.input_bundle_id = d.input_bundle_id
     and b.approval_status = 'approved' and b.bundle_checksum = d.input_bundle_checksum
     and b.feature_contract_version is not distinct from d.feature_contract_version
     and b.policy_export_schema is not distinct from d.policy_export_schema
     and b.policy_representation is not distinct from d.policy_representation
    join public.gto_v31_runtime_cells c on c.dataset_id = d.dataset_id
     and c.feature_contract_version is not distinct from d.feature_contract_version
     and c.policy_export_schema is not distinct from d.policy_export_schema
     and c.policy_representation is not distinct from d.policy_representation
   where d.dataset_id = :DATASET and d.state in ('evaluating', 'candidate', 'active')
     and d.quality_status = 'validated' and d.invalid_rows = 0
     and d.dataset_checksum is not null and d.source_artifact_checksum is not null
   order by c.street, c.game_family, c.objective, c.utility_context, c.table_size,
     c.pot_type, c.hero_position, c.opponent_position, c.depth_bucket, c.texture_class,
     c.node_role, c.facing_kind, c.facing_size_bucket
   offset :OFFSET limit :LIMIT
) r
