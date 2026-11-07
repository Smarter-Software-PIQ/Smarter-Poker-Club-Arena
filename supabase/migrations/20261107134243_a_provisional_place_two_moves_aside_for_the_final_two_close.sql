-- 20261107134243_a_provisional_place_two_moves_aside_for_the_final_two_close
--
-- Reserved by scripts/new-migration.mjs on 2026-11-07 13:42:43 UTC.
--
-- A PROVISIONAL PLACE 2 MOVES ASIDE FOR THE FINAL TWO CLOSE (root cause of
-- the Midnight Free Buy c1b3fa5a miss on 2026-11-07, read from rows).
--
-- Places stamped at bust are PROVISIONAL: the elimination ladder walks down
-- from a seed that drifts while late registration grows the field, and the
-- terminal finish re-ranks every bust by when it happened before a chip is
-- paid (fn_settle_tournament_places; TournamentManagerEliminations.ts,
-- "THE LADDER IS COUNTED FROM UNPLACED PLAYERS"). So when a bounty only PKO
-- reaches its final two, finishing place 2 may ALREADY be held by an earlier
-- bust whose provisional stamp ran low. Measured on Midnight Free Buy (NLH)
-- c1b3fa5a-85f6-4aea-8d4d-c76fc545a984: SLCCamille (true 4th) was stamped a
-- provisional place 2 at her 09:15:03 bust; when the field reached two,
-- fn_ca_bounty_only_pko_final_two tried to record the real runner-up at
-- place 2, trg_tournament_place_collision refused (rightly - a contested
-- place is paid twice), the engine's bounded retries exhausted after 8 tries
-- in 74s, the close was recorded refused, the event played on heads up and
-- the winner took both final heads. Uncle Zoe's own 6.98 head is settled by
-- 20261107134252.
--
-- The fix, at the cause: before the close stamps the runner-up at place 2,
-- any OTHER row holding a provisional place 2 is moved to the lowest free
-- place at 3 or above - the same provisional semantics the engine itself
-- uses when its ladder is exhausted upward, and the terminal finish re-ranks
-- every bust by its time regardless. The relocation is recorded in the
-- receipt. Everything else in the function is byte-identical to the
-- installed version (20261106010426), which production matched when this was
-- written.
--
-- Native proof: scripts/ci/test-bounty-only-pko-final-two.py (contested
-- place scenario runs against the real trg_tournament_place_collision).
--
-- @live-proof: EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'fn_ca_bounty_only_pko_final_two' AND p.prosrc LIKE '%A PROVISIONAL PLACE 2 MOVES ASIDE%')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

DO $pre$ BEGIN
  IF to_regprocedure('public.fn_ca_bounty_only_pko_final_two(uuid)') IS NULL
     OR to_regclass('public.ca_bounty_only_final_two') IS NULL THEN
    RAISE EXCEPTION 'the bounty only final two close is not installed (20261106010426 must run first)';
  END IF;
END $pre$;

CREATE OR REPLACE FUNCTION public.fn_ca_bounty_only_pko_final_two(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_t public.tournaments%ROWTYPE;
  v_done public.ca_bounty_only_final_two%ROWTYPE;
  v_live integer;
  v_first record;
  v_second record;
  v_head numeric(15,2);
  v_prior numeric(15,2);
  v_settle jsonb;
  v_rows integer;
  v_receipt jsonb;
  v_holder record;
  v_free_place integer;
BEGIN
  IF NOT public.fn_caller_is_engine() THEN
    RAISE EXCEPTION 'closing a bounty only PKO at two requires engine authority'
      USING ERRCODE = '28000';
  END IF;
  IF p_tournament_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_tournament');
  END IF;

  -- The same first lock as every bounty payer and the terminal finish.
  PERFORM public.fn_ca_lock_settlement_lane_global();

  SELECT * INTO v_done FROM public.ca_bounty_only_final_two
   WHERE tournament_id = p_tournament_id;
  IF FOUND THEN
    RETURN v_done.receipt || jsonb_build_object('replayed', true);
  END IF;

  SELECT * INTO v_t FROM public.tournaments
   WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF NOT (COALESCE(v_t.is_pko, false)
          AND NOT COALESCE(v_t.is_mystery_bounty, false)
          AND COALESCE(v_t.buy_in_amount, 0) <= 0
          AND COALESCE(v_t.guaranteed_prize, 0) <= 0
          AND COALESCE(v_t.prize_pool, 0) <= 0
          AND COALESCE(v_t.bounty_pool, 0) > 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_bounty_only_pko');
  END IF;
  IF upper(COALESCE(v_t.status::text, '')) <> 'RUNNING'
     OR COALESCE(v_t.prize_pool_finalized, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_running_with_a_final_field');
  END IF;

  -- The terminal authority's roster order, before any row is read for a decision.
  PERFORM 1 FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
   ORDER BY tp.user_id, tp.id FOR UPDATE;

  -- Every bust that brought the field to two is settled first: its head is
  -- on the winner's head before the order and the heads are read.
  IF EXISTS (SELECT 1 FROM public.tournament_knockout_candidates c
              WHERE c.tournament_id = p_tournament_id AND c.state = 'pending')
     OR public.fn_tournament_has_unsettled_bounties(p_tournament_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'busts_not_settled');
  END IF;

  SELECT count(*) INTO v_live FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id AND tp.status = 'playing';
  IF v_live <> 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'field_is_not_two', 'live', v_live);
  END IF;

  SELECT tp.id, tp.user_id, COALESCE(tp.chips, 0) AS chips,
         round(COALESCE(tp.current_bounty, 0), 2) AS head
    INTO v_first
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id AND tp.status = 'playing'
   ORDER BY COALESCE(tp.chips, 0) DESC, COALESCE(tp.current_bounty, 0) DESC,
            tp.registered_at ASC NULLS LAST, tp.user_id ASC
   LIMIT 1;
  SELECT tp.id, tp.user_id, COALESCE(tp.chips, 0) AS chips,
         round(COALESCE(tp.current_bounty, 0), 2) AS head
    INTO v_second
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id AND tp.status = 'playing'
     AND tp.id <> v_first.id;

  IF v_first.chips <= 0 OR v_second.chips <= 0 THEN
    -- A zero stack is a bust the knockout door has not recorded yet.
    RETURN jsonb_build_object('ok', false, 'reason', 'a_live_stack_is_empty');
  END IF;
  v_head := v_second.head;
  IF v_head <= 0 OR v_first.head <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'a_live_head_is_empty');
  END IF;
  IF round(COALESCE(v_t.bounty_pool, 0) - COALESCE(v_t.bounty_pool_paid, 0), 2)
       IS DISTINCT FROM round(v_first.head + v_second.head, 2) THEN
    -- The two live heads are the whole unpaid bounty pool, or something else
    -- is open and this close would not conserve.
    RETURN jsonb_build_object('ok', false, 'reason', 'heads_do_not_match_the_open_pool',
      'open_pool', round(COALESCE(v_t.bounty_pool, 0) - COALESCE(v_t.bounty_pool_paid, 0), 2),
      'heads', round(v_first.head + v_second.head, 2));
  END IF;

  -- A PROVISIONAL PLACE 2 MOVES ASIDE (2026-11-07, Midnight Free Buy
  -- c1b3fa5a). Places stamped at bust are provisional: the elimination
  -- ladder runs low while late registration grows the field, so an earlier
  -- bust may hold place 2 while the true final two are still playing.
  -- trg_tournament_place_collision rightly refuses a second player on a
  -- taken place, so the holder is moved to the lowest free place at 3 or
  -- above - the engine's own exhausted-ladder semantics - and the terminal
  -- finish re-ranks every bust by its time regardless.
  SELECT tp.id, tp.user_id INTO v_holder
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
     AND tp.position = 2
     AND tp.id <> v_second.id
   LIMIT 1;
  IF FOUND THEN
    SELECT min(candidate.place) INTO v_free_place
      FROM generate_series(3, (SELECT count(*)::integer + 2
                                 FROM public.tournament_players
                                WHERE tournament_id = p_tournament_id)) AS candidate(place)
     WHERE NOT EXISTS (SELECT 1 FROM public.tournament_players t2
                        WHERE t2.tournament_id = p_tournament_id
                          AND t2.position = candidate.place);
    IF v_free_place IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_free_provisional_place');
    END IF;
    UPDATE public.tournament_players
       SET position = v_free_place
     WHERE id = v_holder.id;
  END IF;

  v_prior := COALESCE((
    SELECT o.amount_paid FROM public.tournament_obligations o
     WHERE o.tournament_id = p_tournament_id AND o.kind = 'bounty_residual'
       AND o.place IS NULL AND o.user_id = v_second.user_id), 0);
  v_settle := public.fn_settle_tournament_obligation(
    p_tournament_id, 'bounty_residual', NULL, v_second.user_id,
    round(v_prior + v_head, 2), 'fn_ca_bounty_only_pko_final_two',
    'Final two: own bounty head kept');
  IF NOT COALESCE((v_settle->>'ok')::boolean, false)
     OR round(COALESCE((v_settle->>'paid')::numeric, 0), 2) IS DISTINCT FROM v_head THEN
    RAISE EXCEPTION 'fn_ca_bounty_only_pko_final_two: own head % to % in tournament % refused: %',
      v_head, v_second.user_id, p_tournament_id, v_settle
      USING ERRCODE = 'P0404';
  END IF;

  UPDATE public.tournaments
     SET bounty_pool_paid = round(COALESCE(bounty_pool_paid, 0) + v_head, 2)
   WHERE id = p_tournament_id;

  UPDATE public.tournament_players
     SET bounty_winnings = round(COALESCE(bounty_winnings, 0) + v_head, 2),
         current_bounty = 0,
         status = 'eliminated',
         position = 2,
         eliminated_at = clock_timestamp()
   WHERE id = v_second.id AND status = 'playing';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'fn_ca_bounty_only_pko_final_two: second place % was not live in %',
      v_second.user_id, p_tournament_id USING ERRCODE = '55000';
  END IF;

  v_receipt := jsonb_build_object(
    'ok', true, 'tournament_id', p_tournament_id,
    'winner_user_id', v_first.user_id, 'runner_up_user_id', v_second.user_id,
    'winner_chips', v_first.chips, 'runner_up_chips', v_second.chips,
    'winner_head', v_first.head, 'runner_up_head', v_head,
    'obligation', v_settle);
  IF v_holder.id IS NOT NULL THEN
    v_receipt := v_receipt || jsonb_build_object(
      'relocated_provisional_place_2', v_holder.user_id,
      'relocated_to', v_free_place);
  END IF;
  INSERT INTO public.ca_bounty_only_final_two
    (tournament_id, winner_user_id, runner_up_user_id, winner_chips, runner_up_chips,
     winner_head, runner_up_head, receipt)
  VALUES (p_tournament_id, v_first.user_id, v_second.user_id, v_first.chips, v_second.chips,
          v_first.head, v_head, v_receipt);
  RETURN v_receipt;
END;
$function$;
REVOKE ALL ON FUNCTION public.fn_ca_bounty_only_pko_final_two(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_bounty_only_pko_final_two(uuid) TO service_role;
COMMENT ON FUNCTION public.fn_ca_bounty_only_pko_final_two(uuid) IS
 'Closes a bounty only PKO at two players (owner rule 2026-11-05): pays the second player his own head and records second place; a provisional place-2 stamp from an earlier bust is moved to the lowest free place first (2026-11-07); the terminal authority then pays the first player his own head as the residual.';

COMMIT;
