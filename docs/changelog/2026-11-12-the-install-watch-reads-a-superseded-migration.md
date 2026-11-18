# The install watch reads a superseded migration as never to be installed

2026-11-12, Production Alerts fleet (PRIMARY lane), incident `migration-install-watch/376926`.

## What happened

#10558 (`4850f853`, merged 02:12Z) added the ordinary-route migration
`20261112013714_unfinished_rebuys_pay_the_starting_stack.sql`. #10561
(`45086597`, merged 02:52Z) replaced it with `20261112022726` (installed) and
marked `20261112013714` on its first line as superseded by `20261112022726`.
The applier (`scripts/ci/apply-recorded-migration.mjs`) and CI
(`check-migrations-are-live.mjs`, `check-migrations-applied.mjs`) honour that
marker: the file must never run.

At 03:20Z the merged-migration install watch raised critical
`MergedMigrationNotInstalled` (operational_alert_events 376926). The
real-alert route sent it to the owner's phone, telling him to dispatch a file
the applier refuses by design.

## Root cause

`fn_ca_merged_migration_install_watch` (20261110194917) acts on a commit's
`added`, `renamed` and `removed` files only. The commit that marked the file
superseded *modified* it, so the watch never saw it. It also had no notion of
the never-run marker at all: even an added file that arrived superseded would
have been paged.

## Fix

Migration `20261112035143` changes one function and adds one nullable column
(`smarter_private.ca_merged_migration_watch.superseded_by`):

- A `modified` file that is still waiting is read again from its raw text at
  that commit. Its window declaration and its never-run marker come from the
  whole file. If the text can't be read, the commit is retried, never guessed.
- The marker is read the way the applier reads it: a line of its own within
  the first 400 characters, naming a 14-digit version. It only counts while
  that version is installed or still on main.
- A superseded file is never paged. An alert already raised for one resolves
  as `superseded on main by <version>`.
- Data: the commit that marked `20261112013714` was already read, so the
  migration records `superseded_by` for that one row. It is guarded on the row
  still being in its mis-recorded state. The watch's next run then resolves
  row 376926 itself.

## Hardening

- **Regression:** five new cases in
  `scripts/ci/test-a-merged-migration-left-uninstalled-is-paged.py`. With the
  20261110194917 definition (`MIGWATCH_PRE_FIX=1`), the first one fails: the
  alert stays firing.
- **Invariant:** the watch can't record a superseded file as waiting, and it
  never takes a partial patch for the whole file.
- **Detection:** the watch itself. A recurrence raises
  `MergedMigrationNotInstalled` with `target_task_id` into
  `operational_alert_events`.
- **CI gate:** `.github/workflows/a-merged-migration-left-uninstalled-is-paged.yml`
  now also triggers on the new migration.
