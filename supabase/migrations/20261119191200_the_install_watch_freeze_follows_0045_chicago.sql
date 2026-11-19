-- 20261119191200_the_install_watch_freeze_follows_0045_chicago.sql
--
-- Align smarter_private.ca_release_schema_freeze_holds and
-- smarter_private.ca_merged_migration_install_due_at with PR #11413, which
-- moved RELEASE_SCHEMA_FREEZE_CHICAGO in scripts/ci/merged-migration-dispatch.mjs
-- from 23:45-04:15 (midnight-wrapping) to 00:45-04:15 America/Chicago (same-day).
--
-- @live-proof: NOT smarter_private.ca_release_schema_freeze_holds('2026-11-19 06:44:59+00') AND smarter_private.ca_release_schema_freeze_holds('2026-11-19 06:45:00+00') AND smarter_private.ca_release_schema_freeze_holds('2026-11-19 10:14:59+00') AND NOT smarter_private.ca_release_schema_freeze_holds('2026-11-19 10:15:00+00') AND smarter_private.ca_merged_migration_install_due_at('2026-11-19 06:48:00+00') = '2026-11-19 11:15:00+00' AND smarter_private.ca_merged_migration_install_due_at('2026-11-19 06:22:00+00') = '2026-11-19 07:22:00+00'

BEGIN;
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '8s';

-- The dispatcher's nightly release schema freeze, read exactly as
-- scripts/ci/merged-migration-dispatch.mjs inReleaseSchemaFreeze() reads it:
-- America/Chicago wall clock, [00:45, 04:15), same calendar day.
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
-- freeze [00:45, 04:15) that instant is 04:15 Central on the same local date.
CREATE OR REPLACE FUNCTION smarter_private.ca_merged_migration_install_due_at(p_clock timestamptz)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
           WHEN p_clock IS NULL THEN NULL
           WHEN smarter_private.ca_release_schema_freeze_holds(p_clock) THEN
             ((p_clock AT TIME ZONE 'America/Chicago')::date + time '04:15')
               AT TIME ZONE 'America/Chicago'
           ELSE p_clock
         END + interval '60 minutes'
$function$;

REVOKE ALL ON FUNCTION smarter_private.ca_release_schema_freeze_holds(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.ca_merged_migration_install_due_at(timestamptz) FROM PUBLIC, anon, authenticated;

-- @probe-for: smarter_private.ca_release_schema_freeze_holds
-- @probe-for: smarter_private.ca_merged_migration_install_due_at
DO $helpers$
BEGIN
  IF smarter_private.ca_release_schema_freeze_holds('2026-11-19 06:44:59+00')            -- 00:44:59 CST
     OR NOT smarter_private.ca_release_schema_freeze_holds('2026-11-19 06:45:00+00')     -- 00:45 CST
     OR NOT smarter_private.ca_release_schema_freeze_holds('2026-11-19 10:14:59+00')     -- 04:14:59 CST
     OR smarter_private.ca_release_schema_freeze_holds('2026-11-19 10:15:00+00')         -- 04:15 CST
     OR smarter_private.ca_release_schema_freeze_holds('2026-07-01 05:44:00+00')         -- 00:44 CDT
     OR NOT smarter_private.ca_release_schema_freeze_holds('2026-07-01 05:45:00+00') THEN -- 00:45 CDT
    RAISE EXCEPTION 'RELEASE_FREEZE_HELPER_WRONG';
  END IF;
  IF smarter_private.ca_merged_migration_install_due_at('2026-11-19 06:48:00+00') <> '2026-11-19 11:15:00+00'
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 06:22:00+00') <> '2026-11-19 07:22:00+00'
     OR smarter_private.ca_merged_migration_install_due_at('2026-07-01 06:00:00+00') <> '2026-07-01 10:15:00+00' THEN
    RAISE EXCEPTION 'INSTALL_DUE_AT_HELPER_WRONG';
  END IF;
END $helpers$;

COMMIT;
