# Undrawn Spin cancellation keeps its original gross refund contract

A Spin can book three entries into its reserve and fee allocation before its
launch draws a multiplier. The immutable entry entitlements still describe the
original gross buy-ins. Cancellation compared the pre-launch display cache with
the post-booking escrow, then attempted gross refunds before returning those
booked components. A production rollback probe reproduced the cache refusal;
64 registered, undrawn events held 4,584 chips in gross entries at inspection.

The migration admits only the exact evidenced three-entry, single-contribution,
undrawn state. It reverses the existing reserve contribution and fee attribution
inside the same cancellation transaction, then returns those exact components
to the original escrow entry rail. The unchanged exact-entitlement payer creates
the wallet history, journal, refund tranches and durable cancellation receipt.
It never rewrites an entitlement or uses another event's money. Started events
and committed awards remain refused.

The real PostgreSQL test also exposed a terminal-trigger incompatibility:
reversal receipts are unconditionally immutable, but terminal stamping attempted
to update them. The stamp and its reader now exclude all four intrinsically
immutable receipt kinds. The append-only guard is unchanged and its exact
definition is required at installation. Mutable evidence still needs its exact
terminal marker.

The native regression uses real financial functions and enabled triggers in a
disposable PostgreSQL 17 cluster. It reproduces the old refusal and checks gross
refunds, reserve/fee conservation, exact replay, concurrent requests, full rollback
after a late receipt fault, malformed-state refusal, started-event protection,
immutable receipts, club/union reserve ownership, and ordinary MTT/SNG refunds.
Required accounting shard 4 executes it; input-only changes select that check.

This is database-only source work and does not restart the engine. Source
qualification, protected merge, migration installation and production readback
are separate evidence requirements. This file does not certify installation or
tournament reopening.
