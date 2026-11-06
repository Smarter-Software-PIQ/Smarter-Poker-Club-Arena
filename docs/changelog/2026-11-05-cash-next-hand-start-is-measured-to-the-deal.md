# The cash next-hand start is measured to the actual deal

Owner order, November 5, 2026: "AS SOON AS ONE CASH GAME HAND FINISHES AT A TABLE, THE NEXT HAND NEEDS TO START WITHIN 2 SECONDS, ANYTHING LESS IS UNACCEPTABLE", and "Measure the complete transition, including post-hand persistence, settlement, scheduling, and the next actual hand start ... Report the sample size, median, p95, p99, maximum gap, and the count of eligible transitions exceeding two seconds."

`/health` `nextHandGap` stops its clock when the rest ends, before `dealHand`'s own awaits (hand number, seat boundary, cash participant manifest, time-bank reads), and mixes cash with tournament tables. On November 5 its slowest samples were all tournament tables, so it could not say whether cash met the rule.

New `/health` `cashNextHandStart`:

- **Start:** the end of the completion hold. That is the winning hand shown, the pot pushed with its total and the cards mucked (Dan, 2026-08-21), the same instant `armNextHandRest` stamps.
- **Stop:** immediately before the hand controller starts the new hand, after every await in `dealHand`.
- **Scope:** cash tables only. A gap in which the table idled (not enough players, operator or maintenance pause) or ran the five-second rebuy pause is a legitimate wait and is not a sample.
- **Reported:** n, p50, p95, p99, max and `over` (gaps above 2,000 ms), fleet-wide and per table, plus the ten slowest with their table, over the last hour.

Observation only: no dealing, settlement, timer or money behaviour changes. No migration.
