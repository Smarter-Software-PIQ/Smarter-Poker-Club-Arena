# stop() is a shutdown, not a stopwatch (2026-11-07)

## Symptom

The pre-push hook's full server run failed, at random, on

    server/src/services/horseDecisionJournal/theJournalKeepsUpWithTheFleet.throughput.test.ts
    > the journal keeps up with the fleet
    > sheds ~0 decisions at queue_capacity, with 0 lock retries, once each shard owns its own catalog
    AssertionError: shard-a final mode: expected 'failed' to be 'stopped'

The run took 9,325 ms with about 1,100 other test files running on the same
Mac. Every earlier assertion in the loop had passed: enqueued 128, zero
queue_capacity drops, zero lock retries, zero capture_unavailable. Run alone,
the test passed. The hook has no bypass, so any agent's push could fail on it.

## Root cause

The test, not the journal. After firing 128 decisions per shard it called
`publisher.stop()` to wait for the burst to drain
(`theJournalKeepsUpWithTheFleet.throughput.test.ts`, the old line 164,
`await Promise.all([a.publisher.stop(), b.publisher.stop()])`).

`stop()` is the production shutdown path and it is bounded on purpose.
`server/src/services/HorseDecisionJournal.ts:995-999`:

    const timer = setTimeout(() => {
      this.noteShutdownGap();
      this.fail('shutdown_timeout');
      finish();
    }, 5000);

If the queue has not drained five seconds after `stop()` is called, capture
ends as mode `failed`, reason `shutdown_timeout`, and the undrained records are
reported as a `shutdown_unverified` gap. Used as the drain wait, that made the
test assert "two real worker threads fsync 256 records in under five seconds
of wall clock". On a box that is also running 1,100 test files, a healthy,
progressing writer sometimes takes longer. 9,325 ms is a ready wait of about
4.3 s plus the 5 s shutdown deadline.

Shown with the real publisher and a healthy writer that takes 700 ms to fsync
each 16-record batch (a throwaway fake-timer probe, not committed):

| how the test waits         | final mode | reason             | queued | durably recorded | gap notes             |
| -------------------------- | ---------- | ------------------ | ------ | ---------------- | --------------------- |
| `stop()` as the drain wait | `failed`   | `shutdown_timeout` | 31     | 97 / 128         | `shutdown_unverified` |
| drain first, then `stop()` | `stopped`  | none               | 0      | 128 / 128        | none                  |

The first row is the hook's failure exactly: every count up to the mode
assertion is correct, and the mode is `failed`.

There was a second trap in the same test. The "both shards READY" wait had a
literal 10,000 ms budget. Under a heavier load the tsx worker bootstrap alone
took longer than that: two runs gave up after 10,023 ms and 11,173 ms
(`waitFor gave up ... both real journal shards to open their private
catalogs. Budget 10000ms`). The test also set its own 30,000 ms timeout
instead of the shared `TEST_TIMEOUT_MS`.

## Is the production code wrong?

No, and it is not changed. A shutdown has to be bounded: the decision worker's
`stopOwnedServices()` (`server/src/engine/horseDecision/workerRuntime.ts`)
awaits `stopHorseDecisionJournal()` on the drain path, and a journal that could
hold shutdown open for as long as its queue takes would hold the engine's
drain open with it. When the deadline is reached the journal reports what it
could not capture as a named gap, which CLAUDE.md 10.86 asks for. That
behaviour is pinned by `retry.test.ts` ("cancels delayed replacement at the
bounded shutdown deadline") and `HorseDecisionJournal.test.ts`.

While capture is running, a slow writer does not end in `failed`: the
watchdog acts only after 5 s with no progress at all
(`HorseDecisionJournal.ts:421-431`), and every ACK counts as progress. A slow
but progressing writer is never judged dead. The `failed` mode in this flake
came only from the shutdown deadline.

## Fix

`theJournalKeepsUpWithTheFleet.throughput.test.ts` only:

- After the burst is fired, the test waits until every decision has its
  durable ACK from its own shard writer (`recorded + replayed === 128` and
  `queued === 0` on both shards). Only then does it call `stop()`, which now
  meets an empty queue, so its unchanged five-second deadline covers just the
  STOP/STOPPED handshake.
- The READY wait and the drain wait each get `WAIT_BUDGET_MS / 2`, and the
  test uses `TEST_TIMEOUT_MS`. Together the two waits are 60 s under a 90 s
  ceiling, which leaves room for a failed wait to report itself
  (`src/testing/waitBudget.ts`, CLAUDE.md 10.86 rule 4).
- A wait that gives up names its cause. The error lists each shard's mode,
  failure reason, queue depth, durable count, lock retries and writer
  restarts. The final-mode assertion carries the same line.

Everything the test checked before is still checked: 128 enqueued per shard,
zero queue_capacity drops, zero lock retries, zero capture_unavailable,
final `stopped`, nothing left queued. Two checks are new: all 128 decisions
durably recorded per shard, and zero `shutdown_unverified` gaps. The wait
cannot hide a regression to a shared catalog. Lock retries and
queue_capacity drops are counted whether the drain takes one second or
thirty, and a drain that never finishes now fails with its state named
instead of with a mode.

No engine code changes, so this does not wait for the 04:00 window.

## Evidence

The reproduction that matches the hook. The drain is bound by fsync, and on a
Mac running 1,100 test files that write SQLite the disk is the contended
resource. Every `fsync`/`fdatasync` the real worker threads made was slowed
with `strace -f --seccomp-bpf -e inject=fsync,fdatasync:delay_exit=<us>`. The
real writer threads ran each time, and the original test and the fixed test
were run alternately:

| fsync delay | test     | run | READY at  | result                                                                                                                                            |
| ----------- | -------- | --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 40 ms       | original | 1-4 | 2.1-2.2 s | FAIL, 7.2-7.5 s: `stop` 5,001-5,003 ms, both shards `failed shutdown_timeout`, 47 queued, `shard-a final mode: expected 'failed' to be 'stopped'` |
| 40 ms       | fixed    | 1-4 | 2.1-2.3 s | pass, 8.6-9.1 s: drained in 6.5-6.7 s, 128/128 durable, 0 lock retries, 0 writer restarts, `stopped`                                              |
| 60 ms       | original | 1-2 | 2.9 s     | FAIL, 8.0 s: `failed shutdown_timeout`, 79 queued                                                                                                 |
| 60 ms       | fixed    | 1-2 | 2.9-3.1 s | pass, 12.5-12.8 s: drained in 9.6-9.7 s, 128/128 durable, 0 lock retries                                                                          |

The original fails every time with the hook's exact message once the drain
passes five seconds. The fixed test passes every time and reports the drain
it waited for. The committed file (not an instrumented copy) also passed twice
at 40 ms (8.7 s and 8.6 s) and three times unloaded (0.44-0.65 s).

CPU contention alone (`yes` hogs on a 2-core container) mostly slows the READY
wait rather than the drain. Under it the original's literal 10 s READY budget
gave up after 10,023, 10,033 and 11,173 ms. With 1 to 5 hogs (and also pinned
to one core with `taskset`) both versions passed, and the fixed test drained
in 0.25-0.52 s.

As a check, the fixed test still catches the defect it was written for. With
both shards pointed back at shard 0's catalog it failed
`shard-b lock retries: expected 1 to be +0`.

## Seen along the way, not changed here

Under extreme CPU starvation (8 CPU hogs plus fsync hogs plus a 70-file
journal suite, test at nice 10), both shards logged
`capture stopped mode=unavailable reason=start_failed`. The code allows only
one way to get there: the `starting` watchdog
(`HorseDecisionJournal.ts:424-427`) found no READY within five seconds, three
times in a row, replaced the writer twice, and then ended capture. That reason cannot be re-armed,
because `everReady` is false. In this test the cost is the tsx bootstrap of
`worker.ts`, which production does not pay, since it loads compiled JS. If a
production writer is ever slower than 5 s to open, three times running, capture
would stay off until the next restart. Nothing here shows that it has happened.
The log line to look for is
`[HorseDecisionJournal] capture stopped mode=unavailable reason=start_failed`.
In this test, a run that hits it now fails at the READY wait, and the error
names each shard's mode, reason and writer restarts instead of reporting a
bare mode. (That run was killed by its 400 s outer `timeout` before vitest
printed its report.)
