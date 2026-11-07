-- 20261107130652_the_final_two_close_never_dies_on_a_held_place_two.sql
--
-- Reserved by scripts/reserve-migration-version.sh against this worktree,
-- origin/main and every other worktree on this machine, so it cannot collide
-- with another agent's in-flight work.
--
-- THE FINAL TWO CLOSE NEVER DIES ON A HELD PLACE TWO (2026-11-07).
--
-- Dan's rule (2026-11-05): a bounty only PKO has no paid places, only
-- bounties pay, and THE EVENT ENDS WITH TWO PLAYERS LEFT, both keeping the
-- bounty on their own head. fn_ca_bounty_only_pko_final_two (20261106010426)
-- is the authority that closes it: it pays the second player his own head and
-- records him in finishing place 2.
--
-- WHAT WAS WRONG. That UPDATE stamps `position = 2` with no check that place 2
-- is free. tournament_players carries trigger tournament_place_collision_watch
-- (public.trg_tournament_place_collision), which refuses any stamp of a place
-- another entrant already holds by raising SQLSTATE 23505 - correctly, because
-- a contested place is paid twice. Place 2 is routinely held for a moment by
-- another writer: the bounty rebuy step stamps a TEMPORARY position of
-- GREATEST(2, count(*)) on the old entry before the money core clears it
-- (20261024072516), and at two live players that temporary position IS 2.
-- When it is, the whole close attempt dies with an exception instead of
-- answering, and the event plays on heads up - which costs the runner-up his
-- own head.
--
-- WHAT WAS MEASURED. public.ca_bounty_only_final_two holds ZERO rows for all
-- time: the close has never once succeeded in production. The one real
-- attempt ever recorded, ca_bounty_only_final_two_refusals for tournament
-- c1b3fa5a-85f6-4aea-8d4d-c76fc545a984 at 2026-11-07 09:20:13Z, failed exactly
-- this way - "finishing place 2 ... is already held by 4b532a4a... gave up
-- after 8 tries in 74s". 4b532a4a's own settled place in that event is 4, so
-- the 2 it held was transient, and the event then played past two: its
-- runner-up was eliminated at 09:20:37Z and the winner was paid both final
-- heads (bounty_winnings 79.05).
--
-- WHAT THIS CHANGES. One typed answer, added before anything is settled: if
-- place 2 is held by anybody other than the player this close is about to
-- record there, the function RETURNS
-- {"ok": false, "reason": "finishing_place_two_is_held", ...} instead of
-- letting the trigger raise. The engine classifies that reason as transient
-- (bountyOnlyFinalTwo.ts) and asks again about a second later, within the
-- bounded retry budget that already exists so the final two can never freeze;
-- by then the money core has cleared the temporary position. Nothing else in
-- the function changes - the same lock, the same roster order, the same single
-- payer, the same `position = 2` for the runner-up (that place is the owner's
-- rule and the watch's own expectation, so it is NOT re-derived here), the
-- same receipt and the same close row.
--
-- The new answer is returned BEFORE fn_settle_tournament_obligation, because a
-- typed RETURN commits: refusing after the head was paid but before the place
-- was stamped would leave a paid runner-up still `playing`.
--
-- THIS MOVES NO CHIPS. It adds one read of tournament_players (already locked
-- FOR UPDATE by this function two statements earlier, so the answer is stable)
-- and one RETURN. No INSERT, UPDATE or DELETE is added, and no obligation,
-- ledger, wallet or pool row is touched by this migration.
--
-- The preimage is guarded on the live definition (md5 of pg_get_functiondef,
-- owner, ACL, config, SECURITY DEFINER; read 2026-11-07 13:02 UTC on project
-- kuklfnapbkmacvwxktbh, where it matches 20261106010426 byte for byte - no
-- later migration has rewritten it). CREATE OR REPLACE keeps the owner and the
-- ACL; both are re-asserted and proved after.
-- @live-proof: position('finishing_place_two_is_held' in pg_get_functiondef('public.fn_ca_bounty_only_pko_final_two(uuid)'::regprocedure)) > 0 AND position('position = 2,' in pg_get_functiondef('public.fn_ca_bounty_only_pko_final_two(uuid)'::regprocedure)) > 0 AND NOT has_function_privilege('authenticated','public.fn_ca_bounty_only_pko_final_two(uuid)','execute') AND has_function_privilege('service_role','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

DO $pre$ BEGIN
  IF to_regclass('public.ca_bounty_only_final_two') IS NULL
     OR to_regclass('public.tournament_knockout_candidates') IS NULL THEN
    RAISE EXCEPTION 'bounty only final two dependencies are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_ca_bounty_only_pko_final_two(uuid)')
                    AND md5(pg_get_functiondef(p.oid)) = '32ef0b2af5e91401d50068b520ceda55'
                    AND p.proowner = 'postgres'::regrole
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                    AND to_jsonb(p.proconfig) = '["search_path=public, pg_temp"]'::jsonb
                    AND p.prosecdef) THEN
    RAISE EXCEPTION 'FINAL_TWO_CLOSE_PREIMAGE_CHANGED' USING ERRCODE = '55000';
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
  v_held uuid;
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

  -- PLACE 2 BELONGS TO THIS RUNNER-UP, AND IT MUST BE FREE BEFORE ANY MONEY
  -- MOVES (2026-11-07). trg_tournament_place_collision refuses a place another
  -- entrant holds by raising 23505, and place 2 is held for a moment by the
  -- bounty rebuy step's temporary position (GREATEST(2, count(*)), which at two
  -- live players is 2) until the money core clears it. Letting that raise
  -- killed the whole attempt and the event played past two; answering instead
  -- lets the engine ask again inside its existing bounded retry budget. The
  -- roster is already locked FOR UPDATE above, so this read is stable, and the
  -- answer comes before fn_settle_tournament_obligation because a typed RETURN
  -- commits.
  SELECT tp.user_id INTO v_held
    FROM public.tournament_players tp
   WHERE tp.tournament_id = p_tournament_id
     AND tp.position = 2
     AND tp.user_id <> v_second.user_id
   LIMIT 1;
  IF v_held IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'finishing_place_two_is_held',
      'held_by', v_held, 'runner_up_user_id', v_second.user_id, 'live', v_live);
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
 'Closes a bounty only PKO at two players (owner rule 2026-11-05): pays the second player his own head and records second place; the terminal authority then pays the first player his own head as the residual. Refuses finishing_place_two_is_held, which the engine retries, rather than dying on trg_tournament_place_collision (2026-11-07).';

DO $post$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.fn_ca_bounty_only_pko_final_two(uuid)')
                    AND p.proowner = 'postgres'::regrole
                    AND p.proacl::text = '{postgres=X/postgres,service_role=X/postgres}'
                    AND to_jsonb(p.proconfig) = '["search_path=public, pg_temp"]'::jsonb
                    AND p.prosecdef
                    AND position('finishing_place_two_is_held' in pg_get_functiondef(p.oid)) > 0
                    AND position('position = 2,' in pg_get_functiondef(p.oid)) > 0
                    AND position('fn_settle_tournament_obligation(' in pg_get_functiondef(p.oid)) > 0) THEN
    RAISE EXCEPTION 'FINAL_TWO_CLOSE_POSTIMAGE_CHANGED' USING ERRCODE = '55000';
  END IF;
END $post$;

COMMIT;
