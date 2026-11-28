# A Withheld Cycle Keeps The Drain

2026-11-27, HORSE DECISIONS lane. Found by an independent review of #12150, #12172 and #12229 (a reviewer that wrote none of it), confirmed by reading the fleet cycle, fixed before it was seen live.

## What Was Wrong

1. **A withheld cycle wiped the drain.** In a cycle whose seating is withheld (the decision lane is behind, or not ready), the fleet cleared its memory of the released tables and un-published all of them. For that cycle the rotator stopped walking them and a Horse move onto one no longer waited. The next seating cycle no longer knew them as "being released": with a free slot or inside the 90 s pace nothing was named and the walk could refill them (the 2026-11-26 churn again), otherwise only one of them was picked again and the pace restarted.
2. **The beat said `room_free` at a full cap.** When an owed start was already admitted, the shortfall is zero by design and the reason read `room_free` beside `cash_room {cap 17, counted 17}`.
3. **The ramp ran at about 120 s half the time.** The pace asked for a strict 90 s between new releases, measured mid-cycle on a 30 s timer, so a third cycle that ran a few milliseconds early pushed the release to a fourth.
4. **The live check read a withheld newest beat as nothing waiting.** A withheld beat publishes no owed games, so "owed now" and `owed_waiting_now` said 0, and `withheld` could never appear in `drain_why`.
5. **A law pin had lost its anchor.** One ordering assertion compared against `indexOf('varietyDrain = varietyDrainTables({')`, a string that left the fleet in #12229. The anchor was -1 and the assertion passed for any position.

## Why

1. The fleet computed "decided" from the two reads alone (`cashPlanLightningGames && humansWaitingReadComplete`). A withheld cycle usually reads both fine, so it counted as decided with an empty decision. The guard written on 2026-11-26 for exactly this (`!cycleWithheld`) sat behind `drainDecided ||` and only ran when the reads had also failed. The hold for undecided cycles asked for owed games on the beat, and a withheld beat publishes none. The only test was a pin on the source text of that `if`, which the defect satisfied.
2. The decision sees only the shortfall, not why it is zero, and the fleet mapped just one special case (an unread room).
3. A fixed threshold equal to a whole number of timer periods has no slack for the timer's own jitter.
4. The SQL assumed the newest beat always carries the owed list.
5. The pin was a position comparison against a string, with no assertion that the string was found.

## The Fix

- `HorseVarietyFirst.drainCycleOutcome` (pure) is the one place a cycle's outcome is computed: decided only when seating and both reads are complete; an undecided or withheld cycle with a start owed holds, publishes and remembers the tables already being released (never one with a person seated); a withheld cycle is judged on the plan's own owed starts. The fleet has a single assignment to its memory, from this outcome.
- `HorseVarietyFirst.drainWhyForBeat` (pure) names the beat's reason and adds `start_admitted` for a full cap whose owed start is already admitted.
- `HorseVarietyFirst.mayAddDrainTable` gives the pace 10 s of slack (`VARIETY_DRAIN_PACE_SLACK_MS`): three fleet cycles, never two.
- The live check reads "owed now" and `owed_waiting_now` from the newest beat that was not withheld, and counts withheld beats in `drain_why`.
- The lost anchor is replaced by the decision call as written, and the anchor itself is asserted to exist.

## Pinned By

- `server/src/services/anExtraTableYieldsToAnOwedMain.law.test.ts`: "a withheld cycle with good reads still holds, publishes and remembers the released tables", "a cycle that could not decide does not forget the table being released" (now behaviour, not source text) and "the pace is three fleet cycles even when the third runs a moment early, never two". Each fails on the previous code.
- `server/src/services/theDrainSaysWhy.law.test.ts`: "the beat never says room_free at a full cap, and names every cycle state". Fails on the previous code.
- `tests/unit/varietyDrainLiveCheck.test.ts`: "a withheld newest beat is not read as nothing waiting". Fails on the previous SQL.

## Review Findings Not Changed, With The Reason

- **The tie-break counts seats that owe hands by the session row alone** (`readHandsOwedByTable`), while the engine also needs the seat to be in profit. It orders candidates only and never decides whether a table is released; a wrong guess costs one slower sweep. Left as is.
- **The rotator acts on the seat snapshot from the start of its pass.** A person who sits at a released table mid-pass is seen one fleet cycle later, when the table is un-named. Horses leave at a hand boundary and the person keeps the seat. Bounded at one cycle.
- **`no_rejoin_while_named` can fail for ten minutes after a drain ends legitimately**, or after a break move. It has not happened live; a FAIL there is read against `drain_why` before it is treated as a defect.
