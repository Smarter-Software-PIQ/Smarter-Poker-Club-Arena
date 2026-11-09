-- 20261109224717_a_lightning_blind_off_always_completes.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- A LIGHTNING BLIND OFF ALWAYS COMPLETES (bug report BUG-7C1347FF).
--
-- THE HIT AND RUN RULE (owner, 2026-11-06): a player in profit who leaves
-- before the hand count is played "WILL BE BLINDED OFF FOR THE REMAINING
-- HANDS". At a Lightning anchor that means the pool keeps dealing the seat and
-- its hand host checks or folds it (fn_lightning_blind_off_players) until the
-- count completes or the profit is gone; the anchor engine then cashes the
-- seat out through the voluntary door (fn_cash_leave_check).
--
-- THE DEFECT, read from production rows: every Lightning leave door first
-- calls fn_lightning_stop_playing, which marked the stop and closed the pool
-- session ('stop_playing') with no regard for hands owed. A closed pool
-- session is never dealt, so the count froze (3 of 10 for the reporting
-- player), the leave was refused for ever and the stack stayed on the seat.
-- A disconnect did the same by two other routes: the matcher refuses
-- DISCONNECTED and STOP_REQUESTED sessions, and the reaper exits them.
--
-- THE FIX, in the functions that produced the outcome:
--
--   1. fn_lightning_stop_playing neither marks a stop nor exits the session
--      while the voluntary door would refuse the leave for hands owed
--      (fn_cash_leave_check, the one authority, so a leave asked for before
--      the countdown started is still honoured). It withdraws a standing
--      mark and answers ok / exited false / deferred HANDS_OWED; the engine's
--      own confirmation ("Your Hand Count Is Not Completed") follows.
--   2. fn_lightning_player_legality deals a session whose blind off is
--      confirmed and still owes hands even when the player is disconnected
--      or a stop mark stands: the seat needs no client, its hand host acts.
--   3. fn_lightning_reap_expired_disconnects does not exit such a session for
--      a disconnect or a stop. RESPONSIBLE GAMING STILL ENDS IT: an excluded
--      player is never dealt again, so the hands still owed are WAIVED
--      (hr_completed, with a blind_off_waived event) and the anchor engine
--      cashes the seat out through the same voluntary door. Chips are never
--      stranded behind an obligation that can no longer be played.
--   4. fn_cash_session_set_blind_off (the engine's confirmation) makes sure
--      the Lightning pool session the blind off needs is open: it withdraws a
--      standing stop mark and re-enters the pool through the pool's own door
--      (fn_lightning_pool_enter) when an earlier stop or disconnect closed
--      it. Where responsible gaming refuses that door, the hands are waived.
--
-- No money moves in this migration. Function images only; every patched
-- image is guarded by the md5 of the installed image and by each anchor
-- occurring exactly once, so it aborts if production differs.
-- Proof: scripts/qualify-lightning-blind-off.mjs (installed definitions, the
-- strand before, completion after).
-- @live-proof: (position('fn_lightning_hands_owed' in pg_get_functiondef('public.fn_lightning_stop_playing(uuid)'::regprocedure)) > 0)
-- @live-proof: (position('fn_lightning_hands_owed' in pg_get_functiondef('public.fn_lightning_player_legality(uuid,timestamptz,uuid[],jsonb)'::regprocedure)) > 0)
-- @live-proof: (position('fn_lightning_hands_owed' in pg_get_functiondef('public.fn_lightning_reap_expired_disconnects(uuid,timestamptz,integer)'::regprocedure)) > 0)
-- @live-proof: (position('fn_lightning_pool_enter' in pg_get_functiondef('public.fn_cash_session_set_blind_off(uuid,uuid,boolean)'::regprocedure)) > 0)
BEGIN;
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_lightning_stop_playing(uuid)'::regprocedure))
       IS DISTINCT FROM '1b32acb1f0779fc10d162ae2debdf440'
  OR md5(pg_get_functiondef('public.fn_lightning_player_legality(uuid,timestamptz,uuid[],jsonb)'::regprocedure))
       IS DISTINCT FROM '5c93a296a71bcb65508b4ad9b1a4a303'
  OR md5(pg_get_functiondef('public.fn_lightning_reap_expired_disconnects(uuid,timestamptz,integer)'::regprocedure))
       IS DISTINCT FROM '982d09db9e40ccde65476081152a384b'
  OR md5(pg_get_functiondef('public.fn_cash_session_set_blind_off(uuid,uuid,boolean)'::regprocedure))
       IS DISTINCT FROM '50209a2089eef3b84d1fd14e87ec605c' THEN
    RAISE EXCEPTION 'LIGHTNING_BLIND_OFF_SOURCE_CHANGED';
  END IF;
END $guard$;

-- The one question every door below asks: how many hands does the voluntary
-- door still hold this pool session's anchor seat for? p_confirmed_only
-- narrows it to a blind off the player has confirmed (hr_blind_off).
CREATE FUNCTION public.fn_lightning_hands_owed(p_pool_session_id uuid, p_confirmed_only boolean)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce((
    SELECT (public.fn_cash_leave_check(ps.player_id, ts.table_id) ->> 'hands_remaining')::integer
      FROM public.lightning_pool_session ps
      JOIN public.table_seats ts ON ts.id = ps.anchor_seat_id AND ts.user_id = ps.player_id
       AND ts.left_at IS NULL
      JOIN public.cash_player_session cs ON cs.id = ps.cash_player_session_id
       AND cs.player_id = ps.player_id AND cs.closed_at IS NULL
     WHERE ps.id = p_pool_session_id
       AND (NOT coalesce(p_confirmed_only, true) OR cs.hr_blind_off)), 0);
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_hands_owed(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_hands_owed(uuid, boolean) TO service_role;

-- The owed hands can no longer be played (responsible gaming forbids the
-- deal): the obligation is finished, on the record, and the voluntary door
-- opens. Only a confirmed blind off that still owes hands is touched.
CREATE FUNCTION public.fn_lightning_blind_off_waive(
  p_player_id uuid, p_table_id uuid, p_cluster_id uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE w record; v_epoch integer;
BEGIN
  IF (public.fn_cash_leave_check(p_player_id, p_table_id) ->> 'hands_remaining')::integer
       IS NOT DISTINCT FROM 0 THEN
    RETURN false;
  END IF;
  UPDATE public.cash_player_session cs
     SET hr_completed = true
   WHERE cs.player_id = p_player_id AND cs.scope_type = 'table' AND cs.scope_id = p_table_id
     AND cs.closed_at IS NULL AND cs.hr_blind_off AND NOT cs.hr_completed
  RETURNING cs.id, cs.hr_hands_required, cs.hr_hands_played INTO w;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  SELECT cg.cluster_epoch INTO v_epoch FROM public.cash_games cg WHERE cg.id = p_cluster_id;
  INSERT INTO public.cash_cluster_events (game_id, table_id, kind, payload, cluster_epoch)
  VALUES (p_cluster_id, p_table_id, 'blind_off_waived', jsonb_build_object(
    'cluster_id', p_cluster_id, 'player_id', p_player_id, 'cash_player_session_id', w.id,
    'hands_required', w.hr_hands_required, 'hands_played', w.hr_hands_played,
    'reason', p_reason, 'at', clock_timestamp()), coalesce(v_epoch, 0));
  RETURN true;
END
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_blind_off_waive(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_blind_off_waive(uuid, uuid, uuid, text) TO service_role;

DO $patch$
DECLARE
  s text;
  p text;
  i int;
  f int;
  sigs text[] := ARRAY[
    'public.fn_lightning_stop_playing(uuid)',
    'public.fn_lightning_player_legality(uuid,timestamptz,uuid[],jsonb)',
    'public.fn_lightning_reap_expired_disconnects(uuid,timestamptz,integer)',
    'public.fn_cash_session_set_blind_off(uuid,uuid,boolean)'];
  -- pairs[i] = {function index, installed text, replacement}
  pairs text[][] := ARRAY[
    ARRAY['1', $a$  v_stack   numeric;
BEGIN
$a$, $b$  v_stack   numeric;
  v_owed    integer;
BEGIN
$b$],
    ARRAY['1', $a$  IF s.stop_requested_at IS NULL THEN
    UPDATE public.lightning_pool_session ps
       SET stop_requested_at = v_now, updated_at = v_now
$a$, $b$  -- A LIGHTNING BLIND OFF ALWAYS COMPLETES (20261109224717). While the
  -- voluntary door would refuse this leave for hands owed in profit, a stop
  -- neither marks nor exits: a closed pool session is never dealt, so the
  -- owed hands could never be played and the seat could never leave. A
  -- standing mark is withdrawn (never on a frozen Cluster, which is
  -- evidence). The engine's hand count confirmation follows this answer.
  v_owed := public.fn_lightning_hands_owed(s.id, false);
  IF v_owed > 0 THEN
    IF s.stop_requested_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.cash_games fz
                        WHERE fz.id = s.cluster_id AND fz.cluster_mode = 'frozen') THEN
      UPDATE public.lightning_pool_session ps
         SET stop_requested_at = NULL, updated_at = v_now
       WHERE ps.id = s.id AND ps.exited_at IS NULL;
    END IF;
    RETURN jsonb_build_object('ok', true, 'pool_session_id', s.id, 'exited', false,
      'in_hand', public.fn_lightning_player_live_hand(v_uid, p_cluster_id) IS NOT NULL,
      'stop_requested_at', NULL, 'deferred', 'HANDS_OWED', 'hands_owed', v_owed);
  END IF;

  IF s.stop_requested_at IS NULL THEN
    UPDATE public.lightning_pool_session ps
       SET stop_requested_at = v_now, updated_at = v_now
$b$],
    ARRAY['2', $a$        WHEN f.pool_state = 'disconnected'
             OR f.player_id = ANY (coalesce(p_disconnected, ARRAY[]::uuid[])) THEN 'DISCONNECTED'
        WHEN f.pool_state IS DISTINCT FROM 'active' THEN 'POOL_SESSION_NOT_ACTIVE'
$a$, $b$        -- A LIGHTNING BLIND OFF ALWAYS COMPLETES (20261109224717): a confirmed
        -- blind off that still owes hands is dealt with nobody at the client;
        -- its hand host checks or folds the seat (fn_lightning_blind_off_players).
        WHEN (f.pool_state = 'disconnected'
              OR f.player_id = ANY (coalesce(p_disconnected, ARRAY[]::uuid[])))
             AND public.fn_lightning_hands_owed(f.pool_session_id, true) = 0 THEN 'DISCONNECTED'
        WHEN f.pool_state IS NULL OR f.pool_state NOT IN ('active', 'disconnected') THEN 'POOL_SESSION_NOT_ACTIVE'
$b$],
    ARRAY['2', $a$        WHEN f.stop_requested_at IS NOT NULL THEN 'STOP_REQUESTED'
$a$, $b$        WHEN f.stop_requested_at IS NOT NULL
             AND public.fn_lightning_hands_owed(f.pool_session_id, true) = 0 THEN 'STOP_REQUESTED'
$b$],
    ARRAY['3', $a$  v_stack    numeric;
  v_sqlstate text;
$a$, $b$  v_stack    numeric;
  v_owed     integer;
  v_sqlstate text;
$b$],
    ARRAY['3', $a$        CONTINUE;
      END IF;

      UPDATE public.lightning_pool_session ps
         SET exited_at = GREATEST(p_now, ps.entered_at),
$a$, $b$        CONTINUE;
      END IF;

      -- A LIGHTNING BLIND OFF ALWAYS COMPLETES (20261109224717). A confirmed
      -- blind off that still owes hands is not exited for a disconnect or a
      -- stop: the pool goes on dealing the seat until the count completes,
      -- and the anchor's cash-out then exits this session through the seat
      -- trigger. A standing stop mark is withdrawn. RESPONSIBLE GAMING STILL
      -- ENDS THE SESSION: the excluded player is never dealt again, so the
      -- hands still owed are waived and the voluntary door opens.
      v_owed := public.fn_lightning_hands_owed(s.id, true);
      IF v_owed > 0 AND NOT coalesce(s.rg_refused, false) THEN
        IF s.stop_requested_at IS NOT NULL THEN
          UPDATE public.lightning_pool_session ps
             SET stop_requested_at = NULL, updated_at = p_now
           WHERE ps.id = s.id AND ps.exited_at IS NULL;
        END IF;
        v_skipped := v_skipped || jsonb_build_object(
          'pool_session_id', s.id, 'cluster_id', s.cluster_id, 'player_id', s.player_id,
          'reason', 'blind_off_hands_owed', 'hands_owed', v_owed);
        CONTINUE;
      END IF;
      IF v_owed > 0 THEN
        PERFORM public.fn_lightning_blind_off_waive(s.player_id,
          (SELECT ts.table_id FROM public.table_seats ts WHERE ts.id = s.anchor_seat_id),
          s.cluster_id, 'rg_limit');
      END IF;

      UPDATE public.lightning_pool_session ps
         SET exited_at = GREATEST(p_now, ps.entered_at),
$b$],
    -- The engine's confirmation of an early leave: the engine-only gate, the
    -- flag write and the answer are unchanged.
    ARRAY['4', $a$DECLARE v_n integer;
BEGIN
$a$, $b$DECLARE v_n integer; v_seat record; v_ps uuid; v_now timestamptz := clock_timestamp();
BEGIN
$b$],
    ARRAY['4', $a$  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
$a$, $b$  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- A LIGHTNING BLIND OFF ALWAYS COMPLETES (20261109224717). A blind off at a
  -- Lightning anchor is played in the pool, so the confirmation makes sure
  -- the pool session is there to be dealt: a standing stop mark is withdrawn
  -- and a session an earlier stop or disconnect closed is re-entered through
  -- the pool's own door. Where responsible gaming refuses that door the owed
  -- hands are waived. Never during the platform freeze.
  IF coalesce(p_on, false) AND NOT public.fn_platform_frozen() THEN
    SELECT ts.id, tb.cluster_id INTO v_seat
      FROM public.table_seats ts
      JOIN public.tables tb ON tb.id = ts.table_id
      JOIN public.cash_games g ON g.id = tb.cluster_id AND g.cluster_mode = 'lightning'
     WHERE ts.table_id = p_table_id AND ts.user_id = p_user_id AND ts.left_at IS NULL
     LIMIT 1;
    IF FOUND THEN
      UPDATE public.lightning_pool_session ps
         SET stop_requested_at = NULL, updated_at = v_now
       WHERE ps.cluster_id = v_seat.cluster_id AND ps.player_id = p_user_id
         AND ps.exited_at IS NULL AND ps.stop_requested_at IS NOT NULL;
      v_ps := public.fn_lightning_pool_enter(v_seat.id, v_now);
      IF v_ps IS NULL
         AND (public.fn_rg_require_not_excluded(p_user_id) ->> 'ok')::boolean IS DISTINCT FROM true THEN
        PERFORM public.fn_lightning_blind_off_waive(p_user_id, p_table_id, v_seat.cluster_id, 'rg_limit');
      END IF;
    END IF;
  END IF;
  RETURN v_n > 0;
$b$]
  ];
BEGIN
  FOR f IN 1 .. array_length(sigs, 1) LOOP
    s := pg_get_functiondef(sigs[f]::regprocedure);
    FOR i IN 1 .. array_length(pairs, 1) LOOP
      CONTINUE WHEN pairs[i][1]::int <> f;
      p := pairs[i][2];
      IF (length(s) - length(replace(s, p, ''))) / length(p) <> 1 THEN
        RAISE EXCEPTION 'LIGHTNING_BLIND_OFF_ANCHOR_CHANGED % %', sigs[f], i;
      END IF;
      s := replace(s, p, pairs[i][3]);
    END LOOP;
    EXECUTE s;
  END LOOP;
END $patch$;

DO $verify$
DECLARE d text;
BEGIN
  IF public.fn_lightning_hands_owed(NULL, true) <> 0
  OR public.fn_lightning_hands_owed(NULL, false) <> 0 THEN
    RAISE EXCEPTION 'LIGHTNING_BLIND_OFF_PREDICATE_FAILED';
  END IF;
  FOREACH d IN ARRAY ARRAY[
    'public.fn_lightning_stop_playing(uuid)',
    'public.fn_lightning_player_legality(uuid,timestamptz,uuid[],jsonb)',
    'public.fn_lightning_reap_expired_disconnects(uuid,timestamptz,integer)'] LOOP
    IF position('fn_lightning_hands_owed' in pg_get_functiondef(d::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'LIGHTNING_BLIND_OFF_NOT_INSTALLED %', d;
    END IF;
  END LOOP;
  IF position('fn_lightning_pool_enter' in
       pg_get_functiondef('public.fn_cash_session_set_blind_off(uuid,uuid,boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'LIGHTNING_BLIND_OFF_NOT_INSTALLED confirmation';
  END IF;
END $verify$;
COMMIT;
