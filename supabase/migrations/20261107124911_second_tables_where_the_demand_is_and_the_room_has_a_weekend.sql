-- 20261107124911_second_tables_where_the_demand_is_and_the_room_has_a_weekend.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY (owner request 2026-11-07 06:46 CST, "GO AHEAD AND
-- FULLY BUILD, FIX AND ENHANCE ALL OF THESE"):
--
-- 1. SECOND TABLES WHERE THE DEMAND IS. fn_cash_game_second_table_picked
--    picked games at random within the hour's rate, so a 5/10 or a Short Deck
--    game was as likely to grow a second table as NLH 0.25/0.50. The rate is
--    now weighted by the game itself:
--      popular (NLH, PLO4/5/6 from 0.25 to 2 big blind)  rate x 1.3 (cap 90)
--      niche  (big blind 5+, or FLH, FLO8, PLO8, Short Deck, Pineapple)  rate / 4
--    in integer arithmetic the engine reproduces exactly.
--
-- 2. THE ROOM HAS A WEEKEND. The hour bands gain two:
--      peak  Friday and Saturday 18:00-23:59, and the early hours of Saturday
--            and Sunday (the same nights) 00:00-03:59  -> 70
--      dawn  Monday to Thursday 04:00-09:59               -> 15
--    beside evening 60, day 50, late 30 and early 20 (Chicago time).
--    HorseBehavior.secondTablePicked is the exact twin.
--
-- Items 3 and 4 of the same request (waiting-list names, live counts) are in
-- 20261107140215, which installs on merge: they need no engine. This file
-- changes the rule the engine mirrors (HorseBehavior.secondTablePicked), so it
-- is dispatched only once an engine containing that mirror is serving.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_cash_game_second_table_picked(uuid,timestamptz)'::regprocedure))
       <> 'eb81a9261dec8260e4539dce66995c62' THEN
    RAISE EXCEPTION 'second_table_demand_preimage_changed' USING ERRCODE = '55000';
  END IF;
END $preimage$;

-- 1 + 2. Which games may hold a second table right now.
CREATE OR REPLACE FUNCTION public.fn_cash_game_second_table_picked(p_game_id uuid, p_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH c AS (
    SELECT extract(hour FROM p_at AT TIME ZONE 'America/Chicago')::int AS h,
           extract(isodow FROM p_at AT TIME ZONE 'America/Chicago')::int AS d
  ), base AS (
    SELECT CASE
             WHEN (c.d IN (5, 6) AND c.h >= 18) OR (c.d IN (6, 7) AND c.h < 4) THEN 70
             WHEN c.h >= 18 THEN 60
             WHEN c.h >= 10 THEN 50
             WHEN c.d BETWEEN 1 AND 4 AND c.h >= 4 THEN 15
             WHEN c.h >= 4 THEN 20
             ELSE 30
           END AS rate
      FROM c
  ), g AS (
    SELECT coalesce(cg.bb, 0)::numeric AS bb, lower(coalesce(cg.variant, '')) AS variant
      FROM public.cash_games cg WHERE cg.id = p_game_id
  ), r AS (
    SELECT CASE
             WHEN g.bb >= 5 OR g.variant IN ('flh', 'flo8', 'plo8', 'short_deck', 'pineapple')
               THEN (base.rate + 2) / 4
             WHEN g.bb BETWEEN 0.25 AND 2 AND g.variant IN ('nlh', 'plo4', 'plo5', 'plo6')
               THEN least(90, (base.rate * 13 + 5) / 10)
             ELSE base.rate
           END AS rate
      FROM base LEFT JOIN g ON true
  )
  SELECT (('x' || lpad(substr(md5(p_game_id::text || ':second_table:'
             || floor(extract(epoch FROM p_at) / 10800)::bigint::text), 1, 8), 16, '0'))::bit(64)::bigint % 100)
         < (SELECT rate FROM r)
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_game_second_table_picked(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_game_second_table_picked(uuid, timestamptz) TO authenticated, service_role;

COMMIT;
