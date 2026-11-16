# Complete member transaction histories

Member Management now reads all recorded receipts and posted wallet movements for the selected agent or player, including incoming and outgoing rakeback, commissions, game entries, prizes and transfers. The former cashier-only transaction-type list omitted movements recorded solely in chip_ledger.

The read-only member RPC reuses fn_cashier_history_book authorization, preserves opposite-party and funding-wallet filtering, merges indexed sender/recipient reads, suppresses a receipt's mirrored ledger leg, and pages by timestamp, source and ID. Amounts retain exact decimal text. Existing combined club cashier history remains on its current feed. No balances, payment writers or engine code change.

Regression coverage includes real isolated PostgreSQL execution for all categories, both payment directions, receipt deduplication, tied-time cross-source pagination, funding/search/date filters, and staff/downline/self/anonymous boundaries. The existing required data-console PostgreSQL route executes this regression; focused React tests cover the selected RPC, figures and wallet routes.
