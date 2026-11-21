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

Root fix: `scripts/ci/merged-migration-order.mjs`. Before an ordinary install
sends anything, `apply-recorded-migration.mjs` reads the merged files the
install watch knows are still waiting with a lower version (merged in the last
day, not installed, retired, superseded or window) and waits for them, bounded
at 150 s, polling every 5 s. Files released by the same boundary install in
version order. When the budget ends with an older file still waiting, the
install proceeds as before, so a refused older file never holds a later fix
hostage; an unreadable watch is named (COULD NOT TELL) and does not stop the
install.

Pinned by `tests/an-older-merged-migration-installs-first.law.test.ts`.
