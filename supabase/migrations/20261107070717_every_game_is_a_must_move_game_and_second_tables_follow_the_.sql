-- 20261107070717_every_game_is_a_must_move_game_and_second_tables_follow_the_.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- 1. EVERY GAME IS A MUST-MOVE GAME (Dan 2026-11-07 01:05 CST, verbatim):
--    "NO ALL CLASSIC GAMES ARE ALSO MUST MOVE GAMES. THEY JUST DON'T MOVE TO
--    LIGHTNING. EVERY SINGLE GAME IS A MUST MOVE GAME, IF THEY ARE LABELED AS
--    'LIGHTNING' THEY CONVERT WHEN ENOUGH PLAYERS JOIN."
--
--    This supersedes the 2026-10-24 ruling "PLAYERS SHOULD NOT BE MOVING ON
--    CLASSIC GAMES PERIOD" (20261024213758). That migration routed every
--    Classic exception through ONE definition,
--    public.fn_cash_game_never_moves_players(template, ruleset), read by the
--    cluster tick (must-move plans, breaks), the balancer, the join door, the
--    on-table lobby and the cash_seat_moves trigger. That definition now
--    answers false for every game, so all five return to the ordinary
--    must-move rules in one place: a Main seat draws the longest-seated feeder
--    player, a table whose players fit elsewhere breaks, feeders balance, the
--    join door fills the feeder last, and the lobby shows the Must Move List.
--    Lightning is untouched: whether a game converts is still
--    cash_games.lightning_enabled / cluster_mode, which Classic never sets.
--
--    "EVERY SINGLE GAME": 63 enabled games still had must_move = false, so the
--    tick refused them as 'manual_game' and nothing managed their tables.
--    Measured 2026-11-07 07:07 UTC: all 63 are empty Classic games, none
--    Lightning. They become must_move = true. cash_games is not one of the hot
--    tables (clubs, tables, hand_history); a short lock_timeout guards it.
--
-- 2. SECOND TABLES FOLLOW THE CLOCK (owner request 2026-11-07, item 1/5).
--    20261107030430 let a fixed 50% of games hold a second table at every
--    hour. The choice is now public.fn_cash_game_second_table_picked(game,
--    at): per game per three-hour bucket, at a rate set by the Chicago hour -
--    60% from 18:00, 50% from 10:00, 30% from midnight, 20% from 04:00 - so
--    evenings run more second tables and early mornings fewer. It hashes with
--    md5, which the engine reproduces exactly (HorseBehavior.secondTablePicked)
--    so the fleet seats a second table only while its game is picked and lets
--    it drain once it is not. The OPEN rule is unchanged (a full floor and two
--    buyers).
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $preimage$
BEGIN
  IF md5(pg_get_functiondef('public.fn_cash_game_never_moves_players(text,jsonb)'::regprocedure))
       <> 'cfc5a616a18c44664d73b8159947800a'
     OR md5(pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure))
       <> 'a199a6fcb30140a7eedeec9b1e4be1e7' THEN
    RAISE EXCEPTION 'every_game_must_move_preimage_changed' USING ERRCODE = '55000';
  END IF;
END $preimage$;

-- 1. One definition, every game: nobody is exempt from must-move.
CREATE OR REPLACE FUNCTION public.fn_cash_game_never_moves_players(p_template text, p_ruleset jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  -- Dan 2026-11-07: "EVERY SINGLE GAME IS A MUST MOVE GAME". Classic games do
  -- not convert to Lightning; they still move players like every other game.
  SELECT false
$function$;

UPDATE public.cash_games SET must_move = true, updated_at = now()
 WHERE enabled AND must_move IS DISTINCT FROM true;

-- 2. Which games may hold a second table right now.
CREATE OR REPLACE FUNCTION public.fn_cash_game_second_table_picked(p_game_id uuid, p_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT (('x' || lpad(substr(md5(p_game_id::text || ':second_table:'
             || floor(extract(epoch FROM p_at) / 10800)::bigint::text), 1, 8), 16, '0'))::bit(64)::bigint % 100)
         < CASE
             WHEN extract(hour FROM p_at AT TIME ZONE 'America/Chicago') >= 18 THEN 60
             WHEN extract(hour FROM p_at AT TIME ZONE 'America/Chicago') >= 10 THEN 50
             WHEN extract(hour FROM p_at AT TIME ZONE 'America/Chicago') >= 4 THEN 20
             ELSE 30
           END
$function$;
REVOKE ALL ON FUNCTION public.fn_cash_game_second_table_picked(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_game_second_table_picked(uuid, timestamptz) TO authenticated, service_role;

DO $patch$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) INTO original;
 patched := replace(original,
   $anchor$  IF v_table_cap < 2
     AND (abs(hashtextextended(g.id::text || ':second_table:'
            || floor(extract(epoch FROM v_now) / 10800)::bigint::text, 0)) % 100) < 50 THEN
    v_table_cap := 2;
  END IF;
$anchor$,
   $insert$  -- Rate by Chicago hour since 2026-11-07: fn_cash_game_second_table_picked.
  IF v_table_cap < 2 AND public.fn_cash_game_second_table_picked(g.id, v_now) THEN
    v_table_cap := 2;
  END IF;
$insert$);
 IF patched = original THEN RAISE EXCEPTION 'second table anchor absent'; END IF;
 IF position('fn_cash_game_never_moves_players(' IN patched) = 0 THEN
   RAISE EXCEPTION 'cash cluster tick must keep reading the one must-move definition';
 END IF;
 EXECUTE patched;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) TO service_role;

COMMIT;
