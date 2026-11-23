# The promo a refund took goes back to the two members

Companion to `2026-11-22-a-refunded-entry-keeps-its-promo-with-the-player.md`,
which corrects the rule. This is the settlement of what the rule had already
taken, decided under CLAUDE.md 10.9.

## Who and how much

| Member      | Taken | Receipts | Paid in error to              |
| ----------- | ----- | -------- | ----------------------------- |
| twin2983    | 5.25  | 9        | Midway Union promo wallet     |
| Cubsfan1369 | 10.00 | 2        | twin2983's agent promo wallet |

Both were unregistered from Satellite Into Nightly 20K (event `0be6a4b5`) on
2026-11-22 at 22:11 UTC, a nine-seat Sit & Go that never filled. Each refund
credited the full 10.00 entry and then paid the promo part of it back to its
fund. Neither played a hand. These eleven receipts are every principal return
receipt the platform has written.

## Treatment

Migration `20261123002808` gives each member the same amount back as promo,
from the same fund that received it, through the credit door: one declared
journal leg per member, fund to wallet. The grant recorder opens one new grant
per member under the ordinary 4x play-through and 30-day expiry (5.25 with a
21.00 target; 10.00 with a 40.00 target).

The eight original grants that closed as "returned" stay closed, because a
closed grant is terminal. No receipt is deleted and nothing settled is
rewritten. Each credit has its own idempotency key and the block refuses if
either already exists. Nothing is taken from a player.

One difference from "exactly as before": the returned promo carries a fresh
30-day clock and a fresh target on the returned amount, not the remaining
progress of the closed grants. That is the nearest lawful equivalent.

## Proof before the write

The block ran on production inside a self-aborting DO on 2026-11-23 00:31 UTC
and answered `PROBE OK (rolled back): 2 members, 15.25 returned`, with every
assertion and every deferred guard passing. The earlier statement-level probe
showed wallets 6.95 to 12.20 and 14.00 to 24.00, the union promo wallet down
5.25 and the agent promo wallet 35.00 to 25.00.

## Record

Two `ca_manual_adjustments` rows settled under the migration's name, and two
resolved `financial_alerts` rows (source `promo_refund_make_good`) carrying
the before and after balances, the journal leg and the new grant.
