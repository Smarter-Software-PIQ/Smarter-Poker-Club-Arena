# A bounty rebuy never pauses the tournament, and never crosses a hand (2026-11-19, lane B7)

Incident 075013fd. Owner rules: "REBUYS IN A TOURNAMENT SHOULD NOT PAUSE THE
ACTION" (Dan, 2026-08-30); a tournament issue never affects another
tournament or a cash game (Dan, 2026-11-17).

Migration `20261119013430_a_bounty_rebuy_never_pauses_the_tournament`, on top
of lane R2 (`20261119011750`, which moved bounty rebuys and busts onto the
shared event lane). Native proof: section B7 of
`scripts/ci/test-rebuy-never-pauses-the-tournament.py`; law:
`tests/a-bounty-rebuy-never-crosses-a-hand.law.test.ts`.

## What R2 left

Lane B3 measured on the Midday Free Buy (eb0c2d80, 18:30-19:30 UTC) that all
418 rebuys created their bounty obligation inside the rebuy: the rebuy of a
still-open generation runs the bust claim
(`fn_claim_bounty_legacy_candidate_20260907`). R2's harness stubbed that claim
and the seat-first sync, and its hand-commit stand-in took neither the
tournament row nor the `atomic-table:` key, so three things were not seen:

1. **The `atomic-table:` key crossed a hand commit.** Production's hand commit
   order is G and T(id) shared, lease KEY SHARE, tournament row FOR SHARE
   (`fn_ca_commit_hand_settlement_exact_before_obligations` l.89), table row
   FOR UPDATE (l.101), `atomic-table:<table>`
   (`fn_ca_commit_hand_settlement_before_lease_generation` l.70), then roster
   rows (l.106-113). The rebuy took `atomic-table:<candidate table>` first and
   the tournament row after it (in its seat root). On a shared lane they run
   together: the hand holds the row and waits for the key, the rebuy holds the
   key and waits for the row. The candidate's table is the busted player's own
   table, which is still dealing. Native proof before the fix: 1 deadlock, and
   the victim was the hand. The add-on path had the same order.
2. **The bust claim locked the whole field.** `fn_sync_seat_first_player_count`
   locks every table row and every live seat of the event FOR UPDATE before it
   checks seat-first, then rewrites one table's count. Inside a rebuy that is
   held to commit. Native proof before the fix: an F06 hand begin at another
   table waited 1.91 s behind a held rebuy.
3. **Nothing bounded the settle's lock waits.**

## The fix

1. `process_tournament_rebuy` takes `atomic-table:` after its seat root (which
   locks the tournament row, then the candidate's table row) and, for an
   add-on, after its tournament row: the hand's own order.
2. `fn_sync_seat_first_player_count` returns before its field-wide lock inside
   the event's change lane (`smarter_private.tournament_rebuy_lane_held`) on an
   event that is neither seat-first nor a spin. The claim PERFORMs it and has
   already written its own table's count; the rebuy proves its final table's
   count. Seat-first events and callers outside the lane are unchanged. This
   also covers R2's bust doors.
3. The bounty settle runs under `lock_timeout = 500ms` (below
   `deadlock_timeout`, 1 s). A refused wait raises the existing retryable
   `55P03 TOURNAMENT_PURCHASE_PLAYER_BUSY` and nothing is written. The engine's
   horse rebuy retries it in place up to 3 times (150/300/450 ms) inside the
   decision window (`isTournamentPurchasePlayerBusy`,
   `server/src/tournament/TournamentManagerEliminations.ts`); before this it
   only re-drove on the next sweep, 5 s later.

## Lock audit (production bodies, read 2026-11-19, read only)

| Transaction                                                                                             | Order of locks                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hand commit (`fn_ca_commit_hand_submission` -> `fn_ca_commit_hand_settlement`)                          | G S, T(id) S (+ club key S), lease KEY SHARE, **tournaments FOR SHARE**, table FOR UPDATE, `atomic-table:` X, `atomic-hand:` X, hand_atomic_commits row, roster rows of the table (by user), seats                                                                                                                                                                                                                                                                   |
| Retain (`fn_ca_retain_hand_submission`)                                                                 | T(id) S, `f06:hand:` try, lease KEY SHARE, **tournaments FOR SHARE**, table FOR UPDATE                                                                                                                                                                                                                                                                                                                                                                               |
| `fn_f06_begin_hand` / `fn_f06_finish_hand` (accepted) / `fn_f06_retain_hand_continuation`               | (maintenance lane), G S, T(id) S, table FOR UPDATE, its seats FOR UPDATE, permit rows. No tournament, roster or wallet row                                                                                                                                                                                                                                                                                                                                           |
| `insert_hole_cards`, `save_hand_state_snapshot`                                                         | T(id) S (4 s bound), per-table keys; FK KEY SHARE on the table row                                                                                                                                                                                                                                                                                                                                                                                                   |
| `fn_ca_process_hand_post_commit_obligations`, `fn_project_hand_side_effects`                            | T(id) S, per-table try-loops (250 ms / 1 s), rows with 1 s lock_timeout. Tournament hands carry only time banks (3,000 of 3,000 sampled, 6 h)                                                                                                                                                                                                                                                                                                                        |
| Bust doors after R2 (`fn_claim_tournament_bounty_elimination`, `fn_eliminate_tournament_player_atomic`) | R(id) X, G S, T(id) S, tournaments FOR UPDATE, the busted player's table, roster, candidates, seats; then the claim (sync: field-wide before this fix)                                                                                                                                                                                                                                                                                                               |
| `fn_collect_bounty_obligation` from the engine                                                          | proofs (try-lock), then the lane (T(id) X outside a change lane), tournaments, obligation, watermark, rosters, wallets                                                                                                                                                                                                                                                                                                                                               |
| Rebuy, after this fix                                                                                   | R(id) X, G S, T(id) S, 530090/530093 S, player keys (try), profile (NOWAIT), launch receipt, **tournaments FOR UPDATE**, candidate table FOR UPDATE, **`atomic-table:` X**, rebuyer roster, candidates; settle (500 ms bound): claimant tables (R2), obligation, seat-exit authority, claim (no field-wide sync), collect/mystery (lane held), knocker rosters, wallets, tournaments UPDATE; money core (rebuyer wallet, tournament, roster); chosen table and chair |

B3's question, can a hand at the knocker's table hold the knocker's roster or
wallet row and then want the tournament row while the rebuy holds the row and
wants the knocker's? **No**: a hand commit takes the tournament row FOR SHARE
before its table, key and roster rows, and tournament hands write no wallet
row. While the rebuy holds the tournament row no hand commit of the event can
hold a roster row. The cycle that did exist was the key (item 1).

## Measured (native PostgreSQL 16, production pre-images md5-pinned, 118 checks)

- Before B7: F06 hand begin at another table behind a still-open bounty rebuy
  1.908 s; hand commit of its own table vs rebuy: 1 deadlock, hand aborted.
- After B7: F06 begin 0.015 s, card write 0.016 s; hand-first and rebuy-first
  races serialise with 0 deadlocks; an unheld still-open bounty rebuy 0.05 s;
  a settle blocked on a wallet row aborts in 0.53 s with 55P03, writes nothing,
  and the retry commits once.
- Mixed run: 12 still-open bounty rebuys beside 150 production-order hand
  commits, 50 F06 begins, 50 card writes: 262 transactions, 0 deadlocks, 0
  failures, hand commit p100 0.208 s; every old head paid once, every player
  re-seated, chips conserved (wallets + pool, felt = supply = roster,
  ledger = pool).

## What remains

The rebuy holds the tournament row FOR UPDATE from its seat root to commit
(its money core and the bounty payout write it), and every hand commit and
retain takes that row FOR SHARE first, so a table's commit can wait out the
rest of one rebuy (the settle is about 0.33-0.42 s after lane B1). Begins,
finishes, continuations, cards, snapshots, post-commit and projection do not
wait. Removing that needs the hand commit's tournament lock to become FOR KEY
SHARE (an UPDATE of the row then no longer conflicts), which changes what a
hand excludes and is a separate change.

Human rebuys from the SPA surface 55P03 to the player, who clicks again (same
token, idempotent); only the engine path retries in place.
