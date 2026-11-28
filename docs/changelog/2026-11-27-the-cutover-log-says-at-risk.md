# The Cutover Log Says At Risk (2026-11-27)

Lane: release custody (engine cutover every three hours).

## What Went Wrong

PR #12267 gave the readiness check an `AT_RISK` verdict: a certified, selectable candidate with a migration install still in flight that its Backup copy lacks. The T-90m and T-45m line the Stage owner run posts on `#11599` knew only READY, IN_FLIGHT and NO_CANDIDATE, so it would print `readiness unknown (...)` for it: never wrong, but it hides that the build can still ship.

## The Fix

`readiness_note` in `.github/workflows/stage-engine-release.yml` prints `AT RISK <sha12>: <summary>` for `AT_RISK`, with the same other-cycle guard as READY.

## Proof

`tests/daily-preparation-does-not-wait-for-a-punctual-cron.law.test.ts`, "says READY, IN_FLIGHT, AT RISK, NO CHANGE or unknown in one line": two new rows. The case fails with main's workflow and passes on this branch. First live proof: the first readiness post written while an install is in flight.

This is a release-control file: it merges only in a merge window.
