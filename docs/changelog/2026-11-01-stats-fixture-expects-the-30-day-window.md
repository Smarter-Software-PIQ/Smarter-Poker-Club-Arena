# 2026-11-01: the Stats fixture expects the population its 30-day reader reads

From 00:00 UTC on 2026-11-01, `Accounting transactions (PostgreSQL 17) shard
2/7` failed on every branch at
`tests/fixtures/stats-club-scope/recorded-opportunities-after.sql:22` with
`All Clubs inherited capped legacy advanced rates` (wtsd 0.5 against an
expected 0.25, one showdown against two).

Cause: `assertions.sql` seeds six hand facts at fixed times on 2026-10-02
(hand ...0012 is a showdown). `recorded-opportunities-before.sql` computed the
expected WTSD and showdown count over every fact the player has, while
`ca_player_stats_overview_v2(..., 30, 'UTC', ...)` reads today and the 29 UTC
days before it. On 2026-11-01 the 2026-10-02 facts left that range, so the
reader and the expectation diverged permanently - this was not a transient
window, it would have stayed red.

Fix: the expectation is computed over the same 30-day UTC calendar range.
Verified with libfaketime (TZ=UTC, PostgreSQL 16): the old fixture passes at
2026-10-31 23:14 and fails at 2026-11-01 00:07; the new one passes the whole
script at 2026-10-31 23:14, 2026-11-01 00:07, 2026-11-20 and 2027-03-01.
