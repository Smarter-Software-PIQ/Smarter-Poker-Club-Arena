# Complete member transaction histories

Member Management now reads all recorded receipts and posted wallet movements for the selected agent or player, including incoming and outgoing rakeback, commissions, game entries, prizes and transfers. The former cashier-only transaction-type list omitted movements recorded solely in chip_ledger.

The read-only member RPC reuses fn_cashier_history_book authorization, preserves opposite-party and funding-wallet filtering, merges indexed sender/recipient reads, suppresses a receipt's mirrored ledger leg, and pages by timestamp, source and ID. Amounts retain exact decimal text. Existing combined club cashier history remains on its current feed. No balances, payment writers or engine code change.

Regression coverage includes real isolated PostgreSQL execution for all categories, both payment directions, receipt deduplication, tied-time cross-source pagination, funding/search/date filters, and staff/downline/self/anonymous boundaries. The existing required data-console PostgreSQL route executes this regression; focused React tests cover the selected RPC, figures and wallet routes.

Ledger Window also defaults to an explicit Today selection. Agents see Agent Only, Downline Only and Agent + Downline for every activity metric. The server returns all three under the same confirmed Chicago range; unique recursive descendants include the full tree beyond the 50-row rendered list and terminate safely on cycles. Players keep individual activity. A private/read-denied record returns no aggregate figures; unknown cash results remain unavailable rather than zero. Ledger-recorded rakeback/commissions contribute to Claimed Back and Sent Out without counting their mirrored transaction receipt twice.

A live older-page check found a promo transfer whose receipt used a timestamp
16.6 milliseconds after its journal leg. The shared operation ID now matches
those records within the existing one-minute boundary while retaining amount,
party and wallet checks. History and activity both count the transfer once;
a separate wallet leg with the same operation ID stays visible. The native
regressions reproduce both duplicate failures before the correction and pass
after it. No chip records or balances are changed.
