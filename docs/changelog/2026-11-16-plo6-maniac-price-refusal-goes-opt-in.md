# PLO6: The Maniac Price-Refusal Hand-Off Goes Opt-In (PLO6-AUDIT-013)

2026-11-16. Lane: PLO6.

## What Changed

`plo6ManiacPriceRefusalToRangePlay` (#10768) is now read as `=== true`: off unless a caller sets it. With it off, a PLO6 cash refusal by the maniac price arithmetic folds again, as before #10768. With it on, nothing changes from #10768.

## Why

Hand Analysis set a fixed time for the option's reach row (rulings 2026-11-15T06:00:45Z, 14:59:59Z, 16:08:40Z and 17:03:57Z, the last setting the decision read at 2026-11-16T06:00Z from the decision journal, both passes): only a changed accepted decision measured from the decision journal by the decision read keeps it on. None was measured, so the option goes opt-in, as ruled. The case that applied (no eligible opportunity, eligible decisions with no changed action, unreadable evidence, or a harmful decision) is recorded with this pull request. Unless that record names a harmful decision, this is a promotion-evidence disposition, because the production evidence the row requires was not shown; it is not a finding that the change is wrong. The receipts count the first pass only, so the decision journal was read for both passes where it was retained; the 54c9aac8 window's second-look decisions are unreadable (see the evidence file).

## Evidence

`docs/horse-default-on.d/plo6ManiacPriceRefusalToRangePlay.md`: a status line under each of the eight rows, and the reach row's result. `server/src/engine/HorsePlo6OpponentReadMatrix.test.ts`: every case of the arm now sets the option explicitly, and a new case pins that the default is the old fold.

## Not Changed

The arm, its receipts and the `observed_maniac_raiser_seen` read stay. The tiny-price call (#10615) and every other PLO6 option keep their current state.
