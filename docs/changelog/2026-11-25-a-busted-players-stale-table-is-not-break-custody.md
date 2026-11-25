# 2026-11-25: a busted player's stale table is not break custody

Dan, 2026-11-25: "Fix all five" (item 1 of the 24-hour production error
review). Migration `20261125020712_a_busted_players_stale_table_is_not_break_custody.sql`.

## What players saw

A player who busted on a table that the balancer then broke could not rebuy or
re-enter until the break finished. Every attempt was refused with
`F06_SOURCE_EXCLUDED` (2,584 refusals in the 24 hours before the fix, from the
engine's `process_tournament_rebuy` calls), and when the break outlasted the
decision window the player was eliminated. Measured: event dbacbcfb, 01:52 UTC
on 2026-11-25, two players busted on table ab7f2107 two seconds before its
break began; both rebuy windows expired after 31 s while every other rebuy that
hour completed in 7 to 13 s.

## Cause

A bust leaves `tournament_players.table_id` on the table the player left.
`smarter_private.f06_source_guard` binds every roster write that touches a
table under an unacknowledged break and admits only the break's own move. The
rebuy's roster write therefore read as moving source custody, although the
break never included that player (not a member, attempt or manifest entry) and
the player held no live chair on that table.

## Change

One clause in the guard's bound test (exact live body md5 0b9d60df, patched in
place to post-image 4acd120a): a source break does not bind a same-user
`tournament_players` UPDATE when the player has no live chair on the source,
is not named by the break, and the row either leaves the source or is revived
on it inside that player's own rebuy lane.

Still refused: a destination that is itself being broken, any `table_seats`
write on the source, a player with a live chair there or named by the break, a
revive outside the player's rebuy lane, and a row handed to another user.

## Proof

- `scripts/ci/test-a-busted-players-stale-table-is-not-break-custody.py`
  (native PostgreSQL, workflow `f06-stale-roster.yml`): the pinned live guard
  refuses the measured shapes before the file and admits them after it; 13
  custody shapes stay refused and an acknowledged break binds nothing. 32 of 32
  checks pass locally on PostgreSQL 16.
- `tests/a-busted-players-stale-table-is-not-break-custody.law.test.ts` pins
  the shape of the clause.
