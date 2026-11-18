# Promo play-through, phase 2 of 5: the promo chip's ledger row records its grant

Owner ruling, November 15, 2026: the 4x play-through applies "globally for all
promo chips sent out and received" by any player or agent.

## What this adds

Migration `20261115225224_promo_play_through_records_a_grant_at_the_promo_ledger_row.sql`
puts one trigger, `zz_ca_promo_play_through_grant`, on `chip_ledger`. A row
from a promo wallet (a club or agent promo wallet, or the union's promo
wallet) to a player wallet records a grant in the same transaction that
credits the chips.

It is attached to the ledger row and not to each sending function because
every promo chip already writes that row, whichever door sent it: union
disbursements, club and agent promo sends, and the wheel, crash, plinko,
mines and crossing prizes paid from the union promo wallet. Measured over 14
days on production, 4,827 such rows: every one carried its club, named a club
member, was posted and was positive.

Not a gift, so not recorded: `settlement` (a prize shortfall paid from promo
is winnings), `reversal`, `refund`, `correction`, `adjustment`.

## Install

The trigger needs a lock on `chip_ledger`, which every hand writes, so the
file carries `@install-window: daily-maintenance` and installs in the 04:00
America/Chicago break. Until go-live (`enforced_from` is NULL) it reads one
settings row and records nothing.

## Still to come in this phase

Promo sent to an agent wallet, the value of a ticket paid for with promo
chips (locked against that event's winnings), and one sign-up promo per device
and phone number.

## Proof

`scripts/ci/test-promo-play-through.py` now applies both migrations and adds
five checks for the trigger (27 in all).
