# Club Workspace Controls And Bank-Scoped Minting

The Cashier buys chips for the selected bank. An authorized standalone club can mint to its treasury. A union owner or administrator can mint to the union wallet from Union Bank. A club linked to a union cannot start a mint from its own Cashier. The permission read and money writer share the same database predicate. Union admission locks the club before checking its balances, so admission and a concurrent mint cannot both pass using an earlier balance. Same-request retries return their original receipt.

Player Management preserves the selected club, member and table when opening roster tools or watching a game. Cashier reports unknown request counts during a failed read, retains the full fractional maximum on an eligible send, and verifies the target scope and receipt before resolving a request. Daily duplicate Send and Distribute shortcuts are retired. Existing role-specific operations remain available from their owning tools.

Game Reports opens at its actual section and returns focus to its entrance when closed. Report filters and drill-ins preserve their source across navigation. Player Stats refreshes the active account’s displayed report and its open hand details. Filters remain available when a selection has no hands. Goals, saved hands and study actions retain the chosen item and result.

The native PostgreSQL regression exercises both orders of mint and union admission, denied member-club targets, the two permitted destination balances, paired diamond debits and exact-request retries. The migration has a read-only deployed definition and grant check. The tests use isolated accounts and send no production transactions.
