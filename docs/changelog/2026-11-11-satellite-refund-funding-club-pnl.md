# The funding club bears its satellite seat refund

Owner ruling, 2026-11-11 (~16:15 America/Chicago), answering "Which club's
weekly P&L should carry these two refunds?": "KINGS CLUB (Recommended)",
meaning "The club that funded the entry bears its refund; the Felt Society
receipt is recorded as an inter-club transfer."

The two refunds are the last pair in union scheduler incident
`a544b469-9226-4770-9f77-d5a77e085ea7`: cancelled tournament `f4153d52`,
200.00 each, refund ledgers `b9216e23-3580-4480-9265-c146f7f0b5aa` and
`ca27f46a-914e-4d4d-9221-408a86ee314b`. Both players paid their satellite
entries from KINGS CLUB `a41434bb` wallets, left KINGS CLUB on 2026-11-02,
won their seats as The Felt Society `a0000000` registrations and were refunded
into Felt Society wallets on 2026-11-07. `20261111010427` proved that lineage
and attributed the refunds to the admitted club. This ruling replaces that
attribution with a general rule.

`20261111222648` changes both original readers (complete and bounded window).
A satellite seat refund whose funding club, read from the wallet-funded entry
receipt by `fn_union_pnl_satellite_seat_owner`, differs from its refund wallet
club, and whose whole original lineage the admitted-club arm proves, is the
funding club's `tournament_return`. The ledger keeps its own club, and the
ownership predicate admits that difference only for this proven shape, the
way it already admits a proven treasury gift: the receipt in the other club's
wallet is the inter-club transfer. Existing flow kinds only. No ledger, wallet,
membership, receipt, certificate or settled payout is written, and live
membership is never read.

Production, read-only before the change: of 6,238 satellite seat
entitlements, 3 have a resolved funding club other than their refund wallet
club and only these 2 were refunded, so no other flow in any week changes
classification. Their week (2026-11-02 to 2026-11-09) was settled at
2026-11-11 09:05Z on the admitted-club attribution, before the ruling. This
change does not reopen or adjust it.

Native PostgreSQL 17 (`scripts/ci/test-satellite-refund-funding-club-postgres.py`,
run from the required ticket-refund qualification): the fixture readers are
md5-identical to the production preimages the migration pins; before, both
readers certify the two refunds as The Felt Society's; after, both certify
them as KINGS CLUB's (400 chips, zero buyins) while the ledger keeps The Felt
Society, the same-club control and every other output column are unchanged,
and 24 faults (the admitted-club arm's 20 plus a second funding club, an
unposted funding ledger, a different receiving ledger club and a different
refund wallet club) refuse in both readers, with every fixture table digest
preserved after rollback.
