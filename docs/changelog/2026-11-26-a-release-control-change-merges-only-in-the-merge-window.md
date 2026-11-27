# A Release-Control Change Merges Only In The Merge Window (2026-11-26)

Lane: release custody (engine cutover every three hours).

## What Went Wrong

A Backup certificate is selectable only while the release-control projection of its commit equals main's (`projection()` in `scripts/ci/read-engine-prequalification.py`). One merge that changes a projected file strands every certificate, and a new one takes about an hour on the single Backup host.

- 2026-11-25 22:50 CST: O27 (#12038) merged. The only shippable build became unselectable and the 01:00 cycle kept serving.
- 2026-11-26 12:40 CST: the O31 batch (#12103) merged. 13:00 kept serving.

Both merges broke Custodian Checklist rule 1. The rule was text; nothing refused the merge.

## The Fix

The required status `Migration merge window` already holds a pull request with an ordinary migration to the minutes the applier installs (10 to 27 minutes after each cycle, 04:15 to 04:27 CST). It now holds a pull request that changes a projected file to the same minutes:

- `scripts/ci/release-control-paths.mjs` reads `CONTROL_INPUTS` and its four exclusion lists from the Python source as text. No list is copied. If the source cannot be read, the release workflows and release directories are held with no exclusion.
- `mergeWindowVerdict` in `scripts/ci/migration-merge-window.mjs` treats a release-control change like an ordinary migration. A control-only pull request reads `Release controls merge 10-27 min after a cycle or 4:15-4:27 AM; next <time>`.
- The written outage override (`migration-outage-override` label plus an `Outage override:` line) admits a change that cannot wait, for example when no certificate is selectable at all.
- `scripts/ci/merge-window-watch.mjs` counts a held release-control pull request as a candidate when it checks that a window was opened.

No workflow, timer, secret or ruleset changed. The status is already required on main.

## Why The Same Minutes

Ten minutes after a cycle the certificate a merge would strand has just been used or refused, and about two hours remain for a new one before the next cutoff. A second, longer window for release controls would need its own keeper; one window keeps one rule: anything that can stale a certificate merges 10 to 27 minutes after a cycle.

## Limits

- No window exists from 22:27 to 04:15 CST (nightly schema freeze). A release-control change made overnight waits or uses the override.
- A rename out of the projection is seen only through the REST file list (`previous_filename`); the GraphQL list used for small pull requests gives the new path only.

## Proof

`tests/a-release-control-change-merges-only-after-a-cycle.law.test.ts` (10 cases): both merges above are refused; every minute of a day agrees with the migration window; the JavaScript classifier and the Python filter agree on every tracked file; an unparseable constant falls back to holding the release workflows and directories. The existing law `tests/a-migration-merges-only-inside-its-install-window.law.test.ts` still passes (19 cases).
