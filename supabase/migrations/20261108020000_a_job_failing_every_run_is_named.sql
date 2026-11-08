-- A JOB FAILING EVERY RUN IS NAMED (Dan 2026-11-07).
--
-- pg_cron job 117 (sp_prune_hand_history_10m, every 10 s) failed on every run
-- from 19:56 UTC: about 360 rollbacks an hour, TOURNAMENT_HAND_ARCHIVED_BY_OPERATOR.
-- Two things saw it and neither named it in time:
--   * PgCronFailuresElevated fired at 20:14 as a WARNING that counted the whole
--     fleet ("103 pg_cron failures in the last hour") without saying which job.
--   * fn_ca_cron_failure_watch, the per-job watch, only raised at 00:37 UTC,
--     4 h 41 m in. It required three failed runs AND no success for 2 hours
--     (or more fails than successes over 24 h). A 10-second job that fails
--     almost every run still succeeds now and then (job 117 succeeded through
--     21:18-21:23 and twice at 22:33), and each success restarted that clock.
--
-- One definition of "failing" for both readers, fn_cron_failing_jobs():
--   * at least 3 consecutive failed runs, continuously for at least 10 minutes
--     (the current streak since the job's last success), OR
--   * at least 18 of its last 20 finished runs failed, those 20 spanning at
--     least 10 minutes.
-- A success resets the streak, so a single transient error never qualifies,
-- and ten minutes outlasts a maintenance freeze (seven minutes at most). Only
-- the newest ~20000 runs are read, by runid range on the primary key (the
-- table's only index): about seven hours, cheap enough for a one-minute
-- collector. Measured on 2026-11-07: it names job 117 at 20:06-20:10 UTC and
-- no other job at any point in the preceding 24 hours.

BEGIN;

CREATE OR REPLACE FUNCTION public.fn_cron_failing_jobs()
RETURNS TABLE (
  jobid bigint,
  jobname text,
  failed_in_a_row integer,
  failing_since timestamptz,
  failed_of_last_20 integer,
  last_success timestamptz,
  last_error text,
  is_guard boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $$
  WITH bound AS (
    SELECT coalesce(max(d.runid), 0) - 20000 AS lo FROM cron.job_run_details d
  ),
  recent AS MATERIALIZED (
    SELECT d.jobid, d.runid, d.status, d.start_time, d.return_message,
           row_number() OVER (PARTITION BY d.jobid ORDER BY d.runid DESC) AS rk
      FROM cron.job_run_details d, bound
     WHERE d.runid > bound.lo
       AND d.status IN ('failed', 'succeeded')
  ),
  last_ok AS (
    SELECT r.jobid, max(r.runid) AS ok_runid, max(r.start_time) AS ok_at
      FROM recent r WHERE r.status = 'succeeded' GROUP BY r.jobid
  ),
  streak AS (
    SELECT r.jobid, count(*)::integer AS n, min(r.start_time) AS since,
           (array_agg(left(r.return_message, 300) ORDER BY r.runid DESC))[1] AS last_error
      FROM recent r LEFT JOIN last_ok o ON o.jobid = r.jobid
     WHERE r.status = 'failed' AND r.runid > coalesce(o.ok_runid, 0)
     GROUP BY r.jobid
  ),
  last20 AS (
    SELECT r.jobid, count(*)::integer AS runs,
           count(*) FILTER (WHERE r.status = 'failed')::integer AS fails,
           min(r.start_time) AS since,
           (array_agg(left(r.return_message, 300) ORDER BY r.runid DESC)
              FILTER (WHERE r.status = 'failed'))[1] AS last_error
      FROM recent r WHERE r.rk <= 20 GROUP BY r.jobid
  )
  SELECT j.jobid, j.jobname::text,
         coalesce(s.n, 0), s.since, l.fails, o.ok_at,
         coalesce(s.last_error, l.last_error),
         EXISTS (SELECT 1 FROM public.ca_guard_inventory g
                  WHERE g.kind = 'cron' AND g.object_a = j.jobname AND g.active)
    FROM last20 l
    JOIN cron.job j ON j.jobid = l.jobid AND j.active
    LEFT JOIN streak s ON s.jobid = l.jobid
    LEFT JOIN last_ok o ON o.jobid = l.jobid
   WHERE (s.n >= 3 AND s.since <= now() - interval '10 minutes')
      OR (l.runs = 20 AND l.fails >= 18 AND l.since <= now() - interval '10 minutes')
   ORDER BY coalesce(s.n, 0) DESC, j.jobname
   LIMIT 20;
$$;

COMMENT ON FUNCTION public.fn_cron_failing_jobs() IS
  'pg_cron jobs failing repeatedly: >= 3 consecutive failed runs for >= 10 min, or >= 18 of the last 20 runs failed over >= 10 min. Read by fn_ca_cron_failure_watch and the monitoring collector (poker_cron_job_failing_streak). 2026-11-07.';

REVOKE ALL ON FUNCTION public.fn_cron_failing_jobs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_cron_failing_jobs() TO service_role;

-- The per-job watch keeps both of its existing rules and additionally raises
-- every job fn_cron_failing_jobs() names, with the same dedupe key, so one job
-- is one incident a day however many rules see it.
CREATE OR REPLACE FUNCTION public.fn_ca_cron_failure_watch()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; n integer := 0; v_is_guard boolean; v_raised text[] := '{}';
BEGIN
  FOR r IN
    -- ONE pass over a bounded window. cron.job_run_details is indexed only by
    -- runid, so a per-job "last 3 runs" lookup with no time bound is a full
    -- scan per active job. Here a single scan of the last 7 days ranks each
    -- job's finished runs newest first; the 24 hour counts and the last three
    -- finished runs both come from that one pass. A job that appears in the
    -- 24 hour window runs at least daily, so its last three finished runs fall
    -- inside 7 days.
    WITH runs AS (
      SELECT d.jobid, d.status, d.start_time, d.return_message,
             d.start_time > now() - interval '24 hours' AS in_day,
             CASE WHEN d.status IN ('failed', 'succeeded')
                  THEN row_number() OVER (PARTITION BY d.jobid, d.status IN ('failed', 'succeeded')
                                          ORDER BY d.start_time DESC)
             END AS finished_rank
        FROM cron.job_run_details d
       WHERE d.start_time > now() - interval '7 days'
    ),
    day AS (
      SELECT j.jobid, j.jobname,
             count(*) FILTER (WHERE x.in_day AND x.status = 'failed')    AS fails,
             count(*) FILTER (WHERE x.in_day AND x.status = 'succeeded') AS successes,
             max(x.start_time) FILTER (WHERE x.in_day AND x.status = 'succeeded') AS last_success,
             max(left(x.return_message, 200)) FILTER (WHERE x.in_day AND x.status = 'failed') AS sample_error,
             count(*) FILTER (WHERE x.finished_rank <= 3) AS finished,
             count(*) FILTER (WHERE x.finished_rank <= 3 AND x.status = 'failed') AS failed_in_a_row
        FROM cron.job j
        JOIN runs x ON x.jobid = j.jobid
       WHERE j.active
       GROUP BY j.jobid, j.jobname
      HAVING count(*) FILTER (WHERE x.in_day) > 0
    )
    SELECT day.*
      FROM day
     WHERE (day.finished = 3 AND day.failed_in_a_row = 3
            AND (day.last_success IS NULL OR day.last_success <= now() - interval '2 hours'))
        OR (day.fails >= 5 AND day.fails > day.successes)
     ORDER BY day.fails DESC, day.jobname
     LIMIT 20
  LOOP
    SELECT EXISTS (SELECT 1 FROM public.ca_guard_inventory g
                    WHERE g.kind = 'cron' AND g.object_a = r.jobname AND g.active)
      INTO v_is_guard;
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_cron_failure_watch', 'unknown',
      CASE WHEN v_is_guard THEN 'critical' ELSE 'warning' END,
      'cron-failing:' || r.jobname || ':' || CURRENT_DATE::text,
      0, NULL, NULL, 'reporting', 'cron.job_run_details',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'scheduled job ' || r.jobname || ' failed ' || r.fails || ' of '
        || (r.fails + r.successes) || ' runs in 24h (last '
        || r.failed_in_a_row || ' of its last 3 failed; last success '
        || COALESCE(r.last_success::text, 'none in 24h') || '). Last error: '
        || COALESCE(r.sample_error, '?'),
      NULL, jsonb_build_object('jobname', r.jobname, 'fails_24h', r.fails,
                               'successes_24h', r.successes,
                               'failed_in_a_row', r.failed_in_a_row,
                               'last_success', r.last_success));
    v_raised := v_raised || r.jobname::text;
    n := n + 1;
  END LOOP;

  /* 2026-11-07: a job failing run after run is raised by its streak, not
     only after two hours with no success at all. Isolated like the ledger
     watch below, so a fault here never stops the rules above, and a failure
     of its own is a critical incident rather than a silent zero. */
  BEGIN
    FOR r IN SELECT f.* FROM public.fn_cron_failing_jobs() f
              WHERE NOT (f.jobname = ANY (v_raised))
    LOOP
      PERFORM public.fn_ca_raise_drift_incident(
        'fn_ca_cron_failure_watch', 'unknown',
        CASE WHEN r.is_guard THEN 'critical' ELSE 'warning' END,
        'cron-failing:' || r.jobname || ':' || CURRENT_DATE::text,
        0, NULL, NULL, 'reporting', 'cron.job_run_details',
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
        'scheduled job ' || r.jobname || ' is failing repeatedly: '
          || r.failed_in_a_row || ' failed runs in a row'
          || COALESCE(' since ' || r.failing_since::text, '')
          || ', ' || r.failed_of_last_20 || ' of its last 20 runs failed (last success '
          || COALESCE(r.last_success::text, 'not in the last ~7 hours') || '). Last error: '
          || COALESCE(r.last_error, '?'),
        NULL, jsonb_build_object('jobname', r.jobname,
                                 'failed_in_a_row', r.failed_in_a_row,
                                 'failing_since', r.failing_since,
                                 'failed_of_last_20', r.failed_of_last_20,
                                 'last_success', r.last_success,
                                 'rule', 'streak'));
      n := n + 1;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_ca_raise_drift_incident(
      'fn_ca_cron_failure_watch', 'unknown', 'critical',
      'cron-failing-streak-read-failed:' || CURRENT_DATE::text,
      NULL, NULL, NULL, 'reporting', 'cron.job_run_details',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'fn_cron_failing_jobs failed, so a job failing run after run cannot be told from a healthy one: ' || SQLERRM,
      NULL, NULL);
  END;

  /* 20261002135708: a ledger refusal the counter saw and no record reached
     becomes an explicit row and a critical incident here. Isolated, so it can
     never stop the cron watch above from reporting, and a failure of its own
     is itself a critical incident rather than a silent zero. */
  BEGIN
    n := n + public.fn_ca_ledger_invariant_refusal_watch();
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.fn_ca_raise_drift_incident(
      'ledger_invariant.refused', 'unknown', 'critical',
      'ledger-invariant-refusal-watch-failed',
      NULL, NULL, NULL, 'ledger', 'chip_store',
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'fn_ca_ledger_invariant_refusal_watch failed, so a ledger refusal whose record was lost cannot be told from no refusal: ' || SQLERRM,
      NULL, NULL);
  END;
  -- A completed run is a re-measurement fn_ca_resolve_cleared_incidents reads.
  INSERT INTO public.ca_detector_runs (detector, detail)
  VALUES ('fn_ca_cron_failure_watch', jsonb_build_object('raised', n));
  RETURN n;
END $function$;

-- Production already allows only service_role (checked 2026-11-07: anon and
-- authenticated false); stated here so this redefinition can never widen it.
REVOKE ALL ON FUNCTION public.fn_ca_cron_failure_watch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_cron_failure_watch() TO service_role;

-- A watched guard redefined here, declared in the same transaction so the
-- guard watch records it rather than raising it.
SELECT public.fn_ca_declare_guard_redefinition('fn_ca_cron_failure_watch', 'migration 20261108020000_a_job_failing_every_run_is_named');

COMMIT;
