-- @live-proof: position('jsonb_array_length(v_cash->''payouts'') < 1 AND v_t.prize_pool <> 0)' in pg_get_functiondef('public.fn_complete_tournament_terminal_pre_seat_guard(uuid,uuid,text)'::regprocedure)) > 0
-- A bounty-only PKO (finalized ordinary prize pool exactly 0) has no place
-- payouts. 20261105203911 let fn_settle_tournament_places settle it with an
-- empty ladder, but fn_complete_tournament_terminal_pre_seat_guard still
-- demanded at least one cash payout and a place-1 payout row equal to
-- winner_amount, so it refused with "cash authority returned a partial
-- result" (observed on Midday Free Buy 39b5fa14 at 21:5x UTC 2026-11-05,
-- probed in a self-aborting DO block). The guard's own later branch already
-- accepts `prize_pool = 0 AND payouts = []`; this aligns the two earlier
-- checks with it. A positive pool keeps both checks unchanged.
BEGIN;

DO $migration$
DECLARE
  v_def text;
  v_out text;
  v_old1 text := 'OR jsonb_array_length(v_cash->''payouts'') < 1
';
  v_new1 text := 'OR (jsonb_array_length(v_cash->''payouts'') < 1 AND v_t.prize_pool <> 0)
';
  v_old2 text := '     OR (SELECT count(*) FROM jsonb_array_elements(v_cash->''payouts'') p
          WHERE (p->>''place'')::integer = 1
            AND (p->>''user_id'')::uuid = v_winner_id
            AND (p->>''amount'')::numeric =
                (v_cash->>''winner_amount'')::numeric) <> 1 THEN';
  v_new2 text := '     OR (v_t.prize_pool <> 0 AND (SELECT count(*) FROM jsonb_array_elements(v_cash->''payouts'') p
          WHERE (p->>''place'')::integer = 1
            AND (p->>''user_id'')::uuid = v_winner_id
            AND (p->>''amount'')::numeric =
                (v_cash->>''winner_amount'')::numeric) <> 1) THEN';
BEGIN
  v_def := pg_get_functiondef('public.fn_complete_tournament_terminal_pre_seat_guard(uuid,uuid,text)'::regprocedure);
  IF position(v_new1 IN v_def) > 0 AND position(v_new2 IN v_def) > 0 THEN
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1) <> 1
     OR (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2) <> 1 THEN
    RAISE EXCEPTION 'pre_seat_guard: expected exactly one of each zero-prize check to amend';
  END IF;
  v_out := replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
  EXECUTE v_out;
END
$migration$;

COMMIT;
