# 2026-11-15: a declared capture keeps its journal window without a restart

## What was wrong

The Horse decision journal's evidence hold was one environment variable, read when a writer opens, still naming the 2026-09 Phase 6A/6B window. A capture declared for a later release had no protection from the ring. On 2026-11-14 the oldest journal files were retired at up to 1.3 times real time, and the Human-vs-Horse capture owner byte-copied every segment file of a twelve-hour window hourly, with manifests and hash checks, to keep it.

## What changed

- A declared hold is a private file `<journal>/holds/<id>.json` (version, fromUtc, untilUtc, expiresUtc, operator). Every shard's writer reads the directory at most every 30 seconds, outside its write transaction, with no restart. It holds the window's segments, including segments appended while the window is open, and closes the run on the first batch wholly after the window.
- Declared windows share the existing hold budget (half of each quota) with the configured hold, keep their oldest segments when it is reached, and are released at expiry. Capture never stops for one.
- A bad file (any rule, including privacy, size, expiry, more than four) is refused by name in the writer's log and changes nothing.
- Retirement stays a rowid search: below, between and above at most two held runs (`SQL_OLDEST_BETWEEN_HOLDS`, covered by the no-scan law).
- `/health` fields are unchanged in shape; held and trimmed counts include declared holds.

Details and operator steps: `docs/horse-brain-journal-retention-2026-11-15-declared-capture-holds.md`.

## Tests

`server/src/services/horseDecisionJournal/declaredCaptureHold.test.ts`: every shard keeps a window declared after its writer opened; an open window keeps segments appended in it and releases what follows; the budget keeps the oldest and capture never stops; every malformed, unsafe, oversized, expired or surplus file is refused by name; expiry releases; the configured and declared holds coexist; the new ring statement is in the no-scan list; read-only readers ignore declarations. Before the fix these fail.
