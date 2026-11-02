CREATE OR REPLACE FUNCTION public.fn_gto_v31_promote_dataset(p_dataset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_expected_checksum text;
  v_expected_source_checksum text;
  v_paired jsonb;
  v_league jsonb;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='candidate' FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.gto_v31_runtime_cells c WHERE c.dataset_id=p_dataset_id AND (c.feature_contract_version IS DISTINCT FROM v_dataset.feature_contract_version OR c.policy_export_schema IS DISTINCT FROM v_dataset.policy_export_schema)) THEN RAISE EXCEPTION 'cell feature version differs from dataset'; END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not a candidate'; END IF;
  IF public.fn_gto_v31_public215_dataset_models_valid(v_dataset) IS NOT TRUE THEN RAISE EXCEPTION 'numeric model set/source authority/SQL implementation differs from immutable dataset';END IF;
  SELECT encode(digest(v_dataset.dataset_key||':'||v_dataset.pipeline_bundle_checksum||':'||
    v_dataset.manifest_checksum||':'||
    v_dataset.input_bundle_checksum||':'||CASE WHEN v_dataset.feature_contract_version IS NULL THEN '' ELSE v_dataset.feature_contract_version||':' END||CASE WHEN v_dataset.policy_export_schema IS NULL THEN '' ELSE v_dataset.policy_export_schema||':' END||string_agg(cell_key_checksum||':'||
      cell_payload_checksum||':'||lineage_checksum,'' ORDER BY cell_key_checksum),'sha256'),'hex')
    INTO v_expected_checksum FROM public.gto_v31_runtime_cells WHERE dataset_id=p_dataset_id;
  SELECT encode(digest(string_agg(DISTINCT source_artifact_checksum,'' ORDER BY source_artifact_checksum),'sha256'),'hex')
    INTO v_expected_source_checksum FROM public.gto_v31_source_artifacts WHERE dataset_id=p_dataset_id;
  SELECT jsonb_build_object('verdict','pass',
      'evaluations',jsonb_agg(to_jsonb(e) ORDER BY e.game_family))
    INTO v_paired FROM public.gto_v31_release_evaluations e
   WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
     AND e.evaluation_kind='paired_replay' AND e.verdict IN ('win','tie');
  SELECT jsonb_build_object('verdict','pass',
      'evaluations',jsonb_agg(to_jsonb(e) ORDER BY e.game_family))
    INTO v_league FROM public.gto_v31_release_evaluations e
   WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
     AND e.evaluation_kind='league' AND e.verdict IN ('win','tie');
  IF v_dataset.quality_status <> 'validated' OR v_dataset.invalid_rows <> 0
     OR v_dataset.dataset_checksum IS NULL OR v_dataset.source_artifact_checksum IS NULL
     OR v_dataset.dataset_checksum IS DISTINCT FROM v_expected_checksum
     OR v_dataset.source_artifact_checksum IS DISTINCT FROM v_expected_source_checksum
     OR COALESCE((v_dataset.coverage->>'complete')::boolean,false) IS NOT true
     OR COALESCE((v_dataset.heldout_metrics->>'frequency_mae')::numeric,99) > (v_dataset.quality_gates->>'max_frequency_mae')::numeric
     OR COALESCE((v_dataset.heldout_metrics->>'sizing_mae')::numeric,99) > (v_dataset.quality_gates->>'max_sizing_mae')::numeric
     OR COALESCE((v_dataset.heldout_metrics->>'sizing_observations')::bigint,0)<=0
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['cash','spin','tourney_ev','tourney_icm']) family(value)
       WHERE COALESCE((v_dataset.heldout_metrics#>>ARRAY['by_family',family.value,'sizing_observations'])::bigint,0)<=0)
     OR COALESCE((v_dataset.heldout_metrics->>'policy_ev_mae_bb')::numeric,99) > (v_dataset.quality_gates->>'max_policy_ev_mae_bb')::numeric
     OR COALESCE((v_dataset.heldout_metrics->>'mean_action_regret_bb')::numeric,99) > (v_dataset.quality_gates->>'max_action_regret_bb')::numeric
     OR COALESCE((v_dataset.heldout_metrics->>'regret_coverage')::numeric,-1) < (v_dataset.quality_gates->>'min_regret_coverage')::numeric
     OR v_dataset.paired_replay IS DISTINCT FROM v_paired
     OR v_dataset.league_gate IS DISTINCT FROM v_league
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_input_bundles b
       WHERE b.input_bundle_id=v_dataset.input_bundle_id AND b.approval_status='approved'
         AND b.bundle_checksum=v_dataset.input_bundle_checksum
       AND b.feature_contract_version IS NOT DISTINCT FROM v_dataset.feature_contract_version)
     OR NOT public.fn_gto_v31_candidate_evaluations_valid(
       p_dataset_id,v_dataset.dataset_checksum)
     OR EXISTS (
       SELECT 1
         FROM unnest(ARRAY['paired_replay','league']) required_kind(value)
         CROSS JOIN unnest(ARRAY['open','cbet','probe','delayed_cbet','barrel',
           'facing_bet','facing_raise','check_raise','bet_raise','all_in']) required_role(value)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.gto_v31_release_evaluations e
          CROSS JOIN LATERAL jsonb_array_elements_text(e.metrics->'candidate_node_roles') seen(value)
           WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
             AND e.evaluation_kind=required_kind.value AND e.verdict IN ('win','tie')
             AND seen.value=required_role.value))
     OR (SELECT count(*) FROM public.gto_v31_release_evaluations e
       WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
         AND ((e.evaluation_kind='heldout' AND e.game_family='all' AND e.verdict='pass')
           OR (e.evaluation_kind IN ('paired_replay','league') AND e.game_family IN
             ('cash','spin','tourney_ev','tourney_icm') AND e.verdict IN ('win','tie'))))<>9 THEN
    RAISE EXCEPTION 'candidate does not meet its protected promotion gates';
  END IF;

  UPDATE public.gto_v31_datasets SET state='retired', retired_at=now()
   WHERE state='active' AND dataset_id <> p_dataset_id;
  UPDATE public.gto_v31_datasets SET state='active', promoted_at=now()
   WHERE dataset_id=p_dataset_id;
  RETURN v_dataset.dataset_checksum;
END;
$function$
