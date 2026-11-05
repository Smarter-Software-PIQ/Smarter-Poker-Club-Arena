-- @live-proof: position('v_payouts := jsonb_build_array(jsonb_build_object(''place'',1,''user_id'',v_winner.user_id,''amount'',0))' in pg_get_functiondef('public.fn_settle_tournament_places(uuid,uuid)'::regprocedure)) > 0
-- A bounty-only PKO (finalized ordinary prize pool exactly 0) has no place
-- ladder. 20261105203911 let fn_settle_tournament_places settle it, but it
-- returned `payouts: []`. Its caller,
-- fn_complete_tournament_terminal_pre_seat_guard, requires exactly one
-- place-1 line for the winner equal to winner_amount, and its own comment
-- states the contract: "The cash authority returns the derived zero-dollar
-- winner line, but a zero payment correctly creates no tournament_payouts
-- row." The engine receipt verifier (completionSettlementReceipt.ts) also
-- accepts exactly that zero-cash winner line and has a test for it. So the
-- fix is in the cash authority: with an empty ladder and a zero pool it
-- returns {place 1, winner, 0}. No money moves; no tournament_payouts row is
-- written. Refusal seen on Midday Free Buy 39b5fa14 (21:5x UTC 2026-11-05):
-- "cash authority returned a partial result ... payouts: []".
BEGIN;

DO $migration$
DECLARE
  v_def text;
  v_anchor text := '  RETURN jsonb_build_object(
    ''ok'',true,
    ''fully_settled'',true,
    ''status'',v_status,
    ''payouts'',v_payouts,';
  v_insert text := '  IF jsonb_array_length(v_ladder) = 0 AND v_t.prize_pool = 0 THEN
    v_payouts := jsonb_build_array(jsonb_build_object(''place'',1,''user_id'',v_winner.user_id,''amount'',0));
  END IF;
';
BEGIN
  v_def := pg_get_functiondef('public.fn_settle_tournament_places(uuid,uuid)'::regprocedure);
  IF position(v_insert IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'fn_settle_tournament_places: expected exactly one terminal RETURN to amend';
  END IF;
  EXECUTE replace(v_def, v_anchor, v_insert || v_anchor);
END
$migration$;

COMMIT;
