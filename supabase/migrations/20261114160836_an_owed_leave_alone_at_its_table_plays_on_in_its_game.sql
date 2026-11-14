-- 20261114160836_an_owed_leave_alone_at_its_table_plays_on_in_its_game.sql
-- @live-proof: position('not_movable' in pg_get_functiondef('public.fn_owed_leave_plays_on_in_game(uuid,uuid,integer,uuid)'::regprocedure)) > 0 AND to_regclass('public.ca_owed_leave_decisions') IS NOT NULL
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
--   keep = true while the seat is on a FEEDER and a COMPATIBLE live Main of the
--     same game deals: same cash game (one club, variant and stakes, one rule
--     set), same club_id, variant, small and big blind on the table rows
--     themselves, with at least two players in, funded and not leaving. That is
--     the move the must-move planner makes (feeder player to an open Main chair);
--     a seat on a Main can move only to Main 1 (or anywhere while its table is
--     breaking), exactly as the planner draws; otherwise 'not_movable'. In a full-ring
--     game (handedness 7-9) a feeder releases a player to a Main only once it
--     holds handedness - 2 players or is breaking (20261108193515), so a lone
--     seat on such a feeder is answered 'not_movable' (the per-table rule).
--     An open chair is the planner's own count: fn_cash_cluster_census's
--     open_unreserved, net of notified waitlist holds and held Main chairs. Only a game that
--     moves its players qualifies (must_move, cluster_mode 'must_move', and not
--     a Classic game: Dan 2026-10-24, "PLAYERS SHOULD NOT BE MOVING ON CLASSIC
--     GAMES PERIOD"). A Classic game keeps the per-table rule.
--     A pending voluntary request for this exact occupancy is withdrawn and the
--     seat stops pending (it stays sat out: at a must-move table the sit-out is
--     the blind off, and the executor carries it), with the session marked
--     blinded off.
--     The game's own must-move planner then moves the seat to an open chair
--     through fn_cash_seat_move_execute, the maintained path: the stack moves
--     with the seat, the source seat is vacated in the same transaction (one
--     occupancy, no duplicate participation), and the open cash_player_session
--     row is re-pointed, so the countdown, the Charles doubles and the blind off
--     travel with the player. The engine at the destination restores the blind
--     off from the session and the count is played out.
--   keep = false (the per-table waiver stands) when nothing is owed, the request
--     is forced (an administrator's exit), the game does not move players, no
--     compatible table deals, or the wait bound below has passed.
--
-- THE WAIT BOUND. The clock starts at the first keep answer of this EPISODE of
-- being held alone: the first keep row after a gap of more than two minutes or
-- a non-keep answer. The engine asks every presence pass and the record keeps a
-- row at least once a minute, so a longer gap means the seat stopped being alone
-- in between. It is not reset within an episode. Two limits:
--   - while every compatible dealing Main is FULL (every chair held by a seat,
--     dealt, sitting out or leaving), 10 minutes. A move needs an
--     open chair; with none, the seat would sit alone, blinded off, with no
--     hand to play and no way out. Ten minutes is about the time the room
--     takes to open a chair under normal turnover. A player cannot shorten it:
--     the seat is blinded off and cannot act, the clock does not depend on
--     anything the player does, and the moment any compatible chair opens the
--     longer limit applies instead.
--   - while a compatible table HAS an open chair, 30 minutes. The planner moves
--     a funded, non-pending feeder seat to an open Main chair within a tick or
--     two, so a seat still unmoved after 30 minutes is a move-path fault. It
--     is recorded as 'not_moved' rather than held for ever.
-- So waiting out an obligation is only possible when the whole game is full
-- for ten minutes. There is then nowhere to play the hands, which is the
-- same reason the per-table waiver exists.
--
-- THE RECORD. Every answer is written to ca_owed_leave_decisions:
--   - who, from which table and occupancy, and in which game;
--   - the compatible destination it saw (with an open chair or not);
--   - keep, returned, the reason and the hands owed.
-- No names, no stacks, no IP or device data. Row-level security is on with no
-- policies; service_role may only READ it (the SECURITY DEFINER function is the
-- sole writer, so nobody can backdate the wait clock). One row per change of
-- answer, or one a minute while it repeats. There are no foreign keys to hot
-- tables (CLAUDE.md DDL rule 7).
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
  dest_table_id uuid,
  dest_open_chair boolean,
  source text NOT NULL DEFAULT 'engine_held_leave_release',
  keep boolean NOT NULL,
  returned boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  hands_owed integer
);
CREATE INDEX ca_owed_leave_decisions_occupancy ON public.ca_owed_leave_decisions (occupancy_id, occurred_at);
ALTER TABLE public.ca_owed_leave_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_owed_leave_decisions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.ca_owed_leave_decisions TO service_role;

CREATE FUNCTION public.fn_owed_leave_plays_on_in_game(
  p_user_id uuid, p_table_id uuid, p_seat_number integer, p_occupancy_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_seat     record;
  v_game     record;
  v_mode     text;
  v_owed     integer := 0;
  v_census   public.cash_cluster_census_row[];
  v_src      record;
  v_dest     uuid;
  v_open     boolean := false;
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

  SELECT ts.id, ts.leave_pending, ts.is_sitting_out, tb.cluster_id, tb.club_id, tb.role, tb.main_index, tb.lifecycle,
         tb.game_variant, tb.small_blind, tb.big_blind
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

  SELECT g.id, g.must_move, g.cluster_mode, coalesce(g.handedness, 9) AS handedness,
         public.fn_cash_game_never_moves_players(g.template_name, g.ruleset_snapshot) AS never_moves
    INTO v_game
    FROM public.cash_games g WHERE g.id = v_seat.cluster_id;

  IF v_seat.cluster_id IS NOT NULL THEN
    v_census := public.fn_cash_cluster_census(v_seat.cluster_id);
  END IF;
  SELECT c.seated, c.breaking INTO v_src FROM unnest(v_census) c WHERE c.id = p_table_id;

  -- A compatible LIVE MAIN of the same game that deals; an open chair first.
  -- The must-move planner fills open Main chairs from feeder players, so that
  -- is the move this seat can actually get. A chair is open exactly as the
  -- planner counts it: fn_cash_cluster_census's open_unreserved (seats not held
  -- by a seated player, a notified waitlist hold or a held Main chair).
  SELECT x.table_id, x.open_chair INTO v_dest, v_open
    FROM (
      SELECT t.id AS table_id,
             coalesce((SELECT c.open_unreserved > 0 FROM unnest(v_census) c WHERE c.id = t.id), false)
               AS open_chair
        FROM public.tables t
        JOIN public.table_seats s ON s.table_id = t.id
       WHERE t.cluster_id = v_seat.cluster_id AND t.id <> p_table_id
         AND t.role = 'main' AND t.lifecycle = 'live'
         -- The planner's draw (20261108193515 must-move pick): a feeder or a
         -- breaking table gives players to any Main; Main 1 draws from every
         -- other table too.
         AND (v_seat.role = 'feeder' OR v_seat.lifecycle = 'breaking' OR t.main_index = 1)
         AND t.club_id IS NOT DISTINCT FROM v_seat.club_id
         AND t.game_variant IS NOT DISTINCT FROM v_seat.game_variant
         AND t.small_blind IS NOT DISTINCT FROM v_seat.small_blind
         AND t.big_blind IS NOT DISTINCT FROM v_seat.big_blind
         AND coalesce(t.is_deleted, false) = false
         AND s.left_at IS NULL AND coalesce(s.stack, 0) > 0
         AND coalesce(s.is_sitting_out, false) = false
         AND coalesce(s.leave_pending, false) = false
       GROUP BY t.id
      HAVING count(*) >= 2
    ) x
   ORDER BY x.open_chair DESC, x.table_id
   LIMIT 1;

  -- THE CLOCK BELONGS TO THIS EPISODE. The engine asks every presence pass
  -- while the seat is held alone, and the record keeps at least one row a
  -- minute, so a gap of more than two minutes since the last keep means the
  -- seat stopped being alone (someone sat, or the leave was withdrawn) and
  -- this is a new episode with a fresh clock. Within an episode the clock is
  -- the first keep after the last such gap.
  WITH k AS (
    SELECT d.occurred_at, d.keep,
           lag(d.occurred_at) OVER (ORDER BY d.id) AS prev_at,
           lag(d.keep) OVER (ORDER BY d.id) AS prev_keep
      FROM public.ca_owed_leave_decisions d
     WHERE d.occupancy_id = p_occupancy_id
  )
  SELECT CASE WHEN max(occurred_at) FILTER (WHERE keep) > now() - interval '2 minutes'
              THEN max(occurred_at) FILTER (WHERE keep AND (prev_keep IS DISTINCT FROM true
                                                         OR occurred_at - prev_at > interval '2 minutes'))
         END
    INTO v_first
    FROM k;

  IF v_owed <= 0 THEN
    v_reason := 'not_owed';
  ELSIF v_mode = 'forced' THEN
    v_reason := 'forced';
  ELSIF v_game.id IS NULL OR NOT coalesce(v_game.must_move, false)
        OR v_game.cluster_mode IS DISTINCT FROM 'must_move'
        OR coalesce(v_game.never_moves, true) THEN
    v_reason := 'game_never_moves';
  ELSIF v_seat.role = 'feeder' AND v_game.handedness >= 7 AND NOT coalesce(v_src.breaking, false)
        AND coalesce(v_src.seated, 0) < greatest(2, v_game.handedness - 2) THEN
    -- A full-ring feeder gives a Main a player only once it holds
    -- handedness - 2 players, or while it is breaking (20261108193515): a
    -- lone seat there is not moved, so holding it would only wait out the bound.
    v_reason := 'not_movable';
  ELSIF v_dest IS NULL AND v_seat.role IS DISTINCT FROM 'feeder'
        AND v_seat.lifecycle IS DISTINCT FROM 'breaking' THEN
    -- A Main that is not breaking gives players only to Main 1, and Main 1
    -- itself to nobody: there is no move for this seat.
    v_reason := 'not_movable';
  ELSIF v_dest IS NULL THEN
    v_reason := 'nobody_in_game';
  ELSIF v_first IS NOT NULL AND NOT v_open AND now() - v_first > interval '10 minutes' THEN
    v_reason := 'compatible_full';
  ELSIF v_first IS NOT NULL AND now() - v_first > interval '30 minutes' THEN
    v_reason := 'not_moved';
  ELSE
    v_keep := true;
    IF coalesce(v_seat.leave_pending, false) THEN
      DELETE FROM public.seat_departure_requests d
       WHERE d.occupancy_id = p_occupancy_id AND d.user_id = p_user_id
         AND d.table_id = p_table_id AND d.seat_number = p_seat_number
         AND d.leave_mode = 'voluntary';
      -- Pending only: the sit-out IS the blind off at a must-move table, and
      -- fn_cash_seat_move_execute carries it to the destination.
      UPDATE public.table_seats
         SET leave_pending = false
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

  -- One row per change of answer, or one a minute while it repeats.
  IF NOT EXISTS (
    SELECT 1 FROM public.ca_owed_leave_decisions d
     WHERE d.occupancy_id = p_occupancy_id
       AND d.id = (SELECT max(d2.id) FROM public.ca_owed_leave_decisions d2
                    WHERE d2.occupancy_id = p_occupancy_id)
       AND d.reason = v_reason AND d.keep = v_keep
       AND d.occurred_at > now() - interval '1 minute') THEN
    INSERT INTO public.ca_owed_leave_decisions
      (user_id, table_id, occupancy_id, cluster_id, dest_table_id, dest_open_chair,
       keep, returned, reason, hands_owed)
    VALUES
      (p_user_id, p_table_id, p_occupancy_id, v_seat.cluster_id, v_dest, v_open,
       v_keep, v_returned, v_reason, v_owed);
  END IF;

  RETURN jsonb_build_object('keep', v_keep, 'returned', v_returned, 'reason', v_reason,
    'hands_remaining', v_owed, 'cluster_id', v_seat.cluster_id, 'dest_table_id', v_dest,
    'dest_open_chair', v_open);
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_owed_leave_plays_on_in_game(uuid, uuid, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_owed_leave_plays_on_in_game(uuid, uuid, integer, uuid)
  TO service_role;

COMMIT;
