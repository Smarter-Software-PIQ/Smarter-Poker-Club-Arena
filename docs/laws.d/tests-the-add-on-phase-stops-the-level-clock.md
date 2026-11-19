# tests/the-add-on-phase-stops-the-level-clock.law.test.ts

Dan 2026-11-18: "WHEN THE ADD ON PERIOD STARTS AND HANDS ARE PAUSED, THE NEXT
LEVEL STAYS PAUSED UNTIL THE REBUY PERIOD IS OVER... IT CURRENTLY KEEPS RUNNING
UNTIL THE ADD ON STARTS. IT SHOULDN'T DO THAT, IT SHOULD PAUSE AND WAIT FOR ALL
HANDS TO FINISH AND THE REBUY PERIOD END, BEFORE THE NEXT LEVEL STARTS." The
engine stops the level clock for the add-on drain and the paid minute and
re-anchors `level_started_at` only when the minute ends, so every screen, which
computes the clock from that anchor, counted down through both and jumped back.
The law pins `utils/addOnLevelClock` through `getCurrentLevelState`: the clock
runs up to the entry boundary (the level cap, or the late registration clock),
holds through the drain and through the closing minute at the same instant with
no jump when the minute opens, stays held after the minute until the
re-anchored row is read and for no longer than the grace, holds a level
boundary's new level whole, holds nothing for an event with no add-on, a
finished add-on, one not running or one whose level moved on, and that
`levelClockNow` and the tournament dock both read through it.
