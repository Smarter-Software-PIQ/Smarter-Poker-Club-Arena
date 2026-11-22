-- 20261121153438_cron_health_proven_jobs_and_watched_guard_hashes.sql
--
-- WHAT THIS CHANGES, AND WHY (hardening follow-up to incident 316ed735):
--
-- 1. public.fn_ca_cron_health(interval): aligns the single-sample verdict with
--    public.fn_ca_cron_failure_watch()'s proven-job rule. When a job has
--    exactly one finished run in p_window and it failed (successes = 0,
--    failures + successes = 1), and its single-function command has a newer
--    passing row in public.ca_detector_runs (COALESCE((pr.detail->>'pass')::boolean, true)),
--    the verdict is 'warn' instead of 'critical', so a fixed weekly job that
--    already passed a live run does not keep Cron Health red for up to 7 days.
--    Preserves the bounded rn <= 3 lookback and single-run DISTINCT ON row.
-- 2. public.fn_ca_watched_guard_hashes(): read-only service_role helper that
--    returns the live raw md5(prosrc) and comment-stripped, whitespace-collapsed
--    normalized md5 for critical watched guard functions so scripts/ci/check-cron-health.mjs
--    can detect git-vs-production body drift automatically on every Cron Health run.
--
-- @replaces-md5: public.fn_ca_cron_health(interval)=83568107ec1ccb7022fbbfb2e63973ea

BEGIN;

SET LOCAL lock_timeout = '4s';

CREATE OR REPLACE FUNCTION public.fn_ca_cron_health(p_window interval DEFAULT '24:00:00'::interval)
 RETURNS TABLE(jobname text, schedule text, verdict text, runs bigint, failures bigint, successes bigint, last_run_at timestamp with time zone, last_error text, last_run_status text, last_error_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with j as (
    select jobid, jobname, schedule, command from cron.job where active
  ),
  w as (
    select r.jobid, r.status, r.return_message, r.start_time
      from cron.job_run_details r
     where r.start_time > now() - p_window
  ),
  agg as (
    select j.jobid, j.jobname, j.schedule, j.command,
           count(w.*)                                     as runs,
           count(*) filter (where w.status = 'failed')    as failures,
           count(*) filter (where w.status = 'succeeded') as successes,
           max(w.start_time)                              as last_run_at
      from j left join w on w.jobid = j.jobid
     group by j.jobid, j.jobname, j.schedule, j.command
  ),
  last_finished as (
    select distinct on (w.jobid)
           w.jobid, w.status, w.return_message, w.start_time
      from w
     where w.status in ('succeeded', 'failed')
     order by w.jobid, w.start_time desc
  ),
  recent as (
    select d.jobid, d.status,
           row_number() over (partition by d.jobid order by d.start_time desc) as rn
      from cron.job_run_details d
     where d.status in ('succeeded', 'failed')
  ),
  lookback as (
    select k.jobid,
           count(*) filter (where k.status = 'succeeded') as successes_in_last_3
      from recent k
     where k.rn <= 3
     group by k.jobid
  ),
  decided as (
    select a.jobid, a.jobname, a.schedule, a.runs, a.failures, a.successes,
           a.last_run_at,
           case
             when a.failures + a.successes = 0 then 'idle'
             when a.successes = 0
                  and a.failures + a.successes = 1
                  and (coalesce(b.successes_in_last_3, 0) > 0
                       or exists (
                         select 1 from public.ca_detector_runs pr
                          where a.command ~* '^\s*select\s+(public\.)?fn_[a-z0-9_]+\(\s*\)\s*;?\s*$'
                            and pr.detector = substring(a.command from '(fn_[A-Za-z0-9_]+)\(')
                            and pr.ran_at > lf.start_time
                            and coalesce((pr.detail->>'pass')::boolean, true))) then 'warn'
             when a.successes = 0              then 'critical'
             when a.failures  > 0              then 'warn'
             else 'ok'
           end as verdict
      from agg a
      left join lookback b on b.jobid = a.jobid
      left join last_finished lf on lf.jobid = a.jobid
  )
  select d.jobname, d.schedule, d.verdict,
         d.runs, d.failures, d.successes, d.last_run_at,
         case when lf.status = 'failed'
              then left(lf.return_message, 200) end as last_error,
         lf.status                                  as last_run_status,
         case when lf.status = 'failed'
              then lf.start_time end                as last_error_at
    from decided d
    left join last_finished lf on lf.jobid = d.jobid
   order by
     case d.verdict
       when 'critical' then 0
       when 'warn'     then 1
       when 'ok'       then 2
       else 3
     end,
     d.failures desc,
     d.jobname;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_cron_health(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_cron_health(interval) TO service_role;

CREATE OR REPLACE FUNCTION public.fn_ca_watched_guard_hashes()
 RETURNS TABLE(qualified_name text, body_md5 text, normalized_md5 text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT n.nspname || '.' || p.proname AS qualified_name,
         md5(p.prosrc) AS body_md5,
         md5(
           btrim(
             regexp_replace(
               regexp_replace(
                 regexp_replace(p.prosrc, '/\*[\s\S]*?\*/', ' ', 'g'),
                 '--[^\n]*', ' ', 'g'
               ),
               '\s+', ' ', 'g'
             )
           )
         ) AS normalized_md5
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE (n.nspname || '.' || p.proname) IN (
           'public.fn_ca_alarm_drill',
           'public.fn_ca_cron_failure_watch',
           'public.fn_ca_cron_health'
         )
   ORDER BY qualified_name;
$function$;

REVOKE ALL ON FUNCTION public.fn_ca_watched_guard_hashes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_watched_guard_hashes() TO service_role;

-- @probe-for: public.fn_ca_cron_health
DO $probe$
BEGIN
  PERFORM * FROM public.fn_ca_cron_health('24 hours'::interval) LIMIT 1;
END $probe$;

-- @probe-for: public.fn_ca_watched_guard_hashes
DO $probe$
BEGIN
  PERFORM * FROM public.fn_ca_watched_guard_hashes();
END $probe$;

-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_cron_health(interval)'::regprocedure), 'public.ca_detector_runs pr') > 0 AND to_regprocedure('public.fn_ca_watched_guard_hashes()') IS NOT NULL

COMMIT;
