# Evidence: migration-install-watch/376926

These rows were read read-only from production (kuklfnapbkmacvwxktbh) on
2026-11-12 between 03:50 and 04:00Z.

## The alert and what reached the owner

- **operational_alert_events 376926:** `MergedMigrationNotInstalled`, critical,
  firing, received 03:20:00Z. The payload's file is
  `supabase/migrations/20261112013714_unfinished_rebuys_pay_the_starting_stack.sql`,
  merge_sha `4850f853…`, merged_at 02:12:06Z.
- **Owner notification `39b3d3b5`:** type `system`, title "Merged Migration Not
  Installed", data.source `owner-real-alert`, inbox_id 376926. This is the
  sanctioned real-alert route (20261007000420); the page itself was false.

## Why the file can never install

- **The file on main:** its first line marks it superseded by
  `20261112022726`. That marker was added by `45086597` (#10561).
- **The ledger:** `supabase_migrations.schema_migrations` holds
  `20261112022726 the_nightly_20k_rebuy_pays_the_starting_stack` and does not
  hold `20261112013714`.

## How the watch recorded the file

- **The watch's row:** `smarter_private.ca_merged_migration_watch` holds
  20261112013714 with window_install false, retired_at null and alert_id
  376926.
- **The cursor:** `since` is 2026-11-12T02:23:16Z and `last_state` is
  `read`. Commit `45086597` was read and skipped, because it only modified
  this file.

## The function being replaced

- **Live definition:** the md5 of `fn_ca_merged_migration_install_watch` is
  `21ae83bdc42bb6804741b41a7b803ab4`. The new migration checks this as its
  preimage, and the native test reproduces the same md5 from 20261110194917.

## Other waiting rows

- None of them carries the marker on main.
- `20261110003726`, `20261110173033`, `20261110214134` and `20261111174148`
  declare the daily window on line 1.
- `20261110054654` and `20261112013925` declare it later in the file. The
  watch's pattern is line-anchored anywhere in the file, and both are
  recorded window_install true.

## Native proof (PostgreSQL 16 local; CI uses 17)

- **With the fix:** all 24 checks pass.
- **With `MIGWATCH_PRE_FIX=1` (the 20261110194917 definition):** it fails at
  "a file marked superseded after its merge…", with the alert still firing:
  `{'ok': True, 'state': 'read', 'raised': 0, 'pending': 4, 'resolved': 0, 'new_commits': 1}`.
