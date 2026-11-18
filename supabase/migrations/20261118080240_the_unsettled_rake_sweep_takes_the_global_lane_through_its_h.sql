-- 20261118080240_the_unsettled_rake_sweep_takes_the_global_lane_through_its_h.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Incident 758cd269 (2026-11-18 06:16 UTC) replayed the August file
-- 20260826_tournament_rake_settlement_integrity.sql. 20261118071742 restored
-- public.fn_sweep_unsettled_tournament_rake from the newest FILE that defines
-- it, 20260909014534. But the live body was never that file's text:
-- 20260910035435 (the settlement lane is per tournament) rewrote it IN PLACE
-- with a DO block, replacing its direct exclusive lock on the global lane
-- ('ca:tournament-terminal-settlement:v1') with
-- PERFORM public.fn_ca_lock_settlement_lane_global(). No file carries the
-- rewritten body, so a file-based restore cannot find it.
--
-- Measured on production 2026-11-18 08:01 UTC: fn_ca_settlement_lane_doctrine()
-- answers ok=false, g_exclusive_only_by_helpers found
-- fn_sweep_unsettled_tournament_rake, and the sweep holds exactly one raw
-- global lock site. The difference is behavioural, not cosmetic: the helper
-- also takes the hand-settlement barrier ('ca:hand-settlement-barrier:v1'),
-- and inside a non-satellite finish it re-enters the finish lane instead of
-- requesting G exclusively, which would upgrade a shared hold (the 2026-09-10
-- deadlock). The sweep has no caller today (no cron job, no function, no
-- engine code), so nothing has run with the wrong body.
--
-- This applies exactly the 20260910035435 rewrite to this one function, with
-- the same refusals: exactly one raw site, the rewrite must change the body,
-- and no direct use of the global key may remain. Then it asks the doctrine
-- itself and refuses to commit unless it answers ok.

BEGIN;

DO $rewrite$
DECLARE
  v_excl CONSTANT text :=
    'PERFORM\s+pg_advisory_xact_lock\(\s*hashtextextended\(\s*''ca:tournament-terminal-settlement:v1''\s*,\s*0\s*\)\s*\)\s*;';
  v_oid oid;
  v_def text;
  v_new text;
  v_hits integer;
  v_doctrine jsonb;
BEGIN
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'fn_sweep_unsettled_tournament_rake';
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'sweep lane rewrite refused: public.fn_sweep_unsettled_tournament_rake does not exist';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'fn_sweep_unsettled_tournament_rake') <> 1 THEN
    RAISE EXCEPTION 'sweep lane rewrite refused: the sweep is overloaded; one body expected';
  END IF;

  v_def := pg_get_functiondef(v_oid);
  SELECT count(*) INTO v_hits FROM regexp_matches(v_def, v_excl, 'g');

  IF v_hits = 0 AND v_def LIKE '%PERFORM public.fn_ca_lock_settlement_lane_global();%' THEN
    -- Already takes the lane through its helper: nothing to do.
    RETURN;
  END IF;
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'sweep lane rewrite refused: % raw global lock sites, expected exactly 1', v_hits;
  END IF;

  v_new := regexp_replace(v_def, v_excl, 'PERFORM public.fn_ca_lock_settlement_lane_global();');
  IF v_new = v_def THEN
    RAISE EXCEPTION 'sweep lane rewrite refused: rewrite changed nothing';
  END IF;
  IF v_new LIKE '%ca:tournament-terminal-settlement:v1''%' THEN
    RAISE EXCEPTION 'sweep lane rewrite refused: the sweep still takes the global key directly';
  END IF;
  EXECUTE v_new;

  v_doctrine := public.fn_ca_settlement_lane_doctrine();
  IF COALESCE((v_doctrine ->> 'ok')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'sweep lane rewrite refused: the lane doctrine still fails: %', v_doctrine;
  END IF;
END;
$rewrite$;

-- CREATE OR REPLACE keeps the ACL; restate it so a fresh apply is right too.
REVOKE ALL ON FUNCTION public.fn_sweep_unsettled_tournament_rake(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_sweep_unsettled_tournament_rake(integer, integer) TO service_role;

COMMIT;
