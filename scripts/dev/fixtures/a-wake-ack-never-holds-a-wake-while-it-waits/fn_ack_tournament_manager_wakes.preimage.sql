CREATE OR REPLACE FUNCTION public.fn_ack_tournament_manager_wakes(p_tournament_id uuid, p_wake_ids bigint[], p_wake_generations bigint[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ids bigint[];
  v_found integer;
  v_changed integer;
  v_current_receipts jsonb;
BEGIN
  SELECT array_agg(DISTINCT id ORDER BY id)
    INTO v_ids
    FROM unnest(p_wake_ids) id
   WHERE id>0;
  IF p_tournament_id IS NULL OR v_ids IS NULL
     OR cardinality(v_ids)<>cardinality(p_wake_ids)
     OR p_wake_generations IS NULL
     OR cardinality(p_wake_generations)<>cardinality(p_wake_ids)
     OR EXISTS (
       SELECT 1 FROM unnest(p_wake_generations) generation
        WHERE generation IS NULL OR generation<=0
     )
     OR cardinality(v_ids)>200 THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_exact_wake_set');
  END IF;

  -- Lock and verify every exact id before acknowledging any. A global
  -- identity value says nothing about commit order, so no range predicate is
  -- permitted at this boundary.
  PERFORM 1
    FROM public.tournament_manager_wakes w
   WHERE w.id=ANY(v_ids)
   ORDER BY w.id
   FOR UPDATE;
  SELECT count(*) INTO v_found
    FROM public.tournament_manager_wakes w
   WHERE w.id=ANY(v_ids) AND w.tournament_id=p_tournament_id;
  IF v_found<>cardinality(v_ids) THEN
    RETURN jsonb_build_object('ok',false,'reason','wake_identity_or_tournament_mismatch');
  END IF;

  UPDATE public.tournament_manager_wakes w
     SET consumed_at=coalesce(w.consumed_at,clock_timestamp())
    FROM unnest(p_wake_ids,p_wake_generations) requested(id,generation)
   WHERE w.id=requested.id AND w.tournament_id=p_tournament_id
     AND w.generation=requested.generation AND w.consumed_at IS NULL;
  GET DIAGNOSTICS v_changed=ROW_COUNT;

  -- Return the post-lock generation of every exact identity. A signal that
  -- arrived while the manager's sweep was in flight increments generation and
  -- remains unconsumed; the manager must run that newer generation before it
  -- may delete the local receipt.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',w.id,
           'generation',w.generation,
           'consumed',w.consumed_at IS NOT NULL
         ) ORDER BY w.id),'[]'::jsonb)
    INTO v_current_receipts
    FROM public.tournament_manager_wakes w
   WHERE w.id=ANY(v_ids) AND w.tournament_id=p_tournament_id;
  RETURN jsonb_build_object(
    'ok',true,
    'requested',cardinality(v_ids),
    'newly_acknowledged',v_changed,
    'current_receipts',v_current_receipts);
END;
$function$
