# migration-install-watch / 376926: a superseded migration paged as uninstalled

Read 2026-11-12 ~09:50Z (PRIMARY, cloud).

- `operational_alert_events` 376926, `MergedMigrationNotInstalled`, critical, firing since 03:20:00Z,
  file `20261112013714_unfinished_rebuys_pay_the_starting_stack.sql` (merged 4850f853, 02:12Z).
- `push_outbox` 0b5e8c4e (owner, 09:21:00Z): "AI Agent Needed: MergedMigrationNotInstalled (release)".
- On main the file begins `-- SUPERSEDED BY 20261112022726`, added by 45086597 (#10561, 02:52Z) as a modify.
- `schema_migrations` holds `20261112022726 the_nightly_20k_rebuy_pays_the_starting_stack`; the watch row for it
  has `installed_seen_at = 03:10:00Z`.
- Watch row 20261112013714: `retired_at NULL, installed_seen_at NULL, alert_id 376926`.
- Live `fn_ca_merged_migration_install_watch` md5 `21ae83bdc42bb6804741b41a7b803ab4`; its text contains no
  `SUPERSEDED` handling and reads only added/renamed/removed files.

Native proof (PostgreSQL 16 locally, CI uses 17):
`python3 -B scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py` -> all passed, including
"a file marked superseded by an installed successor is retired and its page resolved" and
"a marker naming no installed or watched successor retires nothing and still pages". With the new
migration not applied, the first new case fails at the `retired_by` assertion.
