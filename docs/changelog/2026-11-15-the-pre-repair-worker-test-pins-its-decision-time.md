# 2026-11-15: the pre-repair worker test pins its decision's own time

## What was wrong

`server/src/engine/horseDecision/thePreRepairDiscountThroughTheWorker.test.ts` (#10892) set the river decision's `decisionTimeMs` from the wall clock (`Date.now() + 60_000`). The decision key binds the decision's hour (`buildHorseDecisionKey`, `decisionHour`), and the worker seeds the decision's random stream from that key, so each hour gave the spot a different mixed-strategy draw. In about one hour in eight (measured: 2026-11-15T07Z, 14Z, 17Z; 9 of 72 hours swept) the deep second look, with its deeper equity, came out on the other side of the draw (check) from the fast look (bet), and "fast and deep agree on the action" failed. Forcing only the key's hour, with the time held, moves the failure with it; nothing else in the deep look reads the clock for this outcome.

Production is not affected: the live turn captures `decisionTimeMs` once (`ServerTableEngineTurns.ts`), the deep look is sent the same snapshot and key, and exact replay reads the journaled time. Fast and deep cannot read different hours for one decision.

## What changed

The test fixes `decisionTimeMs` at 2099-01-01T00:00:30Z (after any wall clock the test runs at, as the observer fence requires) and adds a regression: the same decision run under the wall clocks 2026-11-15T07:05Z, 14:30Z and 17:30Z equals the real-clock run, and fast and deep agree. No engine code changed.

## Tests

Before (wall-clock decision time, run at 07:36Z): the agreement assertion and the new regression fail. After: all four tests pass at the same wall clock.
