-- 20261124162837_the_install_watch_follows_the_150_minute_deferral.sql
--
-- ============================================================================
-- THE INSTALL WATCH FOLLOWS THE 150 MINUTE THREE-HOURLY DEFERRAL (O21, part 1)
-- ============================================================================
--
-- WHAT WENT WRONG (GitHub Actions runs and migration history, 2026-11-22 to 11-24):
--   The engine cuts over every three hours (01, 04, 07, 10, 13, 16, 19, 22
--   America/Chicago). A candidate build is certified on a copy of production.
--   An ordinary migration installed after that copy makes the candidate stale
--   and the cycle keeps serving. The dispatcher deferred ordinary merges only
--   inside [cycleStart - 90m, cycleStart + 10m), but the certifying copy is
--   usually taken before cycleStart - 90m. Installs at 2026-11-22 23:22Z,
--   2026-11-23 01:47Z and 02:17Z and 2026-11-24 05:26Z (98, 133, 103 and 94
--   minutes before their cycle) each cost a cycle.
--
-- THE FIX IS TWO CHANGES, AND THIS FILE IS THE FIRST:
--   1. (this file) smarter_private.ca_three_hourly_deferral_clears_at(p_at)
--      treats [cycleStart - 150m, cycleStart + 10m) as held, and looks three
--      whole hours ahead (ARRAY[0, 1, 2, 3]) so an instant at cycleStart - 150m
--      finds its cycle: date_trunc('hour') of cycleStart - 150m is
--      cycleStart - 3h. Windows of consecutive cycles do not meet
--      (cycleStart + 10m < cycleStart + 30m = nextCycleStart - 150m), so at
--      most one cycle matches.
--   2. (a later pull request, merged only after this file is installed)
--      THREE_HOURLY_PRE_CUTOFF_DEFER_MINUTES 90 -> 150 in
--      scripts/ci/merged-migration-dispatch.mjs.
--
-- WHY THE DATABASE MOVES FIRST. The install watch pages a merged file 60
-- minutes after the dispatcher may first send it, and it reads that instant
-- from this helper. If the dispatcher held a file the helper did not know was
-- held, the watch would page a healthy file. The other order is the safe one:
-- while the dispatcher still defers 90 minutes and this helper says 150, a
-- file merged in [cycleStart - 150m, cycleStart - 90m) is sent at once and the
-- watch gives it until cycleStart + 70m. A file that is really stuck is paged
-- later than before (at most 160 minutes later); no healthy file is paged
-- early. tests/the-install-watch-hour-starts-when-the-dispatcher-may-send.law.test.ts
-- holds the rule: the SQL minutes are never smaller than the dispatcher's.
--
-- WHAT DOES NOT CHANGE: the signature, language, volatility, search_path,
-- owner and grants of the helper; smarter_private.ca_merged_migration_install_due_at
-- and public.fn_ca_merged_migration_install_watch (both read this helper and
-- need no edit: a merge at 22:30 Central is released at 01:10, which is inside
-- the nightly freeze, so its hour starts at 04:15, exactly as the dispatcher
-- plans it). No table, no cron job, no timer.
--
-- The md5 below is the helper exactly as 20261123000830 creates it, measured
-- on PostgreSQL 17 from that file. The applier refuses this file if production
-- holds anything else.
-- @replaces-md5: smarter_private.ca_three_hourly_deferral_clears_at(timestamp with time zone)=7a65f8065a8d83f37521df7dceac61ef
-- @live-proof: md5(pg_get_functiondef('smarter_private.ca_three_hourly_deferral_clears_at(timestamp with time zone)'::regprocedure)) = '34646189c370a36abf8c527e0fbe602f' AND smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 20:29:59+00') = '2026-11-22 22:10:00+00' AND smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 19:29:59+00') IS NULL AND smarter_private.ca_merged_migration_install_due_at('2026-11-22 20:29:59+00') = '2026-11-22 23:10:00+00' AND smarter_private.ca_merged_migration_install_due_at('2026-11-19 04:30:00+00') = '2026-11-19 11:15:00+00' AND NOT has_function_privilege('anon', 'smarter_private.ca_three_hourly_deferral_clears_at(timestamp with time zone)', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'smarter_private.ca_three_hourly_deferral_clears_at(timestamp with time zone)', 'EXECUTE')

BEGIN;
SET LOCAL lock_timeout = '5s';

-- The helper must be the one 20261123000830 installed (or this file's own
-- result, so a second run is a no-op). Its grants are remembered and compared
-- after the replacement.
DO $pre$
DECLARE
  v_oid oid := to_regprocedure('smarter_private.ca_three_hourly_deferral_clears_at(timestamp with time zone)');
  v_md5 text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'THREE_HOURLY_DEFERRAL_150_PREIMAGE_MISSING smarter_private.ca_three_hourly_deferral_clears_at(timestamptz)'
      USING ERRCODE = '55000';
  END IF;
  v_md5 := md5(pg_get_functiondef(v_oid));
  IF v_md5 NOT IN ('7a65f8065a8d83f37521df7dceac61ef', '34646189c370a36abf8c527e0fbe602f') THEN
    RAISE EXCEPTION 'THREE_HOURLY_DEFERRAL_150_PREIMAGE_DRIFT ca_three_hourly_deferral_clears_at got %', v_md5
      USING ERRCODE = '55000';
  END IF;
  IF to_regprocedure('smarter_private.ca_merged_migration_install_due_at(timestamp with time zone)') IS NULL
     OR strpos(pg_get_functiondef('smarter_private.ca_merged_migration_install_due_at(timestamp with time zone)'::regprocedure),
               'smarter_private.ca_three_hourly_deferral_clears_at(p_clock)') = 0 THEN
    RAISE EXCEPTION 'THREE_HOURLY_DEFERRAL_150_DUE_AT_DOES_NOT_READ_THE_HELPER'
      USING ERRCODE = '55000';
  END IF;
  PERFORM set_config('ca.o21_deferral_helper_acl',
                     COALESCE((SELECT proacl::text FROM pg_proc WHERE oid = v_oid), '<default>'), true);
  PERFORM set_config('ca.o21_deferral_helper_owner',
                     (SELECT proowner::text FROM pg_proc WHERE oid = v_oid), true);
END
$pre$;

-- DST-aware SQL twin of threeHourlyDeferralWindow() in
-- scripts/ci/merged-migration-dispatch.mjs:
--   THREE_HOURLY_START_HOURS = [1, 4, 7, 10, 13, 16, 19, 22] (America/Chicago)
--   deferral opens 150 minutes before the cycle start (O21, 2026-11-24)
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
        FROM unnest(ARRAY[0, 1, 2, 3]) AS off
    ) c
   WHERE p_at IS NOT NULL
     AND extract(hour FROM c.cycle_start AT TIME ZONE 'America/Chicago')::int = ANY (ARRAY[1, 4, 7, 10, 13, 16, 19, 22])
     AND extract(hour FROM c.cycle_start AT TIME ZONE 'America/Chicago')::int <> 4
     AND extract(hour FROM (c.cycle_start - interval '1 hour') AT TIME ZONE 'America/Chicago')::int
         <> extract(hour FROM c.cycle_start AT TIME ZONE 'America/Chicago')::int
     AND p_at >= c.cycle_start - interval '150 minutes'
     AND p_at <  c.cycle_start + interval '10 minutes'
   ORDER BY c.cycle_start
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION smarter_private.ca_three_hourly_deferral_clears_at(timestamptz) FROM PUBLIC, anon, authenticated;

-- Fixed instants: CST, CDT, both edges of the window, the 20 minute install
-- window between two cycles, the 04:00 anchor, the handoff to the nightly
-- freeze, DST fall-back and spring-forward.
DO $helpers$
DECLARE
  v_oid oid := 'smarter_private.ca_three_hourly_deferral_clears_at(timestamp with time zone)'::regprocedure;
BEGIN
  IF smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 19:29:59+00') IS NOT NULL                  -- 13:29:59 CST: last second of the 13:10-13:30 install window
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 19:30:00+00') <> '2026-11-22 22:10:00+00' -- 13:30 CST = 16:00 - 150m -> 16:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 20:29:59+00') <> '2026-11-22 22:10:00+00' -- 14:29:59 CST (open when the window was 90m) -> 16:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 21:35:11+00') <> '2026-11-22 22:10:00+00' -- 15:35 CST (alert 447640) -> 16:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 22:09:59+00') <> '2026-11-22 22:10:00+00' -- 16:09:59 CST -> 16:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 22:10:00+00') IS NOT NULL               -- 16:10 CST: cleared
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 22:29:59+00') IS NOT NULL               -- 16:29:59 CST: still the install window
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 22:30:00+00') <> '2026-11-23 01:10:00+00' -- 16:30 CST = 19:00 - 150m -> 19:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-22 23:22:00+00') <> '2026-11-23 01:10:00+00' -- the install that cost the 19:00 cycle
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-23 01:47:00+00') <> '2026-11-23 04:10:00+00' -- the install 133 minutes before the 22:00 cycle
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-23 04:29:59+00') IS NOT NULL               -- 22:29:59 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-23 04:30:00+00') <> '2026-11-23 07:10:00+00' -- 22:30 CST = 01:00 - 150m -> 01:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-23 08:00:00+00') IS NOT NULL               -- 02:00 CST: the 04:00 anchor is the nightly freeze's
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-23 10:29:59+00') IS NOT NULL               -- 04:29:59 CST: last second of the 04:15-04:30 window
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-23 10:30:00+00') <> '2026-11-23 13:10:00+00' -- 04:30 CST = 07:00 - 150m -> 07:10 CST
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-07-01 18:29:59+00') IS NOT NULL               -- 13:29:59 CDT
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-07-01 18:30:00+00') <> '2026-07-01 21:10:00+00' -- 13:30 CDT -> 16:10 CDT
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-01 03:29:59+00') IS NOT NULL               -- fall-back eve, 22:29:59 CDT
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-01 03:30:00+00') <> '2026-11-01 06:10:00+00' -- 22:30 CDT -> the first 01:00 CDT + 10m
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-01 06:00:00+00') <> '2026-11-01 06:10:00+00' -- fall-back first 01:00 CDT
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-11-01 07:00:00+00') IS NOT NULL               -- the repeated 01:00 CST is not a second cycle
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-03-08 09:29:59+00') IS NOT NULL               -- spring-forward day, 04:29:59 CDT
     OR smarter_private.ca_three_hourly_deferral_clears_at('2026-03-08 09:30:00+00') <> '2026-03-08 12:10:00+00' -- 04:30 CDT -> 07:10 CDT
     OR smarter_private.ca_three_hourly_deferral_clears_at(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'THREE_HOURLY_DEFERRAL_150_HELPER_WRONG';
  END IF;
  -- Every minute of one Central day (2026-11-22, CST): the helper is NULL
  -- exactly in the 20 minutes after each of the seven cycles clears, and from
  -- 01:10 to 04:30 Central (the 04:00 anchor belongs to the nightly freeze,
  -- which ca_merged_migration_install_due_at applies after this helper).
  IF EXISTS (
    SELECT 1
      FROM generate_series('2026-11-22 06:00:00+00'::timestamptz, '2026-11-23 05:59:00+00'::timestamptz, interval '1 minute') AS t
     WHERE (smarter_private.ca_three_hourly_deferral_clears_at(t) IS NULL)
           IS DISTINCT FROM
           (   (extract(hour FROM t AT TIME ZONE 'America/Chicago')::int IN (1, 7, 10, 13, 16, 19, 22)
                AND extract(minute FROM t)::int >= 10 AND extract(minute FROM t)::int < 30)
            OR (t AT TIME ZONE 'America/Chicago')::time >= time '01:10' AND (t AT TIME ZONE 'America/Chicago')::time < time '04:30')
  ) THEN
    RAISE EXCEPTION 'THREE_HOURLY_DEFERRAL_150_OPEN_MINUTES_WRONG';
  END IF;
  IF smarter_private.ca_merged_migration_install_due_at('2026-11-22 21:35:11+00') <> '2026-11-22 23:10:00+00'   -- 15:35 CST -> 16:10 + 60m (unchanged)
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-22 20:29:59+00') <> '2026-11-22 23:10:00+00' -- 14:29:59 CST: held now -> 16:10 + 60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-22 19:29:59+00') <> '2026-11-22 20:29:59+00' -- 13:29:59 CST: install window -> +60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-22 22:12:00+00') <> '2026-11-22 23:12:00+00' -- 16:12 CST: install window -> +60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 04:30:00+00') <> '2026-11-19 11:15:00+00' -- 22:30 CST: 01:10 is inside the freeze -> 04:15 + 60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 04:29:59+00') <> '2026-11-19 05:29:59+00' -- 22:29:59 CST -> +60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 05:30:00+00') <> '2026-11-19 11:15:00+00' -- 23:30 CST -> 04:15 + 60m (unchanged)
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 06:22:55+00') <> '2026-11-19 11:15:00+00' -- 00:22 CST -> 04:15 + 60m (unchanged)
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 10:20:00+00') <> '2026-11-19 11:20:00+00' -- 04:20 CST: install window -> +60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 17:00:00+00') <> '2026-11-19 20:10:00+00' -- 11:00 CST: held for 13:00 -> 13:10 + 60m
     OR smarter_private.ca_merged_migration_install_due_at('2026-07-01 05:00:00+00') <> '2026-07-01 10:15:00+00' -- 00:00 CDT -> 04:15 CDT + 60m (unchanged)
     OR smarter_private.ca_merged_migration_install_due_at(NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'THREE_HOURLY_DEFERRAL_150_INSTALL_DUE_WRONG';
  END IF;
  -- Read back: the body, and the grants and owner exactly as they were.
  IF md5(pg_get_functiondef(v_oid)) <> '34646189c370a36abf8c527e0fbe602f' THEN
    RAISE EXCEPTION 'THREE_HOURLY_DEFERRAL_150_NOT_READ_BACK got %', md5(pg_get_functiondef(v_oid))
      USING ERRCODE = '55000';
  END IF;
  IF COALESCE((SELECT proacl::text FROM pg_proc WHERE oid = v_oid), '<default>')
       IS DISTINCT FROM current_setting('ca.o21_deferral_helper_acl', true)
     OR (SELECT proowner::text FROM pg_proc WHERE oid = v_oid)
       IS DISTINCT FROM current_setting('ca.o21_deferral_helper_owner', true)
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'THREE_HOURLY_DEFERRAL_150_GRANTS_CHANGED'
      USING ERRCODE = '55000';
  END IF;
END
$helpers$;

COMMIT;
