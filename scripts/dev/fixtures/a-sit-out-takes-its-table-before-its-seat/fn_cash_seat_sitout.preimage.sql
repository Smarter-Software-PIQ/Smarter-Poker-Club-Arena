CREATE OR REPLACE FUNCTION public.fn_cash_seat_sitout(p_table_id uuid, p_user_id uuid, p_occupancy_id uuid, p_sitting_out boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE seat public.table_seats%ROWTYPE; pool_id uuid; cluster uuid; owed integer := 0; blind boolean := false;
BEGIN
  IF public.fn_caller_is_engine() IS DISTINCT FROM true THEN RAISE EXCEPTION 'Engine authority required' USING ERRCODE='42501'; END IF;
  IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'PLATFORM_FROZEN' USING ERRCODE='55006'; END IF;
  IF p_sitting_out IS NULL THEN RAISE EXCEPTION 'Sit out intention required' USING ERRCODE='22023'; END IF;
  SELECT * INTO seat FROM public.table_seats ts WHERE ts.table_id=p_table_id AND ts.user_id=p_user_id
    AND ts.occupancy_id=p_occupancy_id AND ts.left_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF seat.leave_pending THEN RETURN NULL; END IF;
  SELECT g.id INTO cluster FROM public.tables t
    JOIN public.cash_games g ON g.id=t.cluster_id AND g.cluster_mode='lightning'
    WHERE t.id=seat.table_id;
  SELECT ps.id INTO pool_id FROM public.lightning_pool_session ps
    WHERE ps.cluster_id=cluster AND ps.anchor_seat_id=seat.id AND ps.player_id=p_user_id
      AND ps.exited_at IS NULL;
  IF cluster IS NOT NULL AND p_sitting_out THEN
    owed := (public.fn_cash_leave_check(p_user_id,p_table_id)->>'hands_remaining')::integer;
    IF owed IS NULL THEN RAISE EXCEPTION 'Hand count unavailable'; END IF;
    blind := owed > 0;
  END IF;
  IF cluster IS NOT NULL AND NOT p_sitting_out THEN
    IF pool_id IS NULL THEN RAISE EXCEPTION 'SESSION_CHANGED' USING ERRCODE='P2S02'; END IF;
    IF (public.fn_rg_require_not_excluded(p_user_id)->>'ok')::boolean IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'RG_LIMIT' USING ERRCODE='P2S01';
    END IF;
    -- I'm Back withdraws an unconfirmed next-hand stop in the SAME original
    -- transition. A confirmed departure is already refused by leave_pending.
    UPDATE public.lightning_pool_session SET stop_requested_at=NULL,updated_at=clock_timestamp()
      WHERE id=pool_id AND player_id=p_user_id AND exited_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_CHANGED' USING ERRCODE='P2S02'; END IF;
  END IF;
  UPDATE public.table_seats SET is_sitting_out=p_sitting_out AND NOT blind
    WHERE id=seat.id RETURNING * INTO seat;
  IF cluster IS NOT NULL THEN
    -- The original owner also re-enters an earlier stopped pool when an
    -- obligation still stands. Classification must not depend on an open pool.
    PERFORM public.fn_cash_session_set_blind_off(p_table_id,p_user_id,blind);
    SELECT ps.id INTO pool_id FROM public.lightning_pool_session ps
      WHERE ps.cluster_id=cluster AND ps.anchor_seat_id=seat.id AND ps.player_id=p_user_id
        AND ps.exited_at IS NULL;
    IF NOT EXISTS (SELECT 1 FROM public.cash_player_session cs
      WHERE cs.player_id=p_user_id AND cs.scope_type='table' AND cs.scope_id=p_table_id
        AND cs.closed_at IS NULL AND cs.hr_blind_off IS NOT DISTINCT FROM blind) THEN
      RAISE EXCEPTION 'Blind off transition unconfirmed';
    END IF;
    -- Responsible gaming can waive the obligation in the existing owner.
    -- Never re-admit an excluded player or replace that owner's decision.
    IF blind THEN
      IF pool_id IS NOT NULL THEN owed := public.fn_lightning_hands_owed(pool_id,true);
      ELSE owed := (public.fn_cash_leave_check(p_user_id,p_table_id)->>'hands_remaining')::integer;
      END IF;
      IF owed IS NULL THEN RAISE EXCEPTION 'Hand count unavailable'; END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('seat',to_jsonb(seat),'pool_session_id',pool_id,'cluster_id',cluster,
    'sitting_out',p_sitting_out,'blind_off',blind,'hands_remaining',owed);
END
$function$
