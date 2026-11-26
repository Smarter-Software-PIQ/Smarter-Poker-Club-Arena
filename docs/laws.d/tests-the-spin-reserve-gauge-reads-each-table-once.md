# tests/the-spin-reserve-gauge-reads-each-table-once.law.test.ts

`v_spin_reserve_health` returns one row per spin reserve pool and feeds the
spin-sweep alarm and the operator monitor. Its four alarm counters were
correlated subqueries filtered on `fn_spin_reserve_owner(club_id) = p.club_id`,
which no index can serve, so each of about 4,000 pools re-read the last day of
spins and ledger adjustments. On 2026-11-26 it was the largest source of
statement timeouts in the database, 93 in a day, and a timed-out read meant the
alarm it feeds did not run. Migration 20261126195422 reads the ledger and the
tournaments once each, grouped by owner, and joins the counts to the pools; the
same select returns every row in under 100 ms. The law reads the newest
migration that defines the view and pins that no counter filters by owner per
pool, that both tables are grouped by owner, that the sixteen columns keep
their names and order, that the counters keep their meanings and 24 hour
bounds, and that only the service role can read the view as its invoker.
