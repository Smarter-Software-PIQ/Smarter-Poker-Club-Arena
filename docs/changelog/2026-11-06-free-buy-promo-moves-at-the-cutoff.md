# A Free Buy's promo chip moves at the cutoff, not at sign-up (2026-11-06)

Migration `20261106195136_a_free_buy_promo_chip_moves_at_cutoff_not_signup`.

## The rule

Dan, 2026-11-05 14:24 CT: issuing a ticket moves no chips; no chips reach the
prize pool until registration and every rebuy and add-on window has closed;
there is no early promo debit. At the cutoff a guaranteed Free Buy is funded
U = max(0, G - C) from the Midway promo wallet so P = max(G, C), and tickets
add nothing. A non-guaranteed Free Buy is funded V = 1 chip per valid
first-entry ticket, so P = V + C. On 2026-11-06 (13:45 CT) he told us to fully
build the list that named this gap.

## What was wrong

Each first entry debited one promo chip at registration, and the doors booked
it into the pools by format:

| Format | Prize pool | Bounty |
| --- | --- | --- |
| regular / aiof | 1 | 0 |
| mystery | 0.50 | 0.50 |
| pko | 0 | 1 |

A guaranteed event then had to send the surplus back at its cutoff. The
2026-11-06 Morning Free Buy (`f4793b0d`) posted 189 promo chips while
registration was open and returned all 189 when players' 351 chips of rebuys
and add-ons passed the 250 guarantee. The final pool was right. But promo money
sat in the pool during the window, and a compensating write undid it
(CLAUDE.md 10.12).

## What changed

- Neither registration door (human or horse) books any prize-pool promo money
  now. A regular or all-in-or-fold entry books nothing. A mystery entry books
  only its 0.50 bounty half.
- `fn_ca_midway_free_buy_promo_head` posts only the bounty part:
  - a PKO still posts its 1-chip head, because that chip is the player's bounty
    and a knockout pays it during the window;
  - a mystery entry posts 0.50.
- The promo head's return path (unregister, cancellation):
  - returns exactly what was posted, reading legacy 1-chip legs from their own
    metadata;
  - restores the ticket even when nothing was posted.
- New `fn_ca_fund_free_buy_at_cutoff_locked` runs inside
  `fn_apply_prize_guarantee`, the single finalization authority. It runs before
  the excess return and the guarantee core, in the same subtransaction. Two
  things call that authority: the entry close (after registration, rebuys and
  add-ons) and every early settlement.
  - Guaranteed regular / aiof: U = `house_due` = max(0, max(0, G - C) - posted).
  - Non-guaranteed regular / aiof: 1 per first entry.
  - Mystery: 0.50 per first entry, less the prize parts legacy legs already
    posted.
  - PKO: nothing.
  - One ledger leg per event, keyed `tourney:<id>:free_buy_cutoff_funding`. It
    is booked with kind `midway_free_buy_promo_head`, so the escrow shadow and
    `fn_ca_guarantee_funding` read it as promo money with no bounty part.
- Events registered before this change keep their legacy legs. Those legs count
  as already posted, and the existing excess return still sends back anything
  above U. Tonight's in-flight Afternoon (aiof 500) and Prime Time (mystery)
  Free Buys, and tomorrow's registering events, therefore reconcile exactly
  once.

## Proof

`scripts/dev/free-buy-cutoff/run.sh` runs the migration on a scratch local
Postgres against exact production copies of every function it amends or reads.
Measured 2026-11-06 on Postgres 16, all PASS:

| Case | P | U |
| --- | --- | --- |
| G 500, 250 tickets, C 160 | 500 | 340 |
| G 500, 250 tickets, C 0 | 500 | 500 |
| G 500, 250 tickets, C 500 | 500 | 0 |
| G 500, 250 tickets, C 650 | 650 | 0 |
| Non-guaranteed, 250 tickets, C 160 | 410 | 250 |
| Non-guaranteed, 250 tickets, C 0 | 250 | 250 |
| Mystery, 250 tickets, C 160 | 285 | 250 (bounty 125) |
| PKO, 250 tickets | 0 | 250 (bounty 250) |
| Legacy aiof, 124 old + 100 new, C 50 | 500 | 450 |
| Legacy regular, 189 old, C 351 (`f4793b0d`) | 351 | 0 |
| Legacy mystery, 143 old + 57 new | 100 | 200 (bounty 100) |

The same run also proved these:

- During every window the prize pool held 0 promo.
- Retries posted exactly once.
- A legacy mystery entry returns 1 when unregistered, and a new mystery entry
  returns 0.50.
- A new regular entry returns no money and gets its ticket back. The returned
  entry no longer counts at the cutoff.
- A started event returns no ticket.
- Non-Midway events are untouched.
- Every promo chip that left the wallet is in a pool.

The law is `tests/a-free-buy-promo-chip-moves-at-the-cutoff.law.test.ts`.
