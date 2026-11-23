# 2026-11-23 - a timer that wakes early does not start the next hand early

## What failed

On PR #11817 (no engine change) `Server Engine shard 3/4` failed once on
`server/src/engine/noUnintendedDelayBetweenHands.law.test.ts`:
`expected 1499 to be >= 1500`, then passed on re-run. That assertion is the
law's measured deal: from the instant the rest is armed to HAND_START must be
at least the 1,500 ms rest.

## The cause (it was the engine, not the measurement)

The engine really did start the hand 1 ms before its own deadline. The rest is
a deadline on `Date.now()` (`nextHandNotBeforeMs`), and `awaitNextHandRest`
waited it out with one `setTimeout(deadline - Date.now())`. Those are not the
same thing:

- Node counts a timer in whole milliseconds of libuv's loop clock: a monotonic
  clock floored to the millisecond (on Linux the 1 ms
  `CLOCK_MONOTONIC_COARSE` when its resolution allows).
- `Date.now()` floors the wall clock, whose sub-millisecond phase is unrelated.

So a timer of n ms is only guaranteed more than n - 2 ms of real time, and it
can fire while `Date.now()` still reads the deadline minus 1 or 2. The engine
then dealt immediately: HAND_START at `nextHandNotBeforeMs - 1`. The test
measures with `Date.now()`, the same clock the engine arms the deadline with,
so the 1499 was a true reading of an early start, not a bad measurement.

The completion hold (`awaitHandCompletionDisplay`, deadline
`lastHoldDeadlineMs`) had the same single-timer wait and could end 1-2 ms short
in the same way.

Measured on unchanged code (Node 22, this container):

- plain Node, 20,000 `setTimeout(deadline - Date.now())` waits: 83 woke at
  `deadline - 1`;
- the law's fixture, the two measured scenarios of the law plus
  `ThePermitIsReservedUnderTheRest`'s, 200 deals each: 29 of 600 HAND_STARTs
  landed at the rest deadline minus 1 ms;
- the two real test files run 29 times: 2 failed with exactly
  `expected 1499 to be greater than or equal to 1500`.

## The fix

`ServerTableEngineBase.sleepUntil(deadlineMs)`: sleep, then, if the wall clock
is still short of the deadline by at most `NODE_TIMER_EARLY_WAKE_MAX_MS` (2),
sleep once more for the residue plus that bound, which by the same arithmetic
cannot wake before the deadline. A larger residue is not a timer waking early
(the wall clock stepped back, or a test's sleep did not advance it) and is not
waited, so a clock step never stretches a beat. The rest's final wait in
`awaitNextHandRest` and the completion hold both use it. When it engages (about
5% of beats in the fixture) the beat ends 0-4 ms after its deadline instead of
1 ms before it, inside `ENGINE_BETWEEN_HANDS_BUDGET_MS`.

No assertion was loosened. The law gains a fourth part: every sleep modelled
waking 2 ms early (and 1 ms for the hold), both rest paths and the hold still
end on their deadlines, and a clock stepped back a minute mid-rest is not
waited out again. Those pins fail on the old waits.

## Same pattern elsewhere

Searched every server test for a wall-clock lower bound asserted against a
timer delay. The only other one on a real timer is
`ThePermitIsReservedUnderTheRest.test.ts` (`startedAt >= restEndsAt`), which
measures the same `awaitNextHandRest` wait and is fixed by the same engine
change. The rest either use fake or injected clocks, assert ordering rather
than elapsed time, or measure a wait that already loops on `Date.now()`
(`waitForRebuyDecisions`, bound 550 for a 600 ms window).

After the fix: 0 of 600 fixture deals started before the deadline, and the
two real test files passed on every run of the after loop.

## Release

This is engine code. It goes live at the next certified three-hourly cutover
through the normal Stage -> receiver route; no release control was touched.
