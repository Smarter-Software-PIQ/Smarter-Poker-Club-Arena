The JSON files capture the nine actual original money-owner definitions read
from the configured production Supabase connection on 2026-11-16. Each native
run recreates them and verifies their PostgreSQL `pg_get_functiondef` MD5 before
installing the prospective migration. Captures contain source only, no records
or credentials. Changing an owner requires an explicit new capture and review.

The native PG17 proof exercises actual direct redemption, original issuer
cancellation, forced cashier-ticket entry, the exact wallet debit primitive and
the private five-per-day Free Buy coupon book. It retains the original grant
through partial prizes, exact-entry refunds, satellite rollovers and terminal
loss; it also executes two concurrent original redemption requests.

The fixture adapters are explicit: journal legs replace production autoledger
and tally, the registration wrapper calls the actual debit primitive, fee
capture records its numeric handoff, and principal return records intent and
retires custody. The lock-only source-fund adapter has no real fund journal.
This proof does not qualify the production tally, complete tournament entry
accounting, original exact-refund financial closure or source-fund concurrency.
Those require the combined owning financial integration before activation.
