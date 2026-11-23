# A rebuy's capacity check never upgrades its tournament lock (2026-11-23)

## What happened

At 05:18:06.555 UTC on 2026-11-23 a tournament hand commit and a rebuy
deadlocked. Postgres cancelled the hand commit
(`fn_ca_commit_hand_submission` -> `fn_ca_commit_hand_settlement` line 337 ->
`fn_ca_commit_hand_settlement_exact_before_obligations` line 96). It retried
and committed 300 ms later. The rebuy (`process_tournament_rebuy`) went
through. It was a seatless re-entry of a horse in tournament `a915f2e3`, whose
knockout candidate was committed `rebought` at 05:18:06.577. Its candidate
table, `0753917c`, was the table the hand belonged to.

PR #11476 (alert 445924) diagnosed the same cycle on 2026-11-19 and reports
nine of them that night. It never merged. The live function was still that
PR's pre-image (md5 `a539fd43bb2992f8d75253f2d7a4dd7c`).

## Cause, by line

Both sides take the same two rows in the same order, tournament then table.
The cycle comes from a lock **upgrade** on the tournament row:

| step | hand commit                                                   | rebuy                                                                                                                                                                      |
| ---- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | tournament row `FOR KEY SHARE` (lines 84-87)                  | tournament row `FOR NO KEY UPDATE` (`fn_ca_lock_tournament_rebuy_acquisition` lines 57-59)                                                                                 |
| 2    |                                                               | candidate table `FOR UPDATE` (lines 64-68)                                                                                                                                 |
| 3    | its table `FOR UPDATE` (lines 96-99): **waits for the rebuy** |                                                                                                                                                                            |
| 4    |                                                               | `fn_ca_choose_tournament_seat_locked` line 15 -> `fn_ensure_late_registration_capacity(t, 0)` lines 30-32: tournament row `FOR UPDATE`, **waits for the hand's KEY SHARE** |

`FOR NO KEY UPDATE` and `FOR KEY SHARE` are compatible. `FOR UPDATE` is the
one row lock that conflicts with `FOR KEY SHARE`, so step 4 waited for a lock
held by a transaction that was itself waiting for the rebuy.

The seat-update trigger `zz_note_human_seat_seen` is not in this cycle: the
player was a horse, and the wait is on the tournament row, not a table write.

## The change

`20261123052751` changes one token of `fn_ensure_late_registration_capacity`:
`FOR UPDATE` on the tournament row becomes `FOR NO KEY UPDATE`. That is the
mode every caller's lane root already holds, so no caller upgrades. The edit
is anchored on the live text and must match exactly once. It is byte-for-byte
the edit #11476 proposed, so the post-image md5 is
`c142f16547e8cde3ba10338c2bf6e6e4`, which #11476's own migration treats as
already installed.

**Why FOR UPDATE bought nothing here.** The function never deletes a
tournament and never changes a key column of one. It reads the row and
inserts tables, receipts and a wake. `NO KEY UPDATE` still conflicts with
`NO KEY UPDATE`, so two capacity checks still serialise, as does every lane
root that takes the row `NO KEY UPDATE` or `FOR UPDATE`.

**Why no outcome changes.** The only transactions it no longer waits for are
`FOR KEY SHARE` holders: hand commits and hand restores. They write their
table's seats atomically and read nothing the capacity check writes. Not
waiting for one gives the result the capacity check would get running just
before that hand began, an order that already happens whenever the hand starts
a moment later.

Every path that creates a tournament table or seats a tournament player
either takes the tournament row `NO KEY UPDATE` or stronger
(`fn_move_tournament_player`, `fn_seat_stage_entitlement`, the rebuy and
registration roots, the seat-first creators), or runs this same check itself
(`fn_seat_late_registrant_before_maintenance_gate`). No amount, chip count,
payment, seating rule or finishing place is touched, and nothing reads
`is_horse`.

## Proof

`scripts/dev/prove-a-rebuy-capacity-check-never-upgrades-its-tournament-lock.sh`
runs on a throwaway PostgreSQL 16. It loads production's text for the capacity
function (md5 checked) and replays 05:18:06 with each side's lock statements
copied from the live bodies. Then it runs the migration file itself and
replays again.

| case                                 | before                                                         | after                      |
| ------------------------------------ | -------------------------------------------------------------- | -------------------------- |
| rebuy root + capacity vs hand commit | deadlock (`while locking tuple ... in relation "tournaments"`) | both commit                |
| two capacity checks                  | second waits (lock timeout at 500 ms)                          | second still waits         |
| answer, 0 / 1 / 12 unseated entries  | sufficient / one table / one table, deficit 3                  | identical, field for field |

Law: `tests/a-rebuy-capacity-check-never-upgrades-its-tournament-lock.law.test.ts`.
