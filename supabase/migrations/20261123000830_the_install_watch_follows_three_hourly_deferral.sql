-- 20261123000830_the_install_watch_follows_three_hourly_deferral.sql
--
-- ============================================================================
-- THE MERGED-MIGRATION INSTALL WATCH FOLLOWS THREE-HOURLY O3 DEFERRAL
-- (reliability incident ba9d1133, MergedMigrationNotInstalled, alerts 447640/447641)
-- ============================================================================
--
-- WHAT WENT WRONG (read from rows and Actions runs, 2026-11-22 21:31-22:48 UTC):
--   1. Optimization O3 (2026-11-21) taught scripts/ci/merged-migration-dispatch.mjs
--      to defer ordinary merged migrations during three-hourly engine cutover
--      windows [cycleStart - 90m, cycleStart + 10m) America/Chicago for
--      THREE_HOURLY_START_HOURS = [1, 4, 7, 10, 13, 16, 19, 22] (with 04:00
--      already covered by RELEASE_SCHEMA_FREEZE_CHICAGO 23:45-04:15).
--   2. smarter_private.ca_merged_migration_install_due_at(timestamptz) and
--      public.fn_ca_merged_migration_install_watch(timestamptz) (20261119064912)
--      only knew RELEASE_SCHEMA_FREEZE_CHICAGO, so they kept counting O3
--      deferral minutes against the 60-minute page clock.
--   3. On 2026-11-22, 20261122203048 (merged 21:31:17Z / 15:31 CST) and
--      20261122192807 (merged 21:35:11Z / 15:35 CST) were deferred on purpose
--      until 22:10Z (16:10 CST). At 22:40Z (only 30 minutes after the
--      dispatcher was allowed to send them), the watch fired CRITICAL alerts
--      447640 and 447641 saying "Dispatch Apply Merged Migration for it". Both
--      files finished installing by 22:48Z (38 minutes after 22:10Z). Worse, a
--      healthy migration merged at 14:31 CST is deferred 99 minutes to 16:10
--      CST, so the watch would page at 15:40 CST (30 minutes BEFORE dispatch is
--      admitted) and tell the reader to hand-dispatch inside the cutover hold.
--
-- THE ROOT FIX (one pure helper, one updated due-at helper, one watch amendment):
--   * smarter_private.ca_three_hourly_deferral_clears_at(p_at): exact DST-aware
--     SQL equivalent of threeHourlyDeferralWindow() in merged-migration-dispatch.mjs.
--     Returns cycle_start + 10m when p_at falls inside [cycle_start - 90m,
--     cycle_start + 10m) for any non-04:00 three-hourly cycle start in
--     America/Chicago (first 01:00 only on fall-back day); NULL otherwise.
--   * smarter_private.ca_merged_migration_install_due_at(p_clock): advances
--     p_clock to ca_three_hourly_deferral_clears_at(p_clock) first, then
--     applies ca_release_schema_freeze_holds(released_at) (handling 23:30-23:44
--     Central where the 01:00 O3 deferral meets the 23:45-04:15 nightly freeze),
--     then adds 60 minutes.
--   * public.fn_ca_merged_migration_install_watch(p_at): a page raised while
--     ca_three_hourly_deferral_clears_at(p_at) IS NOT NULL says NOT to
--     hand-dispatch Apply Merged Migration, naming the Central clear time.
--
-- Constants are pinned to merged-migration-dispatch.mjs and
-- server/src/maintenance/maintenanceSchedulePolicy.json by
-- tests/the-install-watch-hour-starts-when-the-dispatcher-may-send.law.test.ts.
-- Native proof: scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py.
--
-- periodic-work: a detector that pages a person; it moves no money, seats, lobbies, releases or schema, retries nothing and repairs nothing. It must run from the database clock because the failure it reports is an install event that never happened.
-- @probe-exempt: public.fn_ca_merged_migration_install_watch every call performs live GitHub API GETs (commits, raw files, workflow state) through extensions.http, an external call a rolled-back probe cannot undo; its body is executed end to end by the native proof scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py against a fake GitHub
-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'THREE-HOURLY CUTOVER DEFERRAL HOLDS THE PAGE (20261123000830)') > 0 AND to_regprocedure('smarter_private.ca_three_hourly_deferral_clears_at(timestamp with time zone)') IS NOT NULL AND smarter_private.ca_merged_migration_install_due_at('2026-11-22 21:35:11+00') = '2026-11-22 23:10:00+00' AND smarter_private.ca_merged_migration_install_due_at('2026-11-19 05:30:00+00') = '2026-11-19 11:15:00+00' AND NOT has_function_privilege('anon', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('anon', 'smarter_private.ca_three_hourly_deferral_clears_at(timestamp with time zone)', 'EXECUTE') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-merged-migration-install-watch-10m' AND active)

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Exact DST-aware SQL match to threeHourlyDeferralWindow() in
-- scripts/ci/merged-migration-dispatch.mjs:
--   THREE_HOURLY_START_HOURS = [1, 4, 7, 10, 13, 16, 19, 22] (America/Chicago)
--   THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES = 90
--   THREE_HOURLY_POST_SEAL_CLEAR_MINUTE = 10
-- The 04:00 anchor is covered by ca_release_schema_freeze_holds (23:45-04:15).
CREATE OR REPLACE FUNCTION smarter_private.ca_three_hourly_deferral_clears_at(p_at timestamptz)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT c.cycle_start + interval '10 minutes'
    FROM (
      SELECT date_trunc('hour', p_at, 'UTC') + make_interval(hours => off) AS cycle_start
        FROM unnest(ARRAY[0, 1, 2]) AS off
    ) c
   WHERE p_at IS NOT NULL
     AND extract(hour FROM c.cycle_start AT TIME ZONE 'America/Chicago')::int = ANY (ARRAY[1, 4, 7, 10, 13, 16, 19, 22])
     AND extract(hour FROM c.cycle_start AT TIME ZONE 'America/Chicago')::int <> 4
     AND extract(hour FROM (c.cycle_start - interval '1 hour') AT TIME ZONE 'America/Chicago')::int
         <> extract(hour FROM c.cycle_start AT TIME ZONE 'America/Chicago')::int
     AND p_at >= c.cycle_start - interval '90 minutes'
     AND p_at <  c.cycle_start + interval '10 minutes'
   ORDER BY c.cycle_start
   LIMIT 1
$function$;

-- When a file merged (or fixed in place) at p_clock is overdue: the first
-- instant the dispatcher may send it (clearing any three-hourly O3 deferral
-- first, then the nightly 23:45-04:15 Central release schema freeze), plus the
-- watch's 60 minutes.
CREATE OR REPLACE FUNCTION smarter_private.ca_merged_migration_install_due_at(p_clock timestamptz)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
           WHEN p_clock IS NULL THEN NULL
           WHEN smarter_private.ca_release_schema_freeze_holds(r.released_at) THEN
             (((r.released_at AT TIME ZONE 'America/Chicago')::date
               + CASE WHEN (r.released_at AT TIME ZONE 'America/Chicago')::time >= time '23:45' THEN 1 ELSE 0 END)
              + time '04:15') AT TIME ZONE 'America/Chicago'
           ELSE r.released_at
         END + interval '60 minutes'
    FROM (
      SELECT COALESCE(smarter_private.ca_three_hourly_deferral_clears_at(p_clock), p_clock) AS released_at
    ) r
$function$;

REVOKE ALL ON FUNCTION smarter_private.ca_three_hourly_deferral_clears_at(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.ca_merged_migration_install_due_at(timestamptz) FROM PUBLIC, anon, authenticated;

-- Prove fixed instants across CST, CDT, O3 boundaries, freeze handoff, and DST fall-back.
DO $helpers$
BEGIN
  IF smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 20:29:59+00') IS NOT NULL               -- 14:29:59 CST (before 16:00 O3 window)
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 20:30:00+00') <> '2026-11-22 22:10:00+00' -- 14:30 CST -> 16:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 21:35:11+00') <> '2026-11-22 22:10:00+00' -- 15:35 CST (alert 447640) -> 16:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 22:09:59+00') <> '2026-11-22 22:10:00+00' -- 16:09:59 CST -> 16:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 22:10:00+00') IS NOT NULL               -- 16:10 CST (cleared)
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 23:30:00+00') <> '2026-11-23 01:10:00+00' -- 17:30 CST (19:00 cycle) -> 19:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-07-01 19:30:00+00') <> '2026-07-01 21:10:00+00' -- 14:30 CDT -> 16:10 CDT
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-01 06:00:00+00') <> '2026-11-01 06:10:00+00' -- fall-back first 01:00 CDT
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-01 07:00:00+00') IS NOT NULL               -- fall-back repeated 01:00 CST is not a second cycle
     OR smarter_private.ca_three_hourly_deferral_clears_at(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'THREE_HOURLY_DEFERRAL_HELPER_WRONG';
  END IF;
  IF smarter_private.ca_merged_migration_install_due_at('2026-11-22 21:35:11+00') <> '2026-11-22 23:10:00+00'   -- 15:35 CST -> 16:10 + 60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-22 20:29:59+00') <> '2026-11-22 21:29:59+00' -- outside window -> +60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 05:30:00+00') <> '2026-11-19 11:15:00+00' -- 23:30 CST (01:00 O3 meets 23:45-04:15 freeze) -> 04:15 + 60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 05:29:59+00') <> '2026-11-19 06:29:59+00' -- 23:29:59 CST -> +60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 06:22:55+00') <> '2026-11-19 11:15:00+00' -- 00:22 CST -> 04:15 + 60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 05:48:05+00') <> '2026-11-19 11:15:00+00' -- 23:48 CST -> next-day 04:15 + 60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-07-01 05:00:00+00') <> '2026-07-01 10:15:00+00' -- 00:00 CDT -> 04:15 CDT + 60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 17:00:00+00') <> '2026-11-19 18:00:00+00' -- 11:00 CST (daytime outside O3) -> +60m
     OR smarter_private.ca_merged_migration_install_due_at(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'INSTALL_DUE_HELPER_WRONG';
  END IF;
END
$helpers$;

DO $amend$
DECLARE
  v_sig constant regprocedure := 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure;
  v_def text := pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure);
  v_new text;
  v_anchor text :=
$a1$                          CASE WHEN smarter_private.ca_release_schema_freeze_holds(p_at)
                               THEN 'It is inside the nightly release schema freeze (23:45-04:15 Central): do NOT hand-dispatch Apply Merged Migration, an install now strands the 4 AM engine certificate. Read the refused run''s result, fix the file in place and merge; Dispatch Merged Migrations installs it at 04:15.'
                               ELSE 'Dispatch Apply Merged Migration for it and read the run''s result.' END),$a1$;
  v_with text :=
$w1$                          -- THREE-HOURLY CUTOVER DEFERRAL HOLDS THE PAGE (20261123000830).
                          CASE WHEN smarter_private.ca_release_schema_freeze_holds(p_at)
                               THEN 'It is inside the nightly release schema freeze (23:45-04:15 Central): do NOT hand-dispatch Apply Merged Migration, an install now strands the 4 AM engine certificate. Read the refused run''s result, fix the file in place and merge; Dispatch Merged Migrations installs it at 04:15.'
                               WHEN smarter_private.ca_three_hourly_deferral_clears_at(p_at) IS NOT NULL
                               THEN format('It is inside a three-hourly engine cutover deferral window (clears at %s Central): do NOT hand-dispatch Apply Merged Migration, an install now strands the active cutover certificate. Read the refused run''s result, fix the file in place and merge; Dispatch Merged Migrations installs it after %s Central.',
                                           to_char(smarter_private.ca_three_hourly_deferral_clears_at(p_at) AT TIME ZONE c_tz, 'HH24:MI'),
                                           to_char(smarter_private.ca_three_hourly_deferral_clears_at(p_at) AT TIME ZONE c_tz, 'HH24:MI'))
                               ELSE 'Dispatch Apply Merged Migration for it and read the run''s result.' END),$w1$;
BEGIN
  IF strpos(v_def, 'THREE-HOURLY CUTOVER DEFERRAL HOLDS THE PAGE (20261123000830)') > 0 THEN
    RAISE NOTICE 'fn_ca_merged_migration_install_watch already follows three-hourly cutover deferral';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_THREE_HOURLY_ANCHOR_NOT_ONCE';
  END IF;
  v_new := replace(v_def, v_anchor, v_with);
  EXECUTE v_new;
  IF strpos(pg_get_functiondef(v_sig), 'THREE-HOURLY CUTOVER DEFERRAL HOLDS THE PAGE (20261123000830)') = 0
     OR strpos(pg_get_functiondef(v_sig), 'ca_three_hourly_deferral_clears_at(p_at) IS NOT NULL') = 0
     OR strpos(pg_get_functiondef(v_sig), 'strands the active cutover certificate') = 0 THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_THREE_HOURLY_AMENDMENT_NOT_READ_BACK';
  END IF;
END
$amend$;

REVOKE ALL ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) TO service_role;

COMMIT;
