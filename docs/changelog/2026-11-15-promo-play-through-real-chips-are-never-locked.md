# Promo play-through: real chips are never locked

Owner ruling, November 15, 2026: the 4x play-through is on promo chips. This
is the rule that keeps it off a player's own chips, and go-live waits for it.

## The case

A player is given 50 promo chips and loses 40 at the tables. An agent then
sends 100 real chips. The exit trigger compares the wallet with the lock, so
with the lock still at 50 it would hold 40 of the player's real chips.

## The rule

Migration `20261116013806_promo_play_through_never_locks_real_chips.sql` adds
`zz_ca_promo_play_through_real_chips`, a constraint trigger on `chip_ledger`
deferred to commit. When real chips reach a player wallet, the lock shrinks to
what the player still held just before: the wallet before the credit plus the
stacks on live cash seats. The newest grants give up the difference and close
as `spent`.

Real chips arriving: from the club bank, an agent wallet, another player or a
leaderboard round. Not real chips arriving: a table stack or a prize coming
home (winnings stay under the lock), an escrow release, a bank `settlement`,
and promo itself.

While the player is registered or playing in a tournament the lock is left as
it is, because that entry may still pay the promo back.

## Install

`@install-window: daily-maintenance`. Refuses to install without phase 1.

## Proof

`scripts/ci/test-promo-play-through.py`: seven new checks, 50 in all.
