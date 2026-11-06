# Post-Deploy Audit Uses The Installed Tournament And Wallet Contracts

The multi-table watch post-deploy audit exposed stale expectations for two
previously merged changes. The read-only bounty browser case now expects 3,800
credited toward the 5,000 guarantee: the full 95 payments of 40, including rake,
as required by the November 5 guarantee rule. The historical 1,580 house overlay,
5,000 pool, entry breakdown and all 15 place awards remain asserted.

The cashier contract now pins the exact maintained November 1 tournament-table
funding resolver and November 2 wallet-history reader, including ledger-only
agent movements. Both migration versions are required. No database installation,
balance change, product change or relaxed access check is involved.

Validation: the original bounty credit is absent and the corrected amount is
visible on the published page. The new wallet-history regression fails against
the old pin. Corrected source-derived hash regressions and existing certificate,
wallet-history and installed-contract checks pass (26 tests). The complete
read-only production SQL contract passes with versions, hashes, ACLs, RLS,
triggers and indexes checked. Protected CI, publication and the subsequent
production browser audit remain required delivery evidence.
