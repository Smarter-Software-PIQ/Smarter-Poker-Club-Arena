# 2026-11-21: the hands a person sat in are kept beside the Horse journal (built dark, off)

## What was wrong

The Horse decision journal is a ring on the engine host. The hands every exact-replay grade of a Horse change against persons needs, the few a person plays each day, left the ring before the by-hand read the release rules allow could reach them (Nov 18 gone; Nov 19 person-seated hands 2 of 135 sampled still present). The only copy was a hand-run pull over ssh whose guard read the wording of coordination posts.

## What changed

- `server/src/services/horseDecisionJournal/keep.ts` (new) and four guarded lines in `worker.ts`: after the journal's writer thread has appended and acknowledged a batch, the records of hands with a person seated are appended again to a keep store, `<journal>/keep/archive[-shard-N]`: the same store code, record format and private-file rules, on the same private mount, read by the same reader. Bounded queue (2,048 records / 32 MiB) that drops and counts; a 48 GiB free-disk floor (above the main ring's 32 GiB); three failed batches switch it off until the writer restarts; a byte ring of 4 GiB per shard. Counts go to `<journal>/keep/status-<shard>.json`.
- THE SETTING is the code default `HORSE_JOURNAL_KEEP_SCOPE` in keep.ts and it is `'off'`: nothing is constructed and no file is opened. Turning it on is a one-line change in a later release.
- No decision worker, publisher or protocol file changes; no record kind or field is added; no migration, switch row or environment value.
- `scripts/ops/journal-keep/pull.sh` (new): the by-hand off-host copy. Its guard is read from GitHub and /health; when it refuses, the script exits (75). One read-only, no-network container per batch; nothing is written on the host.

## Laws

- `aPersonsHandsAreKeptAndTheKeepCopyCanOnlyLoseItself.law.test.ts`
- `tests/the-journal-pull-is-started-by-hand-and-never-waits.law.test.ts` (runs `scripts/ops/journal-keep/tests/test_pull.sh`)

## Not in this release

Turning the keep store on; reader-image retention beyond 14 days (a record is replayed on its own release's image).
