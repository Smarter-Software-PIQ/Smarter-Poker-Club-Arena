-- 20261112184444_lightning_session_stats_count_auto_top_ups_in_the_buy_in.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan, 2026-11-12, on the Lightning Session Results card: "FIX THE SESSION
-- CARD DATA AS IT DOESN'T SEE ACCURATE". The card read STARTING STACK 400,
-- ENDING STACK 401, NET -14 for KingFish's PLO4 1.00/2.00 session
-- (aa7ead90-94a3-41c9-95ef-9a81e95422d1). Every number was a true read, but
-- the card left out the chips Auto Top Up added between hands: three applied
-- intents of 4, 1 and 10 (smarter_private.lightning_top_up_intents), so
-- 400 + 15 - 14 = 401. A card whose own numbers do not add up is wrong.
--
-- fn_lightning_session_stats now also answers:
--   'top_ups'      - the chips Auto Top Up actually APPLIED to this session's
--                    anchor seat (status 'applied'; pending/refused add nothing);
--   'total_buy_in' - starting_stack + top_ups, the total chips put on the table.
-- So TOTAL BUY-IN - ENDING STACK always reconciles with NET. Nothing else in
-- the answer changes; the owner/service gate and the read-only body stand.
-- Read-only, CREATE OR REPLACE of one function, no hot-table lock.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_lightning_session_stats(p_pool_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_service boolean := coalesce(auth.role(), '') = 'service_role';
  s         record;
  h         record;
  v_end     timestamptz;
  v_dur     bigint;
  v_stack   numeric;
  v_top_ups numeric;
BEGIN
  IF p_pool_session_id IS NULL OR (v_uid IS NULL AND NOT v_service) THEN
    RETURN NULL;
  END IF;
  SELECT ps.id, ps.cluster_id, ps.player_id, ps.entered_at, ps.exited_at, ps.starting_stack,
         ps.ending_stack, ps.net_result, cg.bb
    INTO s
    FROM public.lightning_pool_session ps
    JOIN public.cash_games cg ON cg.id = ps.cluster_id
   WHERE ps.id = p_pool_session_id;
  -- Somebody else's session is answered exactly as one that does not exist.
  IF NOT FOUND OR (NOT v_service AND s.player_id IS DISTINCT FROM v_uid) THEN
    RETURN NULL;
  END IF;

  -- THE SETTLED HANDS OF THE SESSION, as the settlement recorded them: the
  -- hand row, its hand_history row and, for VPIP and PFR, the per-hand facts
  -- the cash statistics already read.
  SELECT count(*)::integer                                              AS hands,
         coalesce(sum(hp.net_result), 0)                                 AS net,
         count(*) FILTER (WHERE hp.fold_type = 'fast')::integer          AS fast_folds,
         count(*) FILTER (WHERE hp.fold_type = 'normal')::integer        AS normal_folds,
         count(*) FILTER (WHERE hp.fold_type = 'fold_watch')::integer    AS fold_and_watch,
         count(*) FILTER (WHERE hp.showed)::integer                      AS showdowns,
         round(avg(hh.pot_size), 2)                                      AS avg_pot,
         round(avg(hp.waited_ms))::integer                               AS avg_wait_ms,
         percentile_disc(0.95) WITHIN GROUP (ORDER BY hp.waited_ms)      AS p95_wait_ms,
         percentile_disc(0.99) WITHIN GROUP (ORDER BY hp.waited_ms)      AS p99_wait_ms,
         count(f.hand_id)::integer                                       AS fact_hands,
         count(*) FILTER (WHERE f.vpip)::integer                         AS vpip_hands,
         count(*) FILTER (WHERE f.pfr)::integer                          AS pfr_hands
    INTO h
    FROM public.lightning_pool_slot sl
    JOIN public.lightning_hand_player hp ON hp.pool_slot_id = sl.id
    JOIN public.lightning_hand lh ON lh.hand_id = hp.hand_id
    LEFT JOIN public.hand_history hh ON hh.id = lh.hand_history_id
    LEFT JOIN public.ca_hand_facts f ON f.hand_id = lh.hand_history_id AND f.user_id = hp.player_id
   WHERE sl.pool_session_id = s.id
     AND lh.settled_at IS NOT NULL;

  -- AUTO TOP UP: chips added to the anchor seat between hands are part of
  -- what the player put on the table. Only an APPLIED intent moved chips.
  SELECT coalesce(sum(t.applied), 0)
    INTO v_top_ups
    FROM smarter_private.lightning_top_up_intents t
   WHERE t.pool_session_id = s.id
     AND t.status = 'applied'
     AND t.applied > 0;

  v_end := coalesce(s.exited_at, clock_timestamp());
  v_dur := GREATEST(floor(extract(epoch FROM (v_end - s.entered_at))), 0)::bigint;
  v_stack := CASE WHEN s.exited_at IS NULL THEN public.fn_lightning_pool_stack(s.id)
                  ELSE coalesce(s.ending_stack, s.starting_stack + v_top_ups + s.net_result) END;

  RETURN jsonb_build_object(
    'pool_session_id', s.id,
    'cluster_id',      s.cluster_id,
    'started_at',      s.entered_at,
    'ended_at',        s.exited_at,
    'duration_s',      v_dur,
    'hands',           h.hands,
    'hands_per_hour',  CASE WHEN v_dur > 0 THEN round(h.hands * 3600.0 / v_dur, 2) END,
    'starting_stack',  s.starting_stack,
    'top_ups',         round(v_top_ups, 2),
    'total_buy_in',    round(s.starting_stack + v_top_ups, 2),
    'current_stack',   v_stack,
    'net',             round(h.net, 2),
    'bb_per_100',      CASE WHEN h.hands > 0 AND s.bb > 0 THEN round(h.net / s.bb / h.hands * 100, 2) END,
    'vpip',            CASE WHEN h.fact_hands > 0 THEN round(100.0 * h.vpip_hands / h.fact_hands, 1) END,
    'pfr',             CASE WHEN h.fact_hands > 0 THEN round(100.0 * h.pfr_hands / h.fact_hands, 1) END,
    'avg_pot',         h.avg_pot,
    'showdowns',       h.showdowns,
    'fast_folds',      h.fast_folds,
    'normal_folds',    h.normal_folds,
    'fold_and_watch',  h.fold_and_watch,
    'avg_wait_ms',     h.avg_wait_ms,
    'p95_wait_ms',     h.p95_wait_ms,
    'p99_wait_ms',     h.p99_wait_ms);
END
$function$;

COMMIT;
