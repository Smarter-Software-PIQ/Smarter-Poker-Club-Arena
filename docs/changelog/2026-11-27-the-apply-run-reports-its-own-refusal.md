# 2026-11-27: The Apply Run Reports Its Own Refusal

## What Went Wrong

`Apply Merged Migration` run `46054847104` refused
`20261127172908_cron_watchers_materialize_and_prune_without_deadlock.sql`
(statement timeout) at 2026-11-27 13:13 CST. `Migration Apply Refusal Alert`
exists to post that on the owning pull request (#12217) and on the release
custody log (#11599) straight away. It posted nothing, on either.

Two separate causes, both measured:

1. **The alert never ran.** It was triggered by `workflow_run` of the applier.
   The merge dispatcher (`dispatch-merged-migrations.yml`) starts the applier
   with a `repository_dispatch` sent by the Actions job token, and GitHub raises
   no `workflow_run` event for a run the job token started. Run `46054847104`
   reports `event: repository_dispatch`, `actor` and `triggering_actor`
   `github-actions[bot]`, `conclusion: failure`. The alert workflow's whole run
   history was one run, a manual `workflow_dispatch` (`45943016172`,
   2026-11-26 22:58 CST). So for the normal route the alert had never fired and
   never could: a detector with no reader (CLAUDE.md 10.83).
2. **Had it run, it would have said nothing useful.** The script read the
   failed job's log with `gh api <endpoint>`. The hosted runner's gh (2.97 and
   later) refuses to print a non-JSON body holding terminal escape sequences
   unless passed `--allow-escape-sequences`, and the script swallowed that error
   into an empty log. The alert would have carried no verdict and no detail,
   with nothing saying the log was unread (CLAUDE.md 10.86). This is the defect
   fixed for readiness in #12249.

## The Fix

- **The failed run is its own reader.** `apply-merged-migration.yml` gains a
  `report-refusal` job: `needs: apply`, runs only when the apply job concluded
  `failure`, on the default branch, and not for a dry run (a dry run sends
  nothing, so its refusal is not a merged migration left uninstalled). It holds
  no environment and no secret, has `issues: write` and `pull-requests: write`
  and nothing wider, checks out the default branch without stored credentials
  and runs `scripts/ci/migration-apply-refusal-alert.mjs` on its own run id.
  No watcher, no timer, no retry.
- **The script decides from the job, not the run.** Inside the run, the run's
  conclusion is still null. The script now reports when the run's apply job
  (named `Apply <file>`) completed with conclusion `failure`, and skips
  otherwise. The report job itself is never chosen as the failed job, whatever
  its state.
- **The job log is read on every gh.** `ghApiText` always passes
  `--allow-escape-sequences`, falls back to the old form only on gh's own
  "unknown flag" answer, and throws any other failure without retrying.
  Terminal escape sequences are stripped before the log is parsed.
- **An unread log is said to be unread.** If the log cannot be read, comes back
  empty or holds no line the script recognizes, both comments carry a
  `Detail unread:` line with the reason. The alert is still posted.
- **The old workflow tells the truth about itself.**
  `migration-apply-refusal-alert.yml` stays as the hand door (re-report a run
  by id) and for apply runs a person or an App started. Its header no longer
  claims an alert "within ~30 seconds" on a trigger that cannot fire for the
  normal route. The two routes cannot double-post: the script dedups by apply
  run id, and a `workflow_run` event exists only after the apply run, report
  job included, has finished.

## The Proof

- `tests/the-apply-run-reports-its-own-refusal.law.test.ts` reads the applier
  workflow as parsed YAML. On main before this change: 7 tests, 6 failed. On
  this branch: 7 tests, 7 passed.
- `tests/unit/migrationApplyRefusalAlert.test.ts`: 10 tests on main, 20 on this
  branch, all passing. New cases: an in-progress run with a failed apply job is
  reported; a run whose apply job succeeded, is running, was cancelled or was
  skipped is not; the report job is never chosen; the new gh flag path, the old
  gh fallback, and no retry of any other failure; coloured log lines yield the
  same verdict as plain ones; an unreadable log is stated in the comment.
- Read-only replay against the real failed run: the script, pointed at run
  `46054847104` with `DRY_RUN=true` on a gh that does not know the flag
  (2.89, so the fallback ran for real), read the job log and rendered
  `REFUSED after 9952ms` with
  `[apply] ERROR 57014: canceling statement due to statement timeout`, and
  posted nothing. It names the pull request that last changed the file, which
  is #12245 since 16:11 CST and was #12217 when the run refused.
- The workflow pin in
  `scripts/ci/fixtures/cash-link-union-proof-index/source-binding.json` is
  restamped with its own audit block (`theApplyRunReportsItsOwnRefusal20261127`);
  `scripts/ci/verify-source-bindings.py` passes.
- **Live proof is pending** the next refused apply on main after merge: the
  apply run should show a `Report a refused install` job and one comment each
  on the owning pull request and #11599.
