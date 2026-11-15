# The Statements certificate compares the totals on the glass with the server (2026-11-15)

The production Cashier Statements certificate checked that the four totals were well-formed exact figures. It did not check that they were the right figures. It now records every totals answer the page receives and requires the four figures on the glass to equal the newest answer, written the way the page writes it (a plus on a non-zero In, a minus on a non-zero Out, Managed, and the entry count). The comparison is polled, because a live ledger may answer again while the check runs.

`tests/cashier-statements-exact-figure.test.ts` pins the helper against the failed run's figures and against the page's own source expressions, so a change to how the page writes totals fails a unit test first.

Test-only. Asked by the independent post-merge review of #10889 (note 3) and by the owner on 2026-11-14.

Limit: the live proof is the next Post-Deploy E2E client run.
