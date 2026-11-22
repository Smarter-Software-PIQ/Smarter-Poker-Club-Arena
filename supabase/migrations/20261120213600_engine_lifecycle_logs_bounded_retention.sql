-- 20261120213600_engine_lifecycle_logs_bounded_retention
--
-- Incident 075013fd (Wave 2 Hardening, Lane W3): enforce bounded 30-day rolling
-- retention on public.engine_lifecycle_logs (created in 20261119175748) so
-- append-only boot, shutdown, and FATAL/crash diagnostic logs cannot grow
-- unbounded on disk.
--
-- public.engine_lifecycle_logs already carries ix_engine_lifecycle_logs_created_at
-- on (created_at DESC), which PostgreSQL scans backward for oldest-first
-- bounded page deletes.
--
-- periodic-work: retention only. Schedules one daily owner-only bounded page
-- prune of disposable engine lifecycle diagnostic logs older than 30 days;
-- repairs nothing and compensates for nothing.
--
-- @live-proof: to_regprocedure('public.fn_ca_prune_engine_lifecycle_logs(interval,integer)') IS NOT NULL AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-engine-lifecycle-logs-prune-daily' AND command LIKE '%fn_ca_prune_engine_lifecycle_logs%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '8s';

CREATE OR REPLACE FUNCTION public.fn_ca_prune_engine_lifecycle_logs(
  p_keep interval DEFAULT interval '30 days',
  p_batch integer DEFAULT 5000
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '15s'
SET lock_timeout TO '2s'
AS $function$
DECLARE
  v_batch integer := LEAST(50000, GREATEST(COALESCE(p_batch, 5000), 1));
  v_cutoff timestamptz;
  v_deleted integer := 0;
BEGIN
  IF p_keep IS NULL OR p_keep < interval '1 day' THEN
    RAISE EXCEPTION 'p_keep must be at least 1 day' USING ERRCODE = '22023';
  END IF;

  v_cutoff := now() - p_keep;

  WITH doomed AS MATERIALIZED (
    SELECT id
      FROM public.engine_lifecycle_logs
     WHERE created_at < v_cutoff
     ORDER BY created_at ASC, id ASC
     LIMIT v_batch
       FOR UPDATE SKIP LOCKED
  )
  DELETE FROM public.engine_lifecycle_logs t
   USING doomed d
   WHERE t.id = d.id
     AND t.created_at < v_cutoff;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $function$;

REVOKE ALL ON FUNCTION public.fn_ca_prune_engine_lifecycle_logs(interval, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.fn_ca_prune_engine_lifecycle_logs(interval, integer) IS
  'Owner-only bounded page retention pruner for public.engine_lifecycle_logs (default 30-day rolling retention, max 50000 rows per call). Deletes oldest expired diagnostic rows with FOR UPDATE SKIP LOCKED under explicit statement_timeout and lock_timeout.';

SELECT cron.schedule(
  'ca-engine-lifecycle-logs-prune-daily',
  '45 5 * * *',
  $cron$SET statement_timeout = '15s'; SET lock_timeout = '2s'; SELECT public.fn_ca_prune_engine_lifecycle_logs(interval '30 days', 5000);$cron$
);

-- @probe-for: public.fn_ca_prune_engine_lifecycle_logs
DO $probe$
BEGIN
  PERFORM public.fn_ca_prune_engine_lifecycle_logs(interval '30 days', 1);
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
