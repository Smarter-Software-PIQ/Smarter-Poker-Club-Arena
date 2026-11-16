# Data Pages: Pacific accounting dates and Kings source audit

Owner direction November 16: daily totals close at Pacific 23:59:59, and weeks run Monday through Sunday. The November 9–15 window is [2026-11-09T08:00Z, 2026-11-16T08:00Z). Games are distinct game IDs within the entire selected window, not the sum of daily counts.

## Production source audit

Read-only production queries independently reconstructed results from original cash hand outcomes, original Lightning pool hand results attributed through immutable funding receipts, the one relevant post-hand escrow ownership certificate, posted tournament ledger flows, cash rake-credit sources and recognized tournament fee sources. The reconstruction used no page RPC or reporting-fact sums for its expected money totals. Lightning participant entries had zero overlap with the ordinary original-hand population and zero missing linkage receipts. A separate comparison to the accounting model returned the same figures.

| Pacific date | Distinct games | Total winnings | Finished MTT winnings |    Fees |
| ------------ | -------------: | -------------: | --------------------: | ------: |
| 2026-11-09   |             18 |        -349.91 |                300.69 |  413.77 |
| 2026-11-10   |             32 |       -3036.57 |                 92.50 |  854.28 |
| 2026-11-11   |             30 |       -3739.31 |                138.17 |  512.70 |
| 2026-11-12   |             36 |        2545.03 |                321.51 |  721.88 |
| 2026-11-13   |             28 |         380.80 |               -573.50 |  422.06 |
| 2026-11-14   |             41 |        2988.08 |                -80.82 | 1056.80 |
| 2026-11-15   |             58 |       -6687.73 |               -424.72 | 1173.32 |
| Entire week  |            194 |       -7899.61 |               -226.17 | 5154.81 |

November 11 MTT winnings in the owner's transcription were 138.71; the original ledger and the reporting model both give 138.17. Each day's game count matches, and independent source game IDs give 194 for the week. A game active on more than one day appears on each such day's report but once in the week's distinct count.

At audit time coverage was complete but provisional: no settlement period/invoice or retained closing-boundary certificate existed for this week, and November 15 was awaiting boundary certification. Matching original transaction totals is not a claim that an issued invoice or its deferred tournament boundary holdings have been finalized. No financial close, payout, repair, certification or ledger mutation was initiated.

### Midway union BBJ reconciliation

For the same window, original cash rake sources total 817368.93 and 46673 recognized tournament fee sources total 98047.08, independently reproducing the page's 915416.01 fee. Gross BBJ collections are 166462.81: both the 548132 pool contribution records and the corresponding rake records give that amount. Participant attribution independently gives the same amount, including 639.04 for Kings. Qualified original BBJ award records give 25611.60 returned to players. Thus cash losses reconcile exactly: 958220.14 = 817368.93 rake + 166462.81 collected - 25611.60 awarded.

Original posted tournament flows give 1132696.00 funded and 1045467.21 returned; the retained opening boundary holds 15725.60 of deferred entries. Returns minus funding minus opening holdings give the page's -102954.39 tournament result. This differs from tournament fees by 4907.31 while the closing boundary remains provisional. Therefore combined loss minus fee, 145758.52, is gross BBJ minus awards plus that tournament difference, not a BBJ collection metric. The owner's 145755.52 transcription is also 3.00 below that subtraction; the supplied screenshot contains no separate BBJ-collected figure. No number was changed to force reconciliation.

## Source correction

The existing accounting day subtracted two hours from Chicago wall time. On fall-back Sunday, 2026-11-01T07:30Z, that gave October 31 even though it was November 1 at 00:30 Pacific. Both the database producer boundary and client mirror now use America/Los_Angeles directly. The weekly invoice function already uses Pacific and is preserved. All viewers of a given accounting report share this boundary; authorization/downline scope is preserved.

The migration updates the reporting metadata and invalidates only seed receipts whose old boundaries differ. Production read-only discovery identified October 31 and November 1. Existing coverage reports these dates incomplete until the maintained finite history loader rebuilds them from source. The change does not shift aggregate rows based on their last timestamp or overwrite totals with expected numbers. No wallet, game, payout or settlement source is changed.

Explicit Chicago timestamp displays remain Chicago. Their date-picker boundary labels are calculated from the actual selected date, including the one-AM Chicago clock display of Pacific midnight on fall-back Sunday. The reporting help states Pacific days and Monday–Sunday weeks. The legacy calendar basis for historical/non-union reporting remains explicitly Chicago; this change does not relabel those aggregates as Pacific.

## Validation and delivery

The owner explicitly increased the existing 52000-hand benchmark budget from eight to twelve seconds after CI took 8326 ms with all correctness assertions passing. Its maintained test now uses a named twelve-second base, with the existing hosted-CI strictness and bounded local load scaling tested at that base. The hand population, illegal-action, strategy and outcome assertions are unchanged. This is verification-only and introduces no engine runtime change. A finite budget reduces timing sensitivity; it cannot guarantee success on an arbitrarily slow runner.

The existing isolated PostgreSQL accounting qualification reproduces the old error, installs the new migration, verifies the Pacific boundary, detects invalid historical receipts, rebuilds both affected fixture days through the maintained loader and proves conservation with each boundary event counted once. It also verifies the real screen's metadata and coverage. Existing client date/window and component tests and TypeScript checks passed before submission. Protected merge, installation, historical rebuild, client publication and live proof are recorded in the task's external checkpoint; this source changelog alone does not assert deployment.
