# 2026-11-01: a waiting release offers the eed06fe5 census again after the engine restarts itself

## What was wrong

`engine-release-transaction.sh` (#8986) picks a route for replacing eed06fe5
from the serving engine's own heap reading:

- if the heap fits the census allowance (`(heapUsedMb + 1) * 12 ms <= 30300 ms`,
  so under about 2,524 MB), it uses the existing checkpoint (census) route;
- otherwise it uses the drained-hand-boundary route, which needs the engine's
  strict certificate.

The check ran once at intake and again at the top of every wait pass. It
could only ever switch one way, census to drained, under the comment "the heap
only grows while this run waits". For eed06fe5 that comment is wrong. The
engine restarts itself on the same sealed image every 90 to 120 minutes. On
2026-11-01 it did so at 02:19, 03:50, 05:19, 08:15, 09:42 and 12:39 UTC. After
a restart its heap is small: 350 MB at 97 s, and 1,906 to 2,200 MB at 20 to 35
minutes (`2026-11-01-eed06fe5-replacement-deadlock.md`).

Run 41283363258 shows the effect. It was admitted at 07:19, when the heap was
large, so it switched to the drained route. It was still on that route at the
10:00 UTC daily break. eed06fe5 had restarted 18 minutes earlier, at 09:42,
and its heap (about 1.5 GB) was inside the census allowance. Five tables held
`cards_in_air` all through that break, so the strict certificate never opened
(break log: 5 unparked, `ready_for_restart_at` null). The census route that
fitted was never tried.

## What changed

The per-pass re-read now works both ways. A run goes back to the existing
census route when all of these are true:

- it is on the drained route;
- it has not opened the one-shot checkpoint (`LEGACY_CHECKPOINT_ATTEMPTED=0`);
- the sealed predecessor is still eed06fe5;
- `legacy_census_fits` says the heap fits.

`return_to_legacy_census_route` only resets the two route flags.

Nothing is widened:

- the census is admitted by the same predicate the intake already uses;
- the last heap read before the one-shot intent still refuses a census that
  stopped fitting, and sends the run back to the drained route (unchanged);
- after the checkpoint, the full restart certificate is still required
  (unchanged);
- the strict certificate, the database witness, the allow-list and every
  ceiling are unchanged.

A run that opened the checkpoint never measures or switches again.

## What this does not claim

- The change does not show that the census route will cut over with stopped
  tournament originals holding `cards_in_air`. That is still decided at the
  break, by the checkpoint guard and then the full certificate.
- It adds no break, owner window, notice, timer or retry loop. It only stops a
  waiting run from throwing away a route that is available at a break it was
  already going to meet.
- It does not restart the engine and does not raise the census allowance.

## Tests

`tests/operations/eed-drained-cutover.test.py` (25 cases before, 33 now):

- `DrainedQueueTests`: the real queue, started drained. A census that fits
  again takes the checkpoint route, reading the 285000 ms legacy rung and never
  the witness. A census that still does not fit stays drained on the 260000 ms
  strict rung. Both cases fail against the previous script.
- `CensusRereadTests`: the real re-read block and the real switch-back
  function. It covers both directions, a run that has opened the checkpoint,
  and a different sealed predecessor.

The law `tests/eed-is-replaced-at-a-drained-hand-boundary.law.test.ts` now pins
the count at 33 and pins the two-way re-read. Every vitest suite that reads
the transaction script passes (33 files, 531 tests), and so do the window-queue,
legacy-entry-clock, recovery-window, forward-admission, drill-admission,
activation-floor and main-inspector-retirement operations suites.
