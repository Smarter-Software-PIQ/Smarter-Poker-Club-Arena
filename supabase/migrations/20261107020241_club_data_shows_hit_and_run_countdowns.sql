-- @install-window: daily-maintenance
-- 20261107020241_club_data_shows_hit_and_run_countdowns.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- CLUB DATA - HIT AND RUN (owner 2026-11-06). Who in this club owes hands in
-- profit before leaving right now, how many, of what countdown total, and
-- whose confirmed early leave is being blinded off. Reads the columns
-- 20261106203853 adds, so it installs in the same daily window, after it.
--
-- Scope is Club Data's own (fn_ca_club_data_scope): owners, co-owners and
-- admins see every member, agents their own downline, anyone else is
-- refused. A member is listed wherever they play (a union table included).
-- Deleted players never appear (owner 2026-10-16). Read only; no money.
-- @live-proof: (to_regprocedure('public.ca_club_hit_run_status(uuid)') IS NOT NULL)
BEGIN;
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.ca_club_hit_run_status(p_club_id uuid)
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
               'hands_required', s.hr_hands_required,
               'blind_off', s.hr_blind_off) AS r,
             s.hr_blind_off AS blind_off, h.left_hands,
             coalesce(pr.username, '') AS username
        FROM public.cash_player_session s
        JOIN public.table_seats ts ON ts.table_id = s.table_id AND ts.user_id = s.player_id
         AND ts.left_at IS NULL
        JOIN public.tables t ON t.id = s.table_id
        JOIN public.profiles pr ON pr.id = s.player_id
        CROSS JOIN LATERAL (SELECT public.fn_cash_hit_run_hands_remaining(s.hr_hands_required,
               s.hr_hands_played, s.hr_completed, s.hr_engine_ack, ts.stack, s.baseline) AS left_hands) h
       WHERE s.closed_at IS NULL AND s.scope_type = 'table' AND h.left_hands > 0
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
    'rows', v_rows);
END;
$function$;
REVOKE ALL ON FUNCTION public.ca_club_hit_run_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ca_club_hit_run_status(uuid) TO authenticated, service_role;
COMMIT;
