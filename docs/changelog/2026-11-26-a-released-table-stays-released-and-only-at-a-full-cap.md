# A Released Table Stays Released, And Only At A Full Cap (2026-11-26)

Follow-up to `2026-11-24-a-horse-only-extra-table-yields-to-an-owed-main.md` (#12011), found on the first build that served it (4:00 AM CST seal, 2026-11-26).

## What Was Wrong

Read on production from 4:05 to 4:16 AM CST: the hourly cap was 10, 6 tables were counted, and 30 games were owed a start (too few Horses were on shift to start them). The drain named the NLH 0.05/0.10 Classic feeder all the same, un-named it about every fifth cycle, and in every cycle it was not named the fleet walked Horses back in. Seven Horses left and four re-joined in twelve minutes. No person was at the table and no table with a person was touched.

## Why It Broke

Two causes.

1. `owedStartsFit` asked the feeder opener's question (do the counted tables plus EVERY owed start fit under the cap?). That is right for opening another table and wrong for emptying one: with a free slot under the cap an owed start can take it now, so emptying a table frees nothing anyone is waiting for.
2. The released table was decided afresh each cycle. Any cycle in which an owed start was admitted, or the table was briefly empty, un-named it, and an un-named table is an ordinary table the fleet fills.

## The Change

**File:** `server/src/services/HorseVarietyFirst.ts`, `server/src/services/HorseFleetManager.ts`
**What changed:**

- A table is NEWLY released only when the cap has no free slot (counted tables plus empty opening feeders reach the cap). A failed read and an admitted owed start still fit, as before.
- The table already being released stays released while any start is owed and it is still the top of a Horse-only ladder with another of the game's tables occupied: also once it is empty, and also in a cycle where the owed starts fit again. It stops when no start is owed, a person sits or joins the game's list, the game breaks a table, or the table closes.
- A fleet cycle that could not decide (an unread waiting list, cap or Lightning set) still releases nothing, and no longer forgets which table was being released.

## Hardening

`server/src/services/anExtraTableYieldsToAnOwedMain.law.test.ts`: the production numbers (cap 10, 6 counted, 30 owed) fit; a released table stays named when empty and when the starts fit; an empty table is never newly released; every stop condition is pinned; the fleet keeps its memory across an undecided cycle.

## Method Note

The first live read after a seal found this in ten minutes. Read the new signal as a time series (one row per heartbeat), not one row: the flicker and the re-joins only show across cycles.
