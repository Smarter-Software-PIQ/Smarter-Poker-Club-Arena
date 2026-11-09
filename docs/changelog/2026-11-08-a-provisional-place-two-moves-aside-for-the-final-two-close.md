# A provisional place 2 moves aside for the final-two close (2026-11-08)

Owner rule 2026-11-05: a bounty-only PKO (Free Buy) ends with two players left,
and both keep the bounty on their own head. `ca_bounty_only_final_two` still held
zero rows on 2026-11-08: the close had never succeeded in production.

## Why it still failed after #9876

Engine release `391f7bc0` (#9876) reached the close in time. The database
authority then answered `finishing_place_two_is_held` (20261107130652) on every
try, because place 2 was held by an earlier bust and no retry could clear it.
Places stamped at bust are provisional. The elimination ladder runs low while
late registration grows the field, and the terminal finish re-ranks every bust by
time. So the true third or fourth finisher can hold place 2 until the event ends.
`tournament_bounty_obligations.position` shows the place stamped at each bust:

- **Midnight Free Buy (NLH) `7f473b6a`, 2026-11-08.** reedivorson, the true
  third, was stamped place 2 at his 11:23:21 bust. The close was refused 10 times
  in 62 s and gave up at 11:32:33. The event played heads up and the winner took
  both final heads.
- **Midday Free Buy (NLH) `72e9b116`, 2026-11-07.** kaneeverly, the true fourth,
  was stamped place 2 at her 20:54:07 bust. The close was refused at 20:55:07.

## The fix

`20261108193616_a_provisional_place_two_moves_aside_for_the_final_two_close`
replaces `fn_ca_bounty_only_pko_final_two` in place. It is guarded on the live
production body (md5 `37f5f201b9c12d82e78e22203c4310a1`). Before the runner-up is
stamped at place 2, any other entrant who holds place 2 moves to the lowest free
place at 3 or above, and the receipt records the move. A bounty-only PKO pays no
place, so moving a provisional place moves no money. The terminal finish re-ranks
every bust by time, so final standings are unchanged. Everything else is
byte-identical to the live body.

This is a database-only change. The engine's park at the two-left hand edge
(#9876) is already serving. The engine still treats the old refusal as transient,
so a rollback stays safe.

No payment is in this change. The six runners-up already paid by #9872 are not
touched. The runners-up of `7f473b6a` and `72e9b116` are reconciled separately
for the owner's decision.

Proof: `scripts/ci/test-final-two-close-held-place-two.py` runs this file on
native PostgreSQL 17 under a faithful copy of the live collision trigger.
Pinned in `tests/a-bounty-only-pko-ends-with-two-players.law.test.ts`.
