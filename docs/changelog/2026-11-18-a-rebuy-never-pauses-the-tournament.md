# A rebuy never pauses the tournament (incident 075013fd, lane R)

Owner rule, Dan 2026-08-30: **"REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE ACTION."**

Migration `20261118191946_a_rebuy_never_pauses_the_tournament.sql`. Requires lane T
(`20261118160405`, `20261118171613`, PR #11310) installed first; it refuses otherwise.

## What happened

Measured on production 2026-11-18 15:02-15:33 UTC, Morning Free Buy `7004d241`
(61 tables, rebuys and re-entries, no bounty):

- `process_tournament_rebuy` took its event's rolling lane through
  `fn_ca_lock_settlement_lane_for_tournament`: G shared, then
  T(id) = `ca:tournament-terminal-settlement:v1:<id>` **exclusive**, held for the
  whole purchase: 375 ms on average, 28.7 s at most, about 21 rebuys a minute.
- Every per-hand F06 call, card write and hand settlement of the event takes
  T(id) **shared**, so all 61 tables queued behind every rebuy. Fold p90 went to
  5.9-10.7 s.

Reading the bodies showed two more things that would have kept the event still
once the lane was shared, so they are fixed in the same migration:

1. The rebuy called `fn_ca_lock_tournament_seat_acquisition`, which takes the
   exclusive lane itself and then locks **every** table row, roster row and live
   seat of the event `FOR UPDATE`. A hand writer that updates its seats would
   have waited on those row locks instead.
2. The seat root guard (`fn_tournament_live_seat_acquisition_requires_authority`)
   and the F06 source guard (via `f06_try_lane`) accept a chair or roster
   coordinate write only from a holder of T(id) exclusive. Holding T(id)
   shared, a rebuy would have been refused whenever any hand of the event was in
   flight.

## The fix

| Piece                                                                  | What it does                                                                                                                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.fn_ca_share_tournament_lane_for_rebuy(event, player)`          | R(id) = `ca:tournament-rebuy-lane:v1:<id>` exclusive (one purchase of the event at a time), then G and T(id) **shared**, then a transaction-local marker `event:player:txid` |
| `smarter_private.tournament_rebuy_lane_held(event, player)`            | The proof: marker names this event, this player and this transaction, and this backend holds T(id) and R(id) exclusive. A marker alone proves nothing                        |
| `public.fn_ca_lock_tournament_rebuy_acquisition(event, table, player)` | The seat gate's refusals and player keys, the launch receipt and tournament rows, and the candidate's own table row. No field-wide row locks                                 |
| `process_tournament_rebuy`                                             | Rebuys, re-entries and add-ons take the shared lane; a seat takes the scoped root                                                                                            |
| seat root guard                                                        | Accepts a rebuy's own player's chair on the proof plus the destination table row, held already or taken `NOWAIT`                                                             |
| F06 source guard                                                       | Accepts the proof in place of `f06_try_lane` for the rebuy's roster and chair writes; custody checks unchanged                                                               |
| `fn_ca_settlement_lane_doctrine`                                       | Rule 6: only the rebuy takes the shared rebuy lane, it takes T only shared, and both guards accept it only through the proof                                                 |

Exclusive authority stays on balancing moves, breaks, the final table and
terminal settlement. A rebuy and such an authority exclude each other on T(id).
A rebuy and a hand of its destination table serialise on that table's row. Two
rebuys of one event serialise on R(id), which nothing holding G, F, B or T ever
waits for. Lock order: R(id), then lane T's G, F, B, T(id), then rows (launch
receipt, tournament, table, roster, seats).

**Not changed, on purpose: a rebuy or re-entry of a bounty, PKO or mystery
event keeps the rolling lane.** Its prior bounty generation is settled through
`fn_ca_settle_bounty_rebuy_generation_v1`, which opens the event's seat-exit
authority and collects bounty obligations under the exclusive lane. Holding the
lane shared and upgrading mid-flight would deadlock with the event's hands.
Bounty-event rebuys were 0 in the three days before this change (90 rebuy events,
45 bounty events). Making them shared means moving that settlement off the
exclusive authority; it is a separate change.

## Proof

`scripts/ci/test-rebuy-never-pauses-the-tournament.py`, PostgreSQL 16, production
pre-images of the rebuy, the seat gate, the chair chooser, the seat assignment,
the money core and the seat root guard (`scripts/ci/fixtures/rebuy-never-pauses/
preimages.json`) plus lane T's fixture; lane T's two migrations and this one
installed natively. 44 checks:

- Before: a rebuy in flight holds T(id) exclusive; a card write, an F06 share and
  a hand commit on other tables waited 1.97 s each (the length of the hold).
- After: the rebuy holds T(id) `ShareLock` only; the same calls and a card write
  on the rebuy's own table took 0.03 s. Two rebuys serialise on R(id) while a
  hand runs at once.
- Rebuy vs balancing move into the same destination table, both orders: the
  second waits, both land, different chairs.
- Rebuy vs hand settlement on its destination table, both orders: serialised on
  the table row.
- Refused: a chair under T shared only, a forged marker without R, another
  player's rebuy lane, a marker from another transaction, the proof without the
  destination table row (`NOWAIT`, 0.02 s), the scoped root without the lane, a
  non-rebuy roster move under T shared.
- Chips conserved after every step: wallets + prize pool constant, felt = bought-in
  supply = roster mirrors, ledger debits = pool, no shared chair.
- Mixed run: 349 transactions (20 rebuys, 240 hand commits, 80 card writes, 9
  balancing moves) in 3.4 s, all committed, **0 deadlocks**.

Law: `tests/a-rebuy-never-pauses-the-tournament.law.test.ts`.
