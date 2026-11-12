# The install watch retires a migration marked superseded (2026-11-12)

`fn_ca_merged_migration_install_watch` paged the owner (critical, escalated 09:21Z) for
`20261112013714`, a file marked `-- SUPERSEDED BY 20261112022726` whose successor was installed at
03:10Z. The marker came in as a modify, and the watch read only added, renamed and removed files.
Migration `20261112094956` reads every added/modified/renamed migration's text for the marker and
retires the file when its successor is installed, watched, or added in the same commit; it retires the
one already-read row by name. Proof: `scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py`.
Evidence: `docs/production-alerts/evidence/migration-install-watch-376926/`.
