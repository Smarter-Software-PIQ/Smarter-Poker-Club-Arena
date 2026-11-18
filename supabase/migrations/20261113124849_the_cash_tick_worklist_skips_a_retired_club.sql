-- 20261113124849_the_cash_tick_worklist_skips_a_retired_club.sql
-- @live-proof: NOT EXISTS (SELECT 1 FROM public.fn_cash_clusters_to_tick() l JOIN public.clubs c ON c.id = l.club_id WHERE c.lifecycle_status = 'retired') AND position('lifecycle_status = ''retired''' in pg_get_functiondef('public.fn_cash_clusters_to_tick()'::regprocedure)) > 0
--
-- THE CASH TICK WORKLIST SKIPS A RETIRED CLUB (2026-11-13).
--
-- Measured live 2026-11-13 12:40Z on engine 53360840: 25,884
-- controller_tick_error rows in one hour, every one
-- "CLUB_RETIRED: gameplay and cashier records are read-only" (55000), from 36
-- disabled must-move games of four retired "Crest Cert Template" clubs
-- (retired 2026-11-07). Each holds tables stranded at lifecycle='live' /
-- status='closed', so the worklist below admits the game on lifecycle alone
-- (20260909181653), the tick tries to make the two fields agree, and
-- fn_guard_retired_club_mutation refuses the write - every pass, forever,
-- because a retired club's records can never change again. 36 of the 84
-- games on the list were these: 43 percent of every pass was spent on a
-- write that cannot succeed, roughly 600,000 error rows a day.
--
-- A retired club is read-only by design (CLUB_RETIRED refuses gameplay and
-- cashier writes, even under service_role), so there is nothing a tick can
-- ever do for its games. The list now leaves them out. Nothing else changes:
-- same columns, same order, same admission rule for every other game; no
-- table, seat or chip is touched, and the retired records stay exactly as
-- they are. Both tick passes (fn_cash_clusters_tick_all and
-- fn_cash_clusters_tick_all_uncapped) read this list, so both engines stop
-- ticking them. The controller drops a game that leaves the list after
-- ROW_STALE_PASSES with no teardown and no write.
BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

DO $preimage$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc
       WHERE oid = 'public.fn_cash_clusters_to_tick()'::regprocedure)
     IS DISTINCT FROM '41a70819e205ce35986b60066f0ef484' THEN
    RAISE EXCEPTION 'fn_cash_clusters_to_tick changed since 20260921025523; qualify the current source';
  END IF;
END
$preimage$;

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
     -- A RETIRED CLUB IS READ-ONLY (2026-11-13): the tick can never write
     -- for it, so it is never on the list. NULL-safe for a game with no club.
     AND NOT EXISTS (SELECT 1 FROM public.clubs c
                      WHERE c.id = g.club_id
                        AND c.lifecycle_status = 'retired')
   ORDER BY g.created_at;
$function$;

REVOKE ALL ON FUNCTION public.fn_cash_clusters_to_tick() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cash_clusters_to_tick() TO service_role;

-- Read back: no retired club's game is on the list.
DO $readback$
BEGIN
  IF EXISTS (SELECT 1 FROM public.fn_cash_clusters_to_tick() l
               JOIN public.clubs c ON c.id = l.club_id
              WHERE c.lifecycle_status = 'retired') THEN
    RAISE EXCEPTION 'fn_cash_clusters_to_tick still lists a retired club';
  END IF;
END
$readback$;

COMMIT;
