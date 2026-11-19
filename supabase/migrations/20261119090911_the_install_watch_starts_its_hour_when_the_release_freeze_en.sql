-- 20261119090911_the_install_watch_starts_its_hour_when_the_release_freeze_en.sql
--
-- Version reserved by scripts/new-migration.mjs against origin/main and every
-- remote branch, so it cannot collide with another agent's in-flight work.
--
-- ============================================================================
-- THE MERGED-MIGRATION INSTALL WATCH STARTS ITS HOUR WHEN THE NIGHTLY RELEASE
-- SCHEMA FREEZE ENDS (Production Alerts fleet, incident
-- migration-watch-blind-to-release-freeze; alerts 445153, 445160, 445175,
-- 445176, 445189, 445190, 445199, 445213, 445214)
-- ============================================================================
--
-- WHAT WENT WRONG (read from rows and Actions runs, 2026-11-19):
-- #11319 (2026-11-18 20:47Z) added RELEASE_SCHEMA_FREEZE_CHICAGO to
-- scripts/ci/merged-migration-dispatch.mjs: an ordinary merged migration
-- merged between 23:45 and 04:15 America/Chicago is held, by design, inside
-- its own Dispatch Merged Migrations run until 04:15, so the 00:07 Backup copy
-- still equals production when the 03:30 selector certifies tonight's engine.
-- On its first night nine files merged inside it (20261119013426, 050653,
-- 052731, 052600, 015312, 013430, 054539, 053144, 052955), every one held by
-- an in-progress dispatcher run (e.g. 44471745840). The install watch knew
-- nothing of the freeze: it measured its hour from merged_at and paged the
-- owner nine times between 06:40Z and 07:40Z, critical, "Dispatch Apply
-- Merged Migration for it". Followed, that instruction installs after the
-- Backup copy, stales the certificate, and the 04:00 cutover keeps serving
-- the old engine - the exact failure the freeze exists to prevent. The page
-- was the wrong signal at the wrong time, the same shape 20261117165416 fixed
-- for an owner-window pause. (The first of the nine was also a real refusal,
-- BOARD_MOVED in run 44466273298, fixed in place by its owner in #11362; this
-- change does not hide such a refusal, it moves its page to the hour after
-- the freeze, when re-dispatching is the right action.)
--
-- THE ROOT FIX:
--   * smarter_private.fn_ca_release_schema_freeze_end(ts) answers the end of
--     the nightly release schema freeze containing ts (IANA America/Chicago,
--     so both DST offsets), or NULL outside it. Its bounds are the
--     dispatcher's RELEASE_SCHEMA_FREEZE_CHICAGO, and
--     tests/the-install-watch-reads-the-release-freeze-the-dispatcher-holds.law.test.ts
--     refuses any drift between the two;
--   * smarter_private.fn_ca_install_watch_freeze_hold_end(merged_at) answers
--     that end when the file's first hour touches the freeze (merged inside
--     it, or merged within the hour before it), else NULL. The freeze lasts
--     four and a half hours, so an hour that touches it has one end inside it;
--   * in fn_ca_merged_migration_install_watch the hour of such a file starts
--     at the freeze end: a merge at 00:22 Chicago is quiet at 01:22 and pages
--     at 05:15 if it is still not installed. A daytime merge keeps its hour
--     from the merge, exactly as before, and the pause hold is untouched.
-- It still never installs, dispatches, retries or repairs anything.
--
-- The amendment is the guarded replace(pg_get_functiondef(...)) pattern of
-- 20261117165416: the live definition must hash to the expected preimage
-- (md5 3ebd1409de27bdefc7aaa6a850f953af, read on production 2026-11-19
-- 09:10Z), its anchor must occur exactly once, the result is compiled and
-- read back. Re-running this file changes nothing.
--
-- Native proof: scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py
-- (cases "the release freeze ..."; they fail with MIGWATCH_PRE_FREEZE=1, i.e.
-- on the live definition). CI: .github/workflows/a-merged-migration-left-uninstalled-is-paged.yml.
--
-- @probe-exempt: public.fn_ca_merged_migration_install_watch every run issues live GET requests to the GitHub API through extensions.http and pages through the owner route; its body is executed end to end by the native proof named above, and the freeze helpers it calls are asserted below before COMMIT
--
-- periodic-work: a detector that pages a person; it moves no money, seats, lobbies, releases or schema, retries nothing and repairs nothing. It must run from the database clock because the failure it reports is an install event that never happened.
-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'THE RELEASE FREEZE HOLDS THE HOUR (20261119090911)') > 0 AND strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'INSTALLS SWITCHED OFF HOLD THE PAGE (20261117165416)') > 0 AND smarter_private.fn_ca_release_schema_freeze_end('2026-11-19 06:22:54+00') = '2026-11-19 10:15:00+00' AND smarter_private.fn_ca_release_schema_freeze_end('2026-07-15 05:00:00+00') = '2026-07-15 09:15:00+00' AND smarter_private.fn_ca_release_schema_freeze_end('2026-11-19 16:00:00+00') IS NULL AND NOT has_function_privilege('anon', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-merged-migration-install-watch-10m' AND active)

BEGIN;

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- The nightly release schema freeze: 23:45 to 04:15 America/Chicago, wrapping
-- midnight. Bounds = RELEASE_SCHEMA_FREEZE_CHICAGO in
-- scripts/ci/merged-migration-dispatch.mjs (minute of day: 23:45:30 is inside,
-- 04:15:00 is outside), pinned equal by the law test named in the header.
CREATE OR REPLACE FUNCTION smarter_private.fn_ca_release_schema_freeze_end(p_at timestamptz)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
           WHEN s.l::time >= time '23:45' THEN ((s.l::date + 1) + time '04:15') AT TIME ZONE 'America/Chicago'
           WHEN s.l::time <  time '04:15' THEN (s.l::date + time '04:15') AT TIME ZONE 'America/Chicago'
         END
    FROM (SELECT p_at AT TIME ZONE 'America/Chicago' AS l) s
$function$;

COMMENT ON FUNCTION smarter_private.fn_ca_release_schema_freeze_end(timestamptz) IS
  'End of the nightly release schema freeze (23:45-04:15 America/Chicago) containing p_at, NULL outside it. Bounds = RELEASE_SCHEMA_FREEZE_CHICAGO (scripts/ci/merged-migration-dispatch.mjs). 20261119090911.';

-- The freeze end that a file's first hour after merge runs into, or NULL.
CREATE OR REPLACE FUNCTION smarter_private.fn_ca_install_watch_freeze_hold_end(p_merged_at timestamptz)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT COALESCE(smarter_private.fn_ca_release_schema_freeze_end(p_merged_at),
                  smarter_private.fn_ca_release_schema_freeze_end(p_merged_at + interval '60 minutes'))
$function$;

COMMENT ON FUNCTION smarter_private.fn_ca_install_watch_freeze_hold_end(timestamptz) IS
  'Freeze end the install watch starts a file''s hour from when its first hour after merge touches the nightly release schema freeze; NULL otherwise. 20261119090911.';

REVOKE ALL ON FUNCTION smarter_private.fn_ca_release_schema_freeze_end(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.fn_ca_install_watch_freeze_hold_end(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION smarter_private.fn_ca_release_schema_freeze_end(timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION smarter_private.fn_ca_install_watch_freeze_hold_end(timestamptz) TO service_role;

-- The helpers answer the dispatcher's clock before anything uses them.
DO $assert$
BEGIN
  IF smarter_private.fn_ca_release_schema_freeze_end('2026-11-19 06:22:54+00') IS DISTINCT FROM '2026-11-19 10:15:00+00'::timestamptz  -- 00:22 CST
     OR smarter_private.fn_ca_release_schema_freeze_end('2026-11-19 05:45:00+00') IS DISTINCT FROM '2026-11-19 10:15:00+00'::timestamptz  -- 23:45 CST
     OR smarter_private.fn_ca_release_schema_freeze_end('2026-11-19 05:44:59+00') IS NOT NULL                                          -- 23:44 CST
     OR smarter_private.fn_ca_release_schema_freeze_end('2026-11-19 10:15:00+00') IS NOT NULL                                          -- 04:15 CST
     OR smarter_private.fn_ca_release_schema_freeze_end('2026-07-15 05:00:00+00') IS DISTINCT FROM '2026-07-15 09:15:00+00'::timestamptz  -- 00:00 CDT
     OR smarter_private.fn_ca_release_schema_freeze_end('2026-11-01 05:00:00+00') IS DISTINCT FROM '2026-11-01 10:15:00+00'::timestamptz  -- 00:00 CDT, ends 04:15 CST
     OR smarter_private.fn_ca_release_schema_freeze_end('2026-11-19 16:00:00+00') IS NOT NULL                                          -- 10:00 CST
     OR smarter_private.fn_ca_install_watch_freeze_hold_end('2026-11-19 05:30:00+00') IS DISTINCT FROM '2026-11-19 10:15:00+00'::timestamptz  -- 23:30 CST, hour ends inside
     OR smarter_private.fn_ca_install_watch_freeze_hold_end('2026-11-19 04:40:00+00') IS NOT NULL THEN                                  -- 22:40 CST, hour ends before
    RAISE EXCEPTION 'MIGRATION_WATCH_FREEZE_CLOCK_WRONG';
  END IF;
END
$assert$;

DO $amend$
DECLARE
  v_sig constant regprocedure := 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure;
  v_def text := pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure);
  v_new text;
  v_anchor constant text :=
$a1$      OR (v_pause_ended IS NOT NULL AND v_row.merged_at <= v_pause_ended AND p_at < v_pause_ended + interval '60 minutes');$a1$;
  v_with constant text :=
$w1$      OR (v_pause_ended IS NOT NULL AND v_row.merged_at <= v_pause_ended AND p_at < v_pause_ended + interval '60 minutes')
      -- THE RELEASE FREEZE HOLDS THE HOUR (20261119090911). An ordinary file
      -- whose first hour touches the nightly release schema freeze (23:45 to
      -- 04:15 Chicago) is held by its own dispatcher run until 04:15 so the
      -- Backup copy still equals production at 03:30; dispatching it by hand
      -- would stale tonight's certificate. Its hour starts at the freeze end,
      -- so a file still not installed at 05:15 pages exactly as before.
      OR p_at < COALESCE(smarter_private.fn_ca_install_watch_freeze_hold_end(v_row.merged_at), '-infinity'::timestamptz) + interval '60 minutes';$w1$;
BEGIN
  IF strpos(v_def, 'THE RELEASE FREEZE HOLDS THE HOUR (20261119090911)') > 0 THEN
    RAISE NOTICE 'fn_ca_merged_migration_install_watch already starts its hour at the freeze end';
    RETURN;
  END IF;
  IF md5(v_def) <> '3ebd1409de27bdefc7aaa6a850f953af' THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_PREIMAGE_CHANGED: fn_ca_merged_migration_install_watch is %', md5(v_def);
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_ANCHOR_NOT_ONCE: freeze anchor of fn_ca_merged_migration_install_watch';
  END IF;
  v_new := replace(v_def, v_anchor, v_with);
  EXECUTE v_new;
  IF strpos(pg_get_functiondef(v_sig), 'THE RELEASE FREEZE HOLDS THE HOUR (20261119090911)') = 0
     OR strpos(pg_get_functiondef(v_sig), 'fn_ca_install_watch_freeze_hold_end(v_row.merged_at)') = 0
     OR strpos(pg_get_functiondef(v_sig), 'INSTALLS SWITCHED OFF HOLD THE PAGE (20261117165416)') = 0 THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_AMENDMENT_NOT_READ_BACK';
  END IF;
END
$amend$;

-- CREATE OR REPLACE keeps the owner, ACL and proconfig; restate the grants the
-- earlier migrations set so the live proof's privilege checks hold either way.
REVOKE ALL ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) TO service_role;

COMMIT;
