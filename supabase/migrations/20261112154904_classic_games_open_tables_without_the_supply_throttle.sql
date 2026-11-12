-- 20261112154904_classic_games_open_tables_without_the_supply_throttle.sql
-- @install-window: daily-maintenance
-- @live-proof: (position('fn_cash_game_third_table_picked(g.id, v_now)' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) = 0 AND position('ZERO RESTRICTIONS ON THE GAMES THAT CAN BE OPEN' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0)
--
-- Version reserved by scripts/reserve-migration-version.sh.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan, 2026-11-11 17:17 Chicago: "1/2 GAMES NEED TO START BACK UP AND RUNNING
-- FULL TIME AGAIN. I KNOW WE SHUT THEM OFF BECAUSE WE WANTED TO STAY UNDER A
-- 'CERTAIN RAKE AMOUNT'. BUT THAT CHANGES... RELAUNCH ALL THE 1/2 PLO AND
-- HOLDEM CASH GAMES, AND OTHER GAMES WITH ZERO RESTRICTIONS ON THE AMOUNT OF
-- GAMES THAT CAN BE OPEN."
--
-- The rake throttle had two parts. The schedule windows were retired by #10544
-- and #10556. The table-supply cut in fn_cash_cluster_tick was not: since
-- October 26 (0.5x) and November 2 (0.2x) every game's table cap was
-- floor((cap_mains + 1) * 0.2) = ONE table, lifted to two or three only on a
-- three-hourly hash pick (fn_cash_game_second_table_picked / _third_). That is
-- an artificial limit on how many tables a game may open, so it goes.
--
-- A Classic must-move game now opens up to its STRUCTURAL cap, cap_mains + 1
-- (+ 1 with allow_second_feeder): the must-move topology of its mains and
-- feeder, not a throttle. It still opens a table only through the unchanged
-- OPEN rule (a full floor, enough buyers on the list or eligible horses, one
-- table opening at a time, two minutes after an abandoned feeder), and the
-- consolidation break rule still closes tables the players fit without. No
-- table opens without buyers, so there is no open/close loop.
--
-- Lightning keeps its previous allowance exactly (its own controller decides
-- its pool). cash_games_one_per_key (duplicate enabled game definitions) is
-- untouched. fn_cash_game_second_table_picked / _third_ stay installed for
-- their remaining readers (the Lightning allowance, qualification fixtures).
--
-- It installs inside the daily engine break together with the engine that stops
-- withholding horses from secondary Classic tables (same pull request), so the
-- database never opens tables the serving engine will not fill.
--
-- Wrap ALL DDL for one change in ONE transaction (CLAUDE.md, production DDL
-- policy). The preimage is checked: if production's tick no longer carries the
-- exact blocks below, nothing is changed.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $patch$
DECLARE original text; patched text;
  supply_cut text := $old$  -- Owner October 26: halve total table supply at every hour, including feeders.
  v_table_cap := greatest(1, floor(v_table_cap *
     CASE WHEN v_now >= '2026-11-02 00:00:00 America/Chicago'::timestamptz
          THEN 0.2 ELSE 0.5 END)::integer);
  -- SOME GAMES RUN A SECOND TABLE (Dan 2026-11-06). About half the games,
  -- re-chosen per game every three hours, may hold two tables; the OPEN rule
  -- below still requires a full floor and two buyers before it opens one.
  -- Rate by Chicago hour since 2026-11-07: fn_cash_game_second_table_picked.
  IF v_table_cap < 2 AND public.fn_cash_game_second_table_picked(g.id, v_now) THEN
    v_table_cap := 2;
  END IF;
  -- Classic demand may grow to THREE tables; Lightning retains its own controller.
  IF NOT coalesce(g.lightning_enabled, false)
     AND public.fn_cash_game_third_table_picked(g.id, v_now) THEN
    v_table_cap := greatest(v_table_cap, 3);
  END IF;
$old$;
  over_cap_note text := $old$    -- holding more live tables than its cap (v_table_cap carries
    -- fn_cash_game_second_table_picked) breaks its newest table through this
$old$;
BEGIN
  SELECT pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) INTO original;
  IF (length(original) - length(replace(original, supply_cut, ''))) / length(supply_cut) <> 1
     OR (length(original) - length(replace(original, over_cap_note, ''))) / length(over_cap_note) <> 1
     OR position('ZERO RESTRICTIONS ON THE GAMES THAT CAN BE OPEN' IN original) > 0 THEN
    RAISE EXCEPTION 'classic_table_supply_throttle_preimage_changed' USING ERRCODE = '55000';
  END IF;
  patched := replace(original, supply_cut, $new$  -- ZERO RESTRICTIONS ON THE GAMES THAT CAN BE OPEN (Dan 2026-11-11). The
  -- October 26 / November 2 table-supply cut and the second/third-table picks
  -- were the rake throttle he retired: a Classic game may open up to its
  -- structural cap (cap_mains + 1, + 1 with a second feeder), still only
  -- through the OPEN rule below. Lightning keeps its previous allowance.
  IF coalesce(g.lightning_enabled, false) THEN
    v_table_cap := greatest(1, floor(v_table_cap *
       CASE WHEN v_now >= '2026-11-02 00:00:00 America/Chicago'::timestamptz
            THEN 0.2 ELSE 0.5 END)::integer);
    IF v_table_cap < 2 AND public.fn_cash_game_second_table_picked(g.id, v_now) THEN
      v_table_cap := 2;
    END IF;
  END IF;
$new$);
  patched := replace(patched, over_cap_note, $new$    -- holding more live tables than its cap (a Lightning game's allowance, a
    -- Classic game's structural cap since 20261112154904) breaks its newest table through this
$new$);
  EXECUTE patched;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) TO service_role;
COMMIT;
