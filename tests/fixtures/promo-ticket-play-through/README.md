These JSON files capture actual original money-owner definitions read from the
configured production Supabase connection on 2026-11-16. The native PG17 run
recreates them and verifies each PostgreSQL `pg_get_functiondef` MD5 before
installing prospective source. Captures contain source, no records or secrets.

The regression executes the original promo ticket send/batch refusal and old
receipt replay, the original ticket owner with cashable player/agent sources,
agent-source cancellation and replay, the actual wallet debit primitive,
per-entry principal, partial prizes/refunds, earned satellite rollover, full
loss and the private five-per-day Free Buy book. Bought tickets never create
new promo custody or a new play-through target.

Fixture adapters are explicit: journal legs replace production autoledger and
tally, the registration wrapper calls the actual debit primitive, fee capture
records its numeric handoff, and principal return records intent and retires
custody. The lock-only source-fund adapter has no real fund journal. This proof
does not qualify the production tally, full tournament entry accounting,
original exact-refund closure or source-fund concurrency; the combined owning
financial integration must qualify those before programme activation.
