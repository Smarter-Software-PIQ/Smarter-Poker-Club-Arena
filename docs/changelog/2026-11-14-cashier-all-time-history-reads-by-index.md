# Cashier All Time history reads each type group by its own index

**Symptom.** Cashier > Transaction History > All Time on KINGS CLUB answered
"Could not load your transaction history" (statement timeout).

**Root cause.** `fn_cashier_history_feed`'s club book chose its newest page with
one `(cash-out types OR transfer types)` filter. The planner walked
`idx_chip_tx_club_created` in date order through 1,073,286 club ledger rows to
find 16,307 cashier rows; the OR kept it off the partial transfer index.

**Fix.** Migration `20261114171135_cashier_history_club_book_reads_by_index_per_type_group`
replaces only the club book's row picker: transfers come off
`idx_chip_tx_club_transfer_created`, cash-outs off the transaction-type index,
each limited and newest first, then merged. Signature, rows, order, columns,
security and grants are unchanged; person, downline and search books are
untouched.

**Proof (rollback-only `pg_temp` probe on production, 2026-11-14).** All Time
newest 50 equal to the reference query in 111 ms; cursor page 2 equal; Transfers
and a 2-day All range equal to the live function; Cash-Outs (24 rows) equal in
18 ms.

**Refused at install, fixed in place.** The first install (Apply Merged
Migration run 43627660900) was refused by the file's own md5 guard ("History
Source Changed"): a later migration had changed the function's name columns,
and the file carried a whole copy of the older body. Nothing was installed. The
file is now a patch of the installed source (four exact-once anchors under the
current md5), so every other line, including the newer name columns, is kept.
Re-probed rollback-only on production: All Time 50/50 equal in 86 ms, page 2,
Transfers and a 2-day range (full rows, names included) equal to the live
function, Cash-Outs equal in 17 ms.
