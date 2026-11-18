# 2026-11-18: the level clock stops when the add-on drain starts

Dan: "WHEN THE 'ADD ON PERIOD' STARTS AND HANDS ARE PAUSED, THE NEXT LEVEL
STAYS PAUSED UNTIL THE REBUY PERIOD IS OVER... IT CURRENTLY KEEPS RUNNING UNTIL
THE ADD ON STARTS. IT SHOULDN'T DO THAT, IT SHOULD PAUSE AND WAIT FOR ALL HANDS
TO FINISH AND THE REBUY PERIOD END, BEFORE THE NEXT LEVEL STARTS."

## Root cause

The add-on phase has two parts. First the drain: entry reaches its boundary and
every table finishes the hand it is in and parks
(`triggerAddOnPeriod` / `continueFreeBuyClosingDrain`, `addOnDrainPending`).
Then the one paid minute (`beginAddOnBreak`).

Only the minute stopped the level clock. `beginAddOnBreak` called
`suspendLevelClock()`; the drain did not. So for as long as tables were still
finishing hands, the level went on being spent with most of the field already
parked. Two shapes:

- **Entry closes on the clock** (`late_reg_mins`): the level timer was armed
  and ran through the whole drain. A level that came due in the drain was held
  at one second and went up the instant the add-on closed.
- **Entry closes on a level**: the transition that reached the cap never
  re-armed the timer (`isOnBreak()` is true in a drain), so the engine clock
  was already still. The clock on screen was not; that half is the client entry
  of the same date.

A second defect sat behind it. `suspendLevelClock()` measures a null timer as a
fresh full level. Any path that reached `beginAddOnBreak` with the clock
already stopped (a synchronized break that ended inside the drain) handed the
event a whole new level.

## Fix

`holdLevelClockForAddOnDrain()` stops the clock once, where the drain begins,
with the time that was really left. `addOnDrainHoldsLevelClock` records that
the drain holds that remainder:

- `suspendLevelClock()` returns at once when the drain already holds the clock
  and nothing is armed, so no later pause can replace the remainder with a full
  level. This covers `pauseForBreak`, `beginAddOnBreak` and a restart.
- `beginAddOnBreak` takes the remainder over and gives it back in
  `finishAddOnBreak`, exactly as it gave back its own measurement before.
- `resumeFromBreak` marks the drain as the holder when a synchronized break
  ends inside it.
- `giveBackAddOnDrainLevelClock()` re-arms the clock if the add-on ends without
  ever reaching its break (a window recovered already expired), from
  `finishAddOnBreak` and from the finalization that ends the add-on for good.
  A drain can therefore never leave an event with no level clock.

No money path, no purchase, no window timestamp and no pause authority is
changed. The durable row is written only where it already was
(`startBlindTimer` re-anchoring when play resumes).

## Regression lock

`server/src/tournament/TheLevelClockStopsWhenTheAddOnDrainStarts.test.ts` runs
the real clock (nothing about it is stubbed): four minutes into a ten-minute
level the drain begins, the last hand takes ninety seconds, the minute runs,
and the level resumes with exactly six minutes. All three cases fail on the
previous source and pass on this one. The existing add-on guards
(`FreeBuyAddOnLifecycle.guard`, `AddOnMinuteStartsAfterEveryHand`,
`UniversalAddOnMinute.law`, `OneMinuteAddon.guard`, `AnAddOnAtTheBreakIsTheBreak`)
pass unchanged.

## Activation

Engine source. It reaches production only through the certified 04:00
America/Chicago maintenance cutover.
