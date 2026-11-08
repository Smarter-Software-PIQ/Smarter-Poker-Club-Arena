# Smarter Poker Operations Services (Ops Mac)

Everything long-running on this Mac runs as a macOS launchd service, never as a
child of a desktop app or an agent shell. On 2026-11-02 at 14:39 Chicago the
Claude desktop app crashed and every watcher it had started died with it.

## Services

| Label                           | What it does                                                                                                                                                                                                                                                                                                                                                               | Schedule                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| com.smarter-poker.install-queue | Shared install queue for every agent: waits for each PR to merge, installs its migration through the protected apply-merged-migration workflow (dry then real, outside :44 to :04 UTC), then proves it: readback (every function in the merged file re-executed in a rolled-back transaction; unchanged = production equals the file) plus the migration's own @live-proof | Always on (KeepAlive; restarted within 30 s if it dies) |
| com.smarter-poker.ops-heartbeat | Reports uptime, disk space, queue health and whether the Claude app runs to smarter_private.record_host_heartbeat('ops-mac-studio', ...). Silence over 15 minutes raises a critical Production Alert; a volume under 5% free warns daily                                                                                                                                   | Every 5 minutes                                         |

## Queue an install (every agent uses this, nothing else)

    ~/.smarter-poker/ops/submit-install.sh <PR number> <migration file name> [required prior version] [owner]

Jobs live in ~/.smarter-poker/install-queue/{pending,running,done,failed}; the
result is appended to the job file. Log: ~/.smarter-poker/logs/install-queue.log.
A job interrupted mid-run resumes first; an install is never replayed once its
version is recorded in supabase_migrations.schema_migrations.

## Reach the solver PCs M1 and M2

    ~/.smarter-poker/ops/solver-host.sh check
    ~/.smarter-poker/ops/solver-host.sh m1|m2 '<command>'
    ~/.smarter-poker/ops/solver-host.sh scp <from> <to>

The agent terminal on this Mac has no macOS Local Network permission, so a
plain ping, nc or ssh to 192.168.0.51 (M1) or 192.168.0.155 (M2) fails with
"No route to host" even while both PCs are up. That false "down" stalled the
R8 solver round on 2026-11-08 for about 11 hours. This helper connects through
`sudo -n ssh` (root is exempt from the check) with the dedicated controller key
and the pinned host keys; its `check` answer is the only valid reachability
reading. Only the solver-round single writer named in HORSE-LANES-STATUS.md
runs work on M1/M2; everyone else uses `check` only.

## Database access

~/.smarter-poker/ops/db.sh runs psql through the existing helper. The password
comes from the user's ~/.zshenv; no credential is stored in this folder.

## Manage

    launchctl print gui/$(id -u)/com.smarter-poker.install-queue
    launchctl kickstart -k gui/$(id -u)/com.smarter-poker.install-queue
    tail -f ~/.smarter-poker/logs/install-queue.log ~/.smarter-poker/logs/heartbeat.log

## macOS updates

Automatic macOS installs are OFF (download only), so no update restarts this
Mac on its own. Security data files still install automatically. Updates are
installed during the daily 4 to 6 AM Chicago maintenance window.

## Rebuild on any Mac

    operations/ops-mac/setup.sh /path/to/a/linked/club-arena-checkout

The checkout supplies only supabase/.temp/pooler-url (from `supabase link`) and
the production CA certificate; the password stays in ~/.zshenv.

## Alerts these services raise

| Alert                   | Severity      | When                                                                                            |
| ----------------------- | ------------- | ----------------------------------------------------------------------------------------------- |
| HostHeartbeatMissing    | critical      | No heartbeat for 15 minutes (raised by the database check, so it fires even if this Mac is off) |
| HostHeartbeatResumed    | informational | Heartbeats resume after a silence                                                               |
| HostDiskNearlyFull      | warning       | A volume under 5% free, once a day                                                              |
| InstallQueueJobFailed   | warning       | An install job ends failed (closed PR, failed install or failed verification)                   |
| InstallQueueServiceDown | critical      | The heartbeat finds the queue not running; it re-registers and restarts it first                |
