# 2026-11-06 - the timing of a break never freezes a tournament

## What happened

- Sunday Deep Stack Satellite 30 (a2a2c981) took its :55 break from
  00:55:42 to 01:00:42, so it ended inside the 01:00-01:05 hourly break.
  Both resumed at 01:05:00; table 72417d9c reserved hand 55620681 at
  01:05:08 and a pause rose over it about 50 ms later. Its four tables
  dealt nothing for hours.
- Sunday Deep Stack Satellite 25 (fbb86b2a) froze the same way at 18:29Z
  and only came back at 03:05Z, when its own break happened to overlap the
  03:00 hourly break.

## Cause

- Every waiter (the qualifier boundary, the restart census, a table break,
  the mystery activation boundary) asked only `isBetweenHands()`, which is
  false while any hand controller exists. A hand reserved a moment before a
  pause rose is held at the pause gate and never starts; so the pause waited
  for the hand and the hand waited for the pause. #9560 and #9615 closed this
  for the qualifier boundary and the hourly break one owner at a time; the
  mystery activation boundary still had it.
- The :55 tournament break read `MaintenanceBreak.endsAt()`, which is 0 at
  :55 (the hourly break is only announced at :58), so each tournament ran
  five minutes from its own last hand and ended partway through the hourly
  break, coming back in the same instant as the maintenance resume wave.

## Fix

- `ServerTableEngineDealing.isPreparedOriginalHeldAtPauseGate()` is the one
  rule: a retained original that never started (handStarted false, attempted
  permit for this hand, no continuation past sequence zero, no writer in
  flight), physically at the pause gate for ANY owner, is parked.
  `isPreparedOriginalHeldAtTerminalCloseout()` and
  `isPreparedOriginalHeldForMaintenance()` are now that rule plus their own
  owner, and `TournamentManagerBase.allTablesBetweenHands()` (mystery
  activation) accepts it too.
- `MaintenanceBreak.tournamentBreakEndsAt(horizon)` returns the active
  break's end or, when the next scheduled hourly break starts within the
  tournament break's reach, that break's end. Both synchronized-break paths in
  `GameServer` use it, so a tournament break that would overlap the hourly
  break ends exactly with it.

## Guard

- `server/src/maintenance/aBreakTimingNeverFreezesATournament.law.test.ts`
  drives the reservation-then-pause interleaving through the real engine for
  every pause owner, the negative shapes, the activation boundary, the deal
  after the last pause lifts, and the aligned break end.
