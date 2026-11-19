-- 20261119182637_the_cutover_watch_owes_the_build_the_freeze_can_ship.sql
--
-- WHAT THIS CHANGES, AND WHY (incident 076ff467, EngineCutoverMissed):
--
-- fn_ca_engine_cutover_watch decides at 04:30 Chicago which engine build was
-- owed at 04:00 and pages when production does not hold it. It owed the
-- newest engine-runtime commit merged before the 03:30 selection. Inside the
-- nightly release schema freeze (00:45-04:15 Chicago,
-- scripts/ci/merged-migration-dispatch.mjs RELEASE_SCHEMA_FREEZE_CHICAGO) a
-- commit that carries, or descends from, a held migration can never pass the
-- 03:30 contents judge ("Backup copy lacks the exact candidate migration(s)"):
-- its migration installs at 04:15, after the cutover. So on 2026-11-19 the
-- watch owed 9c5f760d (merged 02:52 Chicago, its migration held until 04:15)
-- and paged for a build the release design had already deferred to the next
-- morning.
--
-- The build the 04:00 cutover can ship is the one the Backup certifies on
-- tonight's frozen copy (scripts/ci/backup-freeze-baseline.py, run by the
-- backup-engine.yml plan job): the newest server commit merged at least 30
-- minutes before the freeze began. The watch now owes that build, read with
-- the same cutoff (freeze start 00:45 minus 30 minutes = 00:15 Chicago on the
-- cutover date). Everything else is unchanged: a newer build that ships still
-- satisfies the watch (it contains the owed one), the reasons it names are
-- the same, and an open alarm still closes once production holds its build.
--
-- Anchored edit of production's own definition (prosrc md5
-- 679981e63a1a85b011177e8eb45f8571 at authoring); the anchor must match once.
-- Pinned by tests/the-four-am-build-is-certified-against-the-frozen-copy.law.test.ts.
--
-- @probe-exempt: public.fn_ca_engine_cutover_watch the watch calls GitHub and engine.smarter.poker over extensions.http, which a probe must not do from an install transaction; its 5-minute cron runs it right after install

BEGIN;

SET LOCAL lock_timeout = '4s';

DO $edit$
DECLARE
  v_def text := pg_get_functiondef('public.fn_ca_engine_cutover_watch(timestamp with time zone)'::regprocedure);
  c_old constant text := 'v_owed := smarter_private.ca_cutover_owed_build(v_serving, v_cutoff);';
  c_new constant text := '-- The build the freeze can ship: merged by 00:15 Chicago (freeze start 00:45'
    || chr(10) || '  -- minus 30 minutes, scripts/ci/backup-freeze-baseline.py SETTLE), 20261119182637.'
    || chr(10) || '  v_owed := smarter_private.ca_cutover_owed_build(v_serving, least(v_cutoff, (v_day + time ''00:15'') AT TIME ZONE c_tz));';
BEGIN
  IF (length(v_def) - length(replace(v_def, c_old, ''))) / length(c_old) <> 1 THEN
    RAISE EXCEPTION 'fn_ca_engine_cutover_watch owed-build anchor did not match exactly once';
  END IF;
  EXECUTE replace(v_def, c_old, c_new);
END
$edit$;

DO $verify$
BEGIN
  IF strpos(pg_get_functiondef('public.fn_ca_engine_cutover_watch(timestamp with time zone)'::regprocedure),
            '(v_day + time ''00:15'') AT TIME ZONE c_tz') = 0 THEN
    RAISE EXCEPTION 'fn_ca_engine_cutover_watch did not take the freeze-baseline cutoff';
  END IF;
END
$verify$;

COMMIT;
