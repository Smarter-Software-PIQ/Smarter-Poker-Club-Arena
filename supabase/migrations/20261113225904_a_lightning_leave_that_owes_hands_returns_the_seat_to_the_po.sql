-- 20261113225904_a_lightning_leave_that_owes_hands_returns_the_seat_to_the_po.sql
-- @live-proof: position('fn_cash_leave_check(p_user_id, p_table_id)' in pg_get_functiondef('public.fn_lightning_owed_leave_returns_to_pool(uuid,uuid,integer,uuid)'::regprocedure)) > 0
--
-- A LIGHTNING LEAVE THAT OWES HANDS RETURNS THE SEAT TO THE POOL (#10740).
--
-- Owner rule, Dan, 2026-11-06 (Hit And Run): a player in profit who leaves
-- before the hand count is played "WILL BE BLINDED OFF FOR THE REMAINING
-- HANDS". The seat keeps being dealt, is checked or folded on its turn, and is
-- cashed out when the count completes or the profit is gone.
--
-- WHAT WAS BROKEN (measured 2026-11-13 15:10-15:25 Chicago): fifteen seats in
-- Lightning NLH .25/.50 and PLO4 .25/.50, the oldest for 60 hours, sat out
-- with leave_pending, owing 7 to 10 hands and dealt none since. The path:
--   1. a leave asked while the player's chips were in a live Lightning hand is
--      queued: fn_request_seat_departure sets is_sitting_out and leave_pending;
--   2. after that hand the voluntary cash-out is refused because hands are owed
--      in profit (fn_cash_leave_check), and the engine holds the leave;
--   3. fn_lightning_player_legality answers CASHOUT_PENDING / SITTING_OUT and
--      fn_lightning_anchor_is_live_eligible is false for such a seat, so the
--      pool never deals it again and the owed hands can never be played.
-- The between-hands leave already avoids this (it blinds a Lightning anchor
-- off without sitting it out); the queued leave reached the same obligation
-- with the seat already sat out and pending. It applies to people and horses
-- alike: nothing here reads horse identity.
--
-- THE FIX. One engine-only door turns that queued voluntary leave into the
-- blind off the rule already defines, at the moment the database refuses it:
-- the voluntary departure request for that exact occupancy is withdrawn, the
-- seat stops sitting out and stops pending, and the session is marked blinded
-- off. The existing deferred trigger (fn_table_seats_lightning_pool_follows_seat)
-- then re-opens the pool slot, the matcher deals the seat, the hand host folds
-- or checks it (fn_lightning_blind_off_players), the settlement trigger counts
-- each hand, and the engine's held leave cashes out through the voluntary door
-- once nothing is owed. No stack, departure time or occupant changes here, so
-- no chips move and the anchor guard does not fire.
--
-- It refuses, without writing, when: the caller is not the engine, the platform
-- is frozen, the seat or occupancy does not match, the seat is not pending, the
-- table is not in a Lightning Cluster, the request is forced (an administrator's
-- exit is never turned into a blind off), the player is in a live Lightning
-- hand, or nothing is owed (then the ordinary cash-out must complete instead).
-- Additive only: no existing function changes, so an engine without the caller
-- behaves exactly as before.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE FUNCTION public.fn_lightning_owed_leave_returns_to_pool(
  p_user_id uuid, p_table_id uuid, p_seat_number integer, p_occupancy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_seat    record;
  v_cluster uuid;
  v_mode    text;
  v_owed    integer;
BEGIN
  IF NOT coalesce(public.fn_caller_is_engine(), false) THEN
    RAISE EXCEPTION 'fn_lightning_owed_leave_returns_to_pool is engine-only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_table_id IS NULL OR p_seat_number IS NULL OR p_occupancy_id IS NULL THEN
    RAISE EXCEPTION 'DEPARTURE_IDENTITY_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF public.fn_platform_frozen() THEN
    RETURN jsonb_build_object('returned', false, 'reason', 'platform_frozen');
  END IF;

  SELECT ts.id, ts.leave_pending, tb.cluster_id
    INTO v_seat
    FROM public.table_seats ts
    JOIN public.tables tb ON tb.id = ts.table_id
   WHERE ts.occupancy_id = p_occupancy_id AND ts.user_id = p_user_id
     AND ts.table_id = p_table_id AND ts.seat_number = p_seat_number
     AND ts.left_at IS NULL
   FOR UPDATE OF ts;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('returned', false, 'reason', 'stale_occupancy');
  END IF;
  IF NOT coalesce(v_seat.leave_pending, false) THEN
    RETURN jsonb_build_object('returned', false, 'reason', 'not_pending');
  END IF;

  SELECT g.id INTO v_cluster
    FROM public.cash_games g
   WHERE g.id = v_seat.cluster_id AND g.cluster_mode = 'lightning';
  IF v_cluster IS NULL THEN
    RETURN jsonb_build_object('returned', false, 'reason', 'not_lightning');
  END IF;

  SELECT d.leave_mode INTO v_mode
    FROM public.seat_departure_requests d
   WHERE d.occupancy_id = p_occupancy_id AND d.user_id = p_user_id
     AND d.table_id = p_table_id AND d.seat_number = p_seat_number
   FOR UPDATE;
  IF v_mode IS DISTINCT FROM 'voluntary' THEN
    RETURN jsonb_build_object('returned', false,
      'reason', CASE WHEN v_mode IS NULL THEN 'no_request' ELSE 'forced' END);
  END IF;

  IF public.fn_lightning_player_live_hand(p_user_id, v_cluster) IS NOT NULL THEN
    RETURN jsonb_build_object('returned', false, 'reason', 'in_hand');
  END IF;

  -- The leave door itself decides what is owed, exactly as it refuses the
  -- cash-out (and fn_lightning_hands_owed asks the same question).
  v_owed := coalesce((public.fn_cash_leave_check(p_user_id, p_table_id) ->> 'hands_remaining')::integer, 0);
  IF v_owed <= 0 THEN
    RETURN jsonb_build_object('returned', false, 'reason', 'not_owed');
  END IF;

  DELETE FROM public.seat_departure_requests d
   WHERE d.occupancy_id = p_occupancy_id AND d.user_id = p_user_id
     AND d.table_id = p_table_id AND d.seat_number = p_seat_number
     AND d.leave_mode = 'voluntary';

  UPDATE public.table_seats
     SET leave_pending = false,
         is_sitting_out = false,
         status = 'active'
   WHERE id = v_seat.id;

  UPDATE public.cash_player_session
     SET hr_blind_off = true
   WHERE player_id = p_user_id AND scope_type = 'table' AND scope_id = p_table_id
     AND closed_at IS NULL;

  RETURN jsonb_build_object('returned', true, 'hands_remaining', v_owed,
    'cluster_id', v_cluster, 'occupancy_id', p_occupancy_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_lightning_owed_leave_returns_to_pool(uuid, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_owed_leave_returns_to_pool(uuid, uuid, integer, uuid)
  TO service_role;

COMMIT;
