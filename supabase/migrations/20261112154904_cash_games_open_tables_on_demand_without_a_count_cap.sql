-- 20261112154904_cash_games_open_tables_on_demand_without_a_count_cap.sql
-- @live-proof: (to_regprocedure('public.fn_cash_cluster_tick(uuid,integer,boolean)') IS NOT NULL AND to_regprocedure('public.fn_cash_clusters_tick_all(jsonb,boolean)') IS NOT NULL AND position('(p_uncapped OR v_live_tables < v_table_cap)' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer,boolean)'::regprocedure)) > 0 AND position('v_live_tables < v_table_cap' in pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure)) > 0 AND position('table_refused_unused_tables' in pg_get_functiondef('public.fn_cluster_table_ceiling()'::regprocedure)) > 0)
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
--   2. Under that, the tick never opened past cap_mains + 1 (+1 with a second
--      feeder): a per-game count, nine for every Classic game.
--   3. trg_tables_cluster_table_ceiling refused ANY new table of a game
--      holding cap_mains + 4 live tables, whoever asked for it.
--
-- HOW THE DATABASE AND ENGINE STAY IN STEP (the compatibility contract).
-- The engine that stops withholding horses from secondary tables (same pull
-- request) is the only caller of the UNCAPPED tick. This file ADDS an overload
-- of each tick with a required p_uncapped boolean, built from production's own
-- definition by checked text replacement; the existing two functions are not
-- touched. An engine that does not pass p_uncapped (every engine serving
-- before this pull request) resolves to the untouched originals, by named
-- arguments over PostgREST and by arity inside SQL, and keeps today's
-- behaviour exactly. So the order in which this file and that engine arrive
-- does not matter, and rolling the engine back restores the old behaviour
-- with nothing to undo here. Ordinary migration: no exclusive lock (new
-- functions, a trigger FUNCTION body), installed on merge, so the engine's
-- release-gate door check finds it before the engine ships.
--
-- With p_uncapped true: no table count of any kind (not the 0.2x cut, not the
-- picks, not cap_mains); the OPEN rule still decides - every table full,
-- enough buyers, one table opening at a time, two minutes after an abandoned
-- feeder - and the consolidation rule still breaks tables the players fit
-- without.
--
-- The ceiling trigger becomes a RUNAWAY GUARD measured in demand: a game that
-- already holds two live or opening, not-closed tables with nobody seated and
-- no seat held for anyone cannot need a third; that insert is refused and
-- recorded ('table_refused_unused_tables'). No game with players is capped.
--
-- Kept, because they are not counts of tables: cash_games_one_per_key (one
-- enabled must-move DEFINITION per club, variant, stakes and template - a
-- duplicate-game guard; any number of tables still open under it).
--
-- ONE transaction (CLAUDE.md, production DDL policy). Every replacement is
-- checked against production's text first; any drift changes nothing.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

DO $patch$
DECLARE
  original text;
  patched text;
  hdr text := $t$CREATE OR REPLACE FUNCTION public.fn_cash_cluster_tick(p_game_id uuid, p_eligible_horses integer DEFAULT 0)$t$;
  cap_from text := $t$  v_table_cap := g.cap_mains + 1;
$t$;
  cap_to text := $t$  IF v_plo_lifecycle THEN v_table_cap := greatest(v_table_cap, 2); END IF;
$t$;
  open_gate text := $t$     AND v_live_tables < v_table_cap
$t$;
  over_cap text := $t$    v_over_cap := (SELECT count(*) FROM unnest(v_census) c
                    WHERE c.lifecycle IN ('live', 'opening') AND NOT c.breaking) > v_table_cap;$t$;
  all_hdr text := $t$CREATE OR REPLACE FUNCTION public.fn_cash_clusters_tick_all(p_eligible jsonb DEFAULT '{}'::jsonb)$t$;
  all_call text := $t$      v_res := public.fn_cash_cluster_tick(w.game_id, v_eligible);$t$;
  a integer;
  b integer;
BEGIN
  SELECT pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) INTO original;
  IF (length(original) - length(replace(original, hdr, ''))) / length(hdr) <> 1
     OR (length(original) - length(replace(original, cap_from, ''))) / length(cap_from) <> 1
     OR (length(original) - length(replace(original, cap_to, ''))) / length(cap_to) <> 1
     OR (length(original) - length(replace(original, open_gate, ''))) / length(open_gate) <> 1
     OR (length(original) - length(replace(original, over_cap, ''))) / length(over_cap) <> 1
     OR position('p_uncapped' IN original) > 0 THEN
    RAISE EXCEPTION 'cash_table_count_cap_preimage_changed' USING ERRCODE = '55000';
  END IF;
  a := position(cap_from IN original);
  b := position(cap_to IN original) + length(cap_to);
  IF b <= a OR b - a > 2500 THEN
    RAISE EXCEPTION 'cash_table_count_cap_block_shape_changed' USING ERRCODE = '55000';
  END IF;
  patched := substr(original, 1, a - 1)
    || $t$  -- ZERO RESTRICTIONS ON THE GAMES THAT CAN BE OPEN (Dan 2026-11-11,
  -- 20261112154904). Called with p_uncapped true (only by the engine that
  -- seats every secondary table), no count limits how many tables a game
  -- holds: the OPEN rule below and the consolidation rule decide.
  IF p_uncapped THEN
    v_table_cap := NULL;
  ELSE
$t$
    || substr(original, a, b - a)
    || $t$  END IF;
$t$
    || substr(original, b);
  patched := replace(patched, open_gate, $t$     AND (p_uncapped OR v_live_tables < v_table_cap)
$t$);
  patched := replace(patched, over_cap,
    $t$    v_over_cap := NOT p_uncapped AND (SELECT count(*) FROM unnest(v_census) c
                    WHERE c.lifecycle IN ('live', 'opening') AND NOT c.breaking) > v_table_cap;$t$);
  patched := replace(patched, hdr,
    $t$CREATE OR REPLACE FUNCTION public.fn_cash_cluster_tick(p_game_id uuid, p_eligible_horses integer, p_uncapped boolean)$t$);
  EXECUTE patched;

  SELECT pg_get_functiondef('public.fn_cash_clusters_tick_all(jsonb)'::regprocedure) INTO original;
  IF (length(original) - length(replace(original, all_hdr, ''))) / length(all_hdr) <> 1
     OR (length(original) - length(replace(original, all_call, ''))) / length(all_call) <> 1
     OR position('p_uncapped' IN original) > 0 THEN
    RAISE EXCEPTION 'cash_tick_all_preimage_changed' USING ERRCODE = '55000';
  END IF;
  patched := replace(original, all_hdr,
    $t$CREATE OR REPLACE FUNCTION public.fn_cash_clusters_tick_all(p_eligible jsonb, p_uncapped boolean)$t$);
  patched := replace(patched, all_call,
    $t$      v_res := public.fn_cash_cluster_tick(w.game_id, v_eligible, p_uncapped);$t$);
  EXECUTE patched;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer,boolean) TO service_role;
REVOKE ALL ON FUNCTION public.fn_cash_clusters_tick_all(jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_clusters_tick_all(jsonb,boolean) TO service_role;

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
  -- players for. A game already holding two live or opening, not-closed tables
  -- with nobody seated and no seat held for anyone cannot need a third; that
  -- insert is refused and recorded.
  SELECT count(*) INTO v_unused
    FROM public.tables t
   WHERE t.cluster_id = NEW.cluster_id
     AND coalesce(t.is_deleted, false) = false
     AND t.lifecycle IN ('live', 'opening')
     AND coalesce(t.status, '') <> 'closed'
     AND NOT EXISTS (SELECT 1 FROM public.table_seats s
                      WHERE s.table_id = t.id AND s.left_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.table_waitlist w
                      WHERE w.table_id = t.id AND w.status = 'notified'
                        AND (w.hold_expires_at IS NULL OR w.hold_expires_at > now()));
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
