-- 20261119195420_the_install_watch_clock_follows_the_0045_schema_hold.sql
--
-- ============================================================================
-- THE INSTALL WATCH'S CLOCK FOLLOWS THE DISPATCHER'S 00:45 SCHEMA HOLD
-- ============================================================================
--
-- WHAT WENT WRONG (2026-11-19): #11413 moved the dispatcher's nightly release
-- schema hold from 23:45-04:15 to 00:45-04:15 Central
-- (RELEASE_SCHEMA_FREEZE_CHICAGO in scripts/ci/merged-migration-dispatch.mjs)
-- and left the database's copy of that clock at 23:45. The two clocks that
-- 20261119064912 tied together disagreed again, so
-- tests/the-install-watch-hour-starts-when-the-dispatcher-may-send.law.test.ts
-- failed on main for every pull request from 18:10 UTC and nothing could merge.
-- In production the watch treated a file merged between 23:45 and 00:45 as
-- held to 04:15 although the dispatcher now sends it at once: a failed install
-- in that hour would page up to five hours late and tell the reader not to
-- dispatch.
--
-- THE FIX: the two helpers read the hold exactly as the dispatcher does,
-- [00:45, 04:15) America/Chicago, inside one calendar day, so a held file is
-- due at 04:15 of its own Central date. The watch function itself is
-- unchanged: it calls these helpers. Its page still words the hold as
-- "23:45-04:15 Central"; the law pins the clocks, not that sentence.
--
-- Native proof: scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py.
--
-- @live-proof: smarter_private.ca_release_schema_freeze_holds('2026-11-19 06:45:00+00') AND NOT smarter_private.ca_release_schema_freeze_holds('2026-11-19 06:44:59+00') AND NOT smarter_private.ca_release_schema_freeze_holds('2026-11-19 05:45:00+00') AND smarter_private.ca_merged_migration_install_due_at('2026-11-19 05:48:05+00') = '2026-11-19 06:48:05+00'

BEGIN;
SET LOCAL lock_timeout = '5s';

-- The dispatcher's nightly release schema hold, read exactly as
-- scripts/ci/merged-migration-dispatch.mjs inReleaseSchemaFreeze() reads it:
-- America/Chicago wall clock, [00:45, 04:15).
CREATE OR REPLACE FUNCTION smarter_private.ca_release_schema_freeze_holds(p_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT (p_at AT TIME ZONE 'America/Chicago')::time >= time '00:45'
     AND (p_at AT TIME ZONE 'America/Chicago')::time <  time '04:15'
$function$;

-- When a file merged (or fixed in place) at p_clock is overdue: the first
-- instant the dispatcher may send it, plus the watch's 60 minutes. Inside the
-- hold that instant is the next 04:15 Central at or after p_clock.
CREATE OR REPLACE FUNCTION smarter_private.ca_merged_migration_install_due_at(p_clock timestamptz)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
           WHEN p_clock IS NULL THEN NULL
           WHEN smarter_private.ca_release_schema_freeze_holds(p_clock) THEN
             ((p_clock AT TIME ZONE 'America/Chicago')::date + time '04:15') AT TIME ZONE 'America/Chicago'
           ELSE p_clock
         END + interval '60 minutes'
$function$;

REVOKE ALL ON FUNCTION smarter_private.ca_release_schema_freeze_holds(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.ca_merged_migration_install_due_at(timestamptz) FROM PUBLIC, anon, authenticated;

-- The helpers prove fixed instants before anything uses them (CST and CDT).
DO $helpers$
BEGIN
  IF smarter_private.ca_release_schema_freeze_holds('2026-11-19 05:45:00+00')            -- 23:45 CST: no longer held
     OR smarter_private.ca_release_schema_freeze_holds('2026-11-19 06:44:59+00')         -- 00:44:59 CST
     OR NOT smarter_private.ca_release_schema_freeze_holds('2026-11-19 06:45:00+00')     -- 00:45 CST
     OR NOT smarter_private.ca_release_schema_freeze_holds('2026-11-19 10:14:59+00')     -- 04:14:59 CST
     OR smarter_private.ca_release_schema_freeze_holds('2026-11-19 10:15:00+00')         -- 04:15 CST
     OR smarter_private.ca_release_schema_freeze_holds('2026-07-01 05:44:00+00')         -- 00:44 CDT
     OR NOT smarter_private.ca_release_schema_freeze_holds('2026-07-01 05:45:00+00') THEN -- 00:45 CDT
    RAISE EXCEPTION 'RELEASE_FREEZE_HELPER_WRONG';
  END IF;
  IF smarter_private.ca_merged_migration_install_due_at('2026-11-19 05:48:05+00') <> '2026-11-19 06:48:05+00'     -- 23:48 CST, before the hold: +60
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 06:50:00+00') <> '2026-11-19 11:15:00+00'  -- 00:50 CST -> 04:15 + 60
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 10:14:59+00') <> '2026-11-19 11:15:00+00'  -- 04:14:59 CST -> 04:15 + 60
     OR smarter_private.ca_merged_migration_install_due_at('2026-07-01 06:00:00+00') <> '2026-07-01 10:15:00+00'  -- 01:00 CDT -> 04:15 CDT + 60
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 16:00:00+00') <> '2026-11-19 17:00:00+00'  -- daytime: +60
     OR smarter_private.ca_merged_migration_install_due_at(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'INSTALL_DUE_HELPER_WRONG';
  END IF;
END
$helpers$;

COMMIT;
