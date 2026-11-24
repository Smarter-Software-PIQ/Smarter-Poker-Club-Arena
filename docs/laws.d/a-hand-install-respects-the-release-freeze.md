# tests/a-hand-install-respects-the-release-freeze.law.test.ts

The Apply Merged Migration applier refuses an ordinary install inside the nightly release schema freeze (23:45-04:15 America/Chicago) on every route except the merge dispatcher's proven job-token send and the maintenance window route, unless an outage justification of at least 20 characters is given (release_freeze_override), so a hand install cannot make the Backup copy stale before the routine cutover.
