-- 20261105215359_a_zero_prize_pool_pko_names_its_winner_as_a_zero_valued_firs.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- 20261105203911 let fn_settle_tournament_places accept an empty place ladder
-- when the locked prize pool is exactly 0 (a bounty-only PKO, such as the
-- Midway promo PKO Free Buys). That stopped the "derived an empty ladder"
-- refusal, but the function then returned payouts = [] and the terminal guard
-- (fn_complete_tournament_terminal_pre_seat_guard) refuses any cash result
-- with fewer than one payout line: "cash authority returned a partial result".
-- The Midday Free Buy (2026-11-05 18:30 UTC) sat at its winner for over half
-- an hour, FINALIZING and refused on every retry.
--
-- The guard's own zero-cash branch documents the contract it expects: "the
-- cash authority returns the derived zero-dollar winner line". So when the
-- ladder is empty and the pool is 0, the cash authority now names first place
-- as a single zero-valued ladder line. Every existing rule then applies to it
-- unchanged: a zero-valued place is standings, not a debt (no obligation, no
-- payout row, no wallet credit); the ladder total 0 equals the locked pool 0;
-- the winner is already stamped position 1; and the receipt carries one
-- payout line of amount 0 with winner_amount 0, which the guard and the
-- terminal receipt already accept. Bounties still settle through their own
-- authority. A positive pool with an empty ladder still refuses (23514).
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).
-- @live-proof: position('v_ladder := jsonb_build_array(jsonb_build_object(''place'',1,''amount'',0));' in pg_get_functiondef('public.fn_settle_tournament_places(uuid,uuid)'::regprocedure)) > 0

BEGIN;

DO $migration$
DECLARE
  v_old text := 'IF jsonb_array_length(v_ladder) = 0 AND v_t.prize_pool <> 0 THEN
    RAISE EXCEPTION ''tournament % derived an empty ladder'', p_tournament_id
      USING ERRCODE = ''23514'';
  END IF;';
  v_new text := 'IF jsonb_array_length(v_ladder) = 0 THEN
    IF v_t.prize_pool <> 0 THEN
      RAISE EXCEPTION ''tournament % derived an empty ladder'', p_tournament_id
        USING ERRCODE = ''23514'';
    END IF;
    -- A zero-cash event (a bounty-only PKO) still has one real winner. The
    -- ladder names that first place as a zero-valued standings line, so the
    -- terminal guard receives exactly one payout line and no money moves.
    v_ladder := jsonb_build_array(jsonb_build_object(''place'',1,''amount'',0));
  END IF;';
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.fn_settle_tournament_places(uuid,uuid)'::regprocedure);
  IF position(v_new IN v_def) > 0 THEN
    RETURN; -- already applied
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_settle_tournament_places: expected exactly one zero-pool empty-ladder branch to amend';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$migration$;

COMMIT;
