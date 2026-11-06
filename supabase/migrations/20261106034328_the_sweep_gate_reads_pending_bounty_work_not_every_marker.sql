-- 20261106034328_the_sweep_gate_reads_pending_bounty_work_not_every_marker
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-06 03:43:28 UTC.
--
-- CLAUDE.md 10.9: the reasoning goes in this header, not just the SQL.
-- Say what was wrong, what this changes, and what you measured. A
-- migration whose header is its own filename is the next agent's mystery.
--
-- THE SWEEP GATE READS PENDING BOUNTY WORK, NOT EVERY MARKER
--
-- Every elimination sweep of a bounty event that rewinds to its first stage
-- (every sweep with a new bust) asks fn_tournament_has_unsettled_bounties
-- whether a bounty is still open before it records the bust. That function
-- answers three questions, and the third re-proves the complete generation
-- marker of EVERY settled obligation in the event with
-- fn_bounty_obligation_has_complete_marker. The cost therefore grows with
-- every knockout the event has already paid.
--
-- Measured on production, 2026-11-06 03:42 UTC:
--   - Afternoon Free Buy PKO 74ba8130, 402 obligations: one call took
--     2,429 ms (EXPLAIN ANALYZE, 142,194 shared buffer hits) and 3,994 ms
--     wall in a second run.
--   - pg_stat_statements for the engine's PostgREST call: 272,041 calls,
--     71,250 s total, 262 ms mean. That is about 20 hours of database time,
--     spent re-proving markers that the marker trigger already proved when
--     it set each row to settled.
-- Late in a big PKO this single read is most of the 5 s Dan watched between
-- a knockout hand and its bounty.
--
-- fn_tournament_has_pending_bounty_work answers the gate's real question
-- with indexed reads: a pending obligation, an open mystery award, or an
-- obligation settled in the last ten minutes whose marker is not complete
-- (fresh drift beneath the cache). Same tournament, same verdict shape. The
-- full re-proof stays exactly where it guards money: fn_finalize_bounty_pool,
-- the final table deal, the satellite finish, finish readiness, the
-- mystery activation and settle guards, the completion guard and the final
-- two close all still call fn_tournament_has_unsettled_bounties, so an older
-- drifted marker still refuses the finish. The same query on 74ba8130 ran in
-- 1.27 ms (406 buffer hits).
--
-- Native proof: scripts/ci/test-sweep-gate-pending-bounty-work.py.
--
-- @live-proof: to_regprocedure('public.fn_tournament_has_pending_bounty_work(uuid)') IS NOT NULL AND NOT has_function_privilege('authenticated','public.fn_tournament_has_pending_bounty_work(uuid)','execute') AND NOT has_function_privilege('anon','public.fn_tournament_has_pending_bounty_work(uuid)','execute') AND has_function_privilege('service_role','public.fn_tournament_has_pending_bounty_work(uuid)','execute')
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='30s';

DO $pre$ BEGIN
  IF to_regprocedure('public.fn_tournament_has_pending_bounty_work(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'fn_tournament_has_pending_bounty_work already installed';
  END IF;
  IF to_regprocedure('public.fn_bounty_obligation_has_complete_marker(uuid)') IS NULL
     OR to_regprocedure('public.fn_tournament_has_unsettled_bounties(uuid)') IS NULL
     OR to_regclass('public.tournament_bounty_obligations') IS NULL
     OR to_regclass('public.tournament_bounty_awards') IS NULL THEN
    RAISE EXCEPTION 'pending bounty work dependencies are missing';
  END IF;
END $pre$;

CREATE FUNCTION public.fn_tournament_has_pending_bounty_work(p_tournament_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    EXISTS (
      SELECT 1 FROM public.tournament_bounty_obligations o
       WHERE o.tournament_id = p_tournament_id AND o.state = 'pending'
    )
    OR EXISTS (
      SELECT 1 FROM public.tournament_bounty_awards a
       WHERE a.tournament_id = p_tournament_id
         AND a.status IN ('reserved', 'revealed', 'paid')
    )
    OR EXISTS (
      -- Fresh drift only: a settled cache whose marker is already incomplete.
      -- Older drift is refused at every finish by the full re-proof.
      SELECT 1 FROM public.tournament_bounty_obligations o
       WHERE o.tournament_id = p_tournament_id AND o.state = 'settled'
         AND o.settled_at > clock_timestamp() - interval '10 minutes'
         AND NOT public.fn_bounty_obligation_has_complete_marker(o.id)
    );
$function$;
REVOKE ALL ON FUNCTION public.fn_tournament_has_pending_bounty_work(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_tournament_has_pending_bounty_work(uuid) TO service_role;
COMMENT ON FUNCTION public.fn_tournament_has_pending_bounty_work(uuid) IS
 'The elimination sweep gate (2026-11-06): true while a bounty obligation is pending, a mystery award is open, or an obligation settled in the last ten minutes lacks its complete marker. Indexed reads; the full marker re-proof stays in fn_tournament_has_unsettled_bounties at every finish.';

COMMIT;
