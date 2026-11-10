-- 20261110155259_charles_rule_doubles_are_judged_before_the_house_take.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE CHARLES RULE MISSED A REAL DOUBLE UP (owner report, 2026-11-10 09:46
-- America/Chicago): "i just fully doubled up, and it did not add the 10
-- additional hands before i have to leave (charles rules)".
--
-- What the rows say. cash_player_session a47b9e43 (Lightning table 8122f139)
-- started its countdown at 15:43:43Z with hr_reference_stack 114.46. Hand
-- f7f69559 (Lightning hand 58348066) was an all-in he won: pot 229.67, rake
-- 1.25, BBJ drop 0.30, so he was paid 228.12. fn_cash_session_evaluate tested
-- `v_stack >= 2 * v_ref`, i.e. 228.12 >= 228.92, and refused by 0.80: the
-- house's take from the pot he won is what stood between him and the double.
--
-- The owner's rule (20261106203853 header): "IF A PLAYER DOUBLES UP OR MORE
-- WHILE THEY ARE IN THEIR 10 HAND COUNT DOWN ... 10 ADDITIONAL HANDS ARE
-- ADDED". A double up is the poker event of winning a pot worth your stack;
-- the rake and the jackpot drop are taken from that pot afterwards and do not
-- undo it. The comparison therefore adds back what the house took from the
-- pots THIS player won in THIS hand, read from the hand's own history row:
--
--   house take = sum over pots won of (gross pot - paid to all winners)
--                * (paid to this player / paid to all winners of that pot)
--
-- Both callers already name the hand by its hand_history id: the classic
-- engine passes v_handId after its hand_history step, and the Lightning
-- settlement trigger passes lightning_hand.hand_id, which equals its
-- hand_history_id (5,009 of 5,009 settled hands in the last two hours, every
-- history row written before settled_at). A hand with no history row, no pot
-- won or an unreadable id takes nothing and behaves exactly as before. The
-- new reference stack is still the chips actually held (v_stack).
--
-- No tolerance constant, no repair pass. The one function that decides a
-- double now asks the right question.
--
-- Dan's session: by the time this was diagnosed (15:51Z) it had already
-- played its ten hands and reads hr_completed = true; re-locking a completed
-- session after the fact is not a correction the rule defines, so the row is
-- left as it is. No money moves in this migration.
--
-- Function images only (no hot-table lock): installs from protected main.
-- @live-proof: (to_regprocedure('public.fn_cash_hit_run_house_take(uuid,uuid)') IS NOT NULL)
-- @live-proof: (position('fn_cash_hit_run_house_take' in pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure)) > 0)

BEGIN;
SET LOCAL lock_timeout = '1s';

DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.fn_cash_session_evaluate(uuid,jsonb)'::regprocedure))
       IS DISTINCT FROM '51e5cf628d1f522425b7be60f69a438a' THEN
    RAISE EXCEPTION 'CHARLES_RULE_SOURCE_CHANGED';
  END IF;
END $guard$;

-- What the house took (rake, jackpot drop, any other deduction) from the pots
-- p_user_id won in hand p_hand_id. Zero when the hand or the win is unknown.
CREATE FUNCTION public.fn_cash_hit_run_house_take(p_hand_id uuid, p_user_id uuid)
RETURNS numeric LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp'
AS $$
  WITH h AS (
    SELECT hh.winners, hh.pots FROM public.hand_history hh WHERE hh.id = p_hand_id
  ), pot AS (
    SELECT coalesce((p.v->>'index')::int, (p.ord - 1)::int) AS idx,
           coalesce((p.v->>'amount')::numeric, 0) AS gross
      FROM h, jsonb_array_elements(CASE WHEN jsonb_typeof(h.pots) = 'array' THEN h.pots ELSE '[]'::jsonb END)
           WITH ORDINALITY AS p(v, ord)
  ), won AS (
    SELECT coalesce((w->>'potIndex')::int, 0) AS idx, w->>'userId' AS uid,
           coalesce((w->>'amount')::numeric, 0) AS amount
      FROM h, jsonb_array_elements(CASE WHEN jsonb_typeof(h.winners) = 'array' THEN h.winners ELSE '[]'::jsonb END) AS w
  ), per_pot AS (
    SELECT pot.idx, pot.gross,
           sum(won.amount) AS paid,
           sum(won.amount) FILTER (WHERE won.uid = p_user_id::text) AS mine
      FROM pot JOIN won ON won.idx = pot.idx
     GROUP BY pot.idx, pot.gross
  )
  SELECT coalesce(round(sum(greatest(gross - paid, 0) * mine / paid), 2), 0)
    FROM per_pot
   WHERE paid > 0 AND coalesce(mine, 0) > 0;
$$;
REVOKE ALL ON FUNCTION public.fn_cash_hit_run_house_take(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_hit_run_house_take(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.fn_cash_hit_run_house_take(uuid, uuid) IS
  'Charles Rule: the house take (rake and drops) from the pots this player won in this hand, added back before judging a double.';

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
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'fn_cash_session_evaluate is engine-only';
  END IF;
  SELECT t.id, t.tournament_id INTO v_t FROM public.tables t WHERE t.id = p_table_id;
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
    v_ack := v_s.hr_engine_ack OR COALESCE((v_e->>'hit_run')::boolean, false);
    v_hand := NULLIF(v_e->>'hand_id', '');
    IF v_hand IS NOT NULL AND v_hand IS DISTINCT FROM v_s.hr_last_hand_ref THEN
      v_in_pool := EXISTS (SELECT 1 FROM public.lightning_pool_session ps
                            WHERE ps.cash_player_session_id = v_s.id AND ps.exited_at IS NULL);
      IF (COALESCE(v_e->>'hand_source', 'table') = 'lightning') = v_in_pool THEN
        v_last := v_hand;
        IF NOT v_hr_on THEN
          v_req := 0; v_played := 0; v_ref := NULL; v_dbl := 0; v_started := NULL;
        ELSIF NOT v_done THEN
          IF v_req = 0 THEN
            IF v_stack > v_s.baseline THEN
              v_req := v_hr_hands; v_played := 0; v_ref := v_stack; v_dbl := 0; v_started := v_now;
            END IF;
          ELSIF v_stack <= v_s.baseline THEN
            v_req := 0; v_played := 0; v_ref := NULL; v_dbl := 0; v_started := NULL;
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
REVOKE ALL ON FUNCTION public.fn_cash_session_evaluate(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_session_evaluate(uuid, jsonb) TO service_role;

COMMIT;
