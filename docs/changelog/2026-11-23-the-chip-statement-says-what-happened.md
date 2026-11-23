# The chip statement says what happened

## What a player read

On November 22 a member's "Your Chip Statement" showed nine lines reading
"Reversal, To The Union (Union Promo Wallet)" under one "Refund, From A Prize
Pool". She told the owner all of her Diamond Spins prizes had been reversed.
Nothing had been reversed: an event she entered was refunded, and the promo
part of her entry went back to the fund that sponsored it (that rule is
corrected in `20261123000232` and her 5.25 was returned by `20261123024924`).
The statement printed the journal's category and storage names where a
sentence was owed.

## What the rows carry (read from production by id)

- The promo return legs: category `reversal`, player wallet to
  `union_wallets.promo_wallet` (or `agents.promo_wallet_balance`), description
  `Promo Principal Returned To Original Fund` on every one. The reason
  (`returned`, `fee_refund`, expiry, leaving the club) is only on the private
  receipt, not on the leg.
- The refund: category `refund`, from `prize_liability`, `tournament_id` set,
  description an audit string. No event name.
- The 5.25 give-back: category `promo` from `union_wallets.promo_wallet`. Its
  journal description is the audit string, so the statement cannot tell it
  from any other promo credit; it reads "Promo Chips, From The Union (Union
  Promo Wallet)", which is true.

## What changed (client only, text only)

`statementLegCopy` in `src/components/wallet/ChipStatement.tsx` now writes
both lines of a statement row:

| Leg                      | Before                                       | Now                                                         |
| ------------------------ | -------------------------------------------- | ----------------------------------------------------------- |
| Promo return, out        | Reversal / To The Union (Union Promo Wallet) | Promo Chips Returned To Sponsor / To The Union Promo Wallet |
| Refund from a prize pool | Refund / From A Prize Pool                   | Tournament Refund / From Satellite Into Nightly 20K (NLH)   |
| Entry or prize           | Tournament Entry / To A Prize Pool           | Tournament Entry / To Satellite Into Nightly 20K (NLH)      |

The event name is one read of `tournaments (id, name)` per page for the
prize-pool legs shown. If it cannot be read the line keeps "A Prize Pool".
Any other `reversal`, and any category nobody has mapped, prints exactly as
before.

## Decided not to do

- **No grouping.** The statement has no collapse pattern and its footer
  promises "Every Line Is A Journal Leg; Nothing Is Summarised Away". Nine
  lines stay nine lines; they now say what they are.
- **No reason on the line.** The leg does not carry it, and a statement does
  not guess. Carrying it would mean changing the description the promo return
  writer stamps, in a money function.
- **No refund notice with the promo share.** A refund writes no notification
  today and the promo share lives in `ca_promo_refund_restore_receipts`, which
  is private to `service_role`. It needs a definer function or a notification
  written inside the refund transaction; that is server work of its own.

## Proof

`tests/unit/ChipStatement.test.tsx`, "a line says what happened in a player's
words": fixtures copied from the production rows, the three sponsor wallets,
other reversals unchanged, unknown and malformed legs, the rendered rows, and
a failed name read. Verified by unit test only; no headless render was taken.
