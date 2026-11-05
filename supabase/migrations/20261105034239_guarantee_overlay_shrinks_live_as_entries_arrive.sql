-- 20261105034239_guarantee_overlay_shrinks_live_as_entries_arrive.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('A GUARANTEE MOVES NO CHIPS UNTIL REGISTRATION CLOSES' in pg_get_functiondef('public.fn_ca_fund_overlay_on_lock()'::regprocedure)) > 0
--
-- A GUARANTEE MOVES NO CHIPS UNTIL REGISTRATION CLOSES (Dan, 2026-11-04)
--
--   "YOU JUST DISPLAY THE 1500 YOU DON'T ACTUALLY ADD ANY CHIPS FOR THE
--    GUARANTEE TO THE PRIZE POOLS, ONLY IF THERE IS AN UNDERLAY DO CHIPS GET
--    ADDED AFTER REGISTRATION CLOSES FOR ANY AND ALL SHORTAGES."
--
-- WHAT WAS WRONG, READ FROM ROWS
--
-- fn_ca_fund_overlay_on_lock moved the shortfall from the union bank into the
-- pool at START, sized on the field present at start, and late entries then
-- landed on top. Wednesday Feature (94ef58cf, 1,500 guaranteed): 1,338 paid
-- in on 6 entries, and the pool read 2,904 once 58 entries had covered the
-- guarantee by themselves. The pool finalization returned the excess later,
-- so finished events paid correctly, but every screen was wrong for the whole
-- late-registration window and the bank's chips sat in pools that did not need
-- them.
--
-- THE FIX
--
-- The close-out (fn_apply_prize_guarantee -> fn_ca_apply_prize_guarantee_core)
-- already does exactly what Dan describes: when the pool finalizes at the end
-- of late registration it brings the pool to max(prize pool, place guarantee),
-- debiting only the shortfall from the union bank (club treasury fallback),
-- journaled once under 'tourney:<id>:guarantee_overlay'. So the start no
-- longer funds anything for an ordinary guarantee: the lock trigger keeps its
-- payout-table work, its Diamond arm, and its satellite seat funding (a
-- satellite's guaranteed seats are not covered by the close-out core), and
-- returns before any chip moves for every other event. Screens show the
-- guarantee as a floor (effectivePrizePool / displayTotalPool on the client).
--
-- Settled already, through rolled-back probes first and asserted amounts:
-- Wednesday Feature 1,338, Late Night PKO 84 and Midweek Mystery 352 returned
-- to the Midway Union bank before any of them finalized; each close-out pays
-- only its real shortfall.
--
-- How: the change is one inserted line in a long trigger function, so it is
-- applied to the installed definition and refuses unless the anchor line
-- appears exactly once, rather than retyping the whole function by hand.

BEGIN;

SET LOCAL lock_timeout = '1s';

DO $migration$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_fund_overlay_on_lock()'::regprocedure);
  v_anchor constant text := E'  IF v_short <= 0 THEN RETURN NEW; END IF;\n';
  v_new text;
BEGIN
  IF position('A GUARANTEE MOVES NO CHIPS UNTIL REGISTRATION CLOSES' IN v_def) > 0 THEN
    RETURN;  -- already installed
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_fund_overlay_on_lock anchor not found exactly once; refusing to patch';
  END IF;
  v_new := replace(v_def, v_anchor, v_anchor
    || E'  /* A GUARANTEE MOVES NO CHIPS UNTIL REGISTRATION CLOSES (Dan, 2026-11-04).\n'
    || E'     The close-out (fn_ca_apply_prize_guarantee_core) pays only the real\n'
    || E'     shortfall when the pool finalizes. Only a satellite''s guaranteed seats,\n'
    || E'     which the close-out does not cover, are still funded here. */\n'
    || E'  IF COALESCE(v_seat_guarantee, 0) <= 0 THEN RETURN NEW; END IF;\n');
  EXECUTE v_new;
END
$migration$;

COMMIT;
