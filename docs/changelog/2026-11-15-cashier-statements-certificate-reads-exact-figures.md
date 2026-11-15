# The Cashier Statements certificate reads exact figures (2026-11-15)

## What failed

Post-Deploy E2E 43643304336, "Certify the authenticated production Cashier Statements" (22:07:57Z):
"Statement Totals never reached a terminal state", last read `pending:0|0|177,488.28|2,111`.

## Cause

The page was correct. The totals RPC answered HTTP 200, authorized, with valid totals (the spec's own `totalsObservation` assertion just before the poll passed), and the four figures were on the glass. The spec still read figures with the pre-2026-11-13 grammar: whole numbers or compact K/M/B only. Since the owner's ruling of 2026-11-13 (#10797), real figures keep their cents and are never abbreviated, so `177,488.28` never matched and the poll waited out its 30 seconds. Two more checks in the same spec would have failed next for the same reason: the entry pill pattern (`2,111 Entries` has a separator) and `expectNoRawCashierCents`, which refused any decimal on the page.

## Change (test-only)

- `tests/e2e/support/exact-figure.ts`: one grammar for an exact figure and for the entry pill.
- The statements spec reads totals and the pill with it.
- `expectNoRawCashierCents` becomes `expectNoAbbreviatedCashierFigures`: the page must show no `1.5K`, `393K` or `2B`. That is the current ruling's guard; the old one refused what the ruling requires.
- `tests/cashier-statements-exact-figure.test.ts` runs the grammar and the guard against `exactChips` itself, including the failed run's figures. With the old grammar three of its cases fail.

No client, RPC or migration change.

## Limits

The spec needs the production test account, so it is verified by the next Post-Deploy E2E client run, not locally.
