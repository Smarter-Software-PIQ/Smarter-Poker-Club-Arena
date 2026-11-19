# tests/a-migration-name-is-not-another-files-name.law.test.ts

The production applier answers ALREADY-APPLIED when the ledger holds a file's
version or its name, so of two executable migrations sharing one name the
second is never sent and its run reports success. On 2026-11-19
`20261119183700_chicago_cash_windows_add_partial_days_instead_of_subtracting`
was skipped as "recorded as version=20261119180000" and paged
MergedMigrationNotInstalled (alert 445897). `check-new-migration-version-collisions.mjs`
now refuses a new executable migration whose name, or the applier's
55-character name prefix, another executable file already carries.
