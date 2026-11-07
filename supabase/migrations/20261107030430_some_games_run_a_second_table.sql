-- 20261107030430_some_games_run_a_second_table.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- WHAT THIS CHANGES, AND WHY:
--
-- Dan, 2026-11-06 20:40 CDT: "THERE SHOULD BE SOME GAMES WITH TWO TABLES
-- RUNNING AND THE MUST MOVE LIST ... IT LOOKS FAKE WHEN THERE ARE THE EXACT MAX
-- AMOUNT OF PLAYERS ON EVERY GAME".
--
-- Measured at that time: 0 of 68 enabled cluster games had more than one live
-- table. The cause is the table cap in fn_cash_cluster_tick. The owner's
-- supply cut (October 26 halved it; 20261102015546 cut it to 0.2x from
-- November 2) computes greatest(1, floor((cap_mains + 1) * 0.2)), which is
-- floor(9 * 0.2) = 1 for every game on the platform (cap_mains = 8, no second
-- feeder). So the OPEN step could never pass `v_live_tables < v_table_cap`, a
-- full Main 1 never grew a second table, and the game list behind it never
-- moved.
--
-- The fix keeps the owner's cut for most games and lets about half of them, re-
-- chosen every three hours per game, run a SECOND table. The OPEN rule itself
-- is unchanged: a second table still opens only when every live seat is taken
-- and there are at least two buyers (people or horses on the game list, or
-- horses able to sit). So in practice a second table appears only on a game
-- whose Main 1 is full - the fleet keeps about 40% of tables full from the
-- November 7 engine release (HorseBehavior.occupancyTargetFor). Nothing else
-- in the function changes: Classic still never moves its players
-- (fn_cash_game_never_moves_players), breaking, promotion, holds and money
-- paths are untouched.
--
-- ALSO: fn_cash_game_waiting_counts(uuid[]). The lobby row for a must-move game
-- printed "Running" whatever its list held, because cash_game_waitlist is
-- readable only row-by-row by its own player (cash_game_waitlist_read_own).
-- This returns COUNTS only - no ids, no names - for the games asked about,
-- using the same liveness the offer path uses (a waiting row for 24 hours, a
-- notified row for three minutes), so the card can say "Waitlist 3".
--
-- Supply impact, measured: 18 occupied cluster games at the time of writing, so
-- this adds at most about nine tables.
--
-- Wrap ALL DDL for one change in ONE transaction: every DDL statement fires
-- Supabase's schema-cache reload, which takes ~28s on this database, and ten
-- loose statements mean ten reloads (club-arena CLAUDE.md, production DDL policy).

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $patch$
DECLARE original text; patched text;
BEGIN
 SELECT pg_get_functiondef('public.fn_cash_cluster_tick(uuid,integer)'::regprocedure) INTO original;
 IF md5(original) <> '3d00a553f6c1e4136b18ebf9e4881c44' THEN
   RAISE EXCEPTION 'cash cluster predecessor changed; review before applying';
 END IF;
 patched := replace(original,
   $anchor$          THEN 0.2 ELSE 0.5 END)::integer);
$anchor$,
   $insert$          THEN 0.2 ELSE 0.5 END)::integer);
  -- SOME GAMES RUN A SECOND TABLE (Dan 2026-11-06). About half the games,
  -- re-chosen per game every three hours, may hold two tables; the OPEN rule
  -- below still requires a full floor and two buyers before it opens one.
  IF v_table_cap < 2
     AND (abs(hashtextextended(g.id::text || ':second_table:'
            || floor(extract(epoch FROM v_now) / 10800)::bigint::text, 0)) % 100) < 50 THEN
    v_table_cap := 2;
  END IF;
$insert$);
 IF patched = original THEN RAISE EXCEPTION 'cash cluster capacity anchor absent'; END IF;
 IF position('fn_cash_game_never_moves_players(' IN patched) = 0 THEN
   RAISE EXCEPTION 'cash cluster must preserve Classic player movement restriction';
 END IF;
 EXECUTE patched;
END $patch$;
REVOKE ALL ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_cluster_tick(uuid,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_cash_game_waiting_counts(p_game_ids uuid[])
RETURNS TABLE (game_id uuid, waiting integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
  SELECT w.game_id, count(*)::integer
    FROM public.cash_game_waitlist w
   WHERE w.game_id = ANY (p_game_ids[1:500])
     AND ((w.status = 'waiting' AND w.created_at > now() - interval '24 hours')
       OR (w.status = 'notified' AND w.updated_at > now() - interval '3 minutes'))
   GROUP BY w.game_id
$fn$;
REVOKE ALL ON FUNCTION public.fn_cash_game_waiting_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cash_game_waiting_counts(uuid[]) TO authenticated, service_role;

COMMIT;
