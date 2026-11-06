-- THE AUDIT WATCHDOG NEVER LOOKS STALE BETWEEN ITS OWN PASSES (2026-11-05).
--
-- fn_horse_daily_audit_watch_status (20261105220227) reports watchdog_stale
-- when the last successful watchdog pass is older than 7 hours. The watchdog
-- ran at 08:45, 14:45 and 20:45 UTC, so the 20:45 -> 08:45 gap is 12 hours and
-- from 03:45 UTC every night the audit panel would have called a healthy
-- watchdog stale. A 02:45 pass makes every gap 6 hours, so stale then means a
-- pass was really missed. The 08:45 pass still lands after the 07:30 fallback
-- and before the 10:37 UTC morning check.
-- periodic-work: the watchdog is the audit's independent detector; this only shortens its longest gap so the staleness signal is true, it compensates for nothing.
-- @live-proof: EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'horse-daily-audit-watchdog' AND schedule = '45 2,8,14,20 * * *' AND active)
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
SELECT cron.alter_job(j.jobid, schedule => '45 2,8,14,20 * * *')
  FROM cron.job j
 WHERE j.jobname = 'horse-daily-audit-watchdog';
DO $post$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'horse-daily-audit-watchdog' AND schedule = '45 2,8,14,20 * * *' AND active) THEN
    RAISE EXCEPTION 'horse-daily-audit-watchdog schedule not updated';
  END IF;
END
$post$;
COMMIT;
