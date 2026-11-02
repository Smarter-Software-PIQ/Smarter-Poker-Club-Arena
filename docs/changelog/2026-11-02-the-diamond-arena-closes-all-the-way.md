# The Diamond Arena Closes All The Way

Dan, 2026-11-02: "close all Diamond Arena games and events, including frozen
leftovers - not merely confirm new starts are disabled. Keep the arena closed
until I explicitly reopen it." Settlement through the supported custody-safe
paths only; no balance edits; no duplicate payments; retained hands preserved.

## What was open (read from rows, 05:12 UTC)

| Liability                                 | Count                    | Diamonds | Holders |
| ----------------------------------------- | ------------------------ | -------- | ------- |
| Cash seats, cluster NLH 1/2 (8 tables)    | 43 seats                 | 31,964   | horses  |
| REGISTERING events (34 MTT, 2 satellites) | 36 events, 0 entries     | 0        | -       |
| RUNNING (started) events                  | 15 events, 1,436 entries | 428,212  | horses  |
| Pending purchases, spins, sit-and-gos     | 0                        | 0        | -       |

## What the migration settles

- The 36 empty registering events through `fn_poker_diamond_tournament_cancel`,
  called as the staff door calls it: guarantee earmarks released, an immutable
  cancellation receipt each, nothing owed.
- The 43 cash seats through the engine's own `fn_poker_diamond_cashout`: seat
  vacated, its exact custody released to the player's own wallet once (keyed
  by occupancy), a `seat_cashout_receipts` row each. The empty cluster then
  closes with the close door's own writes, logged in the admin action log.

Proved first as one self-aborting transaction on production: 36 cancelled,
0 refund lines, 43 seats, 31,964 returned, 65 tables closed, 0 unaccounted
exits. The migration asserts those figures and aborts if the board moved.

## What it does not touch, and why

The 15 started events are refused by the cancellation authority by design
("resume or settle it instead of cancelling") and are already members of the
owner's 170-event equal-share closure (operation d44c4440 and siblings). That
operation settles them through `fn_ca_settle_tournament_abort_equal_share`
once window migrations 20261101004247 and 20261101005048 install and the
engine cutover lands. A second settlement here would race it. Their 428,212
Diamonds stay in custody, intact and accounted, until then.

The arena switches stay off and the owner closure record stays closed.
