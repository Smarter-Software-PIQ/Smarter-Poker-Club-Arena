# A Closed Pull Request Stands The Money-Trigger Run Down

2026-11-12

## What Happened

Three runs of Trusted Money Trigger Recovery failed in one afternoon: 43267133049 (pull request #10516), 43282451815 (#10604) and 43296884003 (#10612). Each was started by a pull request event and the pull request was merged one to six seconds later. The begin step read the pull request, found it no longer open and threw "invalid PR state"; the finish step then threw "no started check". The proof step never ran and no check run was created. In each case the same head already carried a successful "Money trigger declaration authority" check from the earlier run that admitted the merge, so nothing about main or a money path was wrong. The cost was a red run on a money guard for a harmless reason.

## What Changed

`scripts/ci/money-trigger-closed-pr.mjs` (new) decides admission at begin. An open pull request on main from this repository is admitted exactly as before, and every earlier refusal is kept (base other than main, unknown state, cross-repository). A pull request that is already closed, merged or not, stands the run down: begin writes a marker bound to this run and this pull request number, creates no check run and ends cleanly; the proof step sees that marker, reads nothing and writes no proof; finish reports nothing, revokes a protection reader token if one was minted, and ends cleanly. No success can come out of a stood-down run. Reopening a pull request starts a fresh run.

Not changed: the workflow file, the merge-group path, the completion rules (a head that advanced or a pull request closed during a run still gets a failure), the reporter identity, the ruleset check.

## Proof

`tests/money-trigger-closed-pr.test.mjs`, 13 cases, run in CI beside the caller test. The process cases run the real scripts with only `fetch` replaced. With the two scripts at their previous content the two stand-down cases fail; with the change all pass, and the existing money-trigger tests still pass unchanged.
