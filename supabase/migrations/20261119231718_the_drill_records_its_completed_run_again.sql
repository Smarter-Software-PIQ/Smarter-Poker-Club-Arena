-- 20261119231718_the_drill_records_its_completed_run_again.sql
--
-- WHAT THIS CHANGES, AND WHY (incident 316ed735, fn_ca_cron_failure_watch):
--
-- 20261119183127 made fn_ca_alarm_drill record each completed run in
-- ca_detector_runs (detector fn_ca_alarm_drill), and fn_ca_cron_failure_watch
-- reads that row as proof that a failed ca-alarm-drill-weekly run no longer
-- holds. 20261119180800, lower-versioned but merged and installed after it,
-- redefined fn_ca_alarm_drill from an older body without that INSERT. The
-- drill then passed all eleven arms at 21:44 UTC on 2026-11-19 (ca_alarm_drills
-- id 13) and recorded nothing, so drift incident 28e0b04d kept re-raising the
-- 2026-11-16 failure every 30 minutes.
--
-- This puts the record back on production's current body by an anchored edit
-- (the final RETURN of a drill that had a subject; the anchor must match
-- once). Nothing else in the drill changes. The class of failure, an older
-- version overwriting a newer function body, is now refused at merge by
-- scripts/ci/check-new-migration-version-collisions.mjs.
-- Pinned by tests/a-newer-function-body-is-never-overwritten.law.test.ts.
--
-- @probe-exempt: public.fn_ca_alarm_drill the drill locks live money rows and runs every watcher, which an install transaction under the 12 s budget must not hold; it is run once live after install, and weekly by its cron

BEGIN;

SET LOCAL lock_timeout = '4s';

DO $edit$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_alarm_drill()'::regprocedure);
  c_old constant text := '  RETURN jsonb_build_object(''pass'', cardinality(v_failing) = 0,';
  c_new constant text := '  -- A COMPLETED DRILL IS A RUN OF ITS JOB (20261119183127, restored after'
    || chr(10) || '  -- 20261119180800 overwrote it): fn_ca_cron_failure_watch reads this row as'
    || chr(10) || '  -- proof that a failed ca-alarm-drill-weekly run no longer holds.'
    || chr(10) || '  INSERT INTO public.ca_detector_runs (detector, detail)'
    || chr(10) || '  VALUES (''fn_ca_alarm_drill'', jsonb_build_object(''pass'', cardinality(v_failing) = 0,'
    || chr(10) || '                                                  ''failing'', v_failing,'
    || chr(10) || '                                                  ''club_id'', c_midway_club));'
    || chr(10) || chr(10) || c_old;
BEGIN
  IF strpos(v_def, 'INSERT INTO public.ca_detector_runs') > 0 THEN
    RAISE NOTICE 'fn_ca_alarm_drill already records its run';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_alarm_drill final RETURN anchor did not match exactly once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END
$edit$;

DO $verify$
BEGIN
  IF strpos(pg_get_functiondef('public.fn_ca_alarm_drill()'::regprocedure),
            'INSERT INTO public.ca_detector_runs (detector, detail)') = 0 THEN
    RAISE EXCEPTION 'fn_ca_alarm_drill does not record its completed run';
  END IF;
END
$verify$;

-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_alarm_drill()'::regprocedure), 'INSERT INTO public.ca_detector_runs (detector, detail)') > 0

COMMIT;
