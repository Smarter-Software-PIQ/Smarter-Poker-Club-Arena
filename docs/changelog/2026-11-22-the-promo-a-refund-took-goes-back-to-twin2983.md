# The promo a refund took goes back to twin2983

Replaces `2026-11-22-the-promo-a-refund-took-goes-back-to-the-two-members.md`.
The rule itself is corrected by
`2026-11-22-a-refunded-entry-keeps-its-promo-with-the-player.md`.

## Why the first settlement never ran

Migration `20261123002808` returned promo to two members: twin2983 (5.25) and
Cubsfan1369 (10.00). It was proved on production in a rolled-back transaction
and merged. Between the proof and the merge, twin2983, who is Cubsfan1369's
agent, sent him his 10.00 promo again herself (2026-11-23 00:38:46 UTC,
`promo_send:5c5ee69b`). The refund had put that 10.00 back in her agent promo
wallet; she sent it back out. He was whole and her promo wallet was where it
started (25.00).

Running the file after that would have paid him a second 10.00 out of her
wallet. Its author recorded the version as held in `schema_migrations` at
02:49 UTC, before the installer sent it. None of its statements ran: no
journal leg carries either of its keys. The file now carries
`SUPERSEDED BY 20261123024924`, so the installer refuses it by name.

## What is paid

| Member   | Taken | Receipts | From                      |
| -------- | ----- | -------- | ------------------------- |
| twin2983 | 5.25  | 9        | Midway Union promo wallet |

Migration `20261123024924` credits 5.25 as promo through the credit door: one
declared journal leg, fund to wallet, and one new grant under the ordinary 4x
play-through (21.00 target) and 30-day expiry. Closed grants stay closed and
no receipt is rewritten.

## What stops a repeat of the near miss

The first file checked only its own idempotency keys. This one also refuses
when any promo credit from the same fund reached the member after the refund,
so a make-good cannot land on top of one somebody already made by hand.

## Proof

Probed on production at 02:52 UTC in one self-aborting block: wallet
1.85 to 7.10, union promo wallet 137742.13 to 137736.88, one leg, one locked
grant, eleven original receipts untouched. Rolled back.

## First install refused, nothing applied

At 04:10 UTC the installer refused the file with
`migration_applier_claim_unrecorded` and rolled back. The block forced every
deferred check early, which fired the installer's own claim check before its
history row existed. The file now forces them only in a probe; at install they
run at commit as usual.
