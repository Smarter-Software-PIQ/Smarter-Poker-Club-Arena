# A horse that banks the win waits for its own pot push (2026-11-15)

Follow-up to `2026-11-15-a-seat-stays-until-its-pot-is-pushed.md`, found
by checking real hands after that fix went live.

## What the rows showed

Since the new engine went out (about 23:30 UTC), most winners who left kept
their seat until the hold ended: about 5 s after a showdown and about 2 s
after a fold win. Six winners still left 0.6 to 1.4 s after their hand ended
(hands 59598118, 59600278, 59606211, 59607967, 59610267 and 59611683). All
six were horses on linked tables. None wrote a departure request, and none
was moved to another table: each was cashed out directly.

## Cause

Settlement's bankroll-management step (`horse_cashouts`, "bank the win")
cashes out a horse that has hit its profit target. It runs during
postHandTasks, while the hand is still being presented, and the horse it
cashes out is usually the one that just won the pot. That exit went
straight through `cashoutVoluntaryStay`, not through `leaveTable`, so the
presentation hold never saw it.

## Fix

The decision is unchanged and is still made at settlement. If the horse
belongs to the hand being presented (`holdsSeatForPresentation`), the exit
is recorded in `deferredBankTheWin`, and the occupancy goes into
`heldDepartures` so no seat move can carry it away. `prepareNextHand` then
runs `runDeferredBankTheWinExits` under the seat boundary, before the roster
read. It uses the same voluntary door (`bankTheWinExit`, which is the old
loop body unchanged) once the pot has landed. A successful exit is released
through `releaseDepartedSeats`, so `seat_left` is announced and the Cluster
woken. A stay-clock refusal keeps the horse seated, exactly as at settlement.

## Pins

- `aSeatStaysUntilItsPotIsPushed.law.test.ts` covers deferral, exactly-once
  exit, the announcement, a refusal, and the ordering in settlement and
  `prepareNextHand`.
- `ChipContinuity.law.test.ts`: the same-door pin moved to `bankTheWinExit`.
