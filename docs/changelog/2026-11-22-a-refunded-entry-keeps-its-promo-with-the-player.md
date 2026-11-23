# A refunded entry keeps its promo with the player

## What a player saw

On November 22 a member sent the owner her chip statement: nine "Reversal"
lines, all stamped the same second, each "To The Union (Union Promo Wallet)".
She believed her Diamond Spins prizes had been taken back.

## What happened

She had entered Satellite Into Nightly 20K (a nine-seat Sit & Go, 9 + 1) with
10 chips, 5.25 of them promo she had won on the wheel, mines and crash games.
The satellite never filled. At 22:11 UTC she and the one other entrant (one of
her own players, whose whole entry was promo from her agent promo wallet) were
unregistered and refunded.

Each refund credited the full 10 chips, and the same transaction then moved
the promo part of the entry out of the wallet again and into the promo fund it
first came from: 5.25 to the Midway Union promo wallet, and 10.00 to the agent
promo wallet. No prize was ever undone; the reversals were the refund's own
"return to promo" leg (`fn_ca_promo_return_refunded_principal`, installed
November 16 in `20261116154719`).

These two members are the only ones it has ever happened to (eleven receipts,
15.25 chips). The leg had never completed on a live refund before, because
wheel and arcade grants name the union wallet by its row id and the return
raised `promo_return_original_fund_missing`; `20261122185915` fixed that
lookup the same afternoon, which is what let the first refund through.

## Why it was wrong

The promo terms a player accepts end a grant in two ways only: its chips are
lost, or 30 days pass. A refunded entry is neither. The rule also had no
ruling behind it for this case. The owner's November 5 refund ruling returns
entries the union paid for (Free Buy coupons) to the union promo fund, and
that still happens. Promo a member already held in their wallet and chose to
spend on an entry is different: taking it on a refund leaves them worse off
than before they registered, for an event that did not run.

## The rule now

A refunded entry puts the member back where they were (`20261123000232`):

- promo principal the refund brings home stays in the wallet under its
  original open grant, with the same target and expiry;
- the promo share of the refunded entry fee, and promo entry stake that had
  been written off as lost before the refund, go back onto that same open
  grant rather than to the fund.

All of it stays locked, so a refund still never turns promo into cashable
chips, and register-then-unregister cannot launder a fee share.

Unchanged on purpose: a grant that has already ended stays ended (a closed
grant is terminal); a refund paid into a different club's wallet than the
grant's club keeps the fund return, because that wallet cannot carry the lock;
Free Buy coupon funding; noncash ticket refunds; and every receipt already
written, which replays exactly as before.

## Proof

- `scripts/ci/test-promo-principal-returns.py`: the exact entry refund now
  ends with wallet 20, fund unchanged, the grant open at its full 10, 10 locked
  in the wallet, no fund receipt and one restore receipt; replay moves nothing.
  The fee matrix keeps open same-club grants whole and leaves closed and
  cross-club cases on the original fund return. A further step returns the
  kept promo through the original return owner.
- `tests/fixtures/promo-ticket-play-through/refunded-entry-keeps-promo.sql`,
  run by `test-promo-tournament-earning-financial.py`: the same refund on the
  full principal, integrity and profit custody stack, with cashable chips
  unchanged at the member's own 10.
- `tests/a-refunded-entry-keeps-its-promo-with-the-player.law.test.ts` pins
  the source and the proof wiring.

## The two members

The chips already taken are returned by a separate correction, recorded with
it. Their closed grants cannot be reopened, so each receives a new promo grant
of the same amount from the same fund.

## Not covered here

A refund of an entry paid with a ticket strips promo value from the reissued
ticket through `fn_ca_promo_returned_ticket_principal_fee`. That path was not
exercised by this incident and is not changed; it needs its own review against
the same rule.
