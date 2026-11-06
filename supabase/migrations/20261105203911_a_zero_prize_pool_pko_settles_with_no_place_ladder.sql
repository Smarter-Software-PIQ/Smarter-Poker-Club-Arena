-- A finalized ordinary prize pool of exactly zero (a bounty-only PKO, such as a
-- Midway promo PKO Free Buy) has no place ladder by definition. Place settlement
-- used to raise "derived an empty ladder" in that case, which left the event
-- RUNNING forever at its winner. The terminal guard and receipt already accept
-- prize_pool = 0 with no place payouts, and bounties settle through their own
-- authority, so the only blocker was this refusal.
--
-- Rule after this change: an empty ladder is accepted only when the locked,
-- finalized prize pool is exactly 0. Any positive pool with an empty ladder
-- still refuses (23514), and the earlier checks still require the pool to be
-- finalized, so an unfunded pool while windows are open never pays.
-- @live-proof: position('jsonb_array_length(v_ladder) = 0 AND v_t.prize_pool <> 0 THEN' in pg_get_functiondef('public.fn_settle_tournament_places(uuid,uuid)'::regprocedure)) > 0
BEGIN;

DO $migration$
DECLARE
  v_old text := 'IF jsonb_array_length(v_ladder) = 0 THEN
    RAISE EXCEPTION ''tournament % derived an empty ladder''';
  v_new text := 'IF jsonb_array_length(v_ladder) = 0 AND v_t.prize_pool <> 0 THEN
    RAISE EXCEPTION ''tournament % derived an empty ladder''';
  v_def text;
  v_out text;
BEGIN
  v_def := pg_get_functiondef('public.fn_settle_tournament_places(uuid,uuid)'::regprocedure);
  IF position(v_new IN v_def) > 0 THEN
    RETURN; -- already applied
  END IF;
  IF (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_settle_tournament_places: expected exactly one empty-ladder refusal to amend';
  END IF;
  v_out := replace(v_def, v_old, v_new);
  EXECUTE v_out;
END
$migration$;

COMMIT;
