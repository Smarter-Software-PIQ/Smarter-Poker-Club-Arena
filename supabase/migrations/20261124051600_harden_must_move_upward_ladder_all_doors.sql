-- 20261124051600_harden_must_move_upward_ladder_all_doors.sql
--
-- HARDEN THE UPWARD MUST-MOVE LADDER ACROSS ALL ENTRY AND SEAT-CHANGE DOORS
--
-- WHY THIS EXISTS (post-fix hardening audit after 20261124003437):
--   Migration 20261124003437 fixed Step 2 (MUST-MOVE) of
--   public.fn_cash_cluster_tick_uncapped(uuid,integer) so every Main N draws
--   upward from higher-numbered Mains (Main N+1..K), the Feeder and breaking
--   tables across every feeder game on the platform.
--
--   A full end-to-end audit of every other door that can seat a player onto an
--   open Main chair found two remaining bypasses of the upward ladder:
--
--   1. public.fn_cash_main_chair_is_the_lists(uuid) (20261108193515):
--      Carried `AND coalesce(cg.handedness, 9) >= 7`, reserving open Main chairs
--      exclusively for the must-move list only on 7-9 handed games. On every
--      6-max feeder game, a cash-out waitlist offer (`fn_offer_open_seat`), a
--      `Join Game` click (`fn_cash_game_join`), or a direct buy-in tap could
--      still seat a newcomer straight into Main 1 or Main 2 ahead of players
--      already seated on Main 2/Main 3/Feeder on the Must Move List. Removing
--      the handedness exemption closes that bypass globally for 6-max and
--      full-ring alike while leaving 6-max heads-up feeder opening and move-up
--      rules untouched.
--
--   2. public.fn_cash_seat_change_plan(uuid, timestamp with time zone):
--      Only excluded `v_front` (Main 1) when taking an open chair. Because
--      `fn_cash_seat_change_request` calls `fn_cash_seat_change_plan`
--      synchronously and the tick calls it right after Step 2, a player at the
--      bottom of the Must Move List on a Feeder (including a 9-max Feeder held
--      below the 7-player gate) or on Main 3 could request a seat change and
--      jump straight into an open chair on Main 2 or Main 3, bypassing both
--      must-move order and the 7-player Feeder gate. Blocking upward open-chair
--      seat changes into any Main (`c.role = 'main'` from a Feeder or higher
--      Main `src.main_index > c.main_index`) closes that bypass while keeping
--      downward/lateral seat changes, feeder-to-feeder changes, and two-way
--      swaps intact.
--
-- No money path, balance write, or engine restart is required. Nothing reads
-- `is_horse`. One bounded transaction with catalog/reversibility guards and
-- rollback probes for both functions.
--
-- Proof: scripts/dev/prove-every-main-table-feeds-upward.sh
-- Law: tests/every-main-table-feeds-upward.law.test.ts
--
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure) LIKE '%ALL FEEDER GAMES%' AND pg_get_functiondef('public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure) NOT LIKE '%coalesce(cg.handedness, 9) >= 7%')
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure) LIKE '%NEVER SEAT-CHANGE UPWARD INTO A MAIN%' AND pg_get_functiondef('public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure) LIKE '%src.main_index > c.main_index%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

-- 1. Reserve open Main chairs for the must-move list on ALL feeder games (6-max and 9-max).
DO $harden_main_chair$
DECLARE
  v_oid     oid := 'public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure;
  v_before  text;
  v_after   text;
  v_catalog record;
  v_old     text := $o$       AND coalesce(cg.handedness, 9) >= 7$o$;
  v_new     text :=
$r$       -- ALL FEEDER GAMES (6-max and 9-max, Dan 2026-11-23): while any live
       -- or opening feeder exists, open Main chairs belong strictly to the
       -- must-move list so newcomers and waitlist offers never jump the line.$r$;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_before;
  SELECT proowner, proacl, proconfig, prosecdef, provolatile
    INTO v_catalog
    FROM pg_proc
   WHERE oid = v_oid;

  IF position('ALL FEEDER GAMES' IN v_before) > 0 THEN
    RAISE EXCEPTION 'fn_cash_main_chair_is_the_lists is already hardened for all feeder games: re-read before editing';
  END IF;

  IF (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_main_chair_is_the_lists handedness anchor was expected exactly once';
  END IF;

  v_after := replace(v_before, v_old, v_new);
  EXECUTE v_after;

  IF replace(pg_get_functiondef(v_oid), v_new, v_old) <> v_before
     OR EXISTS (
       SELECT 1 FROM pg_proc
        WHERE oid = v_oid
          AND (proowner IS DISTINCT FROM v_catalog.proowner
               OR proacl IS DISTINCT FROM v_catalog.proacl
               OR proconfig IS DISTINCT FROM v_catalog.proconfig
               OR prosecdef IS DISTINCT FROM v_catalog.prosecdef
               OR provolatile IS DISTINCT FROM v_catalog.provolatile)
     ) THEN
    RAISE EXCEPTION 'fn_cash_main_chair_is_the_lists edit changed unrelated source or authority';
  END IF;
END
$harden_main_chair$;

DO $verify_main_chair$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_main_chair_is_the_lists(uuid)'::regprocedure);
BEGIN
  IF position('ALL FEEDER GAMES' IN v_def) = 0
     OR position('coalesce(cg.handedness, 9) >= 7' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_cash_main_chair_is_the_lists hardening did not install cleanly';
  END IF;
END
$verify_main_chair$;

-- @probe-for: public.fn_cash_main_chair_is_the_lists
DO $probe_main_chair$
BEGIN
  PERFORM public.fn_cash_main_chair_is_the_lists(gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_main_chair$;

-- 2. Forbid open-chair seat changes upward into any Main table.
DO $harden_seat_change$
DECLARE
  v_oid     oid := 'public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure;
  v_before  text;
  v_after   text;
  v_catalog record;
  v_old     text :=
$o$     WHERE c.id <> r.from_table_id AND NOT c.breaking AND c.lifecycle IN ('live', 'opening')
       AND c.id IS DISTINCT FROM v_front
       AND (r.to_table_id IS NULL OR c.id = r.to_table_id)$o$;
  v_new     text :=
$r$     WHERE c.id <> r.from_table_id AND NOT c.breaking AND c.lifecycle IN ('live', 'opening')
       AND c.id IS DISTINCT FROM v_front
       -- NEVER SEAT-CHANGE UPWARD INTO A MAIN (Dan 2026-11-23): open chairs
       -- on any Main fill strictly upward in must-move order (and honor the
       -- full-ring feeder gate). A seat change onto an open chair cannot jump
       -- from a Feeder or higher-numbered Main into a lower-numbered Main.
       AND NOT EXISTS (
         SELECT 1 FROM unnest(v_census) src
          WHERE src.id = r.from_table_id
            AND c.role = 'main'
            AND (src.role = 'feeder' OR (src.role = 'main' AND src.main_index > c.main_index))
       )
       AND (r.to_table_id IS NULL OR c.id = r.to_table_id)$r$;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_before;
  SELECT proowner, proacl, proconfig, prosecdef, provolatile
    INTO v_catalog
    FROM pg_proc
   WHERE oid = v_oid;

  IF position('NEVER SEAT-CHANGE UPWARD INTO A MAIN' IN v_before) > 0 THEN
    RAISE EXCEPTION 'fn_cash_seat_change_plan already blocks upward Main seat changes: re-read before editing';
  END IF;

  IF (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_seat_change_plan open-chair destination anchor was expected exactly once';
  END IF;

  v_after := replace(v_before, v_old, v_new);
  EXECUTE v_after;

  IF replace(pg_get_functiondef(v_oid), v_new, v_old) <> v_before
     OR EXISTS (
       SELECT 1 FROM pg_proc
        WHERE oid = v_oid
          AND (proowner IS DISTINCT FROM v_catalog.proowner
               OR proacl IS DISTINCT FROM v_catalog.proacl
               OR proconfig IS DISTINCT FROM v_catalog.proconfig
               OR prosecdef IS DISTINCT FROM v_catalog.prosecdef
               OR provolatile IS DISTINCT FROM v_catalog.provolatile)
     ) THEN
    RAISE EXCEPTION 'fn_cash_seat_change_plan edit changed unrelated source or authority';
  END IF;
END
$harden_seat_change$;

DO $verify_seat_change$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_seat_change_plan(uuid,timestamp with time zone)'::regprocedure);
BEGIN
  IF position('NEVER SEAT-CHANGE UPWARD INTO A MAIN' IN v_def) = 0
     OR position('src.main_index > c.main_index' IN v_def) = 0
     OR position('cluster_mode IS DISTINCT FROM ''must_move''' IN v_def) = 0
     OR position('is_horse' IN v_def) > 0 THEN
    RAISE EXCEPTION 'fn_cash_seat_change_plan hardening did not install cleanly';
  END IF;
END
$verify_seat_change$;

-- @probe-for: public.fn_cash_seat_change_plan
DO $probe_seat_change$
BEGIN
  PERFORM public.fn_cash_seat_change_plan(gen_random_uuid());
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_seat_change$;

COMMIT;
