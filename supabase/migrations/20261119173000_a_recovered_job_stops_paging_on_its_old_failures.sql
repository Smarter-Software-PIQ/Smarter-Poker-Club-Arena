-- 20261119173000_a_recovered_job_stops_paging_on_its_old_failures.sql
--
-- A RECOVERED JOB STOPS PAGING ON ITS OLD FAILURES (fn_ca_cron_failure_watch, 2026-11-19)
--
-- WHAT WAS WRONG, READ FROM ROWS (production, 2026-11-19 ~17:25 UTC)
--
-- sp-daily-metrics-snapshot (15,45 5-12 * * *) failed ten of its runs between
-- 06:15 and 11:15 UTC and has succeeded at 11:45, 12:15 and 12:45, every run
-- since. The watch's majority rule (fails >= 5 AND fails > successes, over a
-- 24 h lookback) still counted 10 failed of 16 and re-raised drift incident
-- c44da3ce on every tick (19 occurrences, escalation 3). The job does not run
-- again until 05:15 tomorrow, so nothing short of the window sliding past
-- 11:15 tomorrow could have cleared it: a page about a fix that had been live
-- for a day.
--
-- THE FIX
--
-- The majority rule now skips a job that has RECOVERED: its newest finished
-- runs form an unbroken streak of successes at least three long, and longer
-- than any clean stretch it had inside the last 24 h BETWEEN two failures.
-- The second half is what keeps an intermittent job visible: a job that goes
-- green for three runs and fails again has already shown a three-run streak is
-- not a recovery, so it must beat that before it counts as recovered. The
-- healthy stretch before a job first broke is not between failures and does
-- not count (otherwise a job healthy all night could never recover by noon).
--   sp-daily-metrics-snapshot today, newest first: sss ff s ffffffff ss|...
--   newest streak 3; the one clean stretch between failures is 10:15 (1).
--   3 > 1: recovered. The watch stops raising it and the incident closes.
-- The consecutive-failure rule (three in a row, no success for two hours) and
-- the streak rule (fn_cron_failing_jobs) are untouched; a recovered job meets
-- neither. When the watch stops raising, fn_ca_resolve_cleared_incidents
-- closes the incident on its next pass ('verified_remeasured'); if the job
-- fails again the next tick raises it again.
--
-- Pinned pre/postimage substitution; a re-apply is a no-op.
--
-- @live-proof: position('recovered rc WHERE rc.jobid = day.jobid' in pg_get_functiondef('public.fn_ca_cron_failure_watch()'::regprocedure)) > 0

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

CREATE FUNCTION pg_temp.cfw_subst(p_sig text, p_before text, p_after text,
                                  p_old text[], p_new text[])
RETURNS void LANGUAGE plpgsql AS $h$
DECLARE
  v_def text; v_new text; v_n integer; i integer;
  v_acl text; v_owner text; v_secdef boolean; v_cfg text[];
BEGIN
  v_def := pg_get_functiondef(p_sig::regprocedure);
  IF md5(v_def) = p_after THEN
    RAISE NOTICE '%: already the postimage, nothing to do', p_sig;
    RETURN;
  END IF;
  IF md5(v_def) <> p_before THEN
    RAISE EXCEPTION '% is not the pinned text (md5 %)', p_sig, md5(v_def);
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(p_old, 1) LOOP
    v_n := (length(v_new) - length(replace(v_new, p_old[i], ''))) / length(p_old[i]);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: anchor % occurs % times, expected exactly 1', p_sig, i, v_n;
    END IF;
    v_new := replace(v_new, p_old[i], p_new[i]);
  END LOOP;
  IF md5(v_new) <> p_after THEN
    RAISE EXCEPTION '%: substituted text is not the derived postimage (md5 %)', p_sig, md5(v_new);
  END IF;
  SELECT p.proacl::text, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    INTO v_acl, v_owner, v_secdef, v_cfg
    FROM pg_proc p WHERE p.oid = p_sig::regprocedure;
  EXECUTE v_new;
  IF md5(pg_get_functiondef(p_sig::regprocedure)) <> p_after THEN
    RAISE EXCEPTION '%: the replaced function does not read back as the postimage', p_sig;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = p_sig::regprocedure
                    AND p.proacl::text IS NOT DISTINCT FROM v_acl
                    AND pg_get_userbyid(p.proowner) = v_owner
                    AND p.prosecdef = v_secdef
                    AND p.proconfig IS NOT DISTINCT FROM v_cfg) THEN
    RAISE EXCEPTION '%: owner, security, settings or grants moved', p_sig;
  END IF;
END $h$;

SELECT pg_temp.cfw_subst(
  'public.fn_ca_cron_failure_watch()',
  '527df2af34fa21e074e6a27a46e08cbd', 'a12fa874f03893621417846c56500c99',
  ARRAY[
$o1$    ),
    day AS (
      SELECT j.jobid, j.jobname,$o1$,
$o2$        OR (day.fails >= 5 AND day.fails > day.successes)
     ORDER BY day.fails DESC, day.jobname$o2$],
  ARRAY[
$n1$    ),
    -- A RECOVERED JOB STOPS PAGING ON ITS OLD FAILURES (20261119173000).
    -- Islands of consecutive finished runs, newest first, from the same pass.
    islands AS (
      SELECT y.jobid, y.status, min(y.finished_rank) AS first_rank,
             count(*) FILTER (WHERE y.in_day) AS day_len, count(*) AS len
        FROM (SELECT x.jobid, x.status, x.in_day, x.finished_rank,
                     x.finished_rank - row_number() OVER (PARTITION BY x.jobid, x.status
                                                          ORDER BY x.finished_rank) AS grp
                FROM runs x
               WHERE x.finished_rank IS NOT NULL) y
       GROUP BY y.jobid, y.status, y.grp
    ),
    -- Recovered: the newest finished runs are an unbroken streak of at least
    -- three successes, longer than any clean stretch inside the last 24 h
    -- that sat BETWEEN failures (a failure before it and after it). A job
    -- failing on and off has shown that a streak of that length is not a
    -- recovery, so it stays raised until it beats it. The healthy stretch
    -- before a job first broke is not such a stretch and does not count.
    recovered AS (
      SELECT t.jobid
        FROM islands t
       WHERE t.status = 'succeeded' AND t.first_rank = 1 AND t.len >= 3
         AND t.len > COALESCE((SELECT max(p.day_len) FROM islands p
                                WHERE p.jobid = t.jobid AND p.status = 'succeeded'
                                  AND p.first_rank > 1
                                  AND EXISTS (SELECT 1 FROM islands q
                                               WHERE q.jobid = p.jobid AND q.status = 'failed'
                                                 AND q.first_rank > p.first_rank
                                                 AND q.day_len > 0)), 0)
    ),
    day AS (
      SELECT j.jobid, j.jobname,$n1$,
$n2$        OR (day.fails >= 5 AND day.fails > day.successes
            AND NOT EXISTS (SELECT 1 FROM recovered rc WHERE rc.jobid = day.jobid))
     ORDER BY day.fails DESC, day.jobname$n2$]);

-- @probe-for: public.fn_ca_cron_failure_watch
DO $probe$
BEGIN
  PERFORM public.fn_ca_cron_failure_watch();
  RAISE EXCEPTION 'probe-unwind';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM <> 'probe-unwind' THEN RAISE; END IF;
END $probe$;

COMMIT;
