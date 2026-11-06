-- 20261106010426_bounty_only_pko_ends_with_two_players
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-06 01:04:26 UTC.
--
-- A BOUNTY ONLY PKO ENDS WITH TWO PLAYERS, AND BOTH KEEP THEIR OWN HEAD
-- (owner rule 2026-11-05, Dan: "the top two guys that are left should keep
-- the bounties on both of their heads. Tournament is over with 2 players
-- left.")
--
-- A bounty only PKO (is_pko, not mystery, free entry, no guarantee, zero
-- place pool, funded bounty pool) pays nothing for finishing position: every
-- chip of it is a head. Until now the event played heads up, and the heads up
-- knockout moved half the loser's head into the winner's wallet and half onto
-- the winner's head, which fn_finalize_bounty_pool then paid him as the
-- champion's residual: one player took both final heads. Measured on the
-- Afternoon Free Buy of 2026-11-05 (74ba8130): 236 entries, bounty pool
-- 403.00, every live head plus every bounty paid summed to the pool exactly,
-- so the two final heads are precisely what is left of the pool.
--
-- fn_ca_bounty_only_pko_final_two is the one authority that closes such an
-- event at two. The engine calls it between hands, with every table parked,
-- once the bust that left two players has settled. It decides the order from
-- the locked roster (more chips first; then the larger head; then the
-- earlier registration; then user id), pays the second player his OWN head
-- to his wallet through the single payer fn_settle_tournament_obligation
-- (kind bounty_residual, from the bounty bank, under its own named source),
-- and records him eliminated in second place. The engine then finishes the
-- event through the unchanged terminal authority, whose fn_finalize_bounty_pool
-- pays the first player the pool residual, which is exactly his own head. The
-- terminal close still proves sum(bounty credits) = bounty_pool and every
-- escrow bank at zero, so conservation is checked where it always was.
--
-- One receipt per event (ca_bounty_only_final_two) makes a replay return the
-- same answer and never pay twice. Anything that is not exactly two funded,
-- settled, live stacks in a ready bounty only PKO whose two heads are the
-- whole open pool is refused with a reason and moves nothing.
--
-- Native proof: scripts/ci/test-bounty-only-pko-final-two.py.
--
-- @live-proof: to_regprocedure('public.fn_ca_bounty_only_pko_final_two(uuid)') IS NOT NULL AND to_regclass('public.ca_bounty_only_final_two') IS NOT NULL AND EXISTS(SELECT 1 FROM public.ca_settle_sources WHERE source='fn_ca_bounty_only_pko_final_two') AND NOT has_function_privilege('authenticated','public.fn_ca_bounty_only_pko_final_two(uuid)','execute')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

DO $pre$ BEGIN
  IF to_regclass('public.ca_bounty_only_final_two') IS NOT NULL
     OR to_regprocedure('public.fn_ca_bounty_only_pko_final_two(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'bounty only final two already installed';
  END IF;
  IF to_regprocedure('public.fn_settle_tournament_obligation(uuid,text,integer,uuid,numeric,text,text,uuid)') IS NULL
     OR to_regprocedure('public.fn_ca_lock_settlement_lane_global()') IS NULL
     OR to_regprocedure('public.fn_caller_is_engine()') IS NULL
     OR to_regprocedure('public.fn_tournament_has_unsettled_bounties(uuid)') IS NULL
     OR to_regclass('public.ca_settle_sources') IS NULL
     OR to_regclass('public.tournament_knockout_candidates') IS NULL THEN
    RAISE EXCEPTION 'bounty only final two dependencies are missing';
  END IF;
END $pre$;

CREATE TABLE public.ca_bounty_only_final_two(
  tournament_id uuid NOT NULL PRIMARY KEY REFERENCES public.tournaments(id),
  winner_user_id uuid NOT NULL,
  runner_up_user_id uuid NOT NULL,
  winner_chips numeric NOT NULL,
  runner_up_chips numeric NOT NULL,
  winner_head numeric(15,2) NOT NULL,
  runner_up_head numeric(15,2) NOT NULL CHECK (runner_up_head > 0),
  receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (winner_user_id <> runner_up_user_id));
COMMENT ON TABLE public.ca_bounty_only_final_two IS
 'One row per bounty only PKO closed at two players (owner rule 2026-11-05): who finished first and second and the own head the second player was paid. Written only by fn_ca_bounty_only_pko_final_two; a replay returns the stored receipt.';
ALTER TABLE public.ca_bounty_only_final_two ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ca_bounty_only_final_two FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.ca_bounty_only_final_two TO service_role;

INSERT INTO public.ca_settle_sources(source, note)
VALUES ('fn_ca_bounty_only_pko_final_two',
        'Bounty only PKO closed at two players: the second player is paid his own head (owner rule 2026-11-05).');

INSERT INTO public.ca_money_rpc_registry (proname, status, notes) VALUES
 ('fn_ca_bounty_only_pko_final_two', 'approved',
  'Engine only: closes a bounty only PKO at two players; pays the second player his own head once through fn_settle_tournament_obligation (bounty_residual) and records second place; one receipt per event.')
ON CONFLICT (proname) DO NOTHING;

CREATE FUNCTION public.fn_ca_bounty_only_pko_final_two(p_tournament_id uuid)
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
 'Closes a bounty only PKO at two players (owner rule 2026-11-05): pays the second player his own head and records second place; the terminal authority then pays the first player his own head as the residual.';

COMMIT;
