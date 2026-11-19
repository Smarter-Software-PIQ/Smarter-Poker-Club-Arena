# Bounty rebuys and busts share the event lane (incident 075013fd, lane R2)

Owner rule, Dan 2026-08-30: **"REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE ACTION."**

Migration `20261119011750_bounty_rebuys_and_eliminations_share_the_event_lane.sql`.
It requires `20261118191946` (the shared rebuy lane) and refuses to install
without it.

## What was left after 20261118191946

- **Bounty, PKO and mystery rebuys** still took the event lane T(id) **exclusive**.
  Their old bounty is settled by `fn_ca_settle_bounty_rebuy_generation_v1`, which
  calls several authorities, and each of them takes T(id) exclusive: the
  seat-exit authority, the legacy claim, `fn_collect_bounty`, and mystery
  reserve/pay. Taking T(id) shared and upgrading it mid-flight would deadlock
  with the event's hands.
- **Every bust** took T(id) exclusive, through `fn_eliminate_tournament_player_atomic`
  and `fn_claim_tournament_bounty_elimination`. Every table of the event waited
  while each bust was recorded.

## The fix

The shared change lane (R(id) exclusive, then G and T(id) shared, with a marker
bound to the transaction and proven by `smarter_private.tournament_rebuy_lane_held`)
now covers every change to an event's field: rebuys, re-entries, add-ons and
busts, in every format.

| Function                                                                          | Change                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fn_ca_lock_settlement_lane_for_tournament`                                       | Inside its event's shared change lane, returns at once instead of taking T(id) exclusive, so nested authorities keep only their own row locks                                                              |
| `smarter_private.f06_try_lane`                                                    | Accepts the same proof                                                                                                                                                                                     |
| `process_tournament_rebuy`                                                        | Takes the shared lane in every format; no exclusive lane and no field-wide seat gate remain                                                                                                                |
| `fn_ca_settle_bounty_rebuy_generation_v1`                                         | Locks the tables its claimants sit at now, in id order, before any roster row. A hand writes the knocker's roster row only after its own table row, so the two serialise on that table row and never cross |
| `fn_eliminate_tournament_player_atomic`, `fn_claim_tournament_bounty_elimination` | Take the shared lane, then the busted player's own table row before any of its rows                                                                                                                        |
| doctrine rule 6                                                                   | Names the three callers and the four places that accept the proof                                                                                                                                          |
| `tournament_rebuy_lane_held`                                                      | `EXECUTE` granted to PUBLIC. It only answers a question about the caller's own transaction, and every caller of the lane helper reaches it                                                                 |

### Why a bust needs nothing exclusive

A bust writes only these rows:

- the busted player's roster row, zero-stack chair and table count, all under
  that table's row;
- its own candidate and obligation;
- once the pool is final, at commit, the standings and payouts of players
  already out (`fn_ca_pay_tournament_finishers_now`).

No hand at another table writes any of these rows. R(id) makes busts and rebuys
of one event run one at a time. The engine still assigns finishing places, and
the place-collision guard still checks them.

## Proof

`scripts/ci/test-rebuy-never-pauses-the-tournament.py` passes 88 checks,
including:

- **Before R2:** while a bust or a bounty rebuy is in flight, it holds T(id)
  exclusive, and per-hand calls at other tables wait 1.96 to 1.98 s.
- **After R2:** both hold T(id) shared only, and the same calls finish in
  0.015 to 0.024 s.
- **Races:**
  - A bust against a hand at its own table serialises in both orders.
  - A bounty rebuy against a hand at its knocker's table serialises in both
    orders. In the hand-first order that table is also where the player is
    re-seated (the setup most at risk of deadlock); in the rebuy-first order
    the player was seated at a different table.
- **Chips conserved** after every step: wallets plus prize pool plus bounty
  pool, felt against bought-in supply against roster, and ledger against pool
  plus heads paid.
- **Mixed runs:**
  - 263 transactions: 8 busts, 8 rebuys, plus hands, card writes and moves.
  - 257 transactions: 10 bounty rebuys, plus hands, card writes and moves.
  - Every transaction committed, with **0 deadlocks**.

The bounty collection itself is a stub in the harness, with the lock order and
money moves of a regular collection. `fn_claim_tournament_bounty_elimination`
is pinned by the law test only; it is not run natively.

Law: `tests/bounty-rebuys-and-busts-share-the-event-lane.law.test.ts`.
