-- Reserved by scripts/new-migration.mjs. The original sit-out transition owns
-- this transaction: a player who owes hands remains dealable and is blinded
-- off; I'm Back withdraws that intention before the next matcher admission.
-- No existing seat or money is changed by installation.
-- @live-proof: (has_function_privilege('service_role','public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean)','EXECUTE'))
BEGIN;
SET LOCAL lock_timeout = '1s';
CREATE FUNCTION public.fn_cash_seat_sitout(p_table_id uuid,p_user_id uuid,p_occupancy_id uuid,p_sitting_out boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public,pg_temp AS $$
DECLARE seat public.table_seats%ROWTYPE; pool_id uuid; cluster uuid; owed integer := 0; blind boolean := false;
BEGIN
  IF public.fn_caller_is_engine() IS DISTINCT FROM true THEN RAISE EXCEPTION 'Engine authority required' USING ERRCODE='42501'; END IF;
  IF public.fn_platform_frozen() THEN RAISE EXCEPTION 'PLATFORM_FROZEN' USING ERRCODE='55006'; END IF;
  IF p_sitting_out IS NULL THEN RAISE EXCEPTION 'Sit out intention required' USING ERRCODE='22023'; END IF;
  SELECT * INTO seat FROM public.table_seats ts WHERE ts.table_id=p_table_id AND ts.user_id=p_user_id
    AND ts.occupancy_id=p_occupancy_id AND ts.left_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF seat.leave_pending THEN RETURN NULL; END IF;
  SELECT ps.id,ps.cluster_id INTO pool_id,cluster FROM public.lightning_pool_session ps
    JOIN public.tables t ON t.id=seat.table_id AND t.cluster_id=ps.cluster_id
    JOIN public.cash_games g ON g.id=t.cluster_id AND g.cluster_mode='lightning'
    WHERE ps.anchor_seat_id=seat.id AND ps.player_id=p_user_id AND ps.exited_at IS NULL;
  IF FOUND AND p_sitting_out THEN
    owed := (public.fn_cash_leave_check(p_user_id,p_table_id)->>'hands_remaining')::integer;
    IF owed IS NULL THEN RAISE EXCEPTION 'Hand count unavailable'; END IF;
    blind := owed > 0;
  END IF;
  UPDATE public.table_seats SET is_sitting_out=p_sitting_out AND NOT blind
    WHERE id=seat.id RETURNING * INTO seat;
  IF pool_id IS NOT NULL THEN
    PERFORM public.fn_cash_session_set_blind_off(p_table_id,p_user_id,blind);
    IF NOT EXISTS (SELECT 1 FROM public.cash_player_session cs JOIN public.lightning_pool_session ps
      ON ps.cash_player_session_id=cs.id AND ps.player_id=cs.player_id
      WHERE ps.id=pool_id AND cs.closed_at IS NULL AND cs.hr_blind_off IS NOT DISTINCT FROM blind) THEN
      RAISE EXCEPTION 'Blind off transition unconfirmed';
    END IF;
    -- Responsible gaming can waive the obligation in the existing owner.
    -- Never re-admit an excluded player or replace that owner's decision.
    IF blind THEN owed := public.fn_lightning_hands_owed(pool_id,true); END IF;
  END IF;
  RETURN jsonb_build_object('seat',to_jsonb(seat),'pool_session_id',pool_id,'cluster_id',cluster,
    'sitting_out',p_sitting_out,'blind_off',blind,'hands_remaining',owed);
END
$$;
REVOKE ALL ON FUNCTION public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_seat_sitout(uuid,uuid,uuid,boolean) TO service_role;
COMMIT;
