# A bounty-only PKO always finishes (2026-11-05)

## What was stuck

Midday Free Buy (NLH) 39b5fa14, a Free Buy PKO with an ordinary prize pool of
exactly 0 and a bounty pool of 323.00, reached its last player at 21:17Z and
stayed RUNNING. The 3-minute tournament watch reported it as STUCK FINISH.

## Cause

The terminal guard `fn_complete_tournament_terminal_pre_seat_guard` requires
a place-1 winner line from the cash authority `fn_settle_tournament_places`.
With an empty place ladder and a zero pool, the cash authority returned
`payouts: []`, so the guard refused the result as partial on every attempt.

## Fix (root)

#9570 lets an empty ladder settle; #9580 makes the cash authority return the
zero-dollar place-1 winner line. No money moves for that line and no
`tournament_payouts` row is written.

## Hardening (this change)

`tests/a-bounty-only-pko-always-finishes.law.test.ts` pins the contract for
every format that can have a zero ordinary pool: both migrations stay on
main, the zero line is returned only for an empty ladder and a zero pool,
the migration moves no money, and no later migration may rewrite the cash
authority or the terminal guard without the zero-pool branch.
