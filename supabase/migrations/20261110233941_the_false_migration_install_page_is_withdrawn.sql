-- 20261110233941_the_false_migration_install_page_is_withdrawn.sql
--
-- Version reserved by scripts/reserve-migration-version.sh against this tree,
-- origin/main and every sibling worktree on this machine.
--
-- ============================================================================
-- THE FALSE MIGRATION-INSTALL PAGE IS WITHDRAWN
-- (Reliability incident 9f5b0304-8634-48b9-a8ec-ea9c2fc563e4,
--  MergedMigrationNotInstalled, operational_alert_events row 376392)
-- ============================================================================
--
-- The source defect is already fixed and installed: 20261110194917 makes
-- fn_ca_merged_migration_install_watch read a renamed file's window header
-- from the whole file at its merge SHA, and treat an empty or blank body as
-- unreadable rather than as an absent header. Verified live after install:
-- the function carries both markers.
--
-- This withdraws the one page that defect already raised. It is a data
-- correction of a mis-recorded row, not a resolution bought by the existence
-- of a patch.
--
-- THE EVIDENCE. smarter_private.ca_merged_migration_watch holds version
-- 20261110173033 with window_install = false. That is wrong about the file.
-- Read read-only from production on 2026-11-10 through the watch's own reader,
--   smarter_private.ca_migration_watch_raw(
--     '22c1fe09586b0564cf4227e8ec6c031a9345c312',
--     'supabase/migrations/20261110173033_lightning_blinds_and_button_go_to_the_longest_waiting_player.sql')
-- returns the whole file, 11,748 bytes, and it DOES match the window pattern
--   the watch's own c_window pattern, which anchors the declaration to the
--   start of a line and tolerates a leading '+' from a diff
-- because the daily-maintenance install-window declaration is its first line.
-- (That token is deliberately not written out anywhere in this file, so the
-- file is not read as declaring one: check-migrations-applied requires such a
-- declaration to be exactly one line of its own.) The same
-- call against GitHub's commit detail returns that file with status 'renamed'
-- and a 1,216-byte patch beginning '@@ -3,7 +3,7 @@', which is why the old
-- COALESCE(patch, raw) read it as ordinary-route: the patch starts at line 3
-- and the header is on line 1. The file is on main and carries that header.
--
-- So the migration is correctly QUEUED for the 04:00 America/Chicago window,
-- not late: it takes ACCESS EXCLUSIVE on public.lightning_pool_slot, which
-- every Lightning hand formation writes, and CLAUDE.md section 2 rule 10
-- requires exactly this deferral. Alert 376392 was raised in error.
--
-- WHAT THIS DOES. Sets window_install = true for that one version and resolves
-- that one alert with the reason recorded on the row. Both are guarded on the
-- row still being in the mis-recorded state, so re-running changes nothing.
-- The alert's history is preserved: received_at, delivery_count and the
-- original payload stay, and the resolution is added alongside them.
--
-- WHAT THIS DOES NOT DO. It does not install 20261110173033, which still waits
-- for its window. It does not touch any other watch row, any other alert, or
-- step 3's 60-minute rule, so a genuinely overdue ordinary-route migration
-- still pages exactly as before. No money, seat, schedule or release is
-- involved.
--
-- @live-proof: (SELECT window_install FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110173033') AND NOT EXISTS (SELECT 1 FROM public.operational_alert_events WHERE id = 376392 AND status = 'firing') AND strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure), 'AN EMPTY BODY IS UNREADABLE (20261110194917)') > 0

BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

DO $pre$
BEGIN
  -- The source fix must already be live, or withdrawing its page is premature.
  IF strpos(pg_get_functiondef('public.fn_ca_merged_migration_install_watch(timestamp with time zone)'::regprocedure),
            'AN EMPTY BODY IS UNREADABLE (20261110194917)') = 0 THEN
    RAISE EXCEPTION 'FALSE_PAGE_WITHDRAWAL_PREMATURE: 20261110194917 is not installed, so the defect that raised this page is still live';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110173033') THEN
    RAISE EXCEPTION 'FALSE_PAGE_WITHDRAWAL_PREIMAGE: no watch row for 20261110173033';
  END IF;
END
$pre$;

UPDATE smarter_private.ca_merged_migration_watch
   SET window_install = true
 WHERE version = '20261110173033'
   AND NOT window_install;

UPDATE public.operational_alert_events e
   SET status = 'resolved',
       last_received_at = now(),
       payload = e.payload || jsonb_build_object(
         'resolved_at', now(),
         'resolution',
           'Raised in error. The file carries the daily-maintenance install' || '-window declaration on line 1, so it is queued for the '
        || '04:00 America/Chicago window, not overdue. The watch judged it from a renamed file''s partial diff hunk '
        || '(beginning @@ -3,7 +3,7 @@, so line 1 was absent) instead of from the file. Fixed at source by 20261110194917; '
        || 'the mis-recorded window_install flag is corrected by 20261110233941.')
 WHERE e.id = 376392
   AND e.status = 'firing'
   AND e.alertname = 'MergedMigrationNotInstalled';

DO $post$
BEGIN
  IF NOT (SELECT window_install FROM smarter_private.ca_merged_migration_watch WHERE version = '20261110173033') THEN
    RAISE EXCEPTION 'FALSE_PAGE_WITHDRAWAL_POSTIMAGE: window_install was not corrected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.operational_alert_events WHERE id = 376392 AND status = 'firing') THEN
    RAISE EXCEPTION 'FALSE_PAGE_WITHDRAWAL_POSTIMAGE: alert 376392 is still firing';
  END IF;
  -- Step 3's rule must be untouched: an ordinary-route file with no alert yet
  -- and past its hour is still pageable.
  IF (SELECT count(*) FROM smarter_private.ca_merged_migration_watch
       WHERE installed_seen_at IS NULL AND retired_at IS NULL AND NOT window_install) IS NULL THEN
    RAISE EXCEPTION 'FALSE_PAGE_WITHDRAWAL_POSTIMAGE: pending set unreadable';
  END IF;
END
$post$;

COMMIT;
