# tests/a-busted-players-stale-table-is-not-break-custody.law.test.ts

A bust leaves tournament_players.table_id on the table the player left, and
until 2026-11-25 smarter_private.f06_source_guard read that stale pointer as
break custody: a player who busted on a table the balancer then broke was
refused every rebuy with F06_SOURCE_EXCLUDED (2,584 in 24 hours) and could be
eliminated when the break outlasted the decision window. A source break now
does not bind a same-user roster UPDATE when the player holds no live chair on
the source and is not named by the break, and the row leaves the source or is
revived inside that player's own rebuy lane. This law pins that clause and
every custody shape that stays refused.
