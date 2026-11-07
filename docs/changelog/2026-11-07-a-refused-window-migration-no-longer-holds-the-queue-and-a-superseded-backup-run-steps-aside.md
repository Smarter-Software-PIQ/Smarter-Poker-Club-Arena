# A refused window migration no longer holds the queue, and a superseded Backup run steps aside

2026-11-07. Two causes of the same morning's delay, fixed at the source.

## What happened

The 04:00 America/Chicago installer (`scripts/ci/install-window-migrations.mjs`)
sent six queued `-- @install-window: daily-maintenance` migrations. The first
was refused on a 1 s `lock_timeout`, rolled back cleanly, and the run stopped
there by design: "the first refusal stops the run". Five unrelated migrations,
two of them the Midway guards the day's release depended on, stayed queued,
and the whole release slipped to a daytime owner window.

Separately, the Backup Engine lane (`.github/workflows/backup-engine.yml`)
queues one full build-boot-crash-soak certification (about 45 minutes) for
every engine push to main, serialized on the single Backup host. Main took
engine pushes every few minutes, so when the sealed release at 16:31Z asked
for its 1:1 clone refresh, that refresh queued behind hours of certifications
of commits that newer pushes had already replaced. The 04:00 cutover offers
only the newest certified commit, so those certifications could never be
used; they only held the host.

## The fixes

1. **The installer skips a refused file alone.** A REFUSED outcome (exit 1)
   means the applier's own transaction rolled back and nothing committed, so
   the file is named as SKIPPED, stays queued for the next day, and the next
   queued file is sent. Every file is still sent once and never retried; the
   run still goes red naming every skipped file; an UNKNOWN outcome (exit 3,
   a signal, a timeout) still stops the run before the next file, because
   its outcome has to be read from `schema_migrations` first. Order is no
   longer guaranteed across days, so a window file that depends on an
   earlier window file asserts its prerequisite itself and is refused (not
   silently wrong) if the earlier one was skipped; the native proof's
   dependent pair exercises exactly that.

2. **A superseded Backup push run plans nothing.** The `plan` job of
   `backup-engine.yml` asks GitHub, for `push` runs only, whether a newer push
   run of the same workflow already exists (runs are FIFO, so a newer run can
   only be queued or running; its id is larger). If so, the run ends in
   seconds with an empty `sha`, so `refresh` and `certify` are skipped and no
   `backup-engine/certified` status is written: the commit stays uncertified
   exactly as if its turn had never come. Manual (`workflow_dispatch`),
   nightly (`schedule`) and post-seal clone refreshes (`workflow_run`) are
   never skipped. When GitHub cannot be read the run proceeds as before
   (CLAUDE.md 10.86: an unreadable answer is not a "yes"). With stale runs
   finishing in seconds, a post-seal refresh reaches the host within minutes
   instead of hours.

## Proof

- `scripts/ci/test-maintenance-window-migrations.sh` (PostgreSQL 17 in
  `maintenance-window-migrations.yml`): a refused first file is skipped and a
  dependent second file is sent once and refused with nothing committed; an
  unknown first file still stops before the second; a refused first file
  followed by an independent second installs the second with exact history,
  reports `REFUSED 1 of 2 ... skipped ... installed 1`, and a rerun still shows
  the refused file queued.
- `tests/a-window-migration-waits-for-the-daily-break.law.test.ts` pins the
  skip-alone loop, the red verdict naming skipped files and the UNKNOWN stop.
- `tests/the-backup-day-ends-with-only-a-four-am-release.law.test.ts` runs the
  plan shell: a newer push run skips with an empty sha; an unreadable `gh`
  proceeds; dispatch, schedule and sealed-release runs are never skipped.

## What this is not

Not a retry, not a watcher and not a cancel of another lane's run: the
installer still sends each file once per window, and the Backup lane only
declines to spend the host on a certification nothing can use.
