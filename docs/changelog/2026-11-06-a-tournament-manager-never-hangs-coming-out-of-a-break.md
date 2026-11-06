# A tournament manager never hangs coming out of a break (2026-11-06)

## What happened

Thursday Night PKO c0b77808 took its synchronized :55 break straight into the
04:00 UTC maintenance break. The level clock behaved correctly. It paused at
03:55, waited through the freeze (thaw-wait ceiling reported at 04:01:30) and
resumed at 04:05:00, after the thaw. Levels then went up at 04:13, 04:21 and
04:29.

The manager did not. Its last consumed wake before the stall was at 04:05:03.
A committed late-registration wake, and the rebuy wake behind it, were not
consumed until 04:29:53. A late-registration table was admitted at 04:29:50,
and boundary-balance moves followed at 04:30:08. No stalled-sweep report, no
successor hand-off and no entry-window refusal was logged in between.

## Cause

Every elimination sweep that is admitted while a hand-boundary gap balance is
in flight (`boundaryBalanceInFlight`) yields at once, without a word, and is
owed again only when that balance settles. The balance (`drainBoundaryBalance`)
had no clock. The GameServer stalled-sweep watchdog measured only
`isProcessingEliminations` and the oldest waiting bust. A balance that did not
settle therefore held the manager without limit, and nothing could see it.

## Fix (root)

- `drainBoundaryBalance` records when it began (`boundaryBalanceStartedAt`).
  It reports `Tournament.boundary_balance_overran` once if it holds the
  manager past `BOUNDARY_BALANCE_REPORT_MS` (30 s).
- `getStalledEliminationSweep` measures an in-flight boundary balance exactly
  as it measures a sweep (step `boundary_balance`). So the existing watchdog
  hands a hung one to a lease-fenced successor after
  `STALLED_ELIMINATION_SWEEP_MS`.
- `requestSuccessorForStalledEliminationSweep` accepts that hand-off.
- The live promise is never released early. Releasing it would let a sweep
  plan seat moves beside it, which is the concurrency the flag prevents.

Law: `aTournamentManagerNeverHangsComingOutOfABreak.law.test.ts`. It also pins
that the level clock and dealers stay paused through the whole break and
maintenance overlap.
