# 2026-11-15: A Declared Capture Keeps Its Window Without A Restart

Follows `docs/horse-brain-journal-retention-2026-09-26.md`. That page's evidence hold is one environment variable, `HORSE_DECISION_JOURNAL_ARCHIVE_HOLD`, read when a writer opens and still set to the 2026-09 Phase 6A/6B window. Nothing protected a capture declared for a later release.

## What Was Wrong

Measured on the engine host during the Human-vs-Horse capture of release `a7965514` (declared window 2026-11-14T22:10Z to 2026-11-15T10:10Z): the oldest file in each of the seven later shards was between 2026-11-13T20:27Z and 2026-11-14T06:53Z at 00:27Z, and the oldest files were retired at 0.5 to 1.3 times real time. At the fast end the window's first hours would have been retired before it closed. Changing the environment variable needs an engine restart, which a capture must not cause, and it holds only what exists when the writer opens. The capture owner therefore byte-copied every segment file of the window every hour, with manifests and hash checks: a copying job standing in for a retention rule.

## What Changed

- A declared hold is a file `<HORSE_DECISION_JOURNAL_DIR>/holds/<id>.json`, beside the archive directories, so every shard's writer reads the same declarations. The rules are in `config.ts` beside `parseHorseJournalDeclaredHold`:

  ```json
  {
    "version": 1,
    "fromUtc": "2026-11-14T22:10:00Z",
    "untilUtc": "2026-11-15T10:10:00Z",
    "expiresUtc": "2026-11-22T10:10:00Z",
    "operator": "Human-vs-Horse capture owner"
  }
  ```

  Exactly these five keys; whole UTC seconds; a window of at most 48 hours; an expiry after the window and at most 14 days after it. The file is a private regular file (mode 0600, one link, owned by the writer's user, at most 2 KiB) in a private directory (mode 0700). The name is `<id>.json`, with the id in lower-case letters, digits and hyphens.

- Each writer reads the directory at most once every 30 seconds, and always when it opens, outside its write transaction. No restart is needed. A declaration resolves to one run of segment rowids: from the first segment holding a record at or after the earliest window's start, to the segment before the first batch wholly after the latest window's end. While a window is still being captured, segments appended in it are held as they arrive; the batch's own record times close the run, so nothing is decoded on the append path. Resolving a new declaration costs one binary search (about forty decoded segments on a full catalog), once.
- **Budget.** Declared windows share the existing hold budget (half of each quota) with the configured hold, which keeps its priority. When the budget is reached the run keeps its oldest segments, the rest of the window becomes the ring's, the writer logs it, and `/health` counts the window segments turned away in `holdTrimmedSegments`. The other half of every quota still belongs to new capture, so a declaration can never stop capture.
- **Retirement** stays a rowid search: the oldest segment below, between and above at most two held runs, one seek each (`SQL_OLDEST_BETWEEN_HOLDS` is in `RING_STATEMENTS`, and the no-scan law covers it). Without a declaration, retirement is exactly as before.
- **Refusal.** A file that breaks any rule (name, JSON, schema, version, operator text, instants, window length, expiry, privacy, size, an expired declaration, a fifth valid one) is refused by name in the writer's log, once per file and reason, and changes nothing. A failure to read the directory keeps the last applied run. Capture never stops for a declaration.
- **Release.** At expiry the declaration stops applying at the next refresh, and the ring retires its segments oldest first like any other.
- `/health` keeps its fields: `heldSegments`, `heldBytes` and `holdTrimmedSegments` now include the declared run. The writer's `storageStats` adds `declaredHolds` and `declaredHoldRefusals`. Read-only readers never read declarations.

## How A Capture Owner Uses It

1. Before the window opens, on the engine host, as the journal's owner:

   ```sh
   install -d -m 700 /var/lib/club-arena/horse-decisions/holds
   install -m 600 /dev/stdin /var/lib/club-arena/horse-decisions/holds/<id>.json <<<'{...}'
   ```

2. Within 30 seconds every shard's writer logs `declared capture hold applied from segment N` once its window has a segment.
3. Read the window after it closes, then delete the file, or let it expire.

## Limits

- The budget is per shard: half of 8 GiB on shards 0 and 1 (less the configured 2026-09 hold on shard 0), and half of 4 GiB on shards 2 and up. A window larger than that keeps its oldest part. On 2026-11-14 the later shards wrote about 0.23 to 0.35 GB an hour, so a 12-hour window may exceed 2 GiB there. The ring's other half still keeps the newest capture, so a read soon after the window closes normally finds both ends.
- Records journaled late, in a batch after the first one wholly past the window, are not held.
