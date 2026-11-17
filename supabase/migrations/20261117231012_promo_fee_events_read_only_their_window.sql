-- @live-proof: position('a.created_at>=p_from - interval ''1 hour''' in pg_get_functiondef('public.fn_ca_promo_fee_events(uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure)) > 0
-- 20261117231012_promo_fee_events_read_only_their_window.sql
--
-- Version chosen at 23:10Z (new-migration.mjs timed out under load); the version-collision check gates it.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Since 20:00Z on 2026-11-17, LightningHandHost.post_commit_obligations_pending
-- fired 576 times in three hours: fn_ca_process_hand_post_commit_obligations
-- was cancelled by the 8 s statement timeout. The hand's rake_attributions rows
-- fire Promo Play Through's deferred triggers (ca_promo_fee_notice,
-- ca_promo_profit_original_cash_fee), which call fn_ca_promo_play_through_state
-- and fn_ca_promo_profit_settle, both of which read fn_ca_promo_fee_events.
-- 300 of the 304 players holding an open grant are Horses with long histories.
--
-- fn_ca_promo_fee_events read a player's ENTIRE rake_attributions history in its
-- MATERIALIZED cash CTE and only then kept rows with earned_at >= p_from. The
-- other sources are already bounded by p_from. The cost grew with every hand the
-- player had ever played (ca_promo_cash_hand_clocks: 26,149 seq scans reading
-- 381M rows), so the post-commit obligations crossed their budget.
--
-- The cash CTE now also requires a.created_at >= p_from - interval '1 hour', a
-- sargable bound served by idx_rake_attributions_player_id (player_id,
-- created_at DESC). It is a pure superset of the rows the outer filter keeps:
-- earned_at = COALESCE(clock accepted_at, committed_at, created_at), and on
-- production the clock is never later than the rake row (max lag -0.145 s) and
-- the commit at most 0.32 s later, so earned_at >= p_from implies
-- created_at >= p_from - 0.32 s. The answer cannot change.
--
-- Measured on production in a rolled-back transaction, for the heaviest open
-- grant (76,554 rake rows of history), window = last 3 days:
--   before: 4,877 ms, 1,651 rows      after: 22 ms, 1,651 rows, identical md5
--
-- No money moves and no row is written. Guarded single-anchor amendment over the
-- live definition, re-read after rewrite, idempotent.

BEGIN;

DO $migration$
DECLARE
  v_fn regprocedure := 'public.fn_ca_promo_fee_events(uuid,uuid,timestamp with time zone,timestamp with time zone)'::regprocedure;
  v_anchor text := 'WHERE a.player_id=p_user AND a.club_id=p_club AND (a.created_at<p_to';
  v_new text := 'WHERE a.player_id=p_user AND a.club_id=p_club AND a.created_at>=p_from - interval ''1 hour'' AND (a.created_at<p_to';
  v_marker text := 'a.created_at>=p_from - interval ''1 hour''';
  v_def text;
  v_n int;
BEGIN
  v_def := pg_get_functiondef(v_fn);
  IF position(v_marker in v_def) > 0 THEN
    RAISE NOTICE 'already applied';
  ELSE
    v_n := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'anchor found % times in fn_ca_promo_fee_events, expected 1', v_n;
    END IF;
    EXECUTE replace(v_def, v_anchor, v_new);
    IF position(v_marker in pg_get_functiondef(v_fn)) = 0 THEN
      RAISE EXCEPTION 'rewrite of fn_ca_promo_fee_events did not land';
    END IF;
  END IF;
END
$migration$;

COMMIT;
