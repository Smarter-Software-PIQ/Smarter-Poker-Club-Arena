# The Window Opens Only Active Pull Requests

Lane: release-custody. Date: 2026-11-27 (Chicago).

## Why

The required status `Migration merge window` (`scripts/ci/migration-merge-window.mjs`) flips every held pull request (one that adds or changes an ordinary migration or a release-control file) to success at each window open, `[S+10m, S+27m)` after every cycle, and back to failure at the close. After #12255 (drafts are never opened, unchanged statuses are skipped) one window still cost about 154 status writes at the open and 154 at the close. GitHub documents 80 content-creating requests a minute and 500 an hour; the close took about 1 min 50 s against the 3-minute in-flight margin before the applier's cutoff.

195 of the 212 held pull requests had no update in 7 days. Nobody merges those in a given window, yet each was opened and closed every three hours.

The obvious cut was deferred once because `scripts/ci/merge-window-watch.mjs` (alert `MigrationMergeWindowNotOpened`) sampled the least recently updated held pull requests and expected them to turn green: holding stale pull requests shut would have paged every window as missed.

## The Fix

1. `mergeWindowVerdict` takes the pull request's `updatedAt`. A held, ready pull request is opened only while `updatedAt` is within `ACTIVE_PR_DAYS = 7` of the verdict's own clock. An inactive one gets `INACTIVE_HELD` ("Inactive 7+ days: push or edit the PR, then it merges 10-27 min after a cycle or 4:15-4:27 AM"), one constant text with no time in it, so the existing unchanged-status skip writes it once and never again at a boundary. A push, edit, label, reopen or ready_for_review is a `pull_request_target` event that re-runs the verdict, and the keeper re-reads `updatedAt` every pass, so a touched pull request is opened in the same window. The outage override still opens an inactive pull request; drafts are unchanged. An unreadable `updatedAt` keeps the old window rules (it can only cost writes, never open a closed window). The window length is unchanged.
2. `merge-window-watch.mjs` samples only pull requests the keeper was due to open: ready, held, and active through the whole window (last updated before the open and less than 7 days before the close). It reads the 100 most recently updated open pull requests instead of the 60 least recently updated, prefers those last updated before the open, and judges one updated after the open from its statuses (dropped if it carried `INACTIVE_HELD` just before or during the window, unless the window opened it). With no such pull request the verdict is `not-needed`, never `missed`; an active, ready pull request that stayed failure through the window is still `missed`.

## Expected Writes Per Boundary

From the counts of 2026-11-27 (212 held, 58 drafts, 154 ready, 17 updated within 7 days): at most 17 writes at each open and at each close, down from about 154. The first pass after this merges writes `INACTIVE_HELD` once to each inactive ready pull request (at most about 154 writes, once), and a pull request crossing the 7-day mark is written once more.

## Proof

Tests: `tests/a-migration-merges-only-inside-its-install-window.law.test.ts`, describe "a window opens only active pull requests". Live proof is pending at the next window after merge: the keeper log should show only active held pull requests written at the open and the close, and the next `merge-window-watch.mjs verdict` should read `held` or `not-needed`.
