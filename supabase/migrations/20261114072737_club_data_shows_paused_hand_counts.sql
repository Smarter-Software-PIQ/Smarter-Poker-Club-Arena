-- 20261114072737_club_data_shows_paused_hand_counts.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- CLUB DATA SHOWS A PAUSED HAND COUNT (owner 2026-11-14: "FULLY BUILD, FIX
-- AND ENHANCE ALL OF THESE", following the 2026-11-13 ruling that a Charles
-- Rule countdown pauses out of profit and resumes where it left off,
-- migration 20261114050737).
--
-- ca_club_hit_run_status listed only players who owe hands right now, so a
-- player who fell out of profit with hands left vanished from the owner's
-- view until they were back in profit. It now also returns "paused_rows":
-- every seated player whose countdown is unfinished (hr_hands_played <
-- hr_hands_required, not completed) while they are at or below their
-- baseline and owe nothing, with the hands left and the countdown's total.
--
-- "rows" is byte for byte what it was (the same query, order and limit), so
-- a page still on the previous client shows exactly what it showed. The same
-- scope applies to both lists: owners, co-owners and admins see the club,
-- agents their downline, everyone else is refused, deleted players never
-- appear. Horses and people are listed alike. Read-only; no money moves.
--
-- Function image only (no hot-table lock): installs from protected main.
-- @live-proof: (position('paused_rows' in pg_get_functiondef('public.ca_club_hit_run_status(uuid)'::regprocedure)) > 0)

BEGIN;
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.ca_club_hit_run_status(uuid)'::regprocedure))
       IS DISTINCT FROM '1b119337c2c2ac187a7c3f1cbbb74993' THEN
    RAISE EXCEPTION 'CLUB_HIT_RUN_STATUS_SOURCE_CHANGED';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.ca_club_hit_run_status(p_club_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_scope text := public.fn_ca_club_data_scope(p_club_id);
  v_clubs uuid[];
  v_people uuid[];
  v_rows jsonb;
  v_paused jsonb;
BEGIN
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'not authorized for this club' USING ERRCODE = '42501';
  END IF;
  v_clubs := public.fn_ca_club_data_clubs(p_club_id);
  IF v_scope = 'downline' THEN
    v_people := public.fn_ca_club_data_downline(p_club_id, auth.uid());
  END IF;

  SELECT coalesce(jsonb_agg(x.r ORDER BY x.blind_off DESC, x.left_hands DESC, x.username), '[]'::jsonb)
    INTO v_rows
    FROM (
      SELECT jsonb_build_object(
               'user_id', s.player_id,
               'username', coalesce(public.fn_arena_name(pr.alias, pr.username, pr.display_name,
                                      pr.first_name, pr.last_name, pr.full_name), pr.username, 'Player'),
               'table_id', s.table_id,
               'table_name', coalesce(t.name, ''),
               'stakes', coalesce(t.stakes, ''),
               'hands_remaining', h.left_hands,
               -- The binding obligation's own total, as the player sees it.
               'hands_required',
                 CASE WHEN public.fn_cash_big_win_hands_remaining(s.hr_big_win_required,
                             s.hr_big_win_played, s.hr_engine_ack, ts.stack)
                           >= public.fn_cash_hit_run_hands_remaining(s.hr_hands_required,
                             s.hr_hands_played, s.hr_completed, s.hr_engine_ack, ts.stack, s.baseline)
                           AND s.hr_big_win_required > s.hr_big_win_played
                      THEN s.hr_big_win_required ELSE s.hr_hands_required END,
               'hands_reason', public.fn_cash_session_owed_reason(s, ts.stack),
               'blind_off', s.hr_blind_off) AS r,
             s.hr_blind_off AS blind_off, h.left_hands,
             coalesce(pr.username, '') AS username
        FROM public.cash_player_session s
        JOIN public.table_seats ts ON ts.table_id = s.table_id AND ts.user_id = s.player_id
         AND ts.left_at IS NULL
        JOIN public.tables t ON t.id = s.table_id
        JOIN public.profiles pr ON pr.id = s.player_id
        CROSS JOIN LATERAL (SELECT public.fn_cash_session_hands_owed(s, ts.stack) AS left_hands) h
       WHERE s.closed_at IS NULL AND s.scope_type = 'table' AND h.left_hands > 0
         AND coalesce(pr.status, '') <> 'deleted'
         AND EXISTS (SELECT 1 FROM public.club_members cm
                      WHERE cm.club_id = ANY (v_clubs) AND cm.user_id = s.player_id)
         AND (v_people IS NULL OR s.player_id = ANY (v_people))
       LIMIT 200
    ) x;

  -- THE COUNT IS PAUSED (owner 2026-11-13): out of profit with hands of an
  -- unfinished countdown left. Nothing is owed and the player may leave; the
  -- count resumes at hands_remaining when they are back in profit.
  SELECT coalesce(jsonb_agg(x.r ORDER BY x.left_hands DESC, x.username), '[]'::jsonb)
    INTO v_paused
    FROM (
      SELECT jsonb_build_object(
               'user_id', s.player_id,
               'username', coalesce(public.fn_arena_name(pr.alias, pr.username, pr.display_name,
                                      pr.first_name, pr.last_name, pr.full_name), pr.username, 'Player'),
               'table_id', s.table_id,
               'table_name', coalesce(t.name, ''),
               'stakes', coalesce(t.stakes, ''),
               'hands_remaining', s.hr_hands_required - s.hr_hands_played,
               'hands_required', s.hr_hands_required,
               'paused', true) AS r,
             s.hr_hands_required - s.hr_hands_played AS left_hands,
             coalesce(pr.username, '') AS username
        FROM public.cash_player_session s
        JOIN public.table_seats ts ON ts.table_id = s.table_id AND ts.user_id = s.player_id
         AND ts.left_at IS NULL
        JOIN public.tables t ON t.id = s.table_id
        JOIN public.profiles pr ON pr.id = s.player_id
       WHERE s.closed_at IS NULL AND s.scope_type = 'table'
         AND s.hr_engine_ack AND NOT s.hr_completed
         AND s.hr_hands_required > 0 AND s.hr_hands_played < s.hr_hands_required
         AND ts.stack <= s.baseline
         AND public.fn_cash_session_hands_owed(s, ts.stack) = 0
         AND coalesce(pr.status, '') <> 'deleted'
         AND EXISTS (SELECT 1 FROM public.club_members cm
                      WHERE cm.club_id = ANY (v_clubs) AND cm.user_id = s.player_id)
         AND (v_people IS NULL OR s.player_id = ANY (v_people))
       LIMIT 200
    ) x;

  RETURN jsonb_build_object(
    'contract', 'ca_club_hit_run_status.v1',
    'club_id', p_club_id,
    'scope', v_scope,
    'rows', v_rows,
    'paused_rows', v_paused);
END;
$function$;

COMMIT;
