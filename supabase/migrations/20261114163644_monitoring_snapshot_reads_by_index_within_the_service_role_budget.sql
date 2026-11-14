-- 20261114163644_monitoring_snapshot_reads_by_index_within_the_service_role_budget.sql
-- IRREVERSIBLE: no
--
-- WHY (incident fa23c973, HorseFleetThroughputPolicyUnknown, 2026-11-14):
-- The alert fired at 10:25:49 AM CST and cleared a minute later. The cash
-- admission policy RPC never failed: every call to fn_lightning_admission_policy
-- in the window returned 200. What failed was the monitoring-health collector
-- run that reads it. collect-monitoring-health.sh calls
-- fn_monitoring_health_snapshot first and stops on failure, and that call was
-- cancelled by the service_role 8 s statement timeout (57014) at 10:21:37,
-- 10:22:34, 10:23:39 and 10:24:44 AM CST. With no run for four minutes,
-- poker_health_collected_timestamp_seconds aged past 180 s and
-- sp:lightning_admission_policy:readable went to 0. Seven of these timeouts
-- happened in the 10 AM hour and three at 12 AM; none in the hours between.
--
-- The snapshot costs about 2.1 s on a quiet database (measured 2026-11-14),
-- and the window coincided with heavy concurrent ad-hoc reads, so ordinary
-- contention pushed it over the 8 s ceiling. Two of its parts scan whole
-- tables to answer small questions:
--   * pgc counted the last hour of cron.job_run_details (982,004 rows, indexed
--     only on runid) with a sequential scan: 367 ms. runid is assigned in
--     start order, so the last hour is a range at the end of the primary key:
--     7 ms, same answer (3013 runs / 0 failures when measured).
--   * noop materialised 30 days of cron_execution_log (142,181 rows) and sorted
--     them to find each job's latest run: 780 ms. Each job's latest run and its
--     latest real success are one backward probe each on
--     idx_cron_execution_log_job_started: 3.5 ms, same count.
-- Columns, semantics, owner, SECURITY DEFINER, search_path and grants are
-- unchanged. The admission-policy alert and its rule are unchanged.
--
-- ROLLBACK: re-apply the body from 20261015035957 (md5 353ff5fc64d427d2ffd46582699c6300).
--
-- @live-proof: (SELECT md5(pg_get_functiondef('public.fn_monitoring_health_snapshot(integer)'::regprocedure)) <> '353ff5fc64d427d2ffd46582699c6300' AND pg_get_functiondef('public.fn_monitoring_health_snapshot(integer)'::regprocedure) LIKE '%ORDER BY d.runid DESC LIMIT 1%')

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

CREATE TEMP TABLE ca_snapshot_before ON COMMIT DROP AS
  SELECT p.proacl::text AS acl, pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS secdef,
         p.proconfig::text AS cfg, pg_get_function_result(p.oid) AS result
    FROM pg_proc p WHERE p.oid = 'public.fn_monitoring_health_snapshot(integer)'::regprocedure;

DO $pre$
BEGIN
  IF md5(pg_get_functiondef('public.fn_monitoring_health_snapshot(integer)'::regprocedure))
     <> '353ff5fc64d427d2ffd46582699c6300' THEN
    RAISE EXCEPTION 'fn_monitoring_health_snapshot is not the pinned 20261015035957 body (md5 %)',
      md5(pg_get_functiondef('public.fn_monitoring_health_snapshot(integer)'::regprocedure));
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.fn_monitoring_health_snapshot(p_window_minutes integer DEFAULT 5)
 RETURNS TABLE(settlement_window_minutes integer, settlement_window_hands bigint, settlement_failed bigint, settlement_stuck bigint, settlement_failure_rate numeric, money_undeclared_triggers bigint, financial_alerts_unresolved bigint, financial_alerts_stale_critical bigint, financial_alerts_distinct_conditions bigint, cron_pg_runs bigint, cron_pg_failures bigint, cron_openclaw_stale bigint, cron_openclaw_worst_silence_minutes numeric, cron_jobs_skipping_all_work bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog', 'pg_temp'
AS $function$
  WITH sh AS (
    SELECT * FROM public.fn_settlement_health(greatest(coalesce(p_window_minutes, 5), 1))
  ), fa AS (
    SELECT count(*) FILTER (WHERE NOT resolved) AS unresolved,
           count(*) FILTER (
             WHERE NOT resolved
               AND severity = 'critical'
               AND created_at < now() - interval '24 hours'
           ) AS stale_critical,
           count(DISTINCT source) FILTER (WHERE NOT resolved) AS distinct_conditions
      FROM public.financial_alerts
  ), pgc AS (
    -- THE LAST HOUR IS THE END OF THE PRIMARY KEY (2026-11-14). runid is
    -- assigned in start order; the newest run that started before the hour
    -- bounds a primary-key range, and start_time still filters it.
    SELECT count(*) AS runs,
           count(*) FILTER (WHERE status <> 'succeeded') AS failures
      FROM cron.job_run_details
     WHERE runid >= coalesce((SELECT d.runid FROM cron.job_run_details d
                               WHERE d.start_time <= now() - interval '1 hour'
                               ORDER BY d.runid DESC LIMIT 1), 0)
       AND start_time > now() - interval '1 hour'
  ), oc AS (
    SELECT count(*) FILTER (WHERE is_stale) AS stale,
           coalesce(max(silent_minutes) FILTER (WHERE is_stale), 0) AS worst_silence_minutes
      FROM public.v_openclaw_job_staleness
  ), ut AS (
    SELECT count(*) AS n FROM public.fn_undeclared_money_triggers()
  ), names AS (
    -- One probe per job name on idx_cron_execution_log_job_started, not a
    -- sort of thirty days of runs (2026-11-14).
    WITH RECURSIVE n AS (
      SELECT min(job_name) AS job_name FROM public.cron_execution_log
      UNION ALL
      SELECT (SELECT min(c.job_name) FROM public.cron_execution_log c WHERE c.job_name > n.job_name)
        FROM n WHERE n.job_name IS NOT NULL
    ) SELECT job_name FROM n WHERE job_name IS NOT NULL
  ), latest AS (
    -- EVERY FINISHED RUN, NOT ONLY THE SUCCESSES (2026-10-15). A job whose
    -- latest run failed is not reporting success; reading only successes
    -- kept a job that now fails (pokernews-videos, 500 since 2026-09-30)
    -- counted for 30 days on its last skipped success. A run that reports
    -- held is a deliberate owner hold (an approval gate left off on
    -- purpose), not success while doing nothing, and is never counted.
    SELECT nm.job_name, l.status, l.result
      FROM names nm
      CROSS JOIN LATERAL (
        SELECT c.status, c.result FROM public.cron_execution_log c
         WHERE c.job_name = nm.job_name
           AND c.started_at > now() - interval '30 days'
           AND c.status <> 'running'
         ORDER BY c.started_at DESC LIMIT 1
      ) l
     WHERE NOT EXISTS (SELECT 1 FROM public.ca_retired_cron_jobs r WHERE r.job_name = nm.job_name)
  ), noop AS (
    SELECT count(*) AS n
      FROM latest l
     WHERE l.status = 'success'
       AND NOT (l.result ? 'held')
       AND l.result ? 'skipped'
       AND jsonb_typeof(l.result -> 'skipped') = 'string'
       AND (l.result ->> 'skipped') !~ '^[0-9]+$'
       AND NOT EXISTS (
             SELECT 1 FROM public.cron_execution_log c
              WHERE c.job_name = l.job_name
                AND c.status = 'success'
                AND c.started_at >= now() - interval '24 hours'
                AND NOT (c.result ? 'skipped'
                         AND jsonb_typeof(c.result -> 'skipped') = 'string'
                         AND (c.result ->> 'skipped') !~ '^[0-9]+$')
           )
  )
  SELECT sh.window_minutes,
         sh.settled,
         sh.failed,
         sh.stuck,
         coalesce(sh.failure_rate, 0)::numeric,
         ut.n,
         fa.unresolved,
         fa.stale_critical,
         fa.distinct_conditions,
         pgc.runs,
         pgc.failures,
         oc.stale,
         oc.worst_silence_minutes::numeric,
         noop.n
    FROM sh, fa, pgc, oc, ut, noop;
$function$;

DO $post$
DECLARE b record;
BEGIN
  SELECT * INTO STRICT b FROM ca_snapshot_before;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = 'public.fn_monitoring_health_snapshot(integer)'::regprocedure
       AND p.proacl::text IS NOT DISTINCT FROM b.acl
       AND pg_get_userbyid(p.proowner) = b.owner
       AND p.prosecdef = b.secdef
       AND p.proconfig::text IS NOT DISTINCT FROM b.cfg
       AND pg_get_function_result(p.oid) = b.result) THEN
    RAISE EXCEPTION 'fn_monitoring_health_snapshot changed owner, security, settings, grants or columns';
  END IF;
END
$post$;

COMMIT;
