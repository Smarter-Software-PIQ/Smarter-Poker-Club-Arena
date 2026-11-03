-- @live-proof: md5(pg_get_functiondef('public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'::regprocedure))='aa265e27cee6b1ae2fd06a9f729d7903' AND NOT has_function_privilege('authenticated','public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)','EXECUTE') AND has_function_privilege('service_role','public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)','EXECUTE')
-- Owner instruction in chat01a1a01a November3: no tournament may start or
-- register until relaunch ready. The existing hold now also refuses late
-- entry and re-entry into started events; settlement and cash paths unchanged.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='5s';
DO $preimage$ BEGIN
 IF md5(pg_get_functiondef('public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid)'::regprocedure)) IS DISTINCT FROM 'cb3b1fafe09b50740350d8ae8e7bb31b' THEN RAISE EXCEPTION 'entry_hold_owner_changed'; END IF;
END $preimage$;
CREATE OR REPLACE FUNCTION public.fn_ca_lock_tournament_seat_acquisition(p_tournament_id uuid, p_table_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_tournament_id uuid := p_tournament_id;
  v_table_id uuid := p_table_id;
  v_status text;
  v_max integer := 0;
  v_active integer := 0;
  v_started_at timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','missing_user_id');
  END IF;
  PERFORM public.fn_ca_lock_settlement_lane_for_tournament(p_tournament_id, p_table_id);
  PERFORM pg_advisory_xact_lock_shared(530093);
  IF EXISTS(SELECT 1 FROM public.ca_operator_floor_hold h JOIN public.ca_launch_operator_scopes m ON m.operation_id=h.operation_id JOIN public.tournaments t ON t.id=COALESCE(p_tournament_id,(SELECT tournament_id FROM public.tables WHERE id=p_table_id)) WHERE h.mode='park' AND (t.club_id=ANY(m.club_ids) OR t.union_id=ANY(m.club_ids)) AND NOT EXISTS(SELECT 1 FROM public.tournament_players tp WHERE tp.tournament_id=t.id AND tp.user_id=p_user_id)) THEN
    RETURN jsonb_build_object('ok',false,'reason','operator_floor_parked');
  END IF;
  PERFORM pg_advisory_xact_lock_shared(530090,1);
  IF public.fn_ca_new_tournament_starts_blocked()
     AND COALESCE(p_tournament_id,(SELECT tournament_id FROM public.tables WHERE id=p_table_id)) IS NOT NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','operator_floor_parked');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('table_cap'), hashtext(p_user_id::text));
  PERFORM public.fn_lock_daily_mission_user(p_user_id);

  IF v_table_id IS NOT NULL THEN
    SELECT tb.tournament_id
    INTO v_tournament_id
    FROM public.tables tb
    WHERE tb.id = v_table_id
    FOR UPDATE;
  END IF;

  IF v_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;

  PERFORM 1
  FROM public.tournament_launch_receipts r
  WHERE r.tournament_id = v_tournament_id
  FOR UPDATE;

  SELECT
    upper(COALESCE(t.status::text, '')),
    COALESCE(t.max_players, 0),
    t.started_at
  INTO v_status, v_max, v_started_at
  FROM public.tournaments t
  WHERE t.id = v_tournament_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','tournament_not_found');
  END IF;

  PERFORM 1
  FROM public.tables tb
  WHERE tb.tournament_id = v_tournament_id
    AND COALESCE(tb.status, 'active') <> 'closed'
  ORDER BY tb.id
  FOR UPDATE;

  PERFORM 1
  FROM public.tournament_players tp
  WHERE tp.tournament_id = v_tournament_id
    AND tp.status::text IN ('registered', 'playing')
  ORDER BY tp.id
  FOR UPDATE;

  PERFORM 1
  FROM public.table_seats ts
  JOIN public.tables tb ON tb.id = ts.table_id
  WHERE tb.tournament_id = v_tournament_id
    AND ts.left_at IS NULL
  ORDER BY ts.id
  FOR UPDATE;

  SELECT COUNT(DISTINCT u.uid)::integer
  INTO v_active
  FROM (
    SELECT tp.user_id AS uid
    FROM public.tournament_players tp
    WHERE tp.tournament_id = v_tournament_id
      AND tp.status::text IN ('registered', 'playing')
      AND tp.user_id IS NOT NULL
    UNION
    SELECT ts.user_id AS uid
    FROM public.table_seats ts
    JOIN public.tables tb ON tb.id = ts.table_id
    WHERE tb.tournament_id = v_tournament_id
      AND COALESCE(tb.status, 'active') <> 'closed'
      AND ts.left_at IS NULL
      AND ts.user_id IS NOT NULL
  ) u;

  RETURN jsonb_build_object(
    'ok', true,
    'tournament_id', v_tournament_id,
    'table_id', v_table_id,
    'status', v_status,
    'max_players', v_max,
    'active_players', v_active,
    'started_at', v_started_at
  );
END;
$function$
;
REVOKE ALL ON FUNCTION public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_lock_tournament_seat_acquisition(uuid,uuid,uuid) TO service_role;
COMMIT;
