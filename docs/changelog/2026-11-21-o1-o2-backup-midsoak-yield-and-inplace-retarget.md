# 2026-11-21: Backup Engine Mid-Soak Yield (O1) and In-Place Retarget / Non-Disruptive Supersession (O2)

## Summary

Eliminates two remaining sources of wasted `ca-backup` soak capacity and manual
merge holds observed during the 2026-11-22T02:29Z three-hourly cutover cycle:

1. **O1 - Mid-soak yield for obsolete unselectable push runs (`certify`):**
   - Keeps `server/standby/standby-engine.sh` (`cmd_certify`) on the offline
     standby host 100% network-free and unchanged.
   - Runs the SSH `standby-engine certify` command in the background on the
     GitHub Actions runner while a bounded 60 s runner-side check monitors
     non-`booking`, non-`freeze_baseline` `push` runs.
   - Yields cleanly (`YIELDED_OBSOLETE` in step summary, cleanly terminates SSH
     and remote certify process, stops the standby container via
     `/usr/local/sbin/standby-engine`'s `stop_for_restore` helper, releases the
     standby host lease via the existing `always()` release step, writes NO
     `failure` or `error` commit status, exits `0`) ONLY when ALL FOUR hold:
     - (a) a newer active (`queued`/`in_progress`/`waiting`/`pending`/`requested`)
       push run of `.github/workflows/backup-engine.yml` exists on `main`,
     - (b) `projection(SHA)` from `scripts/ci/read-engine-prequalification.py`
       or `supabase/migrations` on `origin/main` already differs from `SHA`
       (proving `SHA` can never be selected against current `main`),
     - (c) fewer than 75 minutes (`4500` s) remain until the next scheduled
       three-hourly or daily cutoff (`THREE_HOURLY_START_HOURS`), and
     - (d) every check read succeeded (any unreadable read keeps soaking per
       CLAUDE.md 10.86).
   - Never aborts `booking`, `freeze_baseline`, `workflow_dispatch`, `schedule`,
     or `repository_dispatch` (post-seal) runs.

2. **O2 - In-place retarget after lease acquisition and non-disruptive supersession (`refresh`):**
   - In `turn` (while still waiting for the host lease), filters newer push runs
     to active (`status != "completed"`) runs and compares
     `scripts/ci/engine-source-identity.sh` (plus `.github/workflows/backup-engine.yml`
     diff): completed runs and identical-source pushes never supersede a waiting
     run, removing the need for temporary all-merges holds while a candidate
     waits for the Backup lease.
   - Immediately after acquiring the Backup host lease (and before `late_inherit`
     and `due`), `late_retarget` checks `main`'s newest server commit (`head`)
     for non-`booking`, non-`freeze_baseline` push runs: when `head` descends
     from `SHA` and `GITHUB_SHA`, preserves `.github/workflows/backup-engine.yml`,
     and is not already certified, it retargets in-place (`sha="$head"`,
     `control_sha="$head"`, checks out `$head`, and passes the updated target to
     `late_inherit`, `due`, `late_priority`, `refresh` outputs, and `certify`).
   - Removes `superseded` lease-dropping from `late_priority`: `late_priority`
     continues to yield for owner-window `predates` / `booking_pending`, while
     never throwing away an already-acquired host lease for a newer ordinary
     push.

## Files Changed

- `.github/workflows/backup-engine.yml`
- `docs/ENGINE-RELEASE-RUNBOOK.md` (Section 3.6)
- `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts`
- `tests/dr-posture.test.ts`
- `docs/changelog/2026-11-21-o1-o2-backup-midsoak-yield-and-inplace-retarget.md`
