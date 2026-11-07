-- @install-window: daily-maintenance
-- 20261106203853_hit_and_run_ten_hands_in_profit.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE HIT AND RUN RULE (owner direction, 2026-11-06), every cash game:
--
--   "ONCE A PLAYER 'IS IN PROFIT' AT A TABLE... THEY CAN NOT LEAVE THE TABLE
--    UNTIL THEY PLAY 10 HANDS IN PROFIT. IF THEY DROP BACK DOWN TO 'NOT IN
--    PROFIT' THEY CAN LEAVE AT ANY POINT... IF THEY TRY TO LEAVE THE GAME
--    BEFORE THE HANDS ARE COMPLETED... YOU WILL BE BLINDED OFF FOR THE
--    REMAINING HANDS."
--
--   THE CHARLES RULE: "IF A PLAYER DOUBLES UP OR MORE WHILE THEY ARE IN THEIR
--    10 HAND COUNT DOWN ... 10 ADDITIONAL HANDS ARE ADDED TO THE MINIMUM
--    REQUIREMENT, AND IF HE DOUBLES AGAIN AFTER THAT 10 MORE. ONCE A PLAYER
--    COMPLETES THOSE HANDS, THEY CAN LEAVE AT ANY TIME AFTER THAT ... IT ONLY
--    GOES AWAY EARLY IF THEY LOSE ALL THEIR PROFIT. BUT THEN ONCE THEY ARE
--    BACK IN PROFIT (IF THEY NEVER COMPLETED THE FIRST 10 HANDS IN PROFIT) THE
--    10 HAND CLOCK STARTS BACK UP AGAIN."
--
-- THE STATE MACHINE, one row per open cash_player_session, advanced once per
-- dealt hand (hand_id is the idempotency key) from the post-hand stack:
--
--   no countdown, stack > baseline   -> countdown starts: 10 hands, reference
--                                       stack = this stack (the counted hands
--                                       are the ones played from here on)
--   countdown, stack <= baseline     -> cleared (profit gone; may leave)
--   countdown, stack > baseline      -> one hand played; stack >= 2 x the
--                                       reference adds 10 hands and makes this
--                                       stack the new reference (Charles);
--                                       played >= required completes it
--   completed                        -> free for the rest of this session
--
-- Baseline is the session's buy-in plus every add-on and rebuy (unchanged).
-- A classic table's engine reports its dealt players (hand_source 'table');
-- a Lightning hand is reported by its own settlement trigger (hand_source
-- 'lightning'). A session counts only the source it actually plays through,
-- so no hand is ever counted twice.
--
-- ENFORCEMENT is fn_cash_leave_check, which atomic_seat_cashout_locked already
-- calls for every voluntary cash-out, under the seat lock, before any credit.
-- It refuses only sessions an engine that knows this rule has acknowledged
-- (entry 'hit_run': true, hr_engine_ack), so an engine without the blind-off
-- implementation can never strand a player behind a refusal it cannot serve.
-- System exits (admin kick, closure, VPIP boot) are unchanged.
--
-- No money moves in this migration. DDL and function images only; each image
-- replaced in full is guarded by the md5 of the installed image it replaces.
-- @live-proof: (position('hr_hands_required' in pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure)) > 0)
-- @live-proof: (position('hands_remaining' in pg_get_functiondef('public.fn_cash_leave_check(uuid,uuid)'::regprocedure)) > 0)
-- @live-proof: (to_regprocedure('public.fn_my_hit_run_status(uuid)') IS NOT NULL)
-- @live-proof: (position('hand_source' in pg_get_functiondef('public.fn_lightning_cash_clock_at_settlement()'::regprocedure)) > 0)
BEGIN;
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure))
       IS DISTINCT FROM '63c48e5d33b963562295d32e6fbee380'
  OR md5(pg_get_functiondef('public.fn_cash_leave_check(uuid,uuid)'::regprocedure))
       IS DISTINCT FROM '71e3be7e9846022ebbab884a049e60df'
  OR md5(pg_get_functiondef('public.fn_lightning_cash_clock_at_settlement()'::regprocedure))
       IS DISTINCT FROM '9e84b5c6f32b44ed7d8ccc546381f738' THEN
    RAISE EXCEPTION 'HIT_AND_RUN_SOURCE_CHANGED';
  END IF;
END $guard$;

ALTER TABLE public.cash_player_session
  ADD COLUMN hr_hands_required integer NOT NULL DEFAULT 0,
  ADD COLUMN hr_hands_played integer NOT NULL DEFAULT 0,
  ADD COLUMN hr_reference_stack numeric,
  ADD COLUMN hr_doubles integer NOT NULL DEFAULT 0,
  ADD COLUMN hr_completed boolean NOT NULL DEFAULT false,
  ADD COLUMN hr_last_hand_ref text,
  ADD COLUMN hr_engine_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN hr_blind_off boolean NOT NULL DEFAULT false,
  ADD COLUMN hr_started_at timestamptz,
  ADD CONSTRAINT cash_player_session_hr_counts_are_sane
    CHECK (hr_hands_required >= 0 AND hr_hands_played >= 0 AND hr_doubles >= 0) NOT VALID;

COMMENT ON COLUMN public.cash_player_session.hr_hands_required IS
  'Hit and run: hands owed in profit (10, plus 10 per Charles double). 0 = no countdown.';
COMMENT ON COLUMN public.cash_player_session.hr_blind_off IS
  'Hit and run: the player confirmed leaving early and is blinded off for the remaining hands.';

-- The one predicate. Engine, database guard and Lightning host all read it.
CREATE FUNCTION public.fn_cash_hit_run_hands_remaining(
  p_required integer, p_played integer, p_completed boolean, p_ack boolean,
  p_stack numeric, p_baseline numeric
) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT CASE WHEN coalesce(p_ack, false) AND NOT coalesce(p_completed, false)
                   AND coalesce(p_required, 0) > 0
                   AND coalesce(p_played, 0) < p_required
                   AND coalesce(p_stack, 0) > coalesce(p_baseline, 0)
              THEN p_required - coalesce(p_played, 0) ELSE 0 END;
$$;

CREATE OR REPLACE FUNCTION public.fn_cash_session_evaluate(p_table_id uuid, p_entries jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t record; v_e jsonb; v_uid uuid; v_active boolean; v_stack numeric;
  v_s record; v_rem integer; v_running boolean; v_out jsonb := '[]'::jsonb; v_now timestamptz;
  v_hand text; v_in_pool boolean; v_req integer; v_played integer; v_ref numeric;
  v_dbl integer; v_done boolean; v_ack boolean; v_last text; v_left integer;
  v_started timestamptz;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_cash_session_evaluate is engine-only';
  END IF;
  SELECT t.id, t.tournament_id INTO v_t FROM public.tables t WHERE t.id = p_table_id;
  IF NOT FOUND OR v_t.tournament_id IS NOT NULL THEN RETURN v_out; END IF;

  FOR v_e IN SELECT * FROM jsonb_array_elements(COALESCE(p_entries, '[]'::jsonb)) LOOP
    BEGIN
      v_uid := (v_e->>'user_id')::uuid;
    EXCEPTION WHEN others THEN CONTINUE;
    END;
    v_active := COALESCE((v_e->>'active')::boolean, false);
    v_stack := NULLIF(v_e->>'stack', '')::numeric;

    IF v_stack IS NULL THEN
      SELECT ts.stack INTO v_stack FROM public.table_seats ts
       WHERE ts.table_id = p_table_id AND ts.user_id = v_uid AND ts.left_at IS NULL LIMIT 1;
      IF v_stack IS NULL THEN CONTINUE; END IF;
    ELSIF NOT EXISTS (SELECT 1 FROM public.table_seats ts
                       WHERE ts.table_id = p_table_id AND ts.user_id = v_uid AND ts.left_at IS NULL) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_s FROM public.cash_player_session
     WHERE player_id = v_uid AND scope_type = 'table' AND scope_id = p_table_id AND closed_at IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      -- Seated before the session table existed: baseline = what they hold now.
      PERFORM public.fn_cash_session_open(v_uid, p_table_id, v_stack);
      SELECT * INTO v_s FROM public.cash_player_session
       WHERE player_id = v_uid AND scope_type = 'table' AND scope_id = p_table_id AND closed_at IS NULL
       FOR UPDATE;
      IF NOT FOUND THEN CONTINUE; END IF;
    END IF;

    v_now := clock_timestamp();
    v_rem := public.fn_cash_stay_remaining_ms(v_s.stay_remaining_ms, v_s.stay_running, v_s.stay_last_tick_at);
    v_running := v_active AND v_stack > v_s.baseline AND v_rem > 0;

    -- HIT AND RUN: one dealt hand advances the countdown once.
    v_req := v_s.hr_hands_required; v_played := v_s.hr_hands_played;
    v_ref := v_s.hr_reference_stack; v_dbl := v_s.hr_doubles; v_done := v_s.hr_completed;
    v_last := v_s.hr_last_hand_ref; v_started := v_s.hr_started_at;
    v_ack := v_s.hr_engine_ack OR COALESCE((v_e->>'hit_run')::boolean, false);
    v_hand := NULLIF(v_e->>'hand_id', '');
    IF v_hand IS NOT NULL AND v_hand IS DISTINCT FROM v_s.hr_last_hand_ref THEN
      v_in_pool := EXISTS (SELECT 1 FROM public.lightning_pool_session ps
                            WHERE ps.cash_player_session_id = v_s.id AND ps.exited_at IS NULL);
      IF (COALESCE(v_e->>'hand_source', 'table') = 'lightning') = v_in_pool THEN
        v_last := v_hand;
        IF NOT v_done THEN
          IF v_req = 0 THEN
            IF v_stack > v_s.baseline THEN
              v_req := 10; v_played := 0; v_ref := v_stack; v_dbl := 0; v_started := v_now;
            END IF;
          ELSIF v_stack <= v_s.baseline THEN
            v_req := 0; v_played := 0; v_ref := NULL; v_dbl := 0; v_started := NULL;
          ELSE
            v_played := v_played + 1;
            IF v_ref IS NOT NULL AND v_ref > 0 AND v_stack >= 2 * v_ref THEN
              v_req := v_req + 10; v_ref := v_stack; v_dbl := v_dbl + 1;
            END IF;
            IF v_played >= v_req THEN v_done := true; END IF;
          END IF;
        END IF;
      END IF;
    END IF;

    UPDATE public.cash_player_session
       SET stay_remaining_ms = v_rem,
           stay_last_tick_at = v_now,
           stay_running      = v_running,
           hr_hands_required = v_req,
           hr_hands_played   = v_played,
           hr_reference_stack = v_ref,
           hr_doubles        = v_dbl,
           hr_completed      = v_done,
           hr_last_hand_ref  = v_last,
           hr_started_at     = v_started,
           hr_engine_ack     = v_ack
     WHERE id = v_s.id;

    v_left := public.fn_cash_hit_run_hands_remaining(v_req, v_played, v_done, v_ack, v_stack, v_s.baseline);
    v_out := v_out || jsonb_build_object(
      'user_id', v_uid, 'baseline', v_s.baseline, 'stack', v_stack,
      'stay_remaining_ms', v_rem, 'stay_running', v_running,
      'stay_last_tick_at', v_now, 'stay_clock_ms', v_s.stay_clock_ms,
      'leave_locked', v_left > 0,
      'hands_required', v_req, 'hands_played', v_played, 'hands_remaining', v_left,
      'hit_run_doubles', v_dbl, 'hit_run_completed', v_done,
      'hit_run_countdown', (NOT v_done AND v_req > 0 AND v_stack > v_s.baseline),
      'blind_off', v_s.hr_blind_off);
  END LOOP;
  RETURN v_out;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cash_leave_check(p_user_id uuid, p_table_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- The time stay clock stays retired (owner 2026-10-26). What holds a
  -- voluntary leave now is the hit-and-run hand count (owner 2026-11-06).
  -- A leave the player asked for BEFORE this countdown started (a mid-hand
  -- or Lightning leave still pending for this exact occupancy) is the leave
  -- of a player who was free to go when they asked, and is honoured.
  SELECT jsonb_build_object(
    'allowed', coalesce(x.left_hands, 0) = 0 OR coalesce(x.asked_before, false),
    'stay_remaining_ms', 0,
    'hands_remaining', CASE WHEN coalesce(x.asked_before, false) THEN 0
                            ELSE coalesce(x.left_hands, 0) END)
  FROM (SELECT 1) AS one
  LEFT JOIN LATERAL (
    SELECT public.fn_cash_hit_run_hands_remaining(s.hr_hands_required, s.hr_hands_played,
             s.hr_completed, s.hr_engine_ack, ts.stack, s.baseline) AS left_hands,
           (coalesce(ts.leave_pending, false) AND s.hr_started_at IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.seat_departure_requests d
               WHERE d.occupancy_id = ts.occupancy_id AND d.user_id = ts.user_id
                 AND d.table_id = ts.table_id AND d.seat_number = ts.seat_number
                 AND d.leave_mode = 'voluntary' AND d.created_at <= s.hr_started_at)) AS asked_before
      FROM public.cash_player_session s
      JOIN public.table_seats ts ON ts.table_id = s.table_id AND ts.user_id = s.player_id
                                AND ts.left_at IS NULL
     WHERE s.player_id = p_user_id AND s.scope_type = 'table' AND s.scope_id = p_table_id
       AND s.closed_at IS NULL
     ORDER BY s.opened_at DESC LIMIT 1) AS x ON true;
$function$;

-- Replaced images keep their grants; restated here so this file says so.
REVOKE ALL ON FUNCTION public.fn_cash_leave_check(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_leave_check(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fn_cash_session_evaluate(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_session_evaluate(uuid, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_lightning_cash_clock_at_settlement() FROM PUBLIC, anon, authenticated;

-- The engine records the player's confirmed early leave (and its withdrawal)
-- so the Lightning hand host and a restarted engine see the same truth.
CREATE FUNCTION public.fn_cash_session_set_blind_off(p_table_id uuid, p_user_id uuid, p_on boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n integer;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_cash_session_set_blind_off is engine-only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.cash_player_session
     SET hr_blind_off = coalesce(p_on, false)
   WHERE player_id = p_user_id AND scope_type = 'table' AND scope_id = p_table_id
     AND closed_at IS NULL AND hr_blind_off IS DISTINCT FROM coalesce(p_on, false);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_session_set_blind_off(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_session_set_blind_off(uuid, uuid, boolean) TO service_role;

-- Which of a Lightning hand's pool sessions are being blinded off (and still
-- owe hands). Read by the hand host, which folds those seats on their turn.
CREATE FUNCTION public.fn_lightning_blind_off_players(p_pool_session_ids uuid[])
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT ps.player_id
    FROM public.lightning_pool_session ps
    JOIN public.cash_player_session cs ON cs.id = ps.cash_player_session_id
     AND cs.player_id = ps.player_id AND cs.closed_at IS NULL
    JOIN public.table_seats ts ON ts.table_id = cs.table_id AND ts.user_id = cs.player_id
     AND ts.left_at IS NULL
   WHERE ps.id = ANY (coalesce(p_pool_session_ids, ARRAY[]::uuid[]))
     AND ps.exited_at IS NULL
     AND cs.hr_blind_off
     AND public.fn_cash_hit_run_hands_remaining(cs.hr_hands_required, cs.hr_hands_played,
           cs.hr_completed, cs.hr_engine_ack, ts.stack, cs.baseline) > 0;
$function$;
REVOKE ALL ON FUNCTION public.fn_lightning_blind_off_players(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lightning_blind_off_players(uuid[]) TO service_role;
REVOKE ALL ON FUNCTION public.fn_cash_hit_run_hands_remaining(integer, integer, boolean, boolean, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_hit_run_hands_remaining(integer, integer, boolean, boolean, numeric, numeric) TO authenticated, service_role;

-- The player's own countdown, for the felt's hands-left display and the
-- leave confirmation: every open cash session of the caller, or one table's.
CREATE FUNCTION public.fn_my_hit_run_status(p_table_id uuid DEFAULT NULL)
 RETURNS TABLE(table_id uuid, hands_remaining integer, hands_required integer,
               hands_played integer, completed boolean, blind_off boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT s.table_id,
         public.fn_cash_hit_run_hands_remaining(s.hr_hands_required, s.hr_hands_played,
           s.hr_completed, s.hr_engine_ack, ts.stack, s.baseline),
         s.hr_hands_required, s.hr_hands_played, s.hr_completed, s.hr_blind_off
    FROM public.cash_player_session s
    JOIN public.table_seats ts ON ts.table_id = s.table_id AND ts.user_id = s.player_id
     AND ts.left_at IS NULL
   WHERE s.player_id = auth.uid() AND s.scope_type = 'table' AND s.closed_at IS NULL
     AND (p_table_id IS NULL OR s.table_id = p_table_id);
$function$;
REVOKE ALL ON FUNCTION public.fn_my_hit_run_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_my_hit_run_status(uuid) TO authenticated, service_role;

-- The Lightning settlement trigger reports each participant's hand.
CREATE OR REPLACE FUNCTION public.fn_lightning_cash_clock_at_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE boundary record; expected integer; evaluated integer := 0;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'lightning_cash_clock_requires_engine' USING ERRCODE = '42501';
  END IF;
  IF public.fn_platform_frozen() THEN
    RAISE EXCEPTION 'PLATFORM_FROZEN' USING ERRCODE = '55006';
  END IF;
  SELECT count(*) INTO expected
  FROM public.lightning_hand_player hp
  JOIN public.lightning_pool_slot sl ON sl.id = hp.pool_slot_id
  JOIN public.lightning_pool_session ps ON ps.id = sl.pool_session_id
  WHERE hp.hand_id = NEW.hand_id AND ps.exited_at IS NULL;
  -- The ordinary engine evaluates final stacks before departures. Lightning
  -- can anchor one hand at several physical tables, so retain each original
  -- table/session/seat identity and group only those exact participants.
  FOR boundary IN
    SELECT ts.table_id,
      jsonb_agg(jsonb_build_object('user_id', hp.player_id,
        'active', (
          (ps.state = 'active' AND NOT coalesce(ts.is_sitting_out, false)
                               AND NOT coalesce(ts.leave_pending, false))
          -- The ordinary engine serves a voluntary leave held by its clock:
          -- the engine's compulsory sit-out must not stop that countdown.
          OR (coalesce(ts.leave_pending, false) AND EXISTS (SELECT 1 FROM public.seat_departure_requests d
                     WHERE d.occupancy_id = ts.occupancy_id
                       AND d.user_id = ts.user_id AND d.table_id = ts.table_id
                       AND d.seat_number = ts.seat_number AND d.leave_mode = 'voluntary'))
        ),
        -- HIT AND RUN (2026-11-06): every dealt participant's hand counts once.
        'hand_id', NEW.hand_id::text,
        'hand_source', 'lightning') ORDER BY hp.player_id) AS entries
    FROM public.lightning_hand_player hp
    JOIN public.lightning_pool_slot sl ON sl.id = hp.pool_slot_id AND sl.player_id = hp.player_id
      AND sl.cluster_id = NEW.cluster_id AND sl.cluster_epoch = NEW.cluster_epoch
    JOIN public.lightning_pool_session ps ON ps.id = sl.pool_session_id
      AND ps.player_id = hp.player_id AND ps.cluster_id = NEW.cluster_id
      AND ps.cluster_epoch = NEW.cluster_epoch
    JOIN public.table_seats ts ON ts.id = ps.anchor_seat_id AND ts.user_id = hp.player_id
      AND ts.left_at IS NULL
    JOIN public.cash_player_session cs ON cs.id = ps.cash_player_session_id
      AND cs.player_id = hp.player_id AND cs.table_id = ts.table_id
      AND cs.scope_type = 'table' AND cs.scope_id = ts.table_id
      AND cs.cluster_id = NEW.cluster_id AND cs.closed_at IS NULL
    WHERE hp.hand_id = NEW.hand_id AND ps.exited_at IS NULL
    GROUP BY ts.table_id ORDER BY ts.table_id
  LOOP
    -- Omit stack: early folders may already have another hand; only the
    -- original physical seat's current authoritative stack may be evaluated.
    PERFORM public.fn_cash_session_evaluate(boundary.table_id, boundary.entries);
    evaluated := evaluated + jsonb_array_length(boundary.entries);
  END LOOP;
  IF evaluated IS DISTINCT FROM expected THEN
    RAISE EXCEPTION 'lightning_cash_clock_anchor_unavailable' USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END $function$;

DO $verify$
BEGIN
  IF public.fn_cash_hit_run_hands_remaining(10, 3, false, true, 300, 200) <> 7
  OR public.fn_cash_hit_run_hands_remaining(10, 3, false, false, 300, 200) <> 0
  OR public.fn_cash_hit_run_hands_remaining(10, 3, false, true, 200, 200) <> 0
  OR public.fn_cash_hit_run_hands_remaining(20, 20, true, true, 900, 200) <> 0 THEN
    RAISE EXCEPTION 'HIT_AND_RUN_PREDICATE_FAILED';
  END IF;
  IF (public.fn_cash_leave_check(NULL, NULL)->>'allowed')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'HIT_AND_RUN_LEAVE_CHECK_FAILED';
  END IF;
END $verify$;
COMMIT;
