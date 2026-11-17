# Evidence: window-file detector (incident release/window-install-skipped-on-release-control-change)

Read 2026-11-12T10:55Z (PRIMARY, cloud):

- Run 43155291080 (Daily engine reservation, head bb384e80): `cutoff` failed at 09:30:01Z;
  jobs "Install Queued Daily-Maintenance Migrations" (131093400494) and
  "Dispatch The Exact Main SHA" (131093402809) were both skipped.
- `smarter_private.ca_merged_migration_watch` holds 6 window files that are uninstalled, not retired
  and not superseded: 20261110003726, 20261110054654, 20261110173033,
  20261110214134, 20261111174148, 20261112013925. None is in schema_migrations.
- Live `fn_ca_merged_migration_install_watch` md5 = 52d09bfc2e17574b2c92afe078a86616,
  which is the 20261112035143 definition and is the pinned preimage.
- `fn_ca_owner_page_kind('migration-install-watch','WindowMigrationNotInstalled','warning')`
  returns NULL, so the new alert is never an owner page.

Native proof (PostgreSQL 16 locally, CI uses 17):

- With the fix: all cases pass, including the 2 new ones.
- With `MIGWATCH_PRE_WINDOW=1` (the 20261112035143 definition): the run fails at
  `assert window_alert('20261111080000') == 'firing:warning'`
  (`{'raised': 0, 'pending': 5, ...}`).

Expected on install: the first 10-minute run raises 6 WindowMigrationNotInstalled warnings
(the 6 files above). Each one resolves when the installer installs its file.
