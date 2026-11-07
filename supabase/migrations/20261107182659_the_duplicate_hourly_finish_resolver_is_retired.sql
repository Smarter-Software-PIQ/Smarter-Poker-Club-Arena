-- 20261107182659_the_duplicate_hourly_finish_resolver_is_retired
--
-- Reserved by scripts/reserve-migration-version.sh on 2026-11-07 18:26:59 UTC.
--
-- THE DUPLICATE HOURLY FINISH RESOLVER IS RETIRED (2026-11-07)
--
-- Two agents closed the same alarm, Tournament.atomic_finish_outcome_unknown,
-- within seven minutes of each other on 2026-11-07:
--
--   * 20261107140500 added fn_ca_resolve_proven_tournament_finishes() and its
--     own hourly cron (ca-resolve-proven-tournament-finishes-hourly, :27). It
--     resolves on COMPLETED + an end time + no short-paid obligation.
--   * 20261107140719 (#9879) added CLASS 7 to fn_resolve_settled_financial_alerts,
--     which already runs at :04/:24/:44 (cron 354) and :18 (cron 227). It
--     resolves only on exactly ONE terminal receipt written at or after the
--     alarm, receipt pools equal to the tournament's, payouts conserving the
--     prize pool to the cent, and the escrow closed at zero on both sides.
--
-- The risk of an unknown finish outcome is that it paid TWICE. Class 7 counts
-- receipts and keeps the alarm open on a second one; the hourly resolver does
-- not look, so it would close exactly the alarm that matters most. Its
-- evidence is a strict subset of class 7's, it runs on a separate schedule,
-- and keeping both leaves two owners for one state. Class 7 stays the one
-- owner; the hourly job and its function are removed.
--
-- Measured before writing: the hourly job has 5 runs, all succeeded; nothing
-- in the repository or the database calls the function apart from the job.

-- @live-proof: NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-resolve-proven-tournament-finishes-hourly') AND to_regprocedure('public.fn_ca_resolve_proven_tournament_finishes()') IS NULL AND EXISTS (SELECT 1 FROM cron.job WHERE active AND command ILIKE '%fn_resolve_settled_financial_alerts%')

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-resolve-proven-tournament-finishes-hourly') THEN
    PERFORM cron.unschedule('ca-resolve-proven-tournament-finishes-hourly');
  END IF;
END
$cron$;

DROP FUNCTION IF EXISTS public.fn_ca_resolve_proven_tournament_finishes();

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-resolve-proven-tournament-finishes-hourly') THEN
    RAISE EXCEPTION 'the hourly finish resolver is still scheduled';
  END IF;
  IF to_regprocedure('public.fn_ca_resolve_proven_tournament_finishes()') IS NOT NULL THEN
    RAISE EXCEPTION 'fn_ca_resolve_proven_tournament_finishes still exists';
  END IF;
  -- The one owner that remains must be present and scheduled.
  IF to_regprocedure('public.fn_resolve_settled_financial_alerts()') IS NULL
     AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fn_resolve_settled_financial_alerts'
                       AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'fn_resolve_settled_financial_alerts is missing; class 7 has no owner';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE active AND command ILIKE '%fn_resolve_settled_financial_alerts%') THEN
    RAISE EXCEPTION 'fn_resolve_settled_financial_alerts is not scheduled; class 7 would never run';
  END IF;
  IF position('atomic_finish_outcome_unknown' IN (
       SELECT string_agg(prosrc, ' ') FROM pg_proc
        WHERE proname = 'fn_resolve_settled_financial_alerts'
          AND pronamespace = 'public'::regnamespace)) = 0 THEN
    RAISE EXCEPTION 'fn_resolve_settled_financial_alerts does not carry class 7 (atomic_finish_outcome_unknown)';
  END IF;
END
$verify$;

COMMIT;
