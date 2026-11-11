-- 20261111055020_a_retired_club_leaves_the_cluster_tick_worklist.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- @live-proof: position('lifecycle_status' in pg_get_functiondef('public.fn_cash_clusters_to_tick()'::regprocedure)) > 0 AND NOT EXISTS (SELECT 1 FROM public.fn_cash_clusters_to_tick() w JOIN public.clubs c ON c.id = w.club_id WHERE c.lifecycle_status = 'retired')
--
-- A RETIRED CLUB LEAVES THE CLUSTER TICK WORKLIST
--
-- WHAT WAS WRONG (read from production 2026-11-11 05:44-05:52 UTC)
--
-- Alert ClusterPassErrors (operational_alert_events 376546, alertmanager)
-- fired at 05:43:59Z with "4772 cluster tick errors in 15 min". It has fired
-- and resolved 48 times since 2026-10-17; each firing was closed as
-- informational when its resolved twin arrived, so the cause was never read.
-- Its most recent firings ran for hours (11-10 17:23Z -> 11-11 05:26Z, then
-- again from 05:43Z): the tick errors never stop, the 15-minute count only
-- dips under the threshold now and then.
--
-- Every one of the last 3,996 controller_tick_error rows in
-- cash_cluster_events is the same refusal:
--   55000 CLUB_RETIRED: gameplay and cashier records are read-only
-- from 36 games in four RETIRED certification fixtures (Crest Cert Template
-- 6dc7e348, fba91d7b, 32085314, c4770672; retired 2026-11-07). Each game is
-- disabled and dormant with one table stranded at lifecycle = 'live' /
-- status = 'closed', no open seat, no stack, and no member balance.
--
-- THE CAUSE. fn_cash_clusters_to_tick() admits a must-move game while it is
-- enabled or has any table non-terminal by either liveness field (the
-- 20260909181653 rule, so one tick can make lifecycle and status agree). It
-- never asked whether the game's CLUB can be written at all.
-- fn_guard_retired_club_mutation makes every gameplay record of a retired
-- club read-only (cash_games, tables, table_seats and 30 more), so the tick
-- that the worklist promises can never land: fn_cash_clusters_tick_all
-- treats a disabled game as due EVERY pass, calls fn_cash_cluster_tick, the
-- guard refuses, the sub-block rolls back, and an error row is written. 36
-- games x one pass every 5 s = the ~5 errors a second the alert counts, plus
-- ~620,000 cash_cluster_events rows a day and pass budget spent on games
-- that can never change, budget that live games are deferred behind.
--
-- THE FIX. The worklist excludes a game whose club is retired. Nothing can
-- run in a retired club, and retirement (fn_retire_settled_club and the
-- certification doors) refuses any club with a seat, entrant, balance or
-- obligation, so there is nothing for a tick to protect there. A club that
-- is ever un-retired re-enters the worklist on the next pass, unchanged.
-- Everything else in the function is the installed body byte for byte
-- (prosrc md5 41a70819e205ce35986b60066f0ef484, the 20260921025523 text),
-- and the gate below refuses if production has moved underneath it.
--
-- WHAT THIS DOES NOT CHANGE. No row is written. The 36 stranded tables stay
-- exactly as they are: a retired club's records are read-only by design
-- (the same decision 20261024230029 recorded for Crest Cert Template
-- c4059717). fn_cash_cluster_tick and fn_cash_clusters_tick_all are
-- untouched; every non-retired game is admitted exactly as before.
--
-- PINNED BY tests/a-retired-club-leaves-the-cluster-tick-worklist.law.test.ts.
-- Recurrence routes through the existing ClusterPassErrors rule
-- (infra/monitoring) into operational_alert_events.

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $gate$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(prosrc) INTO v_md5
    FROM pg_proc
   WHERE oid = 'public.fn_cash_clusters_to_tick()'::regprocedure;
  IF v_md5 IS DISTINCT FROM '41a70819e205ce35986b60066f0ef484' THEN
    RAISE EXCEPTION 'fn_cash_clusters_to_tick pre-image moved: prosrc md5 %, expected 41a70819e205ce35986b60066f0ef484', v_md5;
  END IF;
END
$gate$;

CREATE OR REPLACE FUNCTION public.fn_cash_clusters_to_tick()
 RETURNS TABLE(game_id uuid, club_id uuid, main1_table_id uuid, state text, enabled boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT g.id, g.club_id,
         -- LIGHTNING 2.0 PHASE 3. This was a subselect for role = 'main' AND
         -- main_index = 1, which answers NULL for a Lightning-capable Cluster
         -- whose one table is a feeder. The ClusterController reads this column
         -- to count eligible horses and to decide whether an engine must exist,
         -- so a NULL here means the Cluster is created and then never ticks.
         -- The column keeps its name because eleven call sites in
         -- server/src/cluster/ClusterController.ts spell it.
         public.fn_cash_cluster_front_table(g.id),
         g.state, g.enabled
    FROM public.cash_games g
   WHERE g.must_move
     -- A RETIRED CLUB IS NEVER TICKED (2026-11-11, 20261111055020).
     -- fn_guard_retired_club_mutation makes every gameplay record of a
     -- retired club read-only, so a tick there can only be refused
     -- (55000 CLUB_RETIRED). A disabled game is due every pass, so 36 such
     -- games produced ~5 controller_tick_error rows a second. Retirement
     -- already refused any seat, entrant or balance, so nothing is left for
     -- a tick to do.
     AND NOT EXISTS (SELECT 1 FROM public.clubs c
                      WHERE c.id = g.club_id
                        AND c.lifecycle_status = 'retired')
     -- A DISABLED GAME IS ADMITTED ON EITHER LIVENESS FIELD (2026-09-09).
     -- This used to require status IN ('waiting','running','active') as well,
     -- and 20260906011113 removed the status half because a table stranded at
     -- lifecycle='live' / status='closed' was excluded from the repair written
     -- for it. The MIRROR of that stranding - lifecycle='closed' with
     -- status='waiting' - then fell into the same hole against the half that
     -- was left, and `status_followed_lifecycle` (which lives inside the tick)
     -- could never reach it. Two FLO8 0.50/1 games sat that way with
     -- last_tick_at NULL: never ticked once.
     -- So the question is asked of BOTH fields: any table that is non-terminal
     -- by either one is a table the tick has something to say about. One tick
     -- makes them agree and the game leaves this list again.
     AND (g.enabled OR EXISTS (SELECT 1 FROM public.tables t
                                WHERE t.cluster_id = g.id
                                  AND coalesce(t.is_deleted, false) = false
                                  AND (t.lifecycle <> 'closed'
                                       OR lower(coalesce(t.status, '')) NOT IN
                                            ('closed', 'completed', 'cancelled', 'finished'))))
   ORDER BY g.created_at;
$function$;

REVOKE ALL ON FUNCTION public.fn_cash_clusters_to_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_clusters_to_tick() TO service_role;

-- Postimage: no retired club's game is admitted.
DO $postimage$
DECLARE
  v_retired integer;
BEGIN
  SELECT count(*) INTO v_retired
    FROM public.fn_cash_clusters_to_tick() w
    JOIN public.clubs c ON c.id = w.club_id
   WHERE c.lifecycle_status = 'retired';
  IF v_retired <> 0 THEN
    RAISE EXCEPTION 'fn_cash_clusters_to_tick still admits % game(s) of a retired club', v_retired;
  END IF;
END
$postimage$;

COMMIT;
