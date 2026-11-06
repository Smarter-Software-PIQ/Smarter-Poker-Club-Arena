# An unclaimable move does not outlast the last pause (2026-11-05)

## What was stuck

Union Mystery Bounty (PLO5) 7576aeb1, table 41d47e9d. Level 9 began at
22:52:02Z and the add-on drain held every table. This table parked at
22:52:05. The add-on minute ran 22:53:04-22:54:04, the :55 synchronized break
followed, then the 23:00-23:05 maintenance freeze. The break ended at
23:05:00.30 and the four sibling tables dealt from 23:05:04. 41d47e9d dealt
nothing until "Pause safety timeout after 600s" at 23:12:05.

## Cause (read from rows)

Hand #55561914 logged "Hand #... - 6 players" at 22:52:04.8. Its
`hand_history` row was written at 23:12:34. It was a **retained, never-started
original**: prepared and permit-retained, then held by the add-on hold in
`runOriginalController`'s pre-start loop, which parks on `awaitPauseGate()`.
With `handController` set, `isBetweenHands()` is false, so the gap balancer
logged "Deferring 1 rebalance move(s) - source table(s) still in-hand" about
every 7s from 22:53 to 23:08, and each time `fenceGapBalanceSource` armed an
**unclaimed** tournament-move owner (`parkForTournamentMove(owner, 0)`).

Such an owner can claim only at a between-hands boundary, and that table
reaches one only by playing the original. #9562 lets the original start past
an owner like this, but only when the loop re-evaluates, and the loop was
suspended inside the gate. Every release path treated the raw
`tournamentMovePauseOwners.size > 0` as a live co-authority and deferred:
`resumeDealing()` through `isHandForHandReleaseBlocked()`, plus
`resumeFromMaintenance()` and the other owner releases. So the end of the
add-on, the end of the break and the thaw all left the gate shut. The move was
waiting for the hand and the hand was waiting for the move.
The gate's 600s safety timer first fired at 23:02:05. The maintenance freeze
was still on, so it re-armed. `resumeDealing` cleared the `untilResumed`
claim at 23:05, so the re-armed timer resumed the loop at 23:12:05. Only on
re-entering the gate did `armUnclaimedTournamentMovePauseExpiry` start the
15s expiry. That expiry is armed only on gate entry, and the move owners had
been added after this table was already parked. Once it dropped the owner,
hand #55561914 played (hand_history 23:12:34).

The add-on/break sequencing in `finishAddOnBreak`/`resumeFromBreak` was
correct: the break end did call `resumeDealing()` on this table, and the
release was refused inside the engine.

## Fix (root)

`ServerTableEngineBase.tournamentMoveHoldsRelease()`: a move owner holds a
release only if one is CLAIMED, or if the table is not carrying a retained
prepared original. `isHandForHandReleaseBlocked`, `resumeFromMaintenance`,
`resumeFromFinalTableDeal`, `releaseTerminalCloseoutPause` and
`resumeFromWeeklyPayout` all ask it. When the last real pause ends, the gate
opens, the pre-start loop re-evaluates, the original plays (#9562), and the
move claims the boundary that hand produces. No timer, retry or watchdog was
added.

## Damage

None to settle. The held hand was preserved and played at 23:12:38 on the
same permit (`f06_hand_permits` state `accepted`). The players lost about 7
minutes of play.

## Pinned

- `server/src/engine/aRetainedOriginalUnderAnUnclaimedMoveIsReleasedByTheLastPause.test.ts`
  replays the sequence (add-on hold, park, unclaimed fence, :55 re-arm,
  freeze, thaw, break end) on real engine code. On the old code it fails.
- `server/src/engine/anUnclaimableMoveDoesNotOutlastTheLastPause.law.test.ts`
  checks that every release path asks the single predicate.
