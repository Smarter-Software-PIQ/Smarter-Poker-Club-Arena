-- 20261124003437_every_main_table_feeds_upward_from_higher_mains_and_feeders.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- EVERY MAIN TABLE FEEDS UPWARD FROM HIGHER MAINS AND FEEDERS
--
-- THE DEFECT, OBSERVED LIVE (2026-11-23, NLH 1/2 Classic 9-Max):
--   Main 1: 9/9, Main 2: 5/9 (4 open seats), Main 3: 9/9 (full), Feeder: 6/9.
--   Main 2 sat at 5/9 with four open seats while Main 3 stayed full at 9/9.
--
-- THE CAUSE, BY LINE:
--   Step 2 (MUST-MOVE) of public.fn_cash_cluster_tick_uncapped(uuid,integer)
--   restricted cross-Main feeding to Main 1 alone:
--
--     AND (c.role = 'feeder' OR c.breaking OR (t.main_index = 1 AND c.id <> t.id))
--     AND c.id <> t.id
--
--   So:
--     1. Main 1 drained Main 2 (because Main 2 players sit at the top of the
--        Must Move List, ahead of Main 3).
--     2. Main 2 (t.main_index = 2) could only draw from the Feeder or a
--        breaking table - never from Main 3.
--     3. On 9-max, the Feeder was gated below 7 players (handedness - 2), and
--        newcomers are routed to the Feeder while a feeder is live, so Main 2
--        remained short-handed while Main 3 stayed 9/9.
--
-- THE RULE (Dan, 2026-11-23, verbatim):
--   "GAMES ALL FEED UPWARDS. TABLE 1 MAIN GAME ALWAYS FULL, TABLE 2 2ND GAME,
--   ALWAYS FULL, THEN SO ON AND SO ON. TABLE 4 FEEDS 3,2,1 IN THAT ORDER."
--   "THIS NEEDS TO BE LIKE THIS FOR EVERY FEEDER GAME ON THE PLATFORM. MAKE
--   THIS CORRECTION GLOBALLY FOR ALL FEEDER GAMES"
--
-- WHAT THIS CHANGES (one bounded transaction, sole cluster tick):
--   Anchored edit of public.fn_cash_cluster_tick_uncapped(uuid,integer) Step 2
--   so EVERY live Main N (not only Main 1) draws from any higher-numbered Main
--   (c.role = 'main' AND c.main_index > t.main_index) in addition to the Feeder
--   and any breaking table. Lower-numbered Mains are never drawn from, so play
--   feeds strictly upward: Feeder -> Main K -> ... -> Main 3 -> Main 2 -> Main 1.
--   Applies globally to every must-move / feeder cash game on the platform
--   (Classic and Lightning-in-must_move-mode, 6-max and 9-max, any table count).
--   The full-ring 7-player feeder gate still applies only to the Feeder
--   (c.role = 'feeder'), never blocking Main 3 -> Main 2 -> Main 1 upward flow.
--   No money path, balance, seat-move executor or engine restart is needed.
--
-- Proof: scripts/dev/prove-every-main-table-feeds-upward.sh
-- Law: tests/every-main-table-feeds-upward.law.test.ts
--
-- @live-proof: (SELECT pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure) LIKE '%(c.role = ''main'' AND c.main_index > t.main_index)%' AND pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure) LIKE '%EVERY MAIN FEEDS UPWARDS%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

DO $cascade_tick$
DECLARE
  v_oid     oid := 'public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure;
  v_before  text;
  v_after   text;
  v_catalog record;
  v_old     text :=
$o$         AND (c.role = 'feeder' OR c.breaking OR (t.main_index = 1 AND c.id <> t.id))
         AND c.id <> t.id$o$;
  v_new     text :=
$r$         -- EVERY MAIN FEEDS UPWARDS (Dan 2026-11-23): Table 1 (Main 1) stays
         -- full first, then Table 2 (Main 2), then Main 3, ...; every Main N
         -- draws from higher-numbered Mains (Main N+1..K), the Feeder and any
         -- breaking table, never downward from a lower-numbered Main.
         AND (c.role = 'feeder' OR c.breaking OR (t.main_index = 1 AND c.id <> t.id) OR (c.role = 'main' AND c.main_index > t.main_index))
         AND c.id <> t.id$r$;
BEGIN
  SELECT pg_get_functiondef(v_oid) INTO v_before;
  SELECT proowner, proacl, proconfig, prosecdef, provolatile
    INTO v_catalog
    FROM pg_proc
   WHERE oid = v_oid;

  IF position('EVERY MAIN FEEDS UPWARDS' IN v_before) > 0
     OR position('(c.role = ''main'' AND c.main_index > t.main_index)' IN v_before) > 0 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped already cascades upward across Mains: re-read before editing';
  END IF;

  IF (length(v_before) - length(replace(v_before, v_old, ''))) / length(v_old) <> 1 THEN
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped Step 2 source-table anchor was expected exactly once';
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
    RAISE EXCEPTION 'fn_cash_cluster_tick_uncapped upward-cascade edit changed unrelated source or authority';
  END IF;
END
$cascade_tick$;

DO $verify_uncapped$
DECLARE
  v_def text := pg_get_functiondef('public.fn_cash_cluster_tick_uncapped(uuid,integer)'::regprocedure);
BEGIN
  IF position('(c.role = ''main'' AND c.main_index > t.main_index)' IN v_def) = 0
     OR position('EVERY MAIN FEEDS UPWARDS' IN v_def) = 0 THEN
    RAISE EXCEPTION 'the upward must-move cascade did not install cleanly in fn_cash_cluster_tick_uncapped';
  END IF;
END
$verify_uncapped$;

-- @probe-for: public.fn_cash_cluster_tick_uncapped
DO $probe_uncapped$
BEGIN
  PERFORM public.fn_cash_cluster_tick_uncapped(gen_random_uuid(), NULL);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe_uncapped$;

COMMIT;
