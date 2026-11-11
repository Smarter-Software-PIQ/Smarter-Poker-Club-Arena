# Evidence: migration-install-watch/376392

Read 2026-11-10T19:50Z (Production Alerts PRIMARY, cloud).

- `operational_alert_events` 376392: source `migration-install-watch`,
  `MergedMigrationNotInstalled`, critical, received 19:10:00Z, file
  `20261110173033_lightning_blinds_and_button_go_to_the_longest_waiting_player.sql`,
  merge `22c1fe09`.
- `smarter_private.ca_merged_migration_watch`: 20261110173033 has
  `window_install = false` and `alert_id = 376392`. Its pre-rename name,
  20261110160345, merged at 17:12:35Z as an added file, has `window_install = true`.
- `git show -M 22c1fe09`: rename at 99% similarity, single hunk `@@ -3,7 +3,7 @@`.
  Line 1 of the file on main is the daily-maintenance window declaration.
- Every window-declared file on main since 2026-11-09 (180446 predates the watch,
  231325, 231855, 003726, 173033): only 173033 is recorded `false`.
- Production `md5(pg_get_functiondef(fn_ca_merged_migration_install_watch))` =
  `050181cc806cb87f389881b72e543330`. This is the migration's preimage pin. The
  native proof installs 20261109182123 and the pin holds against it.

## Native proof (local PostgreSQL 16 here; CI uses 17)

Before the fix, the new rename case fails:

    assert sql("SELECT window_install ... WHERE version = '20261110170000'") == 't'
    AssertionError

After the fix: all 15 cases pass, including
`ok - a renamed daily-maintenance window file is read from its raw text and never paged` and
`ok - a renamed file whose raw text cannot be read is retried, never guessed ordinary`.
