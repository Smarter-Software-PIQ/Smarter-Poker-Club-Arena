# The Drain Scales With The Backlog (2026-11-26)

Follow-up to `2026-11-26-a-released-table-stays-released-and-only-at-a-full-cap.md` (#12084).

## What Was Wrong

The variety drain released one Horse-only extra table at a time and waited for it to close before naming another. At 10:12 AM CST on 2026-11-26 the hourly cap was full (16 of 16) with 19 games owed a start, and the drain was freeing one slot every few minutes.

## Why It Broke

The first version was written for a handful of owed games. Nothing tied the number of tables being released to the number of starts the cap could not fit.

## The Change

**Files:** `server/src/services/HorseVarietyFirst.ts`, `server/src/services/HorseFleetManager.ts`, `server/src/services/HorseSessionRotator.ts`

- `drainShortfall`: the owed starts the cap cannot fit now. It is zero whenever `owedStartsFit` says they fit (a free slot, an admitted owed start, a failed read), and every owed start at a cap with no free slot.
- `varietyDrainTables`: every table already released stays released while it is the top of its Horse-only ladder. A NEW table is added only while the released tables are fewer than the shortfall, and at most one new table per fleet cycle, so releases ramp with the backlog and the leave sweeps (each slows the next deal at that table) are spread out rather than started together.
- The fleet keeps the list across cycles, adds every released table to `surplusTableIds`, and publishes it; the heartbeat carries `detail.variety_drain_tables` beside the existing `detail.variety_drain_table` (the first of them).
- The rotator walks every released table's Horses home, each table under the same rules as before (never a Horse in the hand, owed hands first, never beside a person, never at a breaking table).

## Hardening

`server/src/services/anExtraTableYieldsToAnOwedMain.law.test.ts`: the ramp (one new table per cycle, never past the shortfall); kept tables at a free slot; nothing when no start is owed; the shortfall at the morning's production numbers; publication of several tables and their staleness; the rotator emptying two released tables in one cycle while Main 1 keeps its Horses. The single-table cases from #12011, #12037, #12054 and #12084 still pass unchanged through the single-table view.
