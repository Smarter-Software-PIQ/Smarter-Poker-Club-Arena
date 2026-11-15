# The Statements certificate compares the totals on the glass with the server (2026-11-15)

The production Cashier Statements certificate checked that the four totals were well-formed exact figures. It did not check that they were the right figures. It now records every totals answer the page receives and requires the four figures on the glass to equal the newest answer, written the way the page writes it (a plus on a non-zero In, a minus on a non-zero Out, Managed, and the entry count). The comparison is polled, because a live ledger may answer again while the check runs.

`tests/cashier-statements-exact-figure.test.ts` pins the helper against the failed run's figures and against the page's own source expressions, so a change to how the page writes totals fails a unit test first.

The comparison is bound to one consistent answer: the newest totals answer received (not the last one parsed), and only when its request carries the same club, period and filters as the page request for the entries on the glass. On a mismatch the run log names which figure differs and prints no totals.

In the certification run (`E2E_REQUIRE_AUTH=1`, where the account is an administrator of the club) a refusal now fails. Before, the refusal branch passed with no totals compared.

Test-only. Asked by the independent post-merge review of #10889 (note 3) and by the owner on 2026-11-14.

Limit: the live proof is the next Post-Deploy E2E client run.
