# A new migration's name is not another file's name (2026-11-19)

The production applier treats a ledger row with the same version OR the same
name as ALREADY-APPLIED. #11433 and #11428 both added a migration named
`chicago_cash_windows_add_partial_days_instead_of_subtracting` (versions
20261119180000 and 20261119183700). 180000 installed; the 183700 run reported
success, sent nothing, and MergedMigrationNotInstalled paged an hour later
(operational_alert_events 445897).

`scripts/ci/check-new-migration-version-collisions.mjs` (CI job in `ci.yml`
and `scripts/ci/all-gates.sh`) now refuses a new executable migration whose
name, or the applier's 55-character prefix of it, another executable file
already carries. Recordings and inert tombstones are exempt. Pinned by
`tests/a-migration-name-is-not-another-files-name.law.test.ts`. Evidence:
`docs/production-alerts/evidence/migration-install-watch-445897/`.

183700's own body is still uninstalled and is left to the member-record owner.
