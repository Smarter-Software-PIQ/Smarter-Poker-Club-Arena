-- 20261114160836_an_owed_leave_alone_at_its_table_plays_on_in_its_game.sql
-- @live-proof: position('nobody_in_game' in pg_get_functiondef('public.fn_owed_leave_plays_on_in_game(uuid,uuid,integer,uuid)'::regprocedure)) > 0 AND to_regclass('public.ca_owed_leave_decisions') IS NOT NULL
--
-- AN OWED LEAVE ALONE AT ITS TABLE PLAYS ON IN ITS GAME (2026-11-14).
--
-- Owner rule, Dan, 2026-11-06 (Hit And Run): a player in profit cannot leave
-- the table until 10 hands are played in profit; a leave before that is blinded
-- off for the remaining hands. The engine waives the count when nobody else is
-- left at the table to deal with ("nobody to have hit and run from").
--
-- WHAT WAS WRONG (measured 2026-11-14): Lightning NLH .25/.50 switched off at
-- 03:33:24 Chicago. Nine held leaves, each alone at a former anchor table, were
-- released at 03:33:28-46 as system exits with 0-3 of 10 owed hands played,
-- while the same game dealt 23 hands at another table in the next 45 minutes.
-- In a game of several tables, alone at one table is not alone in the game.
--
-- THE DOOR. The engine asks this function before that waiver. It answers:
--   keep = true while another live table of the same game holds at least two
--     players who are in, funded and not leaving. A pending voluntary request
--     for this exact occupancy is withdrawn and the seat stops sitting out and
--     pending, with the session marked blinded off, so the game's ordinary
--     consolidation (fn_cash_cluster_tick moves funded, non-pending seats) can
--     move it to a table that deals. There the engine restores the blind off
--     from the session and the count is played out. No stack, departure time or
--     occupant changes here, so no chips move.
--   keep = false (the waiver stands) when nothing is owed, the game has no other
--     dealing table, the request is forced (an administrator's exit), the table
--     is in no game, or the seat has waited ten minutes for a move that did not
--     come. The ten-minute bound means a seat is never held at an empty table.
-- Every answer is written to ca_owed_leave_decisions, so a waiver can be read
-- in the database instead of only in a server log. That table has no foreign
-- keys to hot tables (CLAUDE.md DDL rule 7).
--
-- Additive: no existing function changes. An engine without the caller, or a
-- missing function, releases the seat exactly as before. Nothing reads horse
-- identity: a person and a horse get the same answer.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

CREATE TABLE public.ca_owed_leave_decisions (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL,
  table_id uuid NOT NULL,
  occupancy_id uuid NOT NULL,
  cluster_id uuid,
  keep boolean NOT NULL,
  returned boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  hands_owed integer
);
CREATE INDEX ca_owed_leave_decisions_occupancy ON public.ca_owed_leave_decisions (occupancy_id, occurred_at);
ALTER TABLE public.ca_owed_leave_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_owed_leave_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.ca_owed_leave_decisions TO service_role;
GRANT USAGE ON SEQUENCE public.ca_owed_leave_decisions_id_seq TO service_role;

CREATE FUNCTION public.fn_owed_leave_plays_on_in_game(
  p_user_id uuid, p_table_id uuid, p_seat_number integer, p_occupancy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_seat     record;
  v_mode     text;
  v_owed     integer := 0;
  v_others   integer;
  v_first    timestamptz;
  v_keep     boolean := false;
  v_returned boolean := false;
  v_reason   text;
BEGIN
  IF NOT coalesce(public.fn_caller_is_engine(), false) THEN
    RAISE EXCEPTION 'fn_owed_leave_plays_on_in_game is engine-only' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_table_id IS NULL OR p_seat_number IS NULL OR p_occupancy_id IS NULL THEN
    RAISE EXCEPTION 'DEPARTURE_IDENTITY_REQUIRED' USING ERRCODE = '22023';
  END IF;
  -- Frozen: hold, decide nothing, record nothing (the engine stands down too).
  IF public.fn_platform_frozen() THEN
    RETURN jsonb_build_object('keep', true, 'returned', false, 'reason', 'platform_frozen');
  END IF;

  SELECT ts.id, ts.leave_pending, ts.is_sitting_out, tb.cluster_id
    INTO v_seat
    FROM public.table_seats ts
    JOIN public.tables tb ON tb.id = ts.table_id
   WHERE ts.occupancy_id = p_occupancy_id AND ts.user_id = p_user_id
     AND ts.table_id = p_table_id AND ts.seat_number = p_seat_number
     AND ts.left_at IS NULL
   FOR UPDATE OF ts;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('keep', false, 'returned', false, 'reason', 'stale_occupancy');
  END IF;

  v_owed := coalesce((public.fn_cash_leave_check(p_user_id, p_table_id) ->> 'hands_remaining')::integer, 0);

  SELECT d.leave_mode INTO v_mode
    FROM public.seat_departure_requests d
   WHERE d.occupancy_id = p_occupancy_id AND d.user_id = p_user_id
     AND d.table_id = p_table_id AND d.seat_number = p_seat_number
   FOR UPDATE;

  SELECT min(x.occurred_at) INTO v_first
    FROM public.ca_owed_leave_decisions x
   WHERE x.occupancy_id = p_occupancy_id AND x.keep;

  IF v_owed <= 0 THEN
    v_reason := 'not_owed';
  ELSIF v_seat.cluster_id IS NULL THEN
    v_reason := 'no_game';
  ELSIF v_mode = 'forced' THEN
    v_reason := 'forced';
  ELSIF v_first IS NOT NULL AND now() - v_first > interval '10 minutes' THEN
    v_reason := 'not_moved';
  ELSE
    SELECT count(*) INTO v_others
      FROM (
        SELECT s.table_id
          FROM public.table_seats s
          JOIN public.tables t ON t.id = s.table_id
         WHERE t.cluster_id = v_seat.cluster_id AND t.id <> p_table_id
           AND coalesce(t.is_deleted, false) = false
           AND coalesce(t.lifecycle, '') NOT IN ('closed', 'breaking')
           AND s.left_at IS NULL AND coalesce(s.stack, 0) > 0
           AND coalesce(s.is_sitting_out, false) = false
           AND coalesce(s.leave_pending, false) = false
         GROUP BY s.table_id
        HAVING count(*) >= 2
      ) dealing;
    IF v_others = 0 THEN
      v_reason := 'nobody_in_game';
    ELSE
      v_keep := true;
      IF coalesce(v_seat.leave_pending, false) OR coalesce(v_seat.is_sitting_out, false) THEN
        DELETE FROM public.seat_departure_requests d
         WHERE d.occupancy_id = p_occupancy_id AND d.user_id = p_user_id
           AND d.table_id = p_table_id AND d.seat_number = p_seat_number
           AND d.leave_mode = 'voluntary';
        UPDATE public.table_seats
           SET leave_pending = false,
               is_sitting_out = false,
               status = 'active'
         WHERE id = v_seat.id;
        v_returned := true;
        v_reason := 'plays_on';
      ELSE
        v_reason := 'awaiting_move';
      END IF;
      UPDATE public.cash_player_session
         SET hr_blind_off = true
       WHERE player_id = p_user_id AND scope_type = 'table' AND scope_id = p_table_id
         AND closed_at IS NULL AND NOT hr_blind_off;
    END IF;
  END IF;

  INSERT INTO public.ca_owed_leave_decisions
    (user_id, table_id, occupancy_id, cluster_id, keep, returned, reason, hands_owed)
  VALUES
    (p_user_id, p_table_id, p_occupancy_id, v_seat.cluster_id, v_keep, v_returned, v_reason, v_owed);

  RETURN jsonb_build_object('keep', v_keep, 'returned', v_returned, 'reason', v_reason,
    'hands_remaining', v_owed, 'cluster_id', v_seat.cluster_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_owed_leave_plays_on_in_game(uuid, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_owed_leave_plays_on_in_game(uuid, uuid, integer, uuid)
  TO service_role;

COMMIT;
