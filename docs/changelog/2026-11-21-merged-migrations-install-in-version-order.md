# Merged migrations install in version order, by construction (incident 90972d77)

Follow-up to `2026-11-21-an-older-merged-migration-installs-first.md` (#11619).

## What was still open

Every merged file gets its own Apply Merged Migration run. The runs are
serialized (per-file concurrency groups plus the queue step, which waits for
every earlier run id), so they run in **dispatch** order, and dispatch order is
not version order. At 04:15 UTC four merges released by the same hold
dispatched together, `20261121024624` was dispatched and installed before
`20261121005533`, and the older file's chain guard then refused it.

#11619 added `scripts/ci/await-older-merged-applies.mjs`: each dispatcher
watched the applier's runs and waited up to 300 s while an older version was in
flight. That only made the race less likely. An older run slower than 300 s, an
older dispatcher that had not sent yet, or a lost older run still let a newer
file install first.

## The fix

The applier run itself installs in version order. In
`.github/workflows/apply-merged-migration.yml`, after the queue and before the
file it was asked for, `scripts/ci/install-older-merged-first.mjs` reads
`supabase_migrations.schema_migrations` (plain SELECT) and sends every OLDER
ordinary file on main that production does not hold, oldest first, once each,
through the unchanged `apply-recorded-migration.mjs`. The target is sent only if
every one of them installed. Since the runs are serialized, whichever run
reaches the database first installs the older file first; the older file's own
run then answers ALREADY-APPLIED and sends nothing.

- **Selection** matches the applier's own ALREADY-APPLIED test (version, name,
  or the name's 55-character truncation), so it never picks a file the applier
  would skip.
- **Window files** (`-- @install-window: daily-maintenance`) are never sent by
  this path and do not hold a later ordinary file back, as before; only a
  file's own chain guard decides dependencies on them.
- **Superseded files** (`-- SUPERSEDED BY <version>`) never install.
- **Floor `20261110000000`.** Earlier history includes migrations recorded
  under versions or names Supabase stamped; re-sending one would apply it
  twice. From the floor on, migration-install-watch (20261109182123) pages any
  merged ordinary file not installed by its exact version, retired or
  superseded, so every such file is installed, queued, superseded or already
  paging.
- **A refused or unknown older file stops the run** (exit 1 or 3) and the
  target is not sent: sending it would be the inversion. The fix is the older
  file (fix it in place, or mark it SUPERSEDED BY its successor), never sending
  the newer file over it.
- **At most 5 older files per run**, so the 35-minute job timeout holds; a
  longer backlog is refused with nothing sent and names the oldest file to
  dispatch first.
- An unreadable history is REFUSED with nothing sent.

### Why not one shared concurrency group

GitHub keeps one pending run per group and a newer pending run replaces the
older pending one. If an older version's run joins after a newer one is
pending, the newer run is dropped and "install everything up to V" never
reaches it; that is how `20261024213143` was lost on 2026-10-24. The per-file
groups and run-id queue stay as they are.

### Removed

`scripts/ci/await-older-merged-applies.mjs`, its call in
`.github/scripts/dispatch-merged-migrations.sh`, and the dispatcher's
`actions: read` permission, which only that wait used.

## Pinned

`tests/an-older-merged-migration-installs-first.law.test.ts`: the selection
rule, the stop-on-refusal and UNKNOWN codes, the backlog cap, a model of the
queue over all 24 dispatch orders of four files (always installed in version
order), the single-group loss, and the workflow and dispatcher wiring.
`scripts/ci/fixtures/cash-link-union-proof-index/source-binding.json` re-pins
`apply-merged-migration.yml` with a review entry;
`apply-recorded-migration.mjs` is unchanged.

## Not verified here

No production run: the selection against live `schema_migrations` was not
executed (no database access in this change). The first real dispatch after
merge is the proof; its log lines start with `[order]`.

## A switched-off applier is HELD, not "dispatched"

GitHub answers 204 to a `repository_dispatch` for a disabled workflow and
creates no run. During the 1906z owner-window installer pause the dispatcher
reported #11635's `20261121153607` as "dispatched" though no run was ever
queued. The dispatcher now reads the applier's state first (`actions: read`):
switched off means HELD, nothing sent, a PR comment naming the files and
`scripts/release/resume-migration-installs.sh` (which sends every file merged
during a pause); unreadable means COULD NOT TELL and it sends as before.
