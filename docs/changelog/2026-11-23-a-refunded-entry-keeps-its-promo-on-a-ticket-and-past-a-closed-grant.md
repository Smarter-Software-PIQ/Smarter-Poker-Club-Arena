# A refunded entry keeps its promo on a ticket and past a closed grant

## Where the first fix stopped

`20261123000232` (November 22) made a refunded tournament entry keep its promo
with the member, but only when the refund was paid to the wallet and the promo
grant was still open. Its changelog named three places it left alone. Each
still sent the promo to the fund it first came from. This change decides all
three under the same rule: the promo terms end a grant when its chips are lost
or after 30 days, and a refunded entry is neither.

No member has been affected by any of these routes. The ticket route has never
run (no receipt, no refund ticket in production), and no refund has yet met a
closed grant since the first fix. No correction is owed.

## 1. A refund paid as a ticket

When an entry bought with a ticket or a satellite seat is refunded, the member
gets a ticket back, not chips. `fn_ca_promo_returned_ticket_principal_fee`
(`20261116214149`) paid the promo part of that entry to the fund and cut the
ticket's value by the same amount, so a 20 chip entry that was half promo came
back as a 10 chip ticket.

Now the ticket keeps its full value. The promo stays on the member's original
grant and is held on the ticket: it is still locked, it follows the ticket
into the next event, and that event's entry fee takes its promo share exactly
as any entry does.

## 2. A grant that closed before the refund

The first fix paid the fund whenever the grant was closed, whatever closed it.
A grant closes for five reasons, and they are not alike:

| Why it closed                                                                     | What the refund does now             | Why                                         |
| --------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------- |
| Play-through finished (`met`) or released by support (`override`)                 | Stays with the member, unlocked      | Those chips were already the member's own   |
| The entry itself used it up (`spent`), still inside its 30 days                   | Locked again under a successor grant | The refund undoes the entry that used it up |
| Expired, member left the club, already returned, or `spent` with its 30 days over | Paid to the fund, as before          | The promo terms ended the grant             |

The `spent` row is the one that would have happened soon. An entry fee takes
its promo share from the oldest grant first, and wheel and arcade prizes are
small: a 0.13 chip prize is used up entirely by the fee of the first entry it
helps pay for, and closes as spent. If that event then never runs, the refund
used to pay those 0.13 chips from the wallet to the promo fund. That is the
November 22 incident again, one small grant at a time.

A closed grant is never reopened. The successor is a new grant row for the
refunded amount with the same member, club, fund, multiplier and the original
expiry date, so the 30 days do not start again. It moves no chips: the refund
already put them in the wallet (or on the ticket), and the successor only
locks them. It is written without reading the member's fee history, the same
way the Free Buy funding writes its grants, because a refund never settles a
member's play-through.

## 3. A refund paid into another club's wallet

Unchanged, on purpose. A grant and its lock belong to one club, so a wallet in
a different club cannot carry it; that promo still returns to its fund.
Production has never held such a case: all 41 promo event lots read on
November 23 were charged and refundable in the grant's own club, and no member
holds open grants in two clubs.

## Everything else that could pay a promo fund

Only two functions in the database credit a promo fund from a member's grant:
`fn_ca_promo_return_principal` and the ticket owner above. The first is called
by four owners: expiry, leaving the club, and the two refund owners already
covered. No cash-table function calls either one. Promo at a table or in a
pending add-on moves back to the wallet under its grant through the ordinary
custody mover, so a closed table, a refunded add-on or a cash-out cannot send
promo to a fund. Free Buy coupon funding still returns to the union on
unregister under the owner's November 5 ruling.

## The record

Each kept case writes one row in `ca_promo_refund_keep_receipts` naming the
grant, the entitlement, the refund credit or ticket, the treatment, and the
successor grant when there is one. The open-grant wallet restore keeps writing
`ca_promo_refund_restore_receipts`. A fund receipt already written replays
exactly as before.

## Proof

- `scripts/ci/test-promo-principal-returns.py`: six wallet refunds on real
  PostgreSQL 17. Open grant restored (two sizes); finished play-through left
  unlocked with no fund receipt; used-up grant locked again under two
  successors (fee and stake) with the original expiry; a used-up grant whose
  30 days are over and a cross-club wallet still pay the fund, and a failing
  fund journal still takes the credit and tranche with it.
- `scripts/ci/test-promo-ticket-principal-returns.py`: five ticket refunds.
  Finished play-through, open grant and used-up grant each keep a full 20 chip
  ticket and pay no fund, with a fault injected while the receipt is written,
  a replay, and a direct replay of the owner. The open-grant ticket is then
  redeemed into another event and its promo follows it, still locked. A lapsed
  grant and a cross-club ticket keep the original fund return.
- `tests/fixtures/promo-ticket-play-through/refunded-entry-keeps-promo-past-a-used-up-grant.sql`,
  run by `test-promo-tournament-earning-financial.py` on the full principal,
  integrity and profit stack: the wheel-prize case above, ending with all ten
  promo chips locked, only the member's own ten cashable, the fund unchanged,
  and the successor returning to its original fund through the ordinary
  return owner.
- All three changed or new functions are `plpgsql_check` clean in the proof.
- `tests/a-refunded-entry-keeps-its-promo-on-a-ticket-and-past-a-closed-grant.law.test.ts`
  pins the source and the proof wiring.

## Not proven here

The cash-table statement above rests on the function catalogue read from
production, not on a new table-play run. The successor grant sends the member
the ordinary "promo received" notice for its amount; no separate wording was
written for it.
