-- 20261115000756_lightning_bank_the_win_reading_reads_only_the_session.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE LIGHTNING BANK-THE-WIN READING READS ONLY THE HORSE'S OWN SESSION.
--
-- THE FAULT (production, 2026-11-14). fn_lightning_bank_the_win_reading is the
-- one read behind a Lightning Horse's bank-the-win leave (owner 2026-11-10/11,
-- LightningBankTheWinDoor). To learn how many players the Horse's last hand
-- dealt, it joined EVERY lightning_hand_player row the Horse ever had to
-- lightning_hand and sorted them:
--
--   SELECT lh.player_count FROM lightning_hand_player lp JOIN lightning_hand lh ...
--    WHERE lp.player_id = p_player_id AND lh.cluster_id = p_cluster_id
--      AND lh.settled_at IS NOT NULL ORDER BY lh.settled_at DESC LIMIT 1;
--
-- A Horse holds tens of thousands of Lightning hands (68,889 for the Horse
-- measured), so one call read ~333,000 buffers and ran 8.6 s (EXPLAIN ANALYZE
-- on production, 2026-11-15T00:1xZ), past the statement timeout. The API
-- returned HTTP 500 for this RPC 20 to 330 times an hour all day on
-- 2026-11-14 (edge logs). The door treats a failed read as "not ready" and asks
-- again on a later hand, so a Horse at its bank-the-win line could not leave
-- and every re-ask burned another 8 s on the database.
--
-- THE FIX. The last hand is looked for only inside the Horse's open pool
-- session: the session's cluster and epoch, hands formed since it entered,
-- newest first. That walks lightning_hand_by_cluster_epoch (cluster_id,
-- cluster_epoch, formed_at DESC) and probes lightning_hand_player_pkey
-- (hand_id, player_id) until the first hand the Horse was dealt into: 12
-- buffers, 0.4 ms for the same Horse.
--
-- MEANING. players_per_hand is the size of the Horse's last hand in THIS
-- session. Before, a Horse with no settled hand yet in its session got the
-- size of a hand from an earlier session; it now gets 0, which the door
-- already reads as "two per hand" (LightningBankTheWin.decideLightningBankTheWin
-- floors it at 2). A Horse with no hand in its session cannot have reached its
-- bank-the-win line in it, so no leave decision changes. Every other field is
-- computed exactly as before; grants are re-stated unchanged.
--
-- No table lock beyond the function replacement; no data changes.
-- @live-proof: (position('v_ps.entered_at' in pg_get_functiondef('public.fn_lightning_bank_the_win_reading(uuid,uuid)'::regprocedure)) > 0)

BEGIN;
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_lightning_bank_the_win_reading(uuid,uuid)'::regprocedure))
       IS DISTINCT FROM 'a7e9ad154abfb5678c2b3e341b63f3de' THEN
    RAISE EXCEPTION 'LIGHTNING_BANK_THE_WIN_READING_SOURCE_CHANGED';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.fn_lightning_bank_the_win_reading(p_cluster_id uuid, p_player_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ps record; v_s public.cash_player_session; v_ts record; v_max numeric; v_epoch integer;
  v_rank integer; v_pool integer; v_dealt integer;
BEGIN
  SELECT ps.* INTO v_ps FROM public.lightning_pool_session ps
   WHERE ps.cluster_id = p_cluster_id AND ps.player_id = p_player_id AND ps.exited_at IS NULL
   ORDER BY ps.entered_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT * INTO v_s FROM public.cash_player_session cs
   WHERE cs.id = v_ps.cash_player_session_id AND cs.closed_at IS NULL;
  SELECT ts.id, ts.table_id, ts.stack, ts.leave_pending INTO v_ts FROM public.table_seats ts
   WHERE ts.id = v_ps.anchor_seat_id AND ts.user_id = p_player_id AND ts.left_at IS NULL;
  IF v_s.id IS NULL OR v_ts.id IS NULL THEN RETURN jsonb_build_object('found', false); END IF;
  SELECT t.max_buy_in INTO v_max FROM public.tables t WHERE t.id = v_ts.table_id;
  SELECT cg.cluster_epoch INTO v_epoch FROM public.cash_games cg WHERE cg.id = p_cluster_id;
  -- The pool's real big blind order: this player's place, and how many seats it orders.
  SELECT count(*)::integer, max(o.p2_rank) FILTER (WHERE o.player_id = p_player_id)
    INTO v_pool, v_rank
    FROM public.fn_lightning_blind_order(p_cluster_id, v_epoch, NULL) o;
  -- The size of this Horse's last settled hand IN THIS POOL SESSION (20261115000756):
  -- the session's cluster and epoch, formed since it entered, newest first, so
  -- the read walks the cluster's recent hands, never the Horse's whole history.
  SELECT lh.player_count INTO v_dealt
    FROM public.lightning_hand lh
    JOIN public.lightning_hand_player lp
      ON lp.hand_id = lh.hand_id AND lp.player_id = p_player_id
   WHERE lh.cluster_id = p_cluster_id
     AND lh.cluster_epoch = v_ps.cluster_epoch
     AND lh.formed_at >= v_ps.entered_at
     AND lh.settled_at IS NOT NULL
   ORDER BY lh.formed_at DESC
   LIMIT 1;
  RETURN jsonb_build_object(
    'found', true,
    'table_id', v_ts.table_id,
    'stack', v_ts.stack,
    'leave_pending', coalesce(v_ts.leave_pending, false),
    'start_basis', coalesce(v_s.start_basis,
                            CASE WHEN coalesce(v_max, 0) > 0 THEN least(v_s.baseline, v_max)
                                 ELSE v_s.baseline END),
    'hands_since_big_pot', v_s.hands_since_big_pot,
    'hands_owed', public.fn_cash_session_hands_owed(v_s, v_ts.stack),
    'blind_rank', v_rank,
    'pool_players', coalesce(v_pool, 0),
    'players_per_hand', coalesce(v_dealt, 0));
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_bank_the_win_reading(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_bank_the_win_reading(uuid, uuid) TO service_role;

COMMIT;
