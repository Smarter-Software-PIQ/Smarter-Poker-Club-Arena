-- ═══════════════════════════════════════════════════════════════════════════
-- A PROVEN TOURNAMENT FINISH STOPS BEING "UNKNOWN" (2026-11-07)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Tournament.atomic_finish_outcome_unknown fires when a tournament's
-- completion may have committed but its immutable receipt could not be
-- resolved at that instant: "Every table engine was stopped." It is a
-- CRITICAL, and correctly so at the moment it fires - an unknown money
-- outcome is the worst kind.
--
-- It is never taken back. Five fired in a five-second burst at 08:09:33-38
-- UTC on 2026-11-07 and all five were still unresolved hours later, sitting
-- at the top of the attention panel as "3 critical alert types are new this
-- week or doubled". Every one of those five tournaments had in fact
-- COMPLETED and paid in full, 15 to 20 seconds after its alert:
--
--   10 Chip Spin NLH      prize pool 20.00   paid 20.00
--   NLH Heads-Up 2                     3.80       3.80
--   1 Chip Spin PLO4                   2.00       2.00
--   NLH Heads-Up 20                   38.00      38.00
--   2 Chip Spin PLO4                   6.00       6.00
--
-- The alert was right to fire and wrong to stay. An outcome that is unknown
-- at finish time becomes PROVABLE a few seconds later, and nothing was
-- looking again: fn_ca_resolve_cleared_incidents does not cover this source.
-- A Critical nobody can clear is how a Critical list stops being read - the
-- same failure as a nightly certified_v31_missing for a parked program.
--
-- This re-measures. An alert resolves only on PROOF, never on age: the named
-- tournament is COMPLETED, it has an end time, and no obligation of it is
-- short-paid. Anything less stays open and stays Critical. No money moves
-- here; this only writes the resolution that the evidence already supports.

CREATE OR REPLACE FUNCTION public.fn_ca_resolve_proven_tournament_finishes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n integer := 0;
BEGIN
  WITH proven AS (
    SELECT a.id
      FROM public.financial_alerts a
      JOIN public.tournaments t
        ON t.id = (a.context->>'tournament_id')::uuid
     WHERE a.source = 'Tournament.atomic_finish_outcome_unknown'
       AND a.resolved IS NOT TRUE
       -- A malformed or absent id is not proof of anything; leave it open.
       AND (a.context->>'tournament_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND upper(coalesce(t.status::text, '')) = 'COMPLETED'
       AND t.ended_at IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM public.tournament_obligations o
              WHERE o.tournament_id = t.id
                AND coalesce(o.amount_paid, 0) < coalesce(o.amount_owed, 0))
  )
  UPDATE public.financial_alerts a
     SET resolved = true,
         resolved_at = now(),
         resolution = 'outcome proven after the fact: the tournament is COMPLETED, it has an end time, and every obligation is paid in full, so the receipt that could not be resolved at finish time is resolvable now (fn_ca_resolve_proven_tournament_finishes)'
    FROM proven p
   WHERE a.id = p.id;
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO public.ca_detector_runs (detector, detail)
  VALUES ('fn_ca_resolve_proven_tournament_finishes', jsonb_build_object('resolved', n));

  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_resolve_proven_tournament_finishes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_resolve_proven_tournament_finishes() TO service_role;

-- periodic-work: the re-measurement IS the product here, not compensation for a
-- failed write. The alert is raised at the one instant the answer cannot be
-- known - "Every table engine was stopped" - so the engine cannot resolve it
-- in-process; the outcome becomes provable seconds later and nothing was
-- reading it again. This job moves no money, repairs nothing and retries
-- nothing: it writes only the resolution the evidence already supports, and
-- refuses to write it unless the tournament is COMPLETED with no short-paid
-- obligation. fn_ca_resolve_cleared_incidents (:23) is the same shape of work
-- for drift incidents; this is its counterpart for financial_alerts, kept
-- separate because it closes on positive proof rather than on detector
-- silence, and those two must never be read as the same basis.

-- Its own hourly job, offset from ca-resolve-cleared-incidents-hourly (:23)
-- so the two never contend, and separate from it so a change here can never
-- disturb the resolver that already works.
DO $cron$
BEGIN
  PERFORM cron.unschedule('ca-resolve-proven-tournament-finishes-hourly');
EXCEPTION WHEN OTHERS THEN
  NULL; -- not scheduled yet
END
$cron$;

SELECT cron.schedule(
  'ca-resolve-proven-tournament-finishes-hourly',
  '27 * * * *',
  $job$SELECT public.fn_ca_resolve_proven_tournament_finishes();$job$);

-- ── SELF-VERIFY ─────────────────────────────────────────────────────────────
DO $verify$
DECLARE
  v_left integer;
  v_wrongly_resolved integer;
BEGIN
  PERFORM public.fn_ca_resolve_proven_tournament_finishes();

  -- Nothing provably finished and fully paid may still be open.
  SELECT count(*) INTO v_left
    FROM public.financial_alerts a
    JOIN public.tournaments t ON t.id = (a.context->>'tournament_id')::uuid
   WHERE a.source = 'Tournament.atomic_finish_outcome_unknown'
     AND a.resolved IS NOT TRUE
     AND (a.context->>'tournament_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     AND upper(coalesce(t.status::text,'')) = 'COMPLETED'
     AND t.ended_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.tournament_obligations o
                      WHERE o.tournament_id = t.id
                        AND coalesce(o.amount_paid,0) < coalesce(o.amount_owed,0));
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'PROVEN_FINISH_LEFT_OPEN: % still unresolved', v_left;
  END IF;

  -- And nothing unproven may have been closed by this function.
  SELECT count(*) INTO v_wrongly_resolved
    FROM public.financial_alerts a
    LEFT JOIN public.tournaments t ON t.id = (a.context->>'tournament_id')::uuid
   WHERE a.source = 'Tournament.atomic_finish_outcome_unknown'
     AND a.resolution LIKE 'outcome proven after the fact:%'
     AND (t.id IS NULL
          OR upper(coalesce(t.status::text,'')) <> 'COMPLETED'
          OR t.ended_at IS NULL
          OR EXISTS (SELECT 1 FROM public.tournament_obligations o
                      WHERE o.tournament_id = t.id
                        AND coalesce(o.amount_paid,0) < coalesce(o.amount_owed,0)));
  IF v_wrongly_resolved <> 0 THEN
    RAISE EXCEPTION 'UNPROVEN_FINISH_RESOLVED: % closed without proof', v_wrongly_resolved;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job
                  WHERE jobname = 'ca-resolve-proven-tournament-finishes-hourly') THEN
    RAISE EXCEPTION 'PROVEN_FINISH_NOT_SCHEDULED';
  END IF;
END
$verify$;
