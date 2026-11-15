# Promo play-through, phase 3 of 5: the exits refuse locked chips

Owner ruling, November 15, 2026: promo chips cannot "be cashed out or claimed
back by an agent" until their fees are paid, and players "can cash out profit,
but not the free play until the entire requirement is met."

## What this adds

Migration `20261115235049_promo_play_through_refuses_locked_chips_at_the_exits.sql`:

- `zz_ca_promo_play_through_exit`, a constraint trigger on `chip_ledger`
  deferred to commit. When chips leave a player wallet it reads the wallet as
  the transaction leaves it and compares it with what is locked.
  - Refused if it would dip into locked chips: a cash-out request
    (`escrow` / `escrow_hold`), anything to an `agent_wallet` (claim-back or
    send), and a `transfer` to another player. The refusal rolls the whole
    movement back.
  - Allowed, and counted as the promo going home: a claim to the
    `club_treasury` and a reversal to a promo or union wallet. The newest
    grants give up exactly the amount taken.
  - Never touched: table buy-ins, tournament entries, ticket purchases, and
    chips coming off a table.
- `fn_ca_promo_play_through_settle` serialises on the member's own wallet
  row, which every promo send and exit already holds, so every path locks in
  one order.
- `fn_ca_promo_play_through_override(club, member, reason)`: club owner,
  co-owner or admin unlocks a member's promo for a support case; who and why
  are recorded on each grant.

The exits were read from 30 days of production `chip_ledger` rows leaving a
player wallet. Deferring to commit matters because the doors do not agree on
whether the ledger row or the balance is written first.

## Install

`@install-window: daily-maintenance` (it locks `chip_ledger`). It refuses to
install without phase 1. Before go-live no grant exists, so nothing is
refused.

## Not built yet, and required before go-live

- When promo chips have been lost at the tables and real chips arrive later,
  the lock must shrink to what the player still held, so real chips are never
  locked. Until that exists the lock persists in that case.
- Expiry after 30 days returning the promo to its wallet, no commission or
  rakeback on promo play, the chip-dumping hold, leaving a club, agent
  wallets, promo-paid tickets, one sign-up promo per device.

## Proof

`scripts/ci/test-promo-play-through.py` applies all three migrations: 43
checks, including that a refused cash-out moves nothing and that play is never
refused.
