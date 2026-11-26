# The Drain Holds Through An Undecided Cycle And Paces At The Rotator (2026-11-26)

Follow-up to `2026-11-26-the-drain-scales-with-the-backlog.md` (#12109) and the live check (#12111). An independent review of the drain plus the first live check run found six defects. Each is fixed at its root and pinned by a test that fails on the old code.

## Live Evidence

The live check over the 7 AM CST release found two Horses sitting down at the released NLH 0.25/0.50 Classic Feeder at 7:56:38 AM and 8:01:40 AM CST, both while 29 games were owed a start. In both cases the heartbeat around the join did not name the table: a cycle that could not decide had un-named it, so the walk treated it as an ordinary table and seated a Horse there.

## Defects, Why Each Broke, And The Fix

1. **An undecided cycle refilled released tables.** Why: the decision ran only when the Lightning set and the people-waiting read were complete, and an undecided cycle published an empty list, so nothing kept the tables out of seating. Fix: in an undecided cycle with games still owed, every remembered table with no person stays in `surplusTableIds` (no walk, no seat call there), stays published (so the move guard and the rotator still see it) and stays named in the heartbeat.
2. **An emptied released table blocked the next release.** Why: the shortfall compared the count of kept tables, and a kept table with no Horses left covers no owed start. Fix: the shortfall compares kept tables that still have someone seated.
3. **The publication was cleared before the awaited reads.** Why: `publishVarietyDrain(null)` ran early in the cycle; every await after it left the rotator a window with nothing published, and an early return left nothing published for up to 90 seconds. Fix: the early clear is gone; the cycle publishes once, at the decision.
4. **A withheld cycle wiped the memory.** Why: memory was replaced whenever no game was owed, including a cycle whose reads were withheld. Fix: memory changes only on a decided cycle, or a cycle that truly owes nothing.
5. **A Horse could be moved onto a released table.** Why: the move guard covered balance moves onto held tables only. Fix: any Horse move other than a break move onto a published released table waits (`feederStartWaitsForVariety`); a person's move never waits.
6. **The ramp ran at the fleet cycle (30 seconds), not the rotator cycle (90 seconds) the changelog promised.** Why: one new table per call, and the fleet calls every cycle. Fix: `mayAddNew` allows a new table only `VARIETY_DRAIN_NEW_TABLE_MS` (90 seconds, pinned equal to the rotator's `CYCLE_MS`) after the last new one. The publication now goes stale at `VARIETY_DRAIN_FRESH_MS` (65 seconds, two fleet cycles plus margin), so the rotator never acts on a table the fleet stopped naming two cycles ago.

## Reviewed And Kept

The review also proposed that an empty live feeder should stop being the top of its ladder, so the highest Main could be released instead. Kept as it is: an empty feeder either fills, and is then released, or closes by itself and frees its slot, so releasing a Main beside it would drain two tables for one slot. The existing law "a released table stays released: empty..." pins this and now says why in the code.

## The Live Check

`scripts/sql/variety-drain-live-check.sql` gave a wrong PASS (a re-join after the last naming was not counted) and a wrong FAIL (a person at a table counted as a Horse re-join; one first-to-last block treated as one continuous release). It now judges each heartbeat: a Horse joining within 10 minutes after any heartbeat that named the table while starts were owed fails, only Horses count, a person seated for under one fleet cycle is tolerated, and no shipped release or no heartbeat is a FAIL rather than a PASS on zero rows.

## Hardening

- `server/src/services/anExtraTableYieldsToAnOwedMain.law.test.ts`: three new review cases (emptied table and the paced ramp with the rotator's `CYCLE_MS` pinned; no Horse moved onto a released table, a person and a break move never wait; the undecided-cycle hold sits before any seating and no early clear exists), and the staleness tests now use `VARIETY_DRAIN_FRESH_MS`.
- `tests/unit/varietyDrainLiveCheck.test.ts`: the per-heartbeat re-join window, the Horse filter, the person tolerance and the fail-closed verdicts are pinned.
