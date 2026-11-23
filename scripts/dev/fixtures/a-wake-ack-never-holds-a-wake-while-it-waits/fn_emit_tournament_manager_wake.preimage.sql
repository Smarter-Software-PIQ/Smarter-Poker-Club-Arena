CREATE OR REPLACE FUNCTION public.fn_emit_tournament_manager_wake(p_tournament_id uuid, p_reason text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id bigint;
  v_status text;
BEGIN
  IF p_reason NOT IN (
    'rebuy','reentry','addon','late_registration','deal_vote','bounty_settled'
  ) THEN
    RAISE EXCEPTION 'invalid tournament manager wake reason';
  END IF;

  -- Serialize every emitter with the tournament lifecycle transition. UPDATE
  -- takes a NO KEY UPDATE lock, which conflicts with FOR SHARE: an emitter that
  -- commits first is consumed by the terminal AFTER trigger, while an emitter
  -- that arrives second observes the terminal state and cannot strand work for
  -- a manager that has already stopped. Terminal recovery can still settle a
  -- legacy financial obligation; it simply has no live manager to wake.
  SELECT upper(COALESCE(t.status,''))
    INTO v_status
    FROM public.tournaments t
   WHERE t.id=p_tournament_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tournament % does not exist', p_tournament_id
      USING ERRCODE='foreign_key_violation';
  END IF;
  IF v_status IN ('COMPLETED','CANCELLED','CANCELED') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.tournament_manager_wakes AS pending(tournament_id,reason,generation)
  VALUES (p_tournament_id,p_reason,1)
  ON CONFLICT (tournament_id,reason) WHERE consumed_at IS NULL
  DO UPDATE SET
    generation=pending.generation+1,
    created_at=clock_timestamp()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$
