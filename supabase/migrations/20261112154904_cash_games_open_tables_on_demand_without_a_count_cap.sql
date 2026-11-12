-- 20261112154904_cash_games_open_tables_on_demand_without_a_count_cap.sql
-- @install-window: daily-maintenance
-- @live-proof: (position('v_live_tables < v_table_cap' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) = 0 AND position('ZERO RESTRICTIONS ON THE GAMES THAT CAN BE OPEN' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0 AND position('table_refused_unused_tables' in pg_get_functiondef('public.fn_cluster_table_ceiling()'::regprocedure)) > 0)
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
-- Three count limits stood between demand and a table:
--   1. fn_cash_cluster_tick cut every game to greatest(1, floor((cap_mains+1)
--      * 0.2)) = ONE table (October 26 0.5x, November 2 0.2x: the rake
--      throttle), lifted to two or three only on a three-hourly hash pick.
--   2. Under that, the tick still never opened past cap_mains + 1 (+1 with a
--      second feeder): a per-game count, nine for every Classic game.
--   3. trg_tables_cluster_table_ceiling refused ANY new table of a game
--      holding cap_mains + 4 live tables, whoever asked for it.
-- All three are counts, not demand, so all three go.
--
-- What still decides that a table opens (unchanged): the OPEN rule - every
-- live table full, enough buyers on the list or eligible horses, one table
-- opening at a time, two minutes after an abandoned feeder - and the
-- consolidation rule still breaks tables the players fit without. What
-- replaces the ceiling trigger is a RUNAWAY GUARD measured in demand, not a
-- count: a game that already holds two live or opening tables with nobody
-- seated cannot need a third, so that insert is refused and recorded
-- ('table_refused_unused_tables'). No game can loop open/close, and no game
-- with players is ever capped.
--
-- Kept, because they are not counts of tables: cash_games_one_per_key (one
-- enabled must-move DEFINITION per club, variant, stakes and template - a
-- duplicate-game guard; any number of tables still open under it), the
-- cap_mains / allow_second_feeder columns (now read by nothing here; kept for
-- the lobby and history), fn_cash_game_second/third_table_picked (other
-- readers, qualification fixtures).
--
-- It installs inside the daily engine break together with the engine that
-- stops withholding horses from secondary tables (same pull request), so the
-- database never opens tables the serving engine will not fill.
--
-- Wrap ALL DDL for one change in ONE transaction (CLAUDE.md, production DDL
-- policy). The preimage is checked: if production's tick no longer carries
-- the exact text below, nothing is changed.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $patch$
DECLARE
  original text;
  patched text;
  cap_from text := $t$  v_table_cap := g.cap_mains + 1;
$t$;
  cap_to text := $t$  IF v_plo_lifecycle THEN v_table_cap := greatest(v_table_cap, 2); END IF;
$t$;
  open_gate text := $t$     AND v_live_tables < v_table_cap
$t$;
  over_cap text := $t$    v_over_cap := (SELECT count(*) FROM unnest(v_census) c
                    WHERE c.lifecycle IN ('live', 'opening') AND NOT c.breaking) > v_table_cap;$t$;
  a integer;
  b integer;
BEGIN
  SELECT pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) INTO original;
  IF (length(original) - length(replace(original, cap_from, ''))) / length(cap_from) <> 1
     OR (length(original) - length(replace(original, cap_to, ''))) / length(cap_to) <> 1
     OR (length(original) - length(replace(original, open_gate, ''))) / length(open_gate) <> 1
     OR (length(original) - length(replace(original, over_cap, ''))) / length(over_cap) <> 1
     OR position('ZERO RESTRICTIONS ON THE GAMES THAT CAN BE OPEN' IN original) > 0 THEN
    RAISE EXCEPTION 'cash_table_count_cap_preimage_changed' USING ERRCODE = '55000';
  END IF;
  a := position(cap_from IN original);
  b := position(cap_to IN original) + length(cap_to);
  IF b <= a OR b - a > 2500 THEN
    RAISE EXCEPTION 'cash_table_count_cap_block_shape_changed' USING ERRCODE = '55000';
  END IF;
  patched := substr(original, 1, a - 1)
    || $t$  -- ZERO RESTRICTIONS ON THE GAMES THAT CAN BE OPEN (Dan 2026-11-11,
  -- 20261112154904). No count limits how many tables a game holds: not the
  -- retired 0.2x supply cut, not the second/third-table picks, not cap_mains.
  -- The OPEN rule below (every table full, enough buyers, one opening at a
  -- time) and the consolidation rule decide; trg_tables_cluster_table_ceiling
  -- refuses only a third UNUSED table (runaway guard, not a count).
  v_table_cap := NULL;
$t$
    || substr(original, b);
  patched := replace(patched, open_gate, '');
  patched := replace(patched, over_cap,
    $t$    -- No count cap since 20261112154904: nothing is "over" it.
    v_over_cap := false;$t$);
  EXECUTE patched;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_cluster_table_ceiling()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unused integer;
BEGIN
  IF NEW.cluster_id IS NULL THEN RETURN NEW; END IF;
  -- RUNAWAY GUARD, NOT A COUNT (20261112154904). The fixed ceiling
  -- (cap_mains + 4 live tables) is gone: a game opens as many tables as it has
  -- players for. A game already holding two live or opening tables with
  -- nobody seated cannot need a third; that insert is refused and recorded.
  SELECT count(*) INTO v_unused
    FROM public.tables t
   WHERE t.cluster_id = NEW.cluster_id
     AND coalesce(t.is_deleted, false) = false
     AND t.lifecycle IN ('live', 'opening')
     AND NOT EXISTS (SELECT 1 FROM public.table_seats s
                      WHERE s.table_id = t.id AND s.left_at IS NULL);
  IF v_unused >= 2 THEN
    INSERT INTO public.cash_cluster_events (game_id, kind, payload)
    VALUES (NEW.cluster_id, 'table_refused_unused_tables',
            jsonb_build_object('unused', v_unused, 'role', NEW.role,
                               'main_index', NEW.main_index));
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;
COMMIT;
