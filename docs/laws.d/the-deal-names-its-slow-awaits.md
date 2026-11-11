# tests/the-deal-names-its-slow-awaits.law.test.ts

The cash next-hand breach line (#10435) attributes time to named stages. Three
breaches on 2026-11-11 (2,091-2,572 ms) spent their excess in `dealing`, after
the hand was logged and before the deal was recorded, where dealHand awaits
hand number allocation, the bomb-pot claim, the cash hand manifest and the
time-bank reads. The law pins that each of those awaits is its own breach stage
and that the span returns to `dealing` after it, so a breach names the await
that spent the time instead of leaving it unexplained. Observation only: no
await, order or behaviour changes.
