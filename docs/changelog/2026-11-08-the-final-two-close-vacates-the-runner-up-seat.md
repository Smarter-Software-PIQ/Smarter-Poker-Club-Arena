# The final-two close vacates the runner-up's seat (2026-11-08)

Owner rule 2026-11-05: a bounty-only PKO (Free Buy) ends with two players left,
and both keep the bounty on their own head.

## What failed

Midday Free Buy (NLH) `36fc2465` was the first natural finish after
`20261108193616` (#10076). The engine parked the table at two players
(bhamjeremy and velvet9) and asked `fn_ca_bounty_only_pko_final_two` to close.
Every try rolled back at commit, and after 11 tries in 66 s the engine gave up:

> authority_unreachable: TOURNAMENT_SEAT_ROSTER_REQUIRED: live seat user
> d69e25e8 (velvet9) has no active roster in tournament 36fc2465 at commit

The error comes from `trg_assert_live_tournament_seat_has_roster`, run at commit
by the deferred constraint trigger `tournament_roster_update_cannot_orphan_live_seat`
on `tournament_players`. While an event is REGISTERING or RUNNING, anyone with a
live chair (`table_seats.left_at IS NULL`) must have a roster row that is
`registered` or `playing`. The close marked the runner-up `eliminated` but left
his chair live, so the whole transaction was refused and nothing was paid. The
hand was played out, velvet9 busted at 20:48:49, and the winner took both heads.

## Not caused by #10076

#10076 only moves the provisional place-2 holder's `position`. That column is not
watched by the trigger, and the trigger named the runner-up, not the holder. The
status write that trips it has been in the close since `20261106010426`. No close
had ever reached commit before: earlier tries died on the place-2 collision or
were refused `finishing_place_two_is_held`. #10076 removed that refusal, which
exposed this one.

## The fix

`20261108222325` replaces the function in place. In the same transaction as the
runner-up's roster write it closes his live chair (`left_at`), as the knockout
door does for every other bust, and refreshes that table's `current_players`.
The vacated seat ids go in the receipt. A tournament stack is play money, so no
wallet, ledger leg or balance moves. Everything else is unchanged. Guarded on
the live body (md5 `480b20dc852d4c613dfd39b362ebb4ac`).

Proof: `scripts/ci/test-final-two-close-held-place-two.py` now carries a
byte-exact copy of the live roster trigger and real seats. The old body dies at
commit with `TOURNAMENT_SEAT_ROSTER_REQUIRED`; the new body closes, pays the
runner-up once, and leaves him no live chair.
