# A Spin Seat Counts A Refunded Entry As Refunded (2026-11-24)

Incident `7e8dce13-9eb8-436e-ae0e-c0af116b5dba`, alert
`SpinHumanWaitingForOpponents` (critical), first fired 16:55:30 UTC with a
player waiting 506 s at a partly filled Spin.

## Cause

Spin `3b4c6299` (5 Chip Deep Stack Spin NLH). Wallet history on the board:

| UTC      | who    | row                       |
| -------- | ------ | ------------------------- |
| 15:29:21 | player | buy-in debit 5            |
| 15:32:07 | player | unregistration refund 5   |
| 16:46:42 | player | buy-in debit 5 (sits 1/3) |
| 16:50:35 | horse  | buy-in debit 5 (2/3)      |
| 16:59:52 | player | unregistration refund 5   |

From 16:50 the engine offered three horses every 12 s for the third seat and
every one was rolled back inside the seat transaction by `fn_spin_book_entry`:

```
three_paid_seats_required: paid_users 2, buyin_debits 4, buyin_total 20.00,
roster_users 3, seat_users 3, exact_seat_stacks 3
```

The gate proved "three paid seats" from **gross** `tournament_buyin` debits:
per player `sum(debits) = buy_in`, board-wide `count(debits) = 3` and
`sum(debits) = 3 * buy_in`. Refund credits were never subtracted. The
re-registered player read as having paid 10 on a 5 Spin, the board as holding
four debits, so the gate could never pass again, for a person or a horse. The
player left after 13 minutes.

The same count bricks a board after **anyone** leaves it before it fills (a
fourth debit). In the 30 days to 2026-11-24 every Spin with an unregistration
(4 boards) never dealt: 3 were cancelled hours later (for example
`995e91cb`, 20 Chip PLO4, 2026-11-17: a person sat and left 14 s later, the
board sat at 2/3 for 3.5 hours and was cancelled) and 1 is this board.

## Why and how it broke

- `fn_spin_book_entry` and the legacy `fn_spin_draw_and_settle` were written
  on 2026-09-05/09, when a Spin seat was never given back before the draw:
  gross debits and net paid were the same number, so the gross count was
  correct when written.
- Unregistering from a not-yet-started seat-first game, with a refund, was
  then added (and on 2026-11-22 extended to "SIT N GO, HEADS UP OR SPIN").
  The registration side learnt that "a refunded earlier entry is not a second
  entry" (20261024 migrations) and `fn_spin_draw_and_settle_atomic` proves each
  entry net of refunds, but the Spin **booking** gate was never brought to the
  same rule.
- Nothing exercised the shape: every Spin test seeds three clean buy-ins, and
  no law forbade proving "paid" from debits alone.
- The failure was silent in the money path (a refusal, nothing written) and
  loud only through the alert, and the board stays at 2/3 while the human
  waits.

## Fix (SQL migration `20261124172844_a_spin_seat_counts_a_refunded_entry_as_refunded.sql`)

Both functions are rebuilt from their exact production definitions (md5
`3e861cfd…` and `8f6dc9dd…`), changing only the payment proof:

- a roster player is paid when buy-in debits **less** `refund` /
  `tournament_refund` credits on this tournament equal one buy-in (the
  atomic launch's rule);
- board-wide exactly three identities net non-zero and they total
  `3 * buy_in`;
- **new:** any identity netting anything other than 0 or one buy-in refuses
  the seat (`net_irregular`), so a double charge or an orphan refund is still
  refused on purpose rather than by accident.

The refusal now reports `net_paid_entries`, `net_buyin_total` and
`net_irregular`; nothing parses the old names.

## Checked and left alone

- `fn_spin_draw_and_settle_atomic` already nets refunds per player and
  compares escrow gross to wallet gross (both gross): correct.
- No other function in the database or migrations proves paid from debits
  alone (searched the live catalogue and every migration); no engine code
  repeats the rule.
- The engine fill lane (`fillPartialSeatFirstGame` / `topUpPartialSeatFirst`)
  did the right thing: it kept a human's board on the 12 s cadence and raised
  `seat_first_human_waiting` once a minute. No engine change.

## Pinned by

- `scripts/ci/test-spin-books-net-of-refunds.py` (CI shard 4, real PG17):
  the pinned live definition refuses the re-registered, left-the-board and
  both shapes; after the migration each books exactly once and replays as
  `already_booked`; a double charge and a refund without a charge stay
  refused.
- `tests/a-spin-seat-counts-a-refunded-entry-as-refunded.law.test.ts`: both
  functions net refunds, the law fails on the 2026-09-09 definitions, no
  function's newest definition proves paid from gross debits, and the CI step
  exists.
- `docs/runbooks/spin-unfilled-backlog.md` names the refusal and what
  `net_irregular > 0` means.

## The method (for every future fix)

1. Find what actually refused, at its source (here: the engine log's
   `seat_first_seat_rpc_failed` jsonb, not the alert).
2. Fix the owning code or schema; no cron, watcher, reconciler or retry.
3. Reproduce before / pass after against the real component (here a real
   PostgreSQL cluster running the exact production definition).
4. Go back through the fix: work out why it was right when written and what
   later change made it wrong, then harden that seam (a law over every
   function, not just the one that broke) so the class cannot return.
5. Search for the same shape everywhere else and fix or rule out each one.
