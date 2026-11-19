# Evidence: migration-install-watch/445897

Read read-only from production (kuklfnapbkmacvwxktbh) and GitHub Actions on
2026-11-19 between 22:45 and 22:55Z.

## The alert

- **operational_alert_events 445897:** `MergedMigrationNotInstalled`, critical,
  firing, received 22:20:01Z. File
  `20261119183700_chicago_cash_windows_add_partial_days_instead_of_subtracting.sql`,
  merge `71252aa1` (#11428, 21:07:29Z).
- **smarter_private.ca_merged_migration_watch:** version 20261119183700,
  window_install false, installed_seen_at null, alert_id 445897.

## What the applier did

- **Run 44617650995** (Apply Merged Migration, 21:19:49Z, conclusion success),
  job 135890549104:
  - `[apply] ALREADY-APPLIED: 20261119183700_chicago_cash_windows_add_partial_days_instead_of_subtracting.sql`
  - `[apply]   recorded as version=20261119180000 name=chicago_cash_windows_add_partial_days_instead_of_subtracting`
  - `[apply] Nothing sent. This run changed nothing.`
- **The ledger:** schema_migrations holds
  `20261119180000 chicago_cash_windows_add_partial_days_instead_of_subtracting`
  (from #11433, merged 21:01:38Z) and no row for 20261119183700.
- **Why:** `scripts/ci/apply-recorded-migration.mjs` reads history with
  `WHERE version = $1 OR name = $2 OR name = left($2, 55)`. The name key is
  deliberate (a change applied under another stamp), so two executable files
  with one name leave the second unsent while its run reports success.
- **The live-proof lines of 183700 pass anyway** (`'Purely additive'` is in all
  three live bodies), because 180000's bodies contain the same phrase. They do
  not prove 183700's body is live; the two files differ in 310 diff lines.

## Gate before and after

- **origin/main gate** on a fixture repo whose base holds 180000 and adds
  183700: `1 new migration(s) against main; all versions are unique.`, exit 0.
- **This branch:** `newly added migration shares its name with another
  migration`, exit 1.
- **Law test** `tests/a-migration-name-is-not-another-files-name.law.test.ts`:
  4 of 5 cases fail against the origin/main gate; 5 of 5 pass with the fix.
- **Repository on main:** 92 historical name pairs exist; the gate judges only
  newly added files, as the version rule does.

## Not done here

183700's body is still not installed. Whether production should carry its
body (Feeder-to-Main move case) or 180000's is a member-record decision; this
branch does not send, mark or rename either file.
