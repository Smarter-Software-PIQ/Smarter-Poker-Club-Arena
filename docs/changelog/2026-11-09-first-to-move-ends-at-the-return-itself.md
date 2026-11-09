# First to move ends at the return itself

2026-11-09. Follow-up to `2026-11-09-first-to-move-ends-on-return.md`
(migration `20261109010155`, installed 02:05 UTC).

## The gap that fix left

That step drops a bumped player from `first_to_move` when a controller tick
finds them neither seated on a feeder of the game nor holding a pending move.
It decides from where the player is at the tick. A player who goes back to
Main, or cashes out, and sits down at the feeder again before the next tick
is "on the feeder" when the tick looks, and keeps the priority.

Ticks run about every 5 seconds, and a refused tick waits for the next one.
Production over the six hours before 02:10 UTC on 2026-11-09: 732 cash-outs
from game tables, 45 same-game rejoins within two minutes, the fastest after
8.06 seconds, none under 6 seconds. So the gap had not been hit in that
window, but the rule is that priority ends when the player returns.

## The fix

Migration `20261109021129` adds one step right after the earlier one, in step
1b of `fn_cash_cluster_tick`. It reads the two records the live paths write in
the same transaction as the event:

- the move back: a `cash_seat_moves` row for the player in this game, `done`,
  to a Main, executed since the feeder start began, and not one of the start's
  own bump moves;
- leaving the game: a `ca_seat_stack_exits` row for the player on any table of
  the game since the feeder start began. Seat moves write none (measured on
  the 2026-11-09 records of the player in the original defect).

Either one ends first-to-move for good, whenever the tick runs. A bumped
player still on the feeder with neither record keeps it, including one who
busted and rebought without leaving. A bumped player who leaves the feeder with
no chips writes no exit row; the earlier step drops them at the next tick.

## Local tests (copy of the controller, PostgreSQL 16)

| case                                                                         | earlier fix only | both fixes |
| ---------------------------------------------------------------------------- | ---------------- | ---------- |
| D1 back on Main, cashes out, sits at the feeder before a tick: priority gone | FAIL             | PASS       |
| D2 the other bumped player keeps priority                                    | PASS             | PASS       |
| D3 the next Main chair goes to the bumped player still waiting               | error (2 moves)  | PASS       |
| D4 the rejoiner waits for the seven-player gate                              | not reached      | PASS       |
| E1 busts and rebuys on the feeder without leaving: keeps priority            | PASS             | PASS       |
| E2 cashes out of the feeder and sits back down before a tick: priority gone  | FAIL             | PASS       |
| E3 the player who stayed keeps priority                                      | PASS             | PASS       |
| E4 the next Main chair goes to the player who stayed                         | PASS             | PASS       |

The earlier suites (feeder start, bump-return on leave and on bust, 6-max,
return-then-rejoin R1-R5) give the same results with the new step; the
feeder-start board trace is byte-identical.

No money path and no engine change. Pinned in
`tests/a-full-ring-feeder-starts-with-the-last-two.law.test.ts`.
