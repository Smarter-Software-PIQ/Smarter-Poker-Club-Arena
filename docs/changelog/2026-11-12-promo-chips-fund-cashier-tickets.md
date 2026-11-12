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
