# The Backup swap fixes its seat boundary after the serving engine drains

2026-11-08. Backup run 42445553096 (candidate a98ea5d8, the first with the
GoTrue timestamp repair from #10032) passed the rollback rehearsal to the
serving engine 391f7bc0 for the first time since 02:31 UTC, then failed the
forward swap with `swap_rehearsal_failed_from_391f7bc0d57c`:
`frozen_seat_boundary:boundary_changed:fingerprint`, seat count unchanged at
289.

Cause, read from the Backup database: cash table 55a398dc dealt hand 1000165
at 04:23:40 UTC, 14 s before the break was announced. The freeze began at
04:25:54 and the harness took its seat boundary at 04:25:55. The serving
engine settled the hand at 04:26:07 through its service role, which the
freeze admits by design so a hand in the air is never voided. The stack moved
after the boundary, and every later comparison refused.

The release transaction never stops an engine before its /health reports
`handsInFlightTotal == 0` and `maintenance.unparkedTables == 0`. The swap
trial stopped the serving engine without asking. `capture_frozen_seats` now
takes the swap boundary only from a frozen sample read after that same drain
witness; an engine that never drains inside the bounded capture window fails
the trial as `serving_engine_not_drained`. Every comparison after the boundary
is unchanged.

Pinned in `tests/dr-posture.test.ts` (the swap seat boundary is read after the
serving engine drains).
