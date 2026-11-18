# The install watch reads a renamed migration's header from the whole file

2026-11-10, Production Alerts fleet (PRIMARY lane), incident `migration-install-watch/376392`.

## What happened

#10380 (`22c1fe09`, merged 18:00Z) renamed the daily-maintenance window migration
`20261110160345_lightning_...` to `20261110173033_lightning_...` and changed one
line (its own file name, line 7). At 19:10Z the merged-migration install watch
raised critical `MergedMigrationNotInstalled` (operational_alert_events 376392)
for it, although the 04:00 America/Chicago window installs it by design.

## Root cause

`fn_ca_merged_migration_install_watch` (20261109182123) took
`COALESCE(patch, raw file)` as the file text. For a rename, GitHub's patch is
present but carries only the changed hunk (`@@ -3,7 +3,7 @@`), so the window
declaration on line 1 was not in it. The file was remembered with
`window_install = false` and paged an hour later.

A second, smaller defect sat beside it: when neither text could be read,
`COALESCE(..., false)` recorded the file as ordinary instead of saying it could
not tell (CLAUDE.md 10.86).

## Fix

Migration `20261110194917` replaces only that function:

- only an added file's patch counts as the whole file; a renamed file (or an
  added file whose patch GitHub omitted) is read from the raw file at the merge
  commit;
- if that raw read fails, the commit stays unread and is read again next run.

## Hardening

- Regression: two new cases in
  `scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py` (a renamed
  window file is never paged; a rename whose raw text cannot be read is retried).
  Both fail on the 20261109182123 definition and pass with this one.
- Invariant: the watch never records a file as ordinary from a partial patch or
  an unread file.
- Detection: the watch itself remains the detector; a recurrence would raise
  `MergedMigrationNotInstalled` with `target_task_id` into
  `operational_alert_events`.
- CI gate: `.github/workflows/a-merged-migration-left-uninstalled-is-paged.yml`
  now also triggers on the new migration.

## Data

Row 376392 stays raised. When 20261110173033 installs in the 04:00 window, the
watch resolves it. Only this one remembered file was misread (checked against
`smarter_private.ca_merged_migration_watch` and the headers of every file on main).
