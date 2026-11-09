-- 20261108222325_the_final_two_close_vacates_the_runner_up_seat.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- THE FINAL TWO CLOSE VACATES THE RUNNER-UP'S SEAT (2026-11-08).
--
-- Owner rule (Dan, 2026-11-05): a bounty only PKO ends with two players left,
-- both keeping the bounty on their own head. fn_ca_bounty_only_pko_final_two
-- pays the runner-up his own head and records him eliminated in place 2.
--
-- WHAT FAILED. The first natural finish after 20261108193616 (Midday Free Buy
-- (NLH) 36fc2465, 2026-11-08) reached the close with exactly two live players,
-- bhamjeremy and velvet9, and every try rolled back at COMMIT:
--
--   ca_bounty_only_final_two_refusals 36fc2465 at 20:48:14Z:
--   "authority_unreachable: TOURNAMENT_SEAT_ROSTER_REQUIRED: live seat user
--    d69e25e8 (velvet9) has no active roster in tournament 36fc2465 at commit;
--    gave up after 11 tries in 66s"
--
-- The raise is public.trg_assert_live_tournament_seat_has_roster, fired by the
-- DEFERRED constraint trigger tournament_roster_update_cannot_orphan_live_seat
-- (AFTER UPDATE OF tournament_id, user_id, status ON tournament_players,
-- installed 2026-09, #4066/#4232). At commit it requires that a user who still
-- holds a live seat (table_seats.left_at IS NULL) in a REGISTERING or RUNNING
-- event has a roster row in status 'registered' or 'playing'. The close sets
-- the runner-up's roster row to 'eliminated' and never touched his chair: his
-- seat (df7c5a26 seat 4) was still live, so the deferred check refused the
-- whole transaction and nothing was paid. The engine played the hand out,
-- velvet9 busted at 20:48:49Z and the winner took both final heads.
--
-- NOT A REGRESSION OF 20261108193616. Its only new write moves the provisional
-- place-2 holder's `position`, which is not in the trigger's column list, and
-- the trigger named the runner-up himself. The status write that trips it has
-- been in the function since 20261106010426 (line 212). The close had never
-- reached COMMIT before: every earlier attempt died first on the place-2
-- collision (20261107130652) or was answered finishing_place_two_is_held
-- (20261108193616 removed that). Removing the earlier refusal unmasked this.
--
-- THE FIX, AT THE CAUSE. In the same transaction as the roster write, the close
-- closes the runner-up's live chair (left_at), exactly as the knockout door
-- (fn_eliminate_player_legacy_candidate_20260907) closes a busted chair beside
-- its roster write, and refreshes that table's current_players. The engine has
-- parked every table untilResumed before asking, so no hand is in flight. The
-- authority already holds the global settlement lane exclusively, which every
-- seat guard accepts. A tournament stack is play money: the seat exit credits
-- no wallet, writes no chip_ledger leg and moves no balance account (the felt
-- account counts cash tables only). The vacated seat ids are in the receipt.
-- Everything else in the function is byte-identical to the live body.
--
-- THIS MOVES NO CHIPS AND PAYS NOBODY. No make-good is in this file.
--
-- The preimage is guarded on the live definition (md5 of pg_get_functiondef
-- 480b20dc852d4c613dfd39b362ebb4ac, owner, ACL, config, SECURITY DEFINER; read
-- 2026-11-08 22:20 UTC on project kuklfnapbkmacvwxktbh), which is the body
-- 20261108193616 installs. CREATE OR REPLACE keeps the owner and the ACL; both
-- are re-asserted and proved after.
--
-- Native proof: scripts/ci/test-final-two-close-held-place-two.py runs this
-- file after 20261108193616 with a faithful copy of the live roster-orphan
-- constraint trigger and proves the old body dies at commit on a live seat and
-- the new one closes, pays once and leaves no live seat for the runner-up.
--
-- @live-proof: position('THE RUNNER-UP LEAVES HIS CHAIR' in pg_get_functiondef('public.fn_ca_bounty_only_pko_final_two(uuid)'::regprocedure)) > 0 AND position('runner_up_seats_vacated' in pg_get_functiondef('public.fn_ca_bounty_only_pko_final_two(uuid)'::regprocedure)) > 0 AND NOT has_function_privilege('authenticated','public.fn_ca_bounty_only_pko_final_two(uuid)','execute') AND has_function_privilege('service_role','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

DO $pre$ BEGIN
  IF to_regclass('public.ca_bounty_only_final_two') IS NULL
     OR to_regclass('public.table_seats') IS NULL THEN
    RAISE EXCEPTION 'bounty only final two dependencies are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_ca_bounty_only_pko_final_two(uuid)')
                    AND md5(pg_get_functiondef(p.oid)) = '480b20dc852d4c613dfd39b362ebb4ac'
                    AND p.proowner = 'postgres'::regrole
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                    AND to_jsonb(p.proconfig) = '["search_path=public, pg_temp"]'::jsonb
                    AND p.prosecdef) THEN
    RAISE EXCEPTION 'FINAL_TWO_SEAT_VACATE_PREIMAGE_CHANGED' USING ERRCODE = '55000';
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
  v_holder_id uuid;
  v_holder_user uuid;
  v_free_place integer;
  v_seat_ids uuid[];
  v_released_tables uuid[];
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

  -- A PROVISIONAL PLACE 2 MOVES ASIDE (2026-11-08; replaces the
  -- finishing_place_two_is_held answer of 2026-11-07, which no retry could
  -- clear). Places stamped at bust are provisional: the ladder runs low while
  -- late registration grows the field, so the true third or fourth finisher
  -- can hold place 2 while the real final two are still playing (Midnight
  -- Free Buy 7f473b6a, Midday Free Buy 72e9b116). The roster is locked FOR
  -- UPDATE above, so what is read here is a committed provisional stamp. It is
  -- moved to the lowest free place at 3 or above - the engine's own
  -- exhausted-ladder semantics - and the terminal finish re-ranks every bust
  -- by time regardless. A bounty only PKO pays no place, so nothing is paid.
  SELECT tp.id, tp.user_id INTO v_holder_id, v_holder_user
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
     AND tp.position = 2
     AND tp.user_id <> v_second.user_id
   LIMIT 1;
  IF v_holder_id IS NOT NULL THEN
    SELECT min(candidate.place) INTO v_free_place
      FROM generate_series(3, (SELECT count(*)::integer + 2
                                 FROM public.tournament_players t1
                                WHERE t1.tournament_id = p_tournament_id)) AS candidate(place)
     WHERE NOT EXISTS (SELECT 1 FROM public.tournament_players t2
                        WHERE t2.tournament_id = p_tournament_id
                          AND t2.position = candidate.place);
    IF v_free_place IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_free_provisional_place');
    END IF;
    UPDATE public.tournament_players
       SET position = v_free_place
     WHERE id = v_holder_id AND position = 2;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'fn_ca_bounty_only_pko_final_two: provisional place 2 of % in % did not move',
        v_holder_user, p_tournament_id USING ERRCODE = '55000';
    END IF;
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

  -- THE RUNNER-UP LEAVES HIS CHAIR IN THE SAME TRANSACTION (2026-11-08).
  -- Recording him eliminated while his chair stays live is refused at commit
  -- by the deferred tournament_roster_update_cannot_orphan_live_seat
  -- (trg_assert_live_tournament_seat_has_roster: a live seat in a RUNNING
  -- event needs a registered or playing roster row), so the whole close rolled
  -- back with TOURNAMENT_SEAT_ROSTER_REQUIRED on every try (Midday Free Buy
  -- 36fc2465, velvet9, 11 tries in 66 s, 2026-11-08 20:48:14). The knockout
  -- door closes the busted chair in the same transaction as the roster write;
  -- this close is the second player's finish and does the same. The engine has
  -- parked every table untilResumed before asking, so no hand is in flight on
  -- this chair, and the terminal finish that follows records the chips still
  -- on it as nothing: a tournament stack is play money and credits no wallet.
  -- The engine holds no seat-exit authority here; this authority holds G and B
  -- exclusively (fn_ca_lock_settlement_lane_global above), which is exactly
  -- what every seat guard below accepts as terminal authority.
  PERFORM 1
    FROM public.table_seats s
    JOIN public.tables tb ON tb.id = s.table_id
   WHERE tb.tournament_id = p_tournament_id
     AND s.user_id = v_second.user_id AND s.left_at IS NULL
   ORDER BY s.id FOR UPDATE OF s;
  WITH released AS (
    UPDATE public.table_seats s
       SET left_at = clock_timestamp()
      FROM public.tables tb
     WHERE tb.id = s.table_id AND tb.tournament_id = p_tournament_id
       AND s.user_id = v_second.user_id AND s.left_at IS NULL
    RETURNING s.id, s.table_id
  ) SELECT COALESCE(array_agg(r.id ORDER BY r.id), ARRAY[]::uuid[]),
           COALESCE(array_agg(DISTINCT r.table_id), ARRAY[]::uuid[])
      INTO v_seat_ids, v_released_tables FROM released r;
  IF EXISTS (SELECT 1 FROM public.table_seats s
               JOIN public.tables tb ON tb.id = s.table_id
              WHERE tb.tournament_id = p_tournament_id
                AND s.user_id = v_second.user_id AND s.left_at IS NULL) THEN
    RAISE EXCEPTION 'fn_ca_bounty_only_pko_final_two: second place % still holds a live seat in %',
      v_second.user_id, p_tournament_id USING ERRCODE = '55000';
  END IF;
  UPDATE public.tables tb SET current_players = (
    SELECT count(*) FROM public.table_seats s WHERE s.table_id = tb.id AND s.left_at IS NULL)
   WHERE tb.id = ANY(v_released_tables);

  v_receipt := jsonb_build_object(
    'ok', true, 'tournament_id', p_tournament_id,
    'winner_user_id', v_first.user_id, 'runner_up_user_id', v_second.user_id,
    'winner_chips', v_first.chips, 'runner_up_chips', v_second.chips,
    'winner_head', v_first.head, 'runner_up_head', v_head,
    'obligation', v_settle,
    'runner_up_seats_vacated', to_jsonb(v_seat_ids));
  IF v_holder_id IS NOT NULL THEN
    v_receipt := v_receipt || jsonb_build_object(
      'relocated_provisional_place_2', v_holder_user,
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
 'Closes a bounty only PKO at two players (owner rule 2026-11-05): pays the second player his own head, records second place and closes his live chair in the same transaction (2026-11-08); the terminal authority then pays the first player his own head as the residual. A provisional place 2 stamped on an earlier bust is moved to the lowest free place at 3 or above first (2026-11-08), instead of refusing the close.';

DO $post$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_ca_bounty_only_pko_final_two(uuid)')
                    AND p.proowner = 'postgres'::regrole
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                    AND to_jsonb(p.proconfig) = '["search_path=public, pg_temp"]'::jsonb
                    AND p.prosecdef
                    AND position('THE RUNNER-UP LEAVES HIS CHAIR' in pg_get_functiondef(p.oid)) > 0
                    AND position('A PROVISIONAL PLACE 2 MOVES ASIDE' in pg_get_functiondef(p.oid)) > 0
                    AND position('runner_up_seats_vacated' in pg_get_functiondef(p.oid)) > 0
                    AND position('position = 2,' in pg_get_functiondef(p.oid)) > 0
                    AND position('fn_settle_tournament_obligation(' in pg_get_functiondef(p.oid)) > 0) THEN
    RAISE EXCEPTION 'FINAL_TWO_SEAT_VACATE_POSTIMAGE_CHANGED' USING ERRCODE = '55000';
  END IF;
END $post$;

COMMIT;
