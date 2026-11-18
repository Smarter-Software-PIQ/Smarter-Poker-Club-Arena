-- 20261112203847_lightning_a_player_can_withdraw_their_own_leave_next_hand.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan, 2026-11-12: build the improvements to Lightning "Leave Next Hand",
-- including letting the player cancel it. The button calls
-- fn_lightning_stop_playing, which marks stop_requested_at so the matcher
-- never deals the player again and the session exits when the live hand
-- settles. Until now nothing let the player take that mark back.
--
-- fn_lightning_resume_playing(p_cluster_id) withdraws the CALLER'S OWN stop
-- mark on their newest open session in that Cluster, so they keep being
-- dealt in. It refuses (and changes nothing) when:
--   NO_SESSION - the caller has no session in the Cluster;
--   EXITED     - the session already ended (the hand settled first);
--   FROZEN     - the Cluster is frozen: a frozen Cluster is evidence, and the
--                stop doctrine never edits its rows (20261008142857);
--   RG_LIMIT   - responsible gaming (self-exclusion, cooling-off) refuses
--                play; a stop is never withdrawn into a refused door.
-- No stop mark standing answers ok with withdrawn false. A withdrawal writes
-- one 'stop_playing_withdrawn' event beside the 'stop_playing_requested' one.
-- The same withdrawal already exists for blind off (fn_cash_session_set_blind_off).
-- Writes only the caller's own pool-session row; no money, no seat.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_lightning_resume_playing(p_cluster_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_now   timestamptz := clock_timestamp();
  s       record;
  v_table uuid;
BEGIN
  IF v_uid IS NULL OR p_cluster_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- The caller's newest session in the Cluster, locked exactly as the stop
  -- door locks it, so a stop, a resume, the matcher and the reaper serialize.
  SELECT ps.id, ps.cluster_id, ps.cluster_epoch, ps.player_id, ps.anchor_seat_id,
         ps.exited_at, ps.stop_requested_at
    INTO s
    FROM public.lightning_pool_session ps
   WHERE ps.cluster_id = p_cluster_id AND ps.player_id = v_uid
   ORDER BY ps.entered_at DESC, ps.id
   LIMIT 1
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_SESSION');
  END IF;
  IF s.exited_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'EXITED', 'pool_session_id', s.id);
  END IF;
  IF s.stop_requested_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'pool_session_id', s.id, 'withdrawn', false);
  END IF;
  IF EXISTS (SELECT 1 FROM public.cash_games fz
              WHERE fz.id = s.cluster_id AND fz.cluster_mode = 'frozen') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'FROZEN', 'pool_session_id', s.id);
  END IF;
  IF (public.fn_rg_require_not_excluded(v_uid) ->> 'ok')::boolean IS DISTINCT FROM true THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'RG_LIMIT', 'pool_session_id', s.id);
  END IF;

  UPDATE public.lightning_pool_session ps
     SET stop_requested_at = NULL, updated_at = v_now
   WHERE ps.id = s.id AND ps.exited_at IS NULL;

  SELECT ts.table_id INTO v_table FROM public.table_seats ts WHERE ts.id = s.anchor_seat_id;
  INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload, cluster_epoch)
  VALUES (s.cluster_id, v_table, 'stop_playing_withdrawn', jsonb_build_object(
    'cluster_id', s.cluster_id, 'cluster_epoch', s.cluster_epoch, 'player_id', s.player_id,
    'pool_session_id', s.id, 'anchor_seat_id', s.anchor_seat_id,
    'stop_requested_at', s.stop_requested_at, 'at', v_now), s.cluster_epoch);

  RETURN jsonb_build_object('ok', true, 'pool_session_id', s.id, 'withdrawn', true);
END
$function$;

REVOKE ALL ON FUNCTION public.fn_lightning_resume_playing(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_lightning_resume_playing(uuid) TO authenticated, service_role;

COMMIT;
