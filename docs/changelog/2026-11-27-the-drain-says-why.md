# The Drain Says Why It Released What It Did

2026-11-27, HORSE DECISIONS lane.

## What Was Wrong

On the 1 AM CST seal (`f2b854319ea9`) the variety drain released nothing for ten hours while up to 29 games were owed a start. The heartbeat carried the owed games and the released tables, but not the reason for releasing none, so the live check could not tell a drain that was correctly idle from one that was broken. Answering it took hand history per hour: no game ever had a second occupied table, and overnight the cap had free slots, so there was nothing to release.

## Why

The decision (`varietyDrainTables`) returned only the list of tables. Every way of returning an empty or unchanged list (a free slot, no extra table, the shortfall already covered, the one-per-cycle pace) looked the same from outside.

## The Fix

- `varietyDrainDecision` returns the tables and the reason: `released`, `kept`, `covered`, `paced`, `no_extra_table`, `room_free` or `nothing_owed`. `varietyDrainTables` is now that decision's table list, unchanged for every caller.
- The fleet publishes `detail.variety_drain_why` on every beat. It adds `undecided` (an owed cycle that could not read the waiting list or the Lightning set), `withheld` (seating withheld this cycle) and `room_unknown` (the cap or census read failed, which the decision treats as "fits"; the beat must not call it free).
- `scripts/sql/variety-drain-live-check.sql` gains `drain_why`: the reasons counted over the beats with a start owed. It reads "not recorded" until a build that writes the field serves.

## Pinned By

- `server/src/services/theDrainSaysWhy.law.test.ts`: every reason, the wrapper's equality with the decision, and the fleet's wiring. All three tests fail on the previous code.
- `tests/unit/varietyDrainLiveCheck.test.ts`: the `drain_why` row. Fails on the previous SQL.
- `anExtraTableYieldsToAnOwedMain.law.test.ts` keeps its ordering pins (the decision after the hold, the hourly read and the waiting-list gate), now anchored on the decision call.
