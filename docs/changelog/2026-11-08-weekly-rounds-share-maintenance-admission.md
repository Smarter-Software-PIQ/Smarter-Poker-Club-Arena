# Weekly rounds share maintenance admission

The installed round runner entered its original financial transaction without
`530090,1`, while maintenance writers used that exclusive admission lock. Its
private payment capability deliberately bypasses ordinary freeze triggers, and
its bookkeeping row deliberately does not pause gameplay. Consequently neither
the money trigger nor the release host's gameplay pause check excluded this race.

Migration `20261108210509` changes only `weekly_payout_next_round`. Before any
financial locks or preparation it takes the existing shared transaction lock,
rechecks both freeze predicates, and returns a definite maintenance deferral on
contention or freeze. It preserves all original run/scope/round receipts and
payment owners. The next scheduled call continues the same unpaid unit after
thaw; a committed response lost in transport is read from its original receipt.

The next daily announcement comes from `daily_window_policy.last_hand` and its
IANA zone. Admission refuses when the existing statement start plus configured
statement timeout reaches that announcement. An unlimited timeout is refused.
No duration, cron, gameplay pause, release retry, or payout schedule is added.
At the observed configuration, November 9 2026's 03:58 Chicago announcement is
09:58 UTC, before the original weekly due time of 10:00 UTC. The existing cron
statement budget is 1500 seconds. An unexpected maintenance writer arriving
AFTER an already admitted transaction may still be refused until that transaction
finishes; this change does not promise zero delay or override release reserves.

Native PG17 regression executes the original coordinator, calendar, policy and
maintenance admission, with explicit local clock/freeze/payment-boundary adapters.
It proves preimage failure, migration rollback/install/hash, both concurrent lock
orders, no payment calls on deferral, the same run after an unknown committed
response, next-announcement headroom, unlimited-timeout refusal and original ACL.
The adjacent unchanged financial-phase suite independently executes actual wallet,
ledger, invoice, R1/R2/R3 and receipt owners. The admission fixture does not claim
production payouts or whole-week capacity. Both run in required accounting shard1;
a driver-only change selects that gate.

Validation: native admission regression and existing financial-phase regression
passed locally. Protected checks and exact installed readback remain separate
provider evidence. This is database-only; no engine replacement is necessary.
