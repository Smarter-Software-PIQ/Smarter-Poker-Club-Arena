# The conservation books read where the money actually went (2026-11-05)

## What was wrong

113 `fn_tournament_money_conservation` alerts were open ("Tournament retained
money it never paid out"). Every one of those events balances on its own
`chip_ledger` and its escrow reads 0.00. The detector missed three kinds of leg:

| Cause                                                                                                                               | Events                                            | Read as            |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------ |
| Owner retirement transfer (Nov 2 owner closure): leftover pool moved `prize_liability -> union_bank`, key `owner-retirement-pool:*` | 108 cancelled (71 SNG, 35 satellite, 2 freezeout) | +15,841.40         |
| Owner bounty guarantee correction: 950.00 overlay returned as a `reversal`                                                          | 1 (40 Chip Bounty Freezeout 5K GTD)               | +950.00            |
| Entry-only satellite ticket redeemed into a different event than its target                                                         | 4 (two pairs)                                     | +120/-120, +80/-80 |

## The fix

Migration `20261105130850` adds the same three terms to
`fn_tournament_conservation_delta` and `fn_tournament_conservation_deltas`:
the owner-directed returns leave the pool, an admission leg is credited to the
event it entered, and a ticket with an admission leg is no longer seat income
at its target. The admission leg is found through the indexed ledger timestamp
(`created_at = tournament_tickets.redeemed_at`, true for all 2,081 legs).

Measured before installation: last 10 days, 32,590 events, 113 flagged became
0 and none that balanced changed. All time, 209 events carry a term, 0 remain
flagged.

No money moves. Open alerts that now read inside tolerance are resolved with a
resolution note; anything still outside tolerance stays open.

Pinned by `tests/the-conservation-books-read-where-money-actually-went.law.test.ts`.
