-- Install after the room-scoped engine and client are serving.
-- @live-proof: (position('v_seat.table_id, ''seat_number'', v_seat.seat_number' in pg_get_functiondef('public.fn_lightning_my_session(uuid)'::regprocedure)) = 0 AND has_function_privilege('authenticated','public.fn_lightning_stopped_leave_anchor(uuid,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.fn_lightning_stopped_leave_anchor(uuid,uuid,uuid)','EXECUTE'))
-- @live-proof: (NOT has_function_privilege('authenticated','public.fn_lightning_stop_playing(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public.fn_lightning_resume_playing(uuid)','EXECUTE') AND position('s.stop_requested_at IS NULL OR coalesce(s.rg_refused, false)' in pg_get_functiondef('public.fn_lightning_reap_expired_disconnects(uuid,timestamptz,integer)'::regprocedure)) > 0)
-- @live-proof: (position('ps.anchor_seat_id=ts.id' in pg_get_functiondef('public.fn_lightning_legacy_leave_requires_reload(uuid,uuid,uuid)'::regprocedure)) > 0)
-- @live-proof: (position('LEAVE_CONFIRMED' in pg_get_functiondef('smarter_private.lightning_room_leave_control(uuid,uuid,boolean)'::regprocedure)) > 0)
-- @live-proof: (position('LEAVE_CONFIRMED' in pg_get_functiondef('smarter_private.lightning_room_leave_control(uuid,uuid,boolean)'::regprocedure)) > 0 AND NOT has_function_privilege('authenticated','public.fn_lightning_legacy_leave_requires_reload(uuid,uuid,uuid)','EXECUTE') AND has_function_privilege('service_role','public.fn_lightning_legacy_leave_requires_reload(uuid,uuid,uuid)','EXECUTE'))
BEGIN;
SET LOCAL lock_timeout = '1s';
-- Cached room clients cannot identify the target of these old HTTP calls.
-- The scoped wrappers execute as their owner. Existing service-role ACLs stand.
REVOKE EXECUTE ON FUNCTION public.fn_lightning_stop_playing(uuid), public.fn_lightning_resume_playing(uuid) FROM authenticated;

-- The room-less answer is a physical-table navigation hint. Old room clients
-- used its seat number to rediscover and cash out a replacement occupancy.
DO $patch$
DECLARE
  original text := pg_get_functiondef('public.fn_lightning_my_session(uuid)'::regprocedure);
  anchor text := $slot$'seat_table_id', v_seat.table_id, 'seat_number', v_seat.seat_number$slot$;
BEGIN
  IF array_length(string_to_array(original,anchor),1) <> 2 THEN
    RAISE EXCEPTION 'Lightning room-less seat authority changed';
  END IF;
  EXECUTE replace(original,anchor,$slot$'seat_table_id', v_seat.table_id$slot$);
END
$patch$;


-- A cached tab can have read a then-valid anchor before re-entry. Its generic
-- request names only a seat. Ask it to refresh when that occupant has actually
-- participated in a Lightning room at this anchor. A fresh physical-table
-- client identifies the original physical seat and uses its ordinary door.
CREATE OR REPLACE FUNCTION public.fn_lightning_legacy_leave_requires_reload(p_user_id uuid,p_table_id uuid,p_occupancy_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
  SELECT EXISTS (SELECT 1 FROM public.table_seats ts JOIN public.tables t ON t.id=ts.table_id
    JOIN public.lightning_pool_session ps ON ps.cluster_id=t.cluster_id AND ps.player_id=ts.user_id AND ps.anchor_seat_id=ts.id
    WHERE ts.user_id=p_user_id AND ts.table_id=p_table_id AND ts.occupancy_id=p_occupancy_id
      AND ts.left_at IS NULL AND ps.entered_at >= ts.joined_at)
$$;
-- Withdrawing a stop cannot undo another device's confirmed financial leave.
-- Distinguish that outcome from an ordinary, idempotent Keep Playing.
DO $patch$
DECLARE
  original text := pg_get_functiondef('smarter_private.lightning_room_leave_control(uuid,uuid,boolean)'::regprocedure);
  anchor text := '  IF p_resume THEN';
  replacement text := $code$  IF p_resume AND EXISTS (
    SELECT 1 FROM public.lightning_pool_session ps
    JOIN public.cash_player_session cs ON cs.id=ps.cash_player_session_id AND cs.player_id=ps.player_id
    WHERE ps.id=actual AND ps.exited_at IS NULL AND cs.closed_at IS NULL AND cs.hr_blind_off
  ) THEN
    RETURN jsonb_build_object('ok',false,'reason','LEAVE_CONFIRMED','pool_session_id',actual);
  END IF;
  IF p_resume THEN$code$;
BEGIN
  IF array_length(string_to_array(original,anchor),1) <> 2 THEN RAISE EXCEPTION 'Lightning resume authority changed'; END IF;
  EXECUTE replace(original,anchor,replacement);
END
$patch$;
COMMIT;
