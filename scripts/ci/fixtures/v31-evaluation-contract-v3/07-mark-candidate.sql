CREATE OR REPLACE FUNCTION public.fn_gto_v31_mark_candidate(p_dataset_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dataset public.gto_v31_datasets%ROWTYPE;
  v_paired jsonb;
  v_league jsonb;
  v_epoch public.gto_v31_evaluation_epochs%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(),'') <> 'service_role' AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'service_role required';
  END IF;
  SELECT * INTO v_dataset FROM public.gto_v31_datasets
   WHERE dataset_id=p_dataset_id AND state='evaluating' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dataset is not awaiting evaluation'; END IF;
  SELECT * INTO v_epoch FROM public.gto_v31_evaluation_epochs
   WHERE dataset_id=p_dataset_id AND superseded_at IS NULL AND promoted_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no open evaluation epoch; open one for the evaluated engine commit first'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gto_v31_input_bundles b
      WHERE b.input_bundle_id=v_dataset.input_bundle_id AND b.approval_status='approved'
        AND b.bundle_checksum=v_dataset.input_bundle_checksum)
     OR NOT EXISTS (SELECT 1 FROM public.gto_v31_release_evaluations e
      WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
        AND e.evaluation_kind='heldout' AND e.game_family='all' AND e.verdict='pass')
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
             AND e.evaluation_epoch_id=v_epoch.epoch_id
             AND seen.value=required_role.value)) THEN
    RAISE EXCEPTION 'candidate is missing approved, execution-bound release evidence';
  END IF;
  SELECT jsonb_build_object('verdict','pass',
      'evaluations',jsonb_agg(to_jsonb(e) ORDER BY e.game_family))
    INTO v_paired FROM public.gto_v31_release_evaluations e
   WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
     AND e.evaluation_kind='paired_replay' AND e.verdict IN ('win','tie')
     AND e.evaluation_epoch_id=v_epoch.epoch_id;
  SELECT jsonb_build_object('verdict','pass',
      'evaluations',jsonb_agg(to_jsonb(e) ORDER BY e.game_family))
    INTO v_league FROM public.gto_v31_release_evaluations e
   WHERE e.dataset_id=p_dataset_id AND e.dataset_checksum=v_dataset.dataset_checksum
     AND e.evaluation_kind='league' AND e.verdict IN ('win','tie')
     AND e.evaluation_epoch_id=v_epoch.epoch_id;
  UPDATE public.gto_v31_datasets SET state='candidate',paired_replay=v_paired,
    league_gate=v_league,candidate_at=now(),audited_at=now()
   WHERE dataset_id=p_dataset_id;
  RETURN v_dataset.dataset_checksum;
END;
$function$
;
