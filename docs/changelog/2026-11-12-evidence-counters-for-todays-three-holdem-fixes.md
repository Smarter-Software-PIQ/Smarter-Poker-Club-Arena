# Evidence Counters For Today's Three Hold'em Fixes

Date: 2026-11-12

## What Changed

Three Hold'em fixes were merged today. After the next engine release, each one
can now be read from the daily brain telemetry instead of from decision
journals or hand rows. Nothing about how a Horse plays changed: no decision,
wager, timing or range is different, and the random number stream is exactly
the same.

1. Arbiter stand-down (rebuy-priced bust no longer folds a hand for the wrong
   reason). This was already counted as `phase7_unavailable_chip_value_not_modeled`,
   inside the registered `phase7_unavailable_*` family. Nothing was added.

2. A bluff raise needs someone who can fold. New counter
   `bluff_raise_refused_no_fold_equity_seen`. It counts one each time a squeeze
   bluff or a 3-bet bluff passed every earlier condition and its random draw,
   and was stopped only because nobody could fold (the price to call was the
   Horse's whole stack, or every opponent still in the hand was all in).

3. A showdown hand keeps its memory domain. Two new counters, one of which
   fires once for every hand a table settles:
   `hand_memory_domain_recorded_seen` when the hand's row was built with a
   public memory domain, and `hand_memory_domain_absent_seen` when it was built
   without one.

## Why

The fixes were proven by tests and by replaying recorded hands. Once they are
serving, the question becomes whether they are doing their job on live tables.
Before this change the only way to answer was to read journals and hand rows
by hand.

## How To Read Them After The Release

- `bluff_raise_refused_no_fold_equity_seen` should be small and above zero over
  a few days of play. It is rare by design.
- `hand_memory_domain_absent_seen` should be near zero. Before the repair every
  cash showdown hand would have counted here.
- `hand_memory_domain_recorded_seen` should follow the number of hands settled
  on ordinary tables.

## Limits

- The counters are fleet totals per day. They do not name a hand, a table or a
  Horse.
- The memory domain counters report what settlement built for the hand row,
  not what the database stored. The stored side has its own counter and alert.
- The three new names end in `_seen` so the daily drift audit treats them as
  occurrences. A quiet day on a rare counter is then not reported as a layer
  that stopped running.
- The bluff counter is only reported for live Horse decisions with telemetry
  on, the same as every other brain counter.

## Files

- `server/src/engine/HorsePreflop.ts`
- `server/src/engine/HorseLogic.ts`
- `server/src/engine/ServerTableEngineSettlement.ts`
- `server/src/engine/HorseDataLedger.ts`
- `server/src/engine/HorseDataLedger.test.ts`
- `server/src/engine/ABluffRaiseNeedsSomeoneWhoCanFold.test.ts`
- `server/src/engine/ASettledHandCountsItsMemoryDomain.test.ts`
- `server/src/engine/OriginalPayloadRetry.runtime.mjs`
