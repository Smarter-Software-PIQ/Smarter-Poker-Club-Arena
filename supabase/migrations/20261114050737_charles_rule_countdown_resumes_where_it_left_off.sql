-- 20261114050737_charles_rule_countdown_resumes_where_it_left_off.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE CHARLES RULE COUNTDOWN RESUMES, IT DOES NOT RESTART (owner direction,
-- 2026-11-13 23:04 America/Chicago):
--
--   "IF YOU GO INTO PROFIT, AND YOUR 10 HANDS STARTS... THEN YOU FALL BELOW
--    PROFIT AT LETS SAY THE 7 HANDS LEFT MARK... BUT THEN GO BACK INTO PROFIT.
--    IT NEEDS TO PICK BACK UP WHERE YOU LEFT OFF AT THE 7 HANDS, NOT RESTART
--    THE 10 BACK OVER."
--
-- This supersedes the 2026-11-06 behaviour "coming back into profit starts
-- the ten-hand clock again".
--
-- THE CAUSE. fn_cash_session_evaluate, on a counted hand that ended at or
-- below the session baseline, ran
--   v_req := 0; v_played := 0; v_ref := NULL; v_dbl := 0; v_started := NULL;
-- so the hands already played (and any hands added by doubles) were thrown
-- away, and the next hand in profit started a fresh count.
--
-- THE FIX, in that one branch. Losing the profit now PAUSES the countdown:
-- hr_hands_required, hr_hands_played and hr_doubles are kept, and a NULL
-- hr_reference_stack marks the pause. Coming back into profit resumes it:
--   * the hand that returns the player to profit is not counted, exactly as
--     the hand that first starts a countdown is not counted, so a player who
--     fell out with 7 hands left comes back to 7 hands left;
--   * hands played while out of profit never count;
--   * the reference stack for the next double is the stack at the return to
--     profit (the same rule a fresh countdown uses), and hands a double added
--     before the pause stay owed;
--   * hr_started_at is re-stamped at the return, so a voluntary leave asked
--     for while out of profit is still an already accepted departure
--     (fn_cash_leave_check's asked-before exemption), as it was before.
--
-- UNCHANGED: out of profit nothing is owed and the player may leave at any
-- point (fn_cash_hit_run_hands_remaining reads the stack against the
-- baseline); a completed count frees the player for the session; the club's
-- switch still clears every countdown; the +250 BB obligation, the house-take
-- double test and bank-the-win state are byte for byte what 20261111174148
-- installed. The engine's mirror (ChipContinuity.ts) already reads
-- required - played only while in profit, so no engine change is needed.
--
-- Sessions open when this installs: a countdown already cleared by the old
-- branch reads hr_hands_required = 0 and starts normally at its next hand in
-- profit; a running countdown has a reference stack and carries on. Nothing
-- is back-filled and no money moves.
--
-- Function image only (no hot-table lock): installs from protected main.
-- @live-proof: (position('BACK IN PROFIT' in pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure)) > 0)

BEGIN;
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure))
       IS DISTINCT FROM 'ede6dbf160aeba5e1feef8667e1c14e3' THEN
    RAISE EXCEPTION 'CHARLES_RULE_RESUME_SOURCE_CHANGED';
  END IF;
END $guard$;

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
  v_hr_on boolean; v_hr_hands integer;
  v_take numeric;
  v_source text; v_hand_uuid uuid; v_net numeric; v_bb numeric; v_basis numeric;
  v_bw_ref text; v_bw_at timestamptz; v_bw_req integer; v_bw_played integer;
  v_bw_net numeric; v_bw_bb numeric; v_bp_ref text; v_bp_since integer;
  v_hr_left integer; v_bw_left integer;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_cash_session_evaluate is engine-only';
  END IF;
  SELECT t.id, t.tournament_id, t.max_buy_in INTO v_t FROM public.tables t WHERE t.id = p_table_id;
  IF NOT FOUND OR v_t.tournament_id IS NOT NULL THEN RETURN v_out; END IF;
  -- The hosting club's choice (20261107 club setting): on and 10 by default.
  SELECT c.hit_run_enabled, c.hit_run_hands INTO v_hr_on, v_hr_hands
    FROM public.tables t JOIN public.clubs c ON c.id = t.club_id WHERE t.id = p_table_id;
  v_hr_on := coalesce(v_hr_on, true);
  v_hr_hands := coalesce(v_hr_hands, 10);

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
    v_bw_ref := v_s.hr_big_win_hand_ref; v_bw_at := v_s.hr_big_win_at;
    v_bw_req := v_s.hr_big_win_required; v_bw_played := v_s.hr_big_win_played;
    v_bw_net := v_s.hr_big_win_net; v_bw_bb := v_s.hr_big_win_bb;
    v_bp_ref := v_s.big_pot_hand_ref; v_bp_since := v_s.hands_since_big_pot;
    v_basis := coalesce(v_s.start_basis,
                        CASE WHEN coalesce(v_t.max_buy_in, 0) > 0
                             THEN least(v_s.baseline, v_t.max_buy_in) ELSE v_s.baseline END);
    v_ack := v_s.hr_engine_ack OR COALESCE((v_e->>'hit_run')::boolean, false);
    v_hand := NULLIF(v_e->>'hand_id', '');
    IF v_hand IS NOT NULL AND v_hand IS DISTINCT FROM v_s.hr_last_hand_ref THEN
      v_in_pool := EXISTS (SELECT 1 FROM public.lightning_pool_session ps
                            WHERE ps.cash_player_session_id = v_s.id AND ps.exited_at IS NULL);
      v_source := COALESCE(v_e->>'hand_source', 'table');
      IF (v_source = 'lightning') = v_in_pool THEN
        v_last := v_hand;
        IF NOT v_hr_on THEN
          v_req := 0; v_played := 0; v_ref := NULL; v_dbl := 0; v_started := NULL;
        ELSIF NOT v_done THEN
          IF v_req = 0 THEN
            IF v_stack > v_s.baseline THEN
              v_req := v_hr_hands; v_played := 0; v_ref := v_stack; v_dbl := 0; v_started := v_now;
            END IF;
          ELSIF v_stack <= v_s.baseline THEN
            -- PROFIT GONE: the countdown is PAUSED, never cleared (owner
            -- 2026-11-13). The hands played and the hands added by doubles
            -- are kept; a NULL reference stack marks the pause. Nothing is
            -- owed while out of profit (fn_cash_hit_run_hands_remaining).
            v_ref := NULL;
          ELSIF v_ref IS NULL THEN
            -- BACK IN PROFIT: the countdown picks up where it left off. The
            -- hand that got them back is not one of the hands (the same as
            -- the hand that first starts a countdown); the reference stack
            -- and the start stamp are taken from this return to profit.
            v_ref := v_stack; v_started := v_now;
          ELSE
            v_played := v_played + 1;
            -- THE CHARLES RULE, judged before the house's take: the rake and
            -- drops left the pot after this player won it (20261110155259).
            v_take := 0;
            IF v_hand ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
              v_take := public.fn_cash_hit_run_house_take(v_hand::uuid, v_uid);
            END IF;
            IF v_ref IS NOT NULL AND v_ref > 0 AND v_stack + coalesce(v_take, 0) >= 2 * v_ref THEN
              v_req := v_req + v_hr_hands; v_ref := v_stack; v_dbl := v_dbl + 1;
            END IF;
            IF v_played >= v_req THEN v_done := true; END IF;
          END IF;
        END IF;

        -- THE AUTHORITATIVE NET OF THIS HAND (20261111174148).
        v_hand_uuid := NULL; v_net := NULL; v_bb := NULL;
        IF v_hand ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
          v_hand_uuid := v_hand::uuid;
          v_net := public.fn_cash_hand_net(v_hand_uuid, v_uid, v_source);
          SELECT hh.big_blind INTO v_bb FROM public.hand_history hh WHERE hh.id = v_hand_uuid;
        END IF;
        v_bb := coalesce(nullif(v_bb, 0), v_s.bb);

        -- THE CHARLES RULE AFTER A LARGE WIN: one eligible hand counts once
        -- toward an open obligation (never the hand that started it) ...
        IF v_bw_req > v_bw_played AND v_hand IS DISTINCT FROM v_bw_ref THEN
          v_bw_played := v_bw_played + 1;
        END IF;
        -- ... and a hand netting +250 BB or more (re)starts ten subsequent hands.
        IF v_hr_on AND v_net IS NOT NULL AND coalesce(v_bb, 0) > 0
           AND v_net >= 250 * v_bb AND v_hand IS DISTINCT FROM v_bw_ref THEN
          v_bw_ref := v_hand; v_bw_at := v_now; v_bw_req := 10; v_bw_played := 0;
          v_bw_net := v_net; v_bw_bb := v_bb;
        END IF;

        -- BANK THE WIN (Horse orbit): a big pot is half the start basis or more.
        IF v_net IS NOT NULL AND coalesce(v_basis, 0) > 0 AND v_net >= 0.5 * v_basis THEN
          v_bp_ref := v_hand; v_bp_since := 0;
        ELSIF v_bp_since IS NOT NULL THEN
          v_bp_since := v_bp_since + 1;
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
           hr_engine_ack     = v_ack,
           hr_big_win_hand_ref = v_bw_ref,
           hr_big_win_at     = v_bw_at,
           hr_big_win_required = v_bw_req,
           hr_big_win_played = v_bw_played,
           hr_big_win_net    = v_bw_net,
           hr_big_win_bb     = v_bw_bb,
           big_pot_hand_ref  = v_bp_ref,
           hands_since_big_pot = v_bp_since,
           start_basis       = coalesce(start_basis, v_basis)
     WHERE id = v_s.id;

    v_hr_left := public.fn_cash_hit_run_hands_remaining(v_req, v_played, v_done, v_ack, v_stack, v_s.baseline);
    v_bw_left := public.fn_cash_big_win_hands_remaining(v_bw_req, v_bw_played, v_ack, v_stack);
    v_left := greatest(v_hr_left, v_bw_left);
    v_out := v_out || jsonb_build_object(
      'user_id', v_uid, 'baseline', v_s.baseline, 'stack', v_stack,
      'stay_remaining_ms', v_rem, 'stay_running', v_running,
      'stay_last_tick_at', v_now, 'stay_clock_ms', v_s.stay_clock_ms,
      'leave_locked', v_left > 0,
      'hands_required', v_req, 'hands_played', v_played, 'hands_remaining', v_left,
      'hit_run_hands_remaining', v_hr_left,
      'hit_run_doubles', v_dbl, 'hit_run_completed', v_done,
      'hit_run_countdown', (NOT v_done AND v_req > 0 AND v_stack > v_s.baseline),
      'big_win_required', v_bw_req, 'big_win_played', v_bw_played,
      'big_win_hands_remaining', v_bw_left, 'big_win_hand_id', v_bw_ref,
      'big_win_net', v_bw_net, 'big_win_bb', v_bw_bb,
      'hands_reason', CASE WHEN v_hr_left > 0 AND v_bw_left > 0 THEN 'both'
                           WHEN v_bw_left > 0 THEN 'big_win'
                           WHEN v_hr_left > 0 THEN 'hit_run' END,
      'start_basis', v_basis, 'hands_since_big_pot', v_bp_since,
      'blind_off', v_s.hr_blind_off);
  END LOOP;
  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_session_evaluate(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_session_evaluate(uuid, jsonb) TO service_role;

COMMIT;
