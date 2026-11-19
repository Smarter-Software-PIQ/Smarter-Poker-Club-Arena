# The drill chooses its club, and a weekly failure is heard (2026-11-19)

## What was wrong

- The weekly alarm drill (`fn_ca_alarm_drill`, cron `ca-alarm-drill-weekly`)
  had not run since 2026-11-09. Its subject had to be a house horse holding
  chips in KINGS CLUB (`a41434bb`); the horse fleet no longer holds balances
  there, so every run raised `ALARM_DRILL_NO_SUBJECT` before its first arm.
  The last passing drill is dated 2026-10-19.
- Nobody heard it. The exception reached only `cron.job_run_details`, and
  `fn_ca_cron_failure_watch` only considered jobs that had run in the last 24
  hours and failed three times in a row, so a weekly job could fail for three
  weeks before it qualified.

## What changed (`20261119171234`)

- The drill chooses its club with its subject: any Midway union club inside
  incident scope (`fn_ca_is_midway_scope`) other than its out-of-scope
  comparison club, KINGS CLUB first, then by id. Every arm reads the chosen
  club, which is in scope, so each arm proves what it proved before.
- When no club has a subject, the drill records a failing `ca_alarm_drills`
  row (`no_subject`) and raises its own critical incident, instead of an
  exception only the cron log sees.
- The cron watch, in its existing single 7-day pass, also raises an active job
  whose newest finished run failed and that has not run in 24 hours, keyed to
  that run, so one failed weekly run is one incident. Daily and faster jobs
  keep their rules unchanged.

## Proof

- Local PostgreSQL 16 with a stub schema, the real migration file installed
  (including its watcher probe): the failing weekly drill is raised critical,
  keyed to its run; a weekly job whose last run succeeded, an inactive job, a
  daily job and a failure older than 7 days are not.
- The empty-subject path records `{pass:false, failing:[no_subject]}` and one
  critical incident.
- The subject query run read-only on production finds 833 candidates and
  chooses one in 236 ms.
- Pinned by `tests/unit/theDrillChoosesItsClubAndWeeklyFailuresAreHeard.test.ts`.
