# 444704: the install queue was blind to an apply run waiting behind another

Row `operational_alert_events` 444704, `InstallQueueJobFailed`, source
`install-queue`, received 2026-11-19 00:10:09Z: job `20261118233246-pr11326.job`,
file `20261118233000_the_capped_satellite_executor_carries_its_own_deadline.sql`,
note `install rc=3 (see log)`.

## What production recorded (read 2026-11-24 18:50Z)

- `smarter_private.ca_merged_migration_watch`: merge `ccc9cf384df8` at
  2026-11-18 23:58:57Z, first seen 2026-11-19 00:00:00Z, installed seen
  00:20:00Z, `window_install` false.
- `supabase_migrations.schema_migrations` holds `20261118233000`.
- The job failed at 00:10:09Z, before that install was seen.

## Cause

`install-driver.sh` exits 3 ("no run appeared") when it cannot find the run it
just dispatched within 160 s. It identified the run by the first JOB's name
(`gh run view --json jobs --jq '.jobs[0].name'`). `apply-merged-migration.yml`
has a per-file concurrency group (`apply-merged-migration-<file>`,
`cancel-in-progress: false`), and since rule 11 (2026-10-25) the merge
dispatcher sends every merged migration itself. The merge at 23:58:57Z sent its
own run for the file; the queue's dispatch joined the same group and waited
behind it as a pending run, which has no job yet. The driver therefore never
saw its own run and reported rc=3; the dispatcher's run installed the file and
the queue's job stayed `failed`.

A second hazard on the same path: a third send to the group displaces a pending
run (GitHub keeps one running and one pending per group), so a driver that
stacks a send behind an in-flight run can cancel another sender's pending run.

## Fix

- `apply-runs.py` (new) matches runs by run-name, `Apply Merged Migration
  <file>[ <nonce>]`, which exists from creation, and counts runs for the file
  not yet completed. An unreadable listing exits non-zero and is never read as
  "none in flight".
- `install-driver.sh` waits for any run already in flight for the file before
  each send (bounded at 60 min, exit 4), then matches its run by run-name.
- `install-queue.sh` fails a job only when the version is still not recorded
  after the driver returns; if another route recorded it, the job goes on to the
  same readback and live-proof as any install. An unreachable database retries
  next pass.

## Hardening

- Regression: `tests/ops-mac-services.test.ts`, cases "sees its own workflow run
  while it waits behind another run for the same file" (fixture
  `tests/fixtures/ops-mac-apply-runs/queued-behind-dispatcher.json`) and "fails
  a job only when its version is still not recorded". Both fail on main
  (`cd445e2d0`) and pass with the change (9/9).
- Invariant: the queue's failure state requires an unrecorded version.
- Detection: unchanged, `InstallQueueJobFailed` through
  `fn_record_operational_alert` with `target_task_id`.
- CI gate: Client Unit Tests runs `tests/**/*.test.ts` on every PR.

## Delivery note

The services run from `~/.smarter-poker/ops` on the Ops Mac, copied by
`operations/ops-mac/setup.sh`. After merge, `setup.sh <checkout>` must be run
on that Mac for the change to take effect; a cloud session cannot do that.
