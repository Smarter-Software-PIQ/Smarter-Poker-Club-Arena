# An older merged migration installs first (incident 90972d77, 2026-11-21)

`MergedMigrationNotInstalled` paged at 05:30 UTC for
`20261121005533_horse_option_switch_lightning_participation_holdem_harm`.

Each merged pull request has its own dispatcher run and each file its own
Apply Merged Migration run (concurrency is per file). Four merges held behind
the same boundary were released together: runs 44865152030, 44865153281,
44865153866 and 44865154466 started within two seconds of 04:15 UTC, and
`20261121024624` (the next switch list) installed before `20261121005533`,
whose own chain guard then refused it. The instance was closed by #11575
(marked superseded); the race itself was still open.

Root fix: `scripts/ci/await-older-merged-applies.mjs`, run by every
dispatcher (`.github/scripts/dispatch-merged-migrations.sh`) after its own
bounded wait and before its first send. It reads the applier's own queued and
running runs (`actions: read` on the dispatcher's job token) for a minimum
25 s observation period, so a sibling dispatcher woken in the same second has
time to send, and keeps waiting while any run for an OLDER version is queued
or installing. Bounded at 300 s: a stuck older run never holds a later fix
hostage, and an unreadable list is named COULD NOT TELL and the send goes on.
The applier itself (`apply-recorded-migration.mjs`, bound by qualification
evidence) is unchanged.

Pinned by `tests/an-older-merged-migration-installs-first.law.test.ts`.
