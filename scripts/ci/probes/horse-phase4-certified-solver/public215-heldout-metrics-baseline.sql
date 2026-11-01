CREATE OR REPLACE FUNCTION public.fn_gto_v31_public215_heldout_metrics(p_dataset_id uuid, p_game_family text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH scored_nodes AS MATERIALIZED (
    SELECT r.dataset_id,r.cell_id,r.source_row_id,r.source_node,r.split,
           public.fn_gto_v31_assert_source_contract(n.value,
           (SELECT d.policy_export_schema FROM public.gto_v31_datasets d WHERE d.dataset_id=p_dataset_id),
           (SELECT d.icm_model_checksum FROM public.gto_v31_datasets d WHERE d.dataset_id=p_dataset_id)) AS node
      FROM public.gto_v31_cell_source_receipts r
      JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
      JOIN public.solved_spots_gold s ON s.id=r.source_row_id
      CROSS JOIN LATERAL jsonb_array_elements(s.strategy_matrix_v2->'nodes') n(value)
     WHERE r.dataset_id=p_dataset_id AND r.split='holdout'
       AND (p_game_family IS NULL OR c.game_family=p_game_family)
       AND n.value->>'node'=r.source_node
       AND n.value->>'node_checksum'=r.source_node_checksum
  ), public_states AS MATERIALIZED (
    SELECT r.*,c.public_model->'action_ids'AS public_actions,
           public.fn_gto_v31_public215_required_audit(c,r.node#>>'{node_context,board}')AS audit_key
      FROM scored_nodes r JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
  ), holdout AS MATERIALIZED (
    SELECT r.source_row_id,r.source_node,c.cell_id,c.game_family,
           c.action_specs,i,k.hand_key,
           (SELECT jsonb_object_agg(a.action,ap.frequencies[a.ord::integer]ORDER BY a.ord)FROM jsonb_array_elements_text(r.public_actions)WITH ORDINALITY a(action,ord))AS compact_frequencies,
           ap.policy_ev::numeric AS compact_policy,
           (n.value->'policy_evs_bb'->>i)::numeric AS source_policy,
           (SELECT jsonb_object_agg(a.key,a.value->i) FROM jsonb_each(n.value->'frequencies') a) AS source_frequencies,
           (SELECT jsonb_object_agg(a.key,a.value->i) FROM jsonb_each(n.value->'action_evs_bb') a) AS source_action_evs,
           (n.value->'matchups'->>i)::numeric AS weight
      FROM public_states r
      JOIN public.gto_v31_runtime_cells c ON c.cell_id=r.cell_id
      CROSS JOIN LATERAL (SELECT r.node AS value) n
      CROSS JOIN generate_series(0,1325) i
      CROSS JOIN LATERAL (SELECT i::text AS hand_key OFFSET 0) k
      LEFT JOIN public.gto_v31_public_model_audit_combos ap ON ap.audit_key=r.audit_key AND ap.combo=i
     WHERE r.dataset_id=p_dataset_id AND r.split='holdout'
       AND (p_game_family IS NULL OR c.game_family=p_game_family)
       AND n.value->>'node'=r.source_node
       AND (n.value->'matchups'->>i)::numeric>0
  ), action_observations AS MATERIALIZED (
    SELECT h.*,a.key AS action_id,a.value->>'family' AS action_family,
           CASE WHEN a.value->>'family' IN ('bet','raise')
                THEN (a.value->>'size_value')::numeric ELSE NULL END AS size_value,
           (h.source_frequencies->>a.key)::numeric AS source_frequency,
           (h.compact_frequencies->>a.key)::numeric AS compact_frequency,
           (h.source_action_evs->>a.key)::numeric AS source_action_ev
      FROM holdout h CROSS JOIN LATERAL jsonb_each(h.action_specs) a
  ), per_combo AS MATERIALIZED (
    SELECT source_row_id,source_node,cell_id,game_family,i,hand_key,weight,
           max(source_policy) AS source_policy_ev,
           max(compact_policy) AS compact_policy_ev,
           sum(source_frequency*COALESCE(size_value,0))
             FILTER (WHERE size_value IS NOT NULL) AS source_size,
           sum(compact_frequency*COALESCE(size_value,0))
             FILTER (WHERE size_value IS NOT NULL) AS compact_size,
           bool_or(size_value IS NOT NULL) AS sizing_eligible,
           max(source_action_ev) AS best_action_ev,
           sum(compact_frequency*source_action_ev) AS compact_mixed_ev,
           bool_and(compact_frequency IS NOT NULL AND source_action_ev IS NOT NULL)
             AS regret_eligible
      FROM action_observations
     GROUP BY source_row_id,source_node,cell_id,game_family,i,hand_key,weight
  )
  SELECT jsonb_build_object(
    'frequency_mae',(SELECT sum(abs(source_frequency-compact_frequency)*weight)/NULLIF(sum(weight),0)
      FROM action_observations),
    'sizing_mae',COALESCE((SELECT sum(abs(source_size-compact_size)*weight)/NULLIF(sum(weight),0)
      FROM per_combo WHERE sizing_eligible),0),
    'policy_ev_mae_bb',(SELECT sum(abs(source_policy_ev-compact_policy_ev)*weight)/NULLIF(sum(weight),0)
      FROM per_combo),
    'mean_action_regret_bb',(SELECT sum(greatest(0,best_action_ev-compact_mixed_ev)*weight)/NULLIF(sum(weight),0)
      FROM per_combo WHERE regret_eligible),
    'regret_coverage',(SELECT count(*)::numeric/NULLIF((SELECT count(*) FROM per_combo),0)
      FROM per_combo WHERE regret_eligible),
    'holdout_source_rows',(SELECT count(DISTINCT source_row_id) FROM holdout),
    'frequency_observations',(SELECT count(*) FROM action_observations),
    'sizing_observations',(SELECT count(*) FROM per_combo WHERE sizing_eligible),
    'policy_ev_observations',(SELECT count(*) FROM per_combo),
    'regret_observations',(SELECT count(*) FROM per_combo WHERE regret_eligible),
    'live_combo_observations',(SELECT count(*) FROM per_combo),
    'missing_observations',(SELECT count(*) FROM holdout WHERE compact_frequencies IS NULL OR compact_policy IS NULL)
  );
$function$
