# 2026-11-27: A Timed-Out Install Is Reported

Lane: release-custody. Follows #12251 (the apply run reports its own refusal).

## What Was Wrong

Two gaps were left in the `report-refusal` job of
`.github/workflows/apply-merged-migration.yml` and in
`scripts/ci/migration-apply-refusal-alert.mjs`.

1. **A timed-out apply was never reported.** GitHub's workflow syntax describes
   `jobs.<job_id>.timeout-minutes` as "the maximum number of minutes to let a
   job run before GitHub automatically cancels it". So a job that reaches its
   timeout concludes `cancelled`, not `failure`. A public run that hit its
   timeout (n8n run 9056203523) carries two annotations: "has exceeded the
   maximum execution time of 30 minutes" and "The operation was canceled.". The
   report job ran only on `needs.apply.result == 'failure'`, and the script
   skipped any run or job that was not `failure`. A timeout is the UNKNOWN
   outcome: the SQL may or may not have committed. It was the one outcome that
   stayed silent, and it is the most dangerous one to leave unread.
2. **A late re-report named the wrong pull request.** The owning PR was taken
   from the latest non-revert commit on the migration path. A dry-run replay of
   run `46054847104` on main named #12245, merged 2026-11-27 22:11 UTC, three
   hours after the run. The merge that dispatched the run was #12217, merged at
   19:10:06 UTC. The run was created at 19:10:48 UTC.

## What The Cancelled Runs Show

This repository has 69 cancelled `Apply Merged Migration` runs. I read their
jobs, step conclusions, timings and logs, and replayed each through the new
script with `DRY_RUN=true`:

| Shape                                                                                                                        | Runs     | Example                    |
| ---------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------- |
| Cancelled before any job existed (concurrency pending or queued). The jobs list is empty                                     | 54       | 43707103923, 40143306489   |
| Job never started (no runner, no steps), or cancelled in an earlier step with `Apply the migration` `skipped`                | 11       | 38717981247, 42760192569   |
| Cancelled inside `Apply the migration` during its queue wait. The log holds only `[queue] ... waiting` lines                 | 3        | 42692313645 (after 7 min)  |
| Job `cancelled` after `Apply the migration` concluded `success` (`[apply] APPLIED`)                                          | 1        | 38654273566                |
| Applier reached, then stopped by a timeout or a cancel. The log shows `[order] ... installing <file>`, then `[apply] <file>` | 0 so far | shape of 46054847104's log |

None of these runs reached its timeout. The longest apply job ran 44 minutes
(37872820690), all of it waiting for a runner. So the timeout shape comes from
GitHub's documentation and the public run above, not from a run here. A timeout
and a person's cancel leave the same job shape and the same log line ("The
operation was canceled."). Only the elapsed time tells them apart.

## The Fix

- The report job's `if` now admits exactly
  `(needs.apply.result == 'failure' || needs.apply.result == 'cancelled')`. The
  `always()`, default-branch and dry-run gates are unchanged.
- For a cancelled apply job, the script decides from the job itself:
  - `Apply the migration` never started: skipped, "nothing was sent";
  - the step concluded `success` before the cancel: skipped, "the outcome was
    read";
  - the step concluded `failure`: reported as the refusal it is;
  - the step was stopped and its log has no line beginning `[order]` or
    `[apply]`: skipped, because the queue gate loops before any database
    connection. The echoed shell source begins with `echo` and is never
    counted;
  - otherwise, including a log that cannot be read: reported with the verdict
    `TIMED OUT / UNKNOWN` (the job ran at least 35 minutes, the shortest apply
    timeout) or `CANCELLED / UNKNOWN`. The comment says the outcome is UNREAD
    and names the exact
    `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '<version>'`
    check to run before any other operation: no re-dispatch, no hand apply and
    no revert until it is read. The last applier line comes last in the
    detail, so it shows where the applier was when the job stopped.
- The owning commit is looked up with `until=<run created_at>`. The script
  also drops any commit dated after the run, so an API that ignores the bound
  still cannot name a later merge. If no commit is at or before the run, no PR
  is named and the #11599 alert still posts. The revert skip and the subject
  `(#N)` fallback are unchanged.
- `tests/the-apply-run-reports-its-own-refusal.law.test.ts` allows exactly
  `failure` and `cancelled`, nothing wider. It also holds the script's 35-minute
  floor to the shortest `timeout-minutes` of the apply job, and its step name
  to the workflow.
- The `.github/workflows/apply-merged-migration.yml` pin in
  `scripts/ci/fixtures/cash-link-union-proof-index/source-binding.json` was
  restamped (`aTimedOutInstallIsReported20261127`).

## Verification

- Dry-run replays: 42692313645 and 42693377171 are skipped (queue wait).
  42760192569 and 38717981247 are skipped (before the step). 38654273566 is
  skipped (the outcome was read). 43707103923 is skipped (no job). Run
  46054847104 now names #12217. On main the same replay names #12245.
- Not verified live: no run here has reached its timeout yet. Whether the
  report job is scheduled after a person cancels the whole run depends on
  GitHub honouring `always()` for that cancel, and has not been observed.
