# The Cashier Statements certificate reads exact figures (2026-11-15)

## What failed

Post-Deploy E2E 43643304336, "Certify the authenticated production Cashier Statements" (22:07:57Z):
"Statement Totals never reached a terminal state", last read `pending:0|0|177,488.28|2,111`.

## Cause

The page was correct. The totals RPC answered HTTP 200, authorized, with valid totals (the spec's own `totalsObservation` assertion just before the poll passed), and the four figures were on the glass. The spec still read figures with the pre-2026-11-13 grammar: whole numbers or compact K/M/B only. Since the owner's ruling of 2026-11-13 (#10797), real figures keep their cents and are never abbreviated, so `177,488.28` never matched and the poll waited out its 30 seconds. Two more checks in the same spec would have failed next for the same reason: the entry pill pattern (`2,111 Entries` has a separator) and `expectNoRawCashierCents`, which refused any decimal on the page.

## Change (test-only)

- `tests/e2e/support/exact-figure.ts`: one grammar for an exact figure and for the entry pill.
- The statements spec reads totals and the pill with it.
- `expectNoRawCashierCents` becomes `expectExactCashierFigures`: every row amount and every total on the page must be an exact figure (separators, cents kept, never `1.5K`, `393K` or `2B`). It reads only the nodes that carry figures. A first version scanned the whole page for K/M/B and would have failed on reference codes such as `Ref 262B2E2F` (13 of 100 on the failed run's page) and on a name such as `100K`; the independent review caught that before merge.
- `tests/cashier-statements-exact-figure.test.ts` runs the grammar and the guard against `exactChips` itself, including the failed run's figures. With the old grammar three of its cases fail. A Chromium probe on statements-shaped markup passes with hex references and a `100K` name, and fails on an abbreviated amount.

No client, RPC or migration change.

## Limits

The spec needs the production test account, so it is verified by the next Post-Deploy E2E client run, not locally.
