-- A room's Leave and Keep Playing apply only to the pool session displayed in that tab.
-- The existing cluster-wide doors retain ownership of freeze, RG, owed hands and settlement.
-- @live-proof: (has_function_privilege('service_role','public.fn_lightning_request_room_departure(uuid,uuid,uuid,integer,uuid,boolean)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_lightning_request_room_departure(uuid,uuid,uuid,integer,uuid,boolean)','EXECUTE') AND position('WHERE ts.id = p_seat_id FOR UPDATE OF ts' in pg_get_functiondef('public.fn_lightning_pool_enter(uuid,timestamptz)'::regprocedure)) > 0)
-- @live-proof: (has_function_privilege('authenticated','public.fn_lightning_stop_playing(uuid,uuid)','EXECUTE') AND has_function_privilege('authenticated','public.fn_lightning_resume_playing(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_lightning_stop_playing(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','smarter_private.lightning_room_leave_control(uuid,uuid,boolean)','EXECUTE') AND position('P2L01' in pg_get_functiondef('smarter_private.lightning_room_leave_control(uuid,uuid,boolean)'::regprocedure)) > 0)
BEGIN;
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION smarter_private.lightning_room_leave_control(
  p_cluster_id uuid, p_pool_session_id uuid, p_resume boolean
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  actual uuid;
  receipt jsonb;
BEGIN
  SELECT ps.id INTO actual FROM public.lightning_pool_session ps
   WHERE ps.cluster_id = p_cluster_id AND ps.player_id = auth.uid()
   ORDER BY ps.entered_at DESC, ps.id LIMIT 1 FOR UPDATE;
  IF actual IS NULL OR actual IS DISTINCT FROM p_pool_session_id THEN
    RETURN jsonb_build_object('ok',false,'reason','SESSION_CHANGED');
  END IF;
  IF p_resume THEN
    receipt := public.fn_lightning_resume_playing(p_cluster_id);
  ELSE
    receipt := public.fn_lightning_stop_playing(p_cluster_id);
  END IF;
  -- A new session may be inserted after locking a previously closed row.
  -- Roll back every effect of the nested door if it observed that successor.
  IF receipt IS NULL OR (receipt->>'ok' = 'false' AND NOT receipt ? 'pool_session_id') THEN
    RETURN receipt;
  END IF;
  IF receipt->>'pool_session_id' IS DISTINCT FROM p_pool_session_id::text THEN
    RAISE EXCEPTION 'Lightning session changed' USING ERRCODE = 'P2L01';
  END IF;
  RETURN receipt;
EXCEPTION WHEN SQLSTATE 'P2L01' THEN
  RETURN jsonb_build_object('ok',false,'reason','SESSION_CHANGED');
END
$$;
REVOKE ALL ON FUNCTION smarter_private.lightning_room_leave_control(uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.fn_lightning_stop_playing(p_cluster_id uuid, p_pool_session_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT smarter_private.lightning_room_leave_control(p_cluster_id,p_pool_session_id,false)
$$;
CREATE FUNCTION public.fn_lightning_resume_playing(p_cluster_id uuid, p_pool_session_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT smarter_private.lightning_room_leave_control(p_cluster_id,p_pool_session_id,true)
$$;
REVOKE ALL ON FUNCTION public.fn_lightning_stop_playing(uuid,uuid), public.fn_lightning_resume_playing(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_lightning_stop_playing(uuid,uuid), public.fn_lightning_resume_playing(uuid,uuid) TO authenticated;
-- A final hand can first put the player in profit after their stop. Until they
-- confirm the blind-off, a voluntary stop must leave that decision open. The
-- ordinary disconnect and RG exits retain their own confirmed-only rules.
DO $patch$
DECLARE
  original text := pg_get_functiondef('public.fn_lightning_reap_expired_disconnects(uuid,timestamptz,integer)'::regprocedure);
  anchor text := 'v_owed := public.fn_lightning_hands_owed(s.id, true);';
  replacement text := 'v_owed := public.fn_lightning_hands_owed(s.id, s.stop_requested_at IS NULL OR coalesce(s.rg_refused, false));';
BEGIN
  IF array_length(string_to_array(original,anchor),1) <> 2 THEN
    RAISE EXCEPTION 'Lightning reaper leave-count authority changed';
  END IF;
  EXECUTE replace(original,anchor,replacement);
END
$patch$;
CREATE FUNCTION public.fn_lightning_stopped_leave_anchor(
  p_cluster_id uuid, p_pool_session_id uuid, p_occupancy_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT jsonb_build_object('table_id',ts.table_id,'user_id',ts.user_id,'seat_number',ts.seat_number,
                            'occupancy_id',ts.occupancy_id,'left_at',ts.left_at)
    FROM (SELECT ps.id, ps.player_id, ps.anchor_seat_id, ps.exited_at
            FROM public.lightning_pool_session ps
           WHERE ps.player_id = auth.uid() AND ps.cluster_id = p_cluster_id
           ORDER BY ps.entered_at DESC, ps.id LIMIT 1) p
    JOIN public.table_seats ts ON ts.id = p.anchor_seat_id AND ts.user_id = p.player_id
   WHERE p.id = p_pool_session_id AND p.exited_at IS NOT NULL
     AND ts.occupancy_id = p_occupancy_id AND ts.left_at IS NULL
$$;
REVOKE ALL ON FUNCTION public.fn_lightning_stopped_leave_anchor(uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_lightning_stopped_leave_anchor(uuid,uuid,uuid) TO authenticated;
-- Serialize admission with the original seat's departure decision, including
-- automatic pool entry from the seat trigger. Re-read eligibility under lock.
DO $patch$
DECLARE
  original text := pg_get_functiondef('public.fn_lightning_pool_enter(uuid,timestamptz)'::regprocedure);
  anchor text := 'WHERE ts.id = p_seat_id;';
BEGIN
  IF array_length(string_to_array(original,anchor),1) <> 2 THEN
    RAISE EXCEPTION 'Lightning pool admission authority changed';
  END IF;
  EXECUTE replace(original,anchor,'WHERE ts.id = p_seat_id FOR UPDATE OF ts;');
END
$patch$;

CREATE FUNCTION public.fn_lightning_request_room_departure(
  p_pool_session_id uuid, p_user_id uuid, p_table_id uuid, p_seat_number integer,
  p_occupancy_id uuid, p_confirm_hand_count boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  anchor record;
  latest record;
  obligation jsonb;
  owed integer;
  accepted jsonb;
BEGIN
  IF public.fn_caller_is_engine() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Engine authority required' USING ERRCODE='42501';
  END IF;
  IF public.fn_platform_frozen() THEN RETURN jsonb_build_object('ok',false,'reason','FROZEN'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('table_cap:'||p_user_id::text,0));
  SELECT ts.id,t.cluster_id INTO anchor FROM public.table_seats ts
    JOIN public.tables t ON t.id=ts.table_id
   WHERE ts.table_id=p_table_id AND ts.seat_number=p_seat_number AND ts.occupancy_id=p_occupancy_id
     AND ts.user_id=p_user_id AND ts.left_at IS NULL AND t.tournament_id IS NULL FOR UPDATE OF ts;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','STALE_OCCUPANCY'); END IF;
  SELECT ps.id,ps.anchor_seat_id INTO latest FROM public.lightning_pool_session ps
   WHERE ps.cluster_id=anchor.cluster_id AND ps.player_id=p_user_id
   ORDER BY ps.entered_at DESC,ps.id LIMIT 1;
  IF NOT FOUND OR latest.id IS DISTINCT FROM p_pool_session_id OR latest.anchor_seat_id IS DISTINCT FROM anchor.id THEN
    RETURN jsonb_build_object('ok',false,'reason','STALE_OCCUPANCY');
  END IF;
  obligation := public.fn_cash_leave_check(p_user_id,p_table_id);
  IF obligation->>'allowed' IS NULL THEN RAISE EXCEPTION 'Leave rule unavailable'; END IF;
  owed := (obligation->>'hands_remaining')::integer;
  IF (obligation->>'allowed')::boolean IS NOT TRUE THEN
    IF owed IS NULL OR owed <= 0 THEN RAISE EXCEPTION 'Leave rule unavailable'; END IF;
    IF p_confirm_hand_count IS NOT TRUE THEN
      RETURN jsonb_build_object('ok',false,'reason','LEAVE_LOCKED','hands_remaining',owed);
    END IF;
    IF public.fn_cash_session_set_blind_off(p_table_id,p_user_id,true) IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Blind off not confirmed';
    END IF;
    RETURN jsonb_build_object('ok',true,'blind_off',true,'hands_remaining',owed);
  END IF;
  accepted := public.fn_request_seat_departure(p_user_id,p_table_id,p_seat_number,p_occupancy_id,'voluntary');
  IF accepted->>'accepted' IS DISTINCT FROM 'true' OR accepted->>'occupancy_id' IS DISTINCT FROM p_occupancy_id::text THEN
    RAISE EXCEPTION 'Scoped departure not confirmed';
  END IF;
  RETURN jsonb_build_object('ok',true,'blind_off',false);
END
$$;
REVOKE ALL ON FUNCTION public.fn_lightning_request_room_departure(uuid,uuid,uuid,integer,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_request_room_departure(uuid,uuid,uuid,integer,uuid,boolean) TO service_role;
-- The final retirement migration switches this on after both new routes serve.
CREATE FUNCTION public.fn_lightning_legacy_leave_requires_reload(p_user_id uuid,p_table_id uuid,p_occupancy_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$ SELECT false $$;
REVOKE ALL ON FUNCTION public.fn_lightning_legacy_leave_requires_reload(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_legacy_leave_requires_reload(uuid,uuid,uuid) TO service_role;
-- Replay only a receipt for the room that owned this physical seat when the
-- original receipt was committed. A later admission can reuse the occupancy.
CREATE FUNCTION public.fn_get_lightning_room_cashout_receipt(
 p_user_id uuid,p_table_id uuid,p_seat_number integer,p_occupancy_id uuid,p_pool_session_id uuid
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT public.fn_get_seat_cashout_receipt(p_user_id,p_table_id,p_seat_number,p_occupancy_id)
    FROM public.seat_cashout_receipts r
    JOIN LATERAL (
      SELECT ps.id FROM public.lightning_pool_session ps
      WHERE ps.player_id=r.user_id AND ps.anchor_seat_id=r.seat_id AND ps.entered_at<=r.created_at
      ORDER BY ps.entered_at DESC,ps.id LIMIT 1
    ) owner ON owner.id=p_pool_session_id
    WHERE r.occupancy_id=p_occupancy_id AND r.user_id=p_user_id AND r.table_id=p_table_id AND r.seat_number=p_seat_number
$$;
REVOKE ALL ON FUNCTION public.fn_get_lightning_room_cashout_receipt(uuid,uuid,integer,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_get_lightning_room_cashout_receipt(uuid,uuid,integer,uuid,uuid) TO service_role;
COMMIT;
