# The install watch's hour starts when the dispatcher may send (2026-11-19)

Reliability incident dc479141 - `MergedMigrationNotInstalled`, alert 445153.

## What happened

- 05:35 UTC (23:35 Central) #11340 merged `20261119013426_an_ended_seat_settles_its_pending_addons.sql`.
  Its applier run (44466273298, 05:36) was **refused**: the settlement pinned
  "exactly 44 probed rows / 17,600.00" and one probed horse had sat back down
  (`BOARD_MOVED`). A real defect, fixed in place by #11362 (each row proves its
  own evidence), merged 06:22 UTC.
- 06:22 UTC is inside the nightly release schema freeze (23:45-04:15 Central,
  `RELEASE_SCHEMA_FREEZE_CHICAGO`). Dispatch Merged Migrations held the fixed
  file to 04:15 on purpose, so tonight's 4 AM engine certificate stays valid.
- The database install watch knew neither the freeze nor the fix. At 06:40 UTC
  it paged the file 65 minutes after its *original* merge and said "Dispatch
  Apply Merged Migration for it", the one action that would have stranded the
  cutover. Seven more freeze-held merges were each due to page the same way.

## Root fix

`20261119064912_the_install_watch_hour_starts_when_the_dispatcher_may_send.sql`:

- `smarter_private.ca_release_schema_freeze_holds(t)` is the dispatcher's freeze in SQL;
  `smarter_private.ca_merged_migration_install_due_at(t)` is the dispatcher's first
  admitted send (the next 04:15 Central when `t` is in the freeze), plus 60 minutes.
- The watch's hour runs from `install_due_at(GREATEST(merged_at, modified_at))`.
- A waiting file modified on main (fixed in place) records `modified_at`, resolves
  the outdated page with the fix named, and pages again once, under its own key
  `uninstalled:<version>@<sha>`, if still not installed after its new hour.
- A page raised inside the freeze says **do not hand-dispatch**.

## Hardening

- `tests/the-install-watch-hour-starts-when-the-dispatcher-may-send.law.test.ts` pins the
  SQL freeze bounds to `RELEASE_SCHEMA_FREEZE_CHICAGO`; moving one without the other fails CI.
- `scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py` proves the freeze,
  fix-in-place and freeze-wording cases on real PostgreSQL; they fail on the previous
  definition (`MIGWATCH_PRE_FREEZE=1`) with tonight's exact page text.
- The migration proves its helpers on fixed CST and CDT instants before COMMIT.
