-- 20261119064912_the_install_watch_hour_starts_when_the_dispatcher_may_send.sql
--
-- ============================================================================
-- THE MERGED-MIGRATION INSTALL WATCH STARTS ITS HOUR WHEN THE DISPATCHER MAY
-- SEND, AND A FIX IN PLACE RESTARTS IT
-- (reliability incident dc479141, MergedMigrationNotInstalled, alert 445153)
-- ============================================================================
--
-- WHAT WENT WRONG (read from rows and Actions runs, 2026-11-19 05:35-06:45 UTC):
--   1. 20261119013426_an_ended_seat_settles_its_pending_addons.sql merged at
--      05:35 UTC (23:35 Central, #11340), ten minutes before the nightly
--      release schema freeze. Its applier run (44466273298, 05:36) was REFUSED:
--      the settlement pinned "exactly 44 probed rows / 17,600.00" and one probed
--      horse had sat back down (BOARD_MOVED). That refusal was real; #11362
--      fixed the file in place (each row proves itself) and merged at 06:22 UTC.
--   2. 06:22 UTC is 00:22 Central, inside RELEASE_SCHEMA_FREEZE_CHICAGO
--      (23:45-04:15, scripts/ci/merged-migration-dispatch.mjs). Dispatch Merged
--      Migrations held the fixed file, on purpose, to 04:15, because an install
--      after the 00:07 Backup copy strands the 03:30 engine certificate. The
--      database refuses direct DDL for the same reason
--      (fn_ca_release_freeze_refuses_mgmt_api_ddl).
--   3. This watch knew neither. Its hour ran from the ORIGINAL merge, so at
--      06:40 UTC it paged a file whose fix was already merged and queued, and
--      it told the reader "Dispatch Apply Merged Migration for it" - inside the
--      freeze, the one instruction that would have spoiled tonight's cutover.
--      Seven more files merged inside the freeze (05:48-06:37 UTC) were each
--      due to page the same way between 06:48 and 07:37 UTC, every night, for
--      every merge after 23:45 Central (the freeze landed 2026-11-17).
--
-- THE ROOT FIX (one function amendment, two nullable columns, two pure helpers):
--   * smarter_private.ca_release_schema_freeze_holds(t): the dispatcher's own
--     freeze, 23:45-04:15 America/Chicago, wrapping midnight. The constants are
--     pinned to RELEASE_SCHEMA_FREEZE_CHICAGO by
--     tests/the-install-watch-hour-starts-when-the-dispatcher-may-send.law.test.ts,
--     so the two clocks cannot drift apart again.
--   * smarter_private.ca_merged_migration_install_due_at(t): the instant the
--     dispatcher may first send a file merged at t (t, or the next 04:15
--     Central when t is inside the freeze), plus the watch's 60 minutes.
--   * the hour page fires at install_due_at(GREATEST(merged_at, modified_at)),
--     not at merged_at + 60 minutes;
--   * a 'modified' commit to a waiting file (a refused file fixed in place)
--     records modified_at/modified_sha, resolves a firing page with the fix
--     named, and clears it so the file is paged again - once, under its own
--     key uninstalled:<version>@<fixing sha> - if the fixed file is still not
--     installed an hour after the dispatcher could send it;
--   * a page raised inside the freeze says NOT to hand-dispatch, and why.
-- Everything else is unchanged: the pause hold, superseded/retired/window
-- handling, the unreadable-GitHub rules. It still never installs, dispatches,
-- retries or repairs anything, and it reads only GET endpoints.
--
-- The amendment is the repository's guarded replace(pg_get_functiondef(...))
-- pattern: each anchor must occur exactly once, the result is compiled, the
-- new markers are read back, and the helpers prove fixed instants before
-- COMMIT. Idempotent: a second run is a NOTICE.
--
-- Native proof: scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py
-- (cases "the freeze ..." / "a fix in place ..."; they fail on
-- 20261117165416's definition). CI: .github/workflows/a-merged-migration-left-uninstalled-is-paged.yml.
--
-- periodic-work: a detector that pages a person; it moves no money, seats, lobbies, releases or schema, retries nothing and repairs nothing. It must run from the database clock because the failure it reports is an install event that never happened.
-- @probe-exempt: public.fn_ca_merged_migration_install_watch every call performs live GitHub API GETs (commits, raw files, workflow state) through extensions.http, an external call a rolled-back probe cannot undo; its body is executed end to end by the native proof scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py against a fake GitHub
-- @live-proof: strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'THE HOUR STARTS WHEN THE DISPATCHER MAY SEND (20261119064912)') > 0 AND strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'INSTALLS SWITCHED OFF HOLD THE PAGE (20261117165416)') > 0 AND to_regprocedure('smarter_private.ca_merged_migration_install_due_at(timestamp with time zone)') IS NOT NULL AND smarter_private.ca_merged_migration_install_due_at('2026-11-19 06:22:00+00') = '2026-11-19 11:15:00+00' AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'smarter_private' AND table_name = 'ca_merged_migration_watch' AND column_name = 'modified_at') AND NOT has_function_privilege('anon', 'public.fn_ca_merged_migration_install_watch(timestamp with time zone)', 'EXECUTE') AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ca-merged-migration-install-watch-10m' AND active)

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE smarter_private.ca_merged_migration_watch
  ADD COLUMN IF NOT EXISTS modified_at timestamptz,
  ADD COLUMN IF NOT EXISTS modified_sha text;

COMMENT ON COLUMN smarter_private.ca_merged_migration_watch.modified_at IS
  'Committer time of the latest main commit that modified this file while it waited (a refused file fixed in place). The install hour runs from GREATEST(merged_at, modified_at) (20261119064912).';
COMMENT ON COLUMN smarter_private.ca_merged_migration_watch.modified_sha IS
  'The commit that set modified_at (20261119064912).';

-- The dispatcher's nightly release schema freeze, read exactly as
-- scripts/ci/merged-migration-dispatch.mjs inReleaseSchemaFreeze() reads it:
-- America/Chicago wall clock, [23:45, 04:15), wrapping midnight.
CREATE OR REPLACE FUNCTION smarter_private.ca_release_schema_freeze_holds(p_at timestamptz)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT (p_at AT TIME ZONE 'America/Chicago')::time >= time '23:45'
      OR (p_at AT TIME ZONE 'America/Chicago')::time <  time '04:15'
$function$;

-- When a file merged (or fixed in place) at p_clock is overdue: the first
-- instant the dispatcher may send it, plus the watch's 60 minutes. Inside the
-- freeze that instant is the next 04:15 Central at or after p_clock.
CREATE OR REPLACE FUNCTION smarter_private.ca_merged_migration_install_due_at(p_clock timestamptz)
 RETURNS timestamptz
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT CASE
           WHEN p_clock IS NULL THEN NULL
           WHEN smarter_private.ca_release_schema_freeze_holds(p_clock) THEN
             (((p_clock AT TIME ZONE 'America/Chicago')::date
               + CASE WHEN (p_clock AT TIME ZONE 'America/Chicago')::time >= time '23:45' THEN 1 ELSE 0 END)
              + time '04:15') AT TIME ZONE 'America/Chicago'
           ELSE p_clock
         END + interval '60 minutes'
$function$;

REVOKE ALL ON FUNCTION smarter_private.ca_release_schema_freeze_holds(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION smarter_private.ca_merged_migration_install_due_at(timestamptz) FROM PUBLIC, anon, authenticated;

-- The helpers prove fixed instants before anything uses them (CST and CDT).
DO $helpers$
BEGIN
  IF smarter_private.ca_release_schema_freeze_holds('2026-11-19 05:44:59+00')            -- 23:44:59 CST
     OR NOT smarter_private.ca_release_schema_freeze_holds('2026-11-19 05:45:00+00')     -- 23:45 CST
     OR NOT smarter_private.ca_release_schema_freeze_holds('2026-11-19 10:14:59+00')     -- 04:14:59 CST
     OR smarter_private.ca_release_schema_freeze_holds('2026-11-19 10:15:00+00')         -- 04:15 CST
     OR smarter_private.ca_release_schema_freeze_holds('2026-07-01 04:44:00+00')         -- 23:44 CDT
     OR NOT smarter_private.ca_release_schema_freeze_holds('2026-07-01 04:45:00+00') THEN -- 23:45 CDT
    RAISE EXCEPTION 'RELEASE_FREEZE_HELPER_WRONG';
  END IF;
  IF smarter_private.ca_merged_migration_install_due_at('2026-11-19 05:35:17+00') <> '2026-11-19 06:35:17+00'  -- before the freeze: +60
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 06:22:55+00') <> '2026-11-19 11:15:00+00'  -- 00:22 CST -> 04:15 + 60
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 05:48:05+00') <> '2026-11-19 11:15:00+00'  -- 23:48 CST -> next-day 04:15 + 60
     OR smarter_private.ca_merged_migration_install_due_at('2026-07-01 05:00:00+00') <> '2026-07-01 10:15:00+00'  -- 00:00 CDT -> 04:15 CDT + 60
     OR smarter_private.ca_merged_migration_install_due_at('2026-11-19 16:00:00+00') <> '2026-11-19 17:00:00+00'  -- daytime: +60
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
  v_anchor text;
  v_with text;
  v_pairs text[][] := ARRAY[
    -- 1. A fix in place restarts the hour and closes the page it outdated.
    ARRAY[
$a1$          UPDATE smarter_private.ca_merged_migration_watch
             SET window_install = v_text ~ c_window,
                 superseded_by = NULLIF(v_by, version)
           WHERE version = substring(v_name FROM c_file) AND file = v_name;$a1$,
$w1$          UPDATE smarter_private.ca_merged_migration_watch
             SET window_install = v_text ~ c_window,
                 superseded_by = NULLIF(v_by, version),
                 -- THE HOUR STARTS WHEN THE DISPATCHER MAY SEND (20261119064912).
                 -- A waiting file modified on main is a refused file fixed in
                 -- place: the dispatcher sends it again from this commit, so
                 -- the hour restarts here, and a page raised before the fix
                 -- named a state that no longer exists. It is resolved with the
                 -- fix named and cleared, so the file pages again - once - if
                 -- it is still not installed an hour after it could be sent.
                 modified_at = GREATEST(COALESCE(modified_at, v_at), v_at),
                 modified_sha = CASE WHEN modified_at IS NULL OR v_at >= modified_at THEN v_sha ELSE modified_sha END
           WHERE version = substring(v_name FROM c_file) AND file = v_name;
          UPDATE public.operational_alert_events e
             SET status = 'resolved', last_received_at = p_at,
                 payload = e.payload || jsonb_build_object('resolved_at', p_at,
                   'resolution', format('fixed in place on main by %s at %s Central; its install hour restarts from the dispatcher''s next admitted send',
                                        left(v_sha, 8), to_char(v_at AT TIME ZONE c_tz, 'Mon FMDD HH24:MI')))
            FROM smarter_private.ca_merged_migration_watch w
           WHERE w.version = substring(v_name FROM c_file) AND w.file = v_name
             AND e.id = w.alert_id AND e.status = 'firing';
          IF FOUND THEN v_resolved := v_resolved + 1; END IF;
          UPDATE smarter_private.ca_merged_migration_watch
             SET alert_id = NULL
           WHERE version = substring(v_name FROM c_file) AND file = v_name AND alert_id IS NOT NULL;$w1$],
    -- 2. The hour clock: from the dispatcher's first admitted send.
    ARRAY[
$a2$OR v_row.merged_at > p_at - interval '60 minutes'$a2$,
$w2$OR smarter_private.ca_merged_migration_install_due_at(GREATEST(v_row.merged_at, v_row.modified_at)) > p_at$w2$],
    -- 3. Inside the freeze the page must not say "dispatch it".
    ARRAY[
$a3$        'summary', format('%s merged at %s Central (%s) and is still not installed in production after %s minutes. Dispatch Apply Merged Migration for it and read the run''s result.',
                          regexp_replace(v_row.file, '^supabase/migrations/', ''),
                          to_char(v_row.merged_at AT TIME ZONE c_tz, 'Mon FMDD HH24:MI'), left(v_row.merge_sha, 8),
                          floor(extract(epoch FROM p_at - v_row.merged_at) / 60)::int),$a3$,
$w3$        'summary', format('%s merged at %s Central (%s)%s and is still not installed in production after %s minutes. %s',
                          regexp_replace(v_row.file, '^supabase/migrations/', ''),
                          to_char(v_row.merged_at AT TIME ZONE c_tz, 'Mon FMDD HH24:MI'), left(v_row.merge_sha, 8),
                          CASE WHEN v_row.modified_at IS NOT NULL
                               THEN format(', fixed in place at %s Central (%s),', to_char(v_row.modified_at AT TIME ZONE c_tz, 'Mon FMDD HH24:MI'), left(v_row.modified_sha, 8))
                               ELSE '' END,
                          floor(extract(epoch FROM p_at - v_row.merged_at) / 60)::int,
                          CASE WHEN smarter_private.ca_release_schema_freeze_holds(p_at)
                               THEN 'It is inside the nightly release schema freeze (23:45-04:15 Central): do NOT hand-dispatch Apply Merged Migration, an install now strands the 4 AM engine certificate. Read the refused run''s result, fix the file in place and merge; Dispatch Merged Migrations installs it at 04:15.'
                               ELSE 'Dispatch Apply Merged Migration for it and read the run''s result.' END),$w3$],
    -- 4. One page per (file, fix): operational_alert_events is unique on
    --    (source, event_key), so a fixed file's page needs its own key or it
    --    would only bump the resolved row's receipt and never reach anyone.
    ARRAY[
$a4$'uninstalled:' || v_row.version,$a4$,
$w4$'uninstalled:' || v_row.version || COALESCE('@' || left(v_row.modified_sha, 12), ''),$w4$]
  ];
  i integer;
BEGIN
  IF strpos(v_def, 'THE HOUR STARTS WHEN THE DISPATCHER MAY SEND (20261119064912)') > 0 THEN
    RAISE NOTICE 'fn_ca_merged_migration_install_watch already starts its hour when the dispatcher may send';
    RETURN;
  END IF;
  v_new := v_def;
  FOR i IN 1 .. array_length(v_pairs, 1) LOOP
    v_anchor := v_pairs[i][1];
    v_with := v_pairs[i][2];
    IF (length(v_new) - length(replace(v_new, v_anchor, ''))) / length(v_anchor) <> 1 THEN
      RAISE EXCEPTION 'MIGRATION_WATCH_ANCHOR_NOT_ONCE: anchor % of fn_ca_merged_migration_install_watch', i;
    END IF;
    v_new := replace(v_new, v_anchor, v_with);
  END LOOP;
  EXECUTE v_new;
  IF strpos(pg_get_functiondef(v_sig), 'THE HOUR STARTS WHEN THE DISPATCHER MAY SEND (20261119064912)') = 0
     OR strpos(pg_get_functiondef(v_sig), 'ca_merged_migration_install_due_at(GREATEST(v_row.merged_at, v_row.modified_at))') = 0
     OR strpos(pg_get_functiondef(v_sig), 'do NOT hand-dispatch') = 0
     OR strpos(pg_get_functiondef(v_sig), 'COALESCE(''@'' || left(v_row.modified_sha, 12), '''')') = 0 THEN
    RAISE EXCEPTION 'MIGRATION_WATCH_AMENDMENT_NOT_READ_BACK';
  END IF;
END
$amend$;

-- CREATE OR REPLACE keeps the owner, ACL and proconfig; restate the grants the
-- earlier migrations set so the live proof's privilege checks hold either way.
REVOKE ALL ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_ca_merged_migration_install_watch(timestamptz) TO service_role;

COMMIT;
