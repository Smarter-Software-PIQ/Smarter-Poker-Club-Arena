CREATE OR REPLACE FUNCTION public.fn_request_seat_departure(p_user_id uuid, p_table_id uuid, p_seat_number integer, p_occupancy_id uuid, p_leave_mode text DEFAULT 'voluntary'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
 SET statement_timeout TO '30s'
AS $function$
DECLARE v_tournament uuid; v_mode text; v_seat_id uuid;
BEGIN
 IF NOT coalesce(public.fn_caller_is_engine(),false) THEN
  RAISE EXCEPTION 'Engine authority required' USING ERRCODE='42501';
 END IF;
 IF p_user_id IS NULL OR p_table_id IS NULL OR p_seat_number IS NULL OR
    p_occupancy_id IS NULL OR p_leave_mode IS NULL OR p_leave_mode NOT IN ('voluntary','forced') THEN
  RAISE EXCEPTION 'DEPARTURE_IDENTITY_OR_MODE_REQUIRED' USING ERRCODE='22023';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('table_cap:'||p_user_id::text,0));
 SELECT tournament_id INTO v_tournament FROM public.tables WHERE id=p_table_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASHOUT_TABLE_NOT_FOUND' USING ERRCODE='22023'; END IF;
 IF v_tournament IS NOT NULL THEN
  PERFORM 1 FROM public.tournaments WHERE id=v_tournament FOR NO KEY UPDATE;
 END IF;
 SELECT id INTO v_seat_id FROM public.table_seats
  WHERE occupancy_id=p_occupancy_id AND user_id=p_user_id AND table_id=p_table_id
   AND seat_number=p_seat_number AND left_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASHOUT_STALE_OCCUPANCY' USING ERRCODE='22023'; END IF;
 INSERT INTO public.seat_departure_requests(occupancy_id,user_id,table_id,seat_number,leave_mode)
  VALUES(p_occupancy_id,p_user_id,p_table_id,p_seat_number,p_leave_mode)
 ON CONFLICT(occupancy_id) DO UPDATE SET leave_mode =
  CASE WHEN seat_departure_requests.leave_mode='forced' THEN 'forced' ELSE EXCLUDED.leave_mode END
 WHERE seat_departure_requests.user_id=EXCLUDED.user_id
   AND seat_departure_requests.table_id=EXCLUDED.table_id
   AND seat_departure_requests.seat_number=EXCLUDED.seat_number
 RETURNING leave_mode INTO v_mode;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASHOUT_OCCUPANCY_SCOPE_MISMATCH' USING ERRCODE='22023'; END IF;
 UPDATE public.table_seats SET status='sitting_out',is_sitting_out=true,
   leave_pending=CASE WHEN v_tournament IS NULL THEN true ELSE leave_pending END
  WHERE id=v_seat_id;
 RETURN jsonb_build_object('accepted',true,'occupancy_id',p_occupancy_id,
  'user_id',p_user_id,'table_id',p_table_id,'seat_number',p_seat_number,
  'leave_mode',v_mode,'tournament_table',v_tournament IS NOT NULL);
END;
$function$
