# Promo Chips Fund Cashier Tickets, And A Ticket Cancel Commits (2026-11-12)

Owner: "IN THE CASHIER, YOU AREN'T ALLOWED TO USE PROMO CHIPS TO SEND A TICKET...
AGENTS SHOULD BE ABLE TO SEND TICKETS TO THEIR DOWNLINES USING PROMO CHIPS (50 MAX)".

## Cause

Send Ticket had one funding account. `fn_issue_tournament_ticket_phase2_core_20260831`
debits `club_members.chip_balance` and nothing else, `fn_cashier_batch_transfer`
ignores `source` on a ticket item, and the dialog printed "From Your Player Wallet"
with no choice.

## Change

Migration `20261112184216_promo_chips_fund_cashier_tickets_and_cancel_returns_escrow`:

- `fn_cashier_promo_ticket_send(club, holder, value, retry key)`: debits the sender's
  own promo wallet into the ticket escrow (autoledger leg `promo_wallet -> escrow`,
  `ticket_issue`) and issues the same value ticket the player wallet door issues.
  Its receipt is a `promo_wallet_send` row with destination `tournament_ticket`, so
  the allowance installed on November 11 (50 chips per downline from all agents in
  any 7 days) counts promo sends and promo tickets as one total in both doors.
  Staff are not capped, as with promo sends. Registered in `ca_money_rpc_registry`.
- `fn_cancel_tournament_ticket`: a cancelled promo ticket returns to the issuer's
  promo wallet, so a ticket cannot convert promo chips into cashable chips.

Client: Send Ticket has a "Send Ticket From" selector (Player Wallet or Promo
Wallet), checks the chosen balance, shows the 50 chip rule for agents, and sends
promo tickets through the new door with the retry key the batch used.

## Landing Order

The first apply of this migration was refused whole and wrote nothing: #10622
(`20261112184950`) landed minutes earlier and changed the cancel door's release
category from `escrow_release` to `refund`, so this file's preimage guard did
not match. The file now patches that installed body (md5
`e52d94e64fe64cc1508885a541450c71`) and leaves its category alone.

## Verification Before Merge

- Rolled back production probe of the money section: promo 500.00 -> 495.00, one
  leg `promo_wallet -> escrow` (`ticket_issue`), tally balanced for both stores.
- The five cancel patch needles matched the live definition (read only dry run).
- The migration applied on PostgreSQL 16 against the captured live preimage.

## Follow-Up, Same Day

Migration `20261112204754_promo_tickets_batch_allowance_receipts_and_redeem_names_its_`:

- `fn_cashier_promo_allowance`: the dialog shows what each selected downline can
  still receive of the 50, and Send Ticket disables values above it.
- `fn_cashier_promo_ticket_batch`: up to 25 promo tickets in one round trip.
- `fn_cashier_promo_ticket_receipts`: uncertain-outcome recovery finds a promo
  ticket by its retry key.
- `fn_redeem_tournament_ticket` finds a promo ticket's issue receipt, so the
  redeem leg names the ticket.
- History reads "Promo Wallet To Tournament Ticket".
- `scripts/ci/test-promo-ticket-postgres.py`: the doors run on real PostgreSQL.

## Review Fixes, Same Day

Found by a line by line review of the shipped feature:

- Send Ticket never loaded the promo balance itself (it read "Unavailable" unless
  Send Out had been opened first) and did not read it again after a send or a
  cancel. It now loads on open and after every ticket batch and cancel.
- The chosen source carried over into later dialogs and other clubs. It resets
  with the dialog, the club and a completed transfer.
- Promo Wallet is not offered when the sender is among the recipients.
- The allowance preview is read again after every attempt, a value above it is
  cleared instead of staying selected, and a failed read says so.
- The success toast names the Promo Wallet.
- Migration `20261112235138`: a replayed cancel returns `refund_wallet` from its
  receipt, and an issuer without a promo wallet row is told that.

Left as is: a cancelled promo ticket still counts toward the downline's 50 for
the window, the same gross rule the owner set for promo sends on November 11.

## Report Readers

Found by audit: promo given as a ticket was missing from every promo total,
because the readers looked for promo by ledger category (`promo_send`, `promo`)
and a promo ticket journals as `ticket_issue`, promo wallet to escrow.
Migration `20261113010721` patches four readers from their live definitions:

- `fn_ca_weekly_revenue_digest`: Player Promo And Leaderboard counts the leg.
- `fn_sp_daily_metrics_compute`: `promo_and_leaderboard` counts the leg.
- `fn_sp_digest_spins_spend`: the daily promo spend list carries the leg and
  names the ticket holder as its recipient.
- `fn_cashier_statement_rows`: the Ticket wallet filter also returns a promo
  ticket receipt. The receipt keeps wallet `promo`, so the Promo filter still
  shows it and no existing row changes.

The digests count promo gross, so a cancelled promo ticket is counted gross
too, the same as a promo send that is later claimed back. Proved on PostgreSQL
16 against the byte exact live definitions: a 30 promo send, a 20 promo ticket
and a cancelled 10 promo ticket read 30.00 before and 60.00 after in both
digests, and an ordinary 40 player wallet ticket reads the same before and
after everywhere.

Left as is: the refund leg of a cancelled ticket (escrow to promo wallet)
still lists under the statement's Cashout wallet, as every escrow leg does.

## Final Polish

Migration `20261113021529` patches two functions from their live definitions:

- `fn_cashier_promo_ticket_send` writes the ticket note `Promo Cashier Ticket`.
  The Tickets tab shows such a ticket as "Promo", and its issuer sees "Cancel
  Returns To Your Promo Wallet" on the row and on the Cancel button's name.
  Nothing reads a ticket row's note on the server; the browser recovery
  envelope keeps `Cashier Ticket`, which `fn_cashier_browser_recovery_valid`
  validates. Production held no promo ticket when this was written, so no
  earlier ticket carries the old note.
- `fn_cashier_statement_rows` files a `refund` ledger leg on the ticket escrow
  under the Ticket wallet filter, no longer under Cashout. Only the cancel door
  and the closed entry ticket issuer return declare that leg, and production
  held none, so no existing statement row moves. This closes the item left as
  is under Report Readers.

Client: with several players selected and an agent sending from the Promo
Wallet, Send Ticket and Send Out name each player the allowance holds back
with their remaining figure, five names at most and then "And N More".

Proved on PostgreSQL 16 against the byte exact live definitions and the
statement baseline fixture: 240 viewer and filter combinations return the same
rows before and after, two added ticket refund legs move from Cashout to
Ticket, totals equal their own page, and a second run is refused.
