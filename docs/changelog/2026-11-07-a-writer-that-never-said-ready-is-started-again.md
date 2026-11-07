# A journal writer that never said READY is started again (2026-11-07)

## Symptom

If a Horse decision journal shard's writer did not answer READY within the
five-second start watchdog three times in a row, the shard logged

    [HorseDecisionJournal] capture stopped mode=unavailable reason=start_failed

and stopped capturing decisions until the engine process restarted, which is
the next daily 04:00 America/Chicago release. Nothing was written after that
line. This was reproduced under extreme CPU starvation in the throughput test
(`docs/changelog/2026-11-07-stop-is-a-shutdown-not-a-stopwatch.md`, "Seen
along the way"). In production, a slow disk or a CPU spike at boot could
silently turn off the evidence chain for horse decisions for most of a day.

## Root cause

`server/src/services/HorseDecisionJournal.ts`, `HorseDecisionJournalPublisher`:

- `recover()` runs out of its in-place budget (`this.retries >= 2`) and, because
  no writer was ever READY, calls `this.fail('start_failed')`.
- `fail()` re-armed capture only under
  `rearmable(reason) && this.options.restart && !this.stopping && this.everReady`.
  `start_failed` was not in `HORSE_JOURNAL_REARMABLE`, and `everReady` is false
  by definition for a writer that never started, so no re-arm was ever
  scheduled. That condition is the line where a start failure became permanent.

A writer that died **after** READY could be restarted for the life of the
process: two in-place replacements (250 ms, then 1 s), then a fresh writer
every `HORSE_JOURNAL_REARM_MS` (60 s) once the retired one had actually exited
(`2026-09-28-the-journal-hold-cannot-starve-capture.md`). A writer that was
slow to open, which is the more transient of the two cases, got none of that.

## Fix

The fix is in the publisher's own lifecycle. There is no new sweep, timer or
monitor.

- `start_failed` is added to `HORSE_JOURNAL_REARMABLE`, and the `everReady`
  condition is removed from the re-arm decision. A start failure now follows
  the same path as `retry_exhausted`: the queue is kept, a fresh writer with a
  fresh two-restart budget is started every 60 s, only after the previous
  writer's `terminate()` has resolved (so a publisher never runs two writers at
  once), and this continues until a writer captures or the process stops. Each
  cycle starts at most three writers in about 76 s. A writer module that fails
  at once (an `error` then an `exit`) also starts about three a minute, never
  in a loop.
- Records behave as they did before. While a writer is `starting` or
  `recovering`, records queue within `HORSE_JOURNAL_QUEUE_MAX_RECORDS` /
  `_BYTES`. While capture is stopped (`failed`), each record is counted as the
  named gap `capture_unavailable`. The decision path never waits on any of
  this.
- The receipts stay truthful (CLAUDE.md 10.86):
  - A start failure that will re-arm reports mode `failed`, reason
    `start_failed`. Its `/health` capture sentence is "capture stopped at
    start_failed since ...; a fresh writer is started every minute until one
    captures". It logs `capture stopped mode=failed reason=start_failed`.
  - `unavailable` means only that capture never started and never will: a
    publisher with no restart, or a stop that arrived first. Only that case
    calls `onStartFailed`, which moves the module lifecycle to `start_failed`.
  - The first READY after start failures logs
    `capture started mode=ready after=start_failed queued=<n>`, so the stop
    line is no longer the last thing in the log.
  - `phase15_journal_start_failed`, `rearm_started` and `retry_recovered` are
    counted as before.
- A start failure before READY that ends at `termination_unverified` is also
  no longer terminal. It waits for the writer to actually exit, exactly as it
  does after READY.

The five-second READY deadline is unchanged.

## Evidence

New test: `server/src/services/horseDecisionJournal/aWriterThatNeverSaidReadyIsStartedAgain.test.ts`.

On `origin/main` (9599d45e9), before the fix:

| case                                        | result                                                                                                          |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| three silent writers, then one that answers | FAIL: `mode: 'unavailable'`, expected `'failed'` (terminal; no fresh writer is ever started)                    |
| a writer that keeps failing, 30 minutes     | FAIL: `expected 3 to be greater than or equal to 69`, so three writers in total and then nothing for 30 minutes |
| a module that cannot load, 10 minutes       | FAIL: `expected 3 to be greater than or equal to 27`                                                            |

After the fix, all five tests pass:

- Three silent writers, then `start_failed`. A minute later a fresh writer
  starts. It says READY, receives the kept record and a record queued during
  `starting` (sequences 1 and 2) in one batch, ACKs both, and the mode is
  `ready`. A record offered while capture was stopped is a
  `capture_unavailable` gap.
- 30 minutes of writers that never answer: three writers per cycle, the last
  one inside the current cycle, every retired writer terminated, no two starts
  less than 250 ms apart, and a full minute between cycles. A writer that
  finally answers is adopted.
- A module that fails at once: 27 to 33 writers in 10 minutes.
- A publisher with no restart stays `unavailable` with the "never started"
  sentence, and `onStartFailed` is called once.
- A stop while waiting to re-arm starts nothing.

One existing pin is changed on purpose in
`server/src/services/HorseDecisionJournal.test.ts`: "a real worker whose module
cannot load" (with a restart available) now expects `failed` / `start_failed`,
the re-arm sentence and no `onStartFailed`. It still requires that no writer
was ever ready, exactly two in-place restarts, the `start_failed` count and no
`retry_exhausted`.

Checks run: the `server/src/services/horseDecisionJournal` suite (including
`retry.test.ts` and `theJournalKeepsUpWithTheFleet.throughput.test.ts`) plus
`HorseDecisionJournal.test.ts`: 22 files, 673 tests passed. All 59 other
server test files that import the journal: 2,041 tests passed.
`npx tsc --noEmit -p server` is clean.

## Delivery

This is engine code. It reaches production only through the certified daily
04:00 America/Chicago release.
