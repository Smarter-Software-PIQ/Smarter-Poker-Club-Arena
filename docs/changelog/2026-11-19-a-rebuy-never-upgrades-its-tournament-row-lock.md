# A rebuy never upgrades its tournament row lock (2026-11-19, alert 445924)

**What happened.** From 23:02 to 23:29 UTC, Postgres raised nine `deadlock detected`
errors, all with the same cycle (tournaments 1b630c53 and ed11d658):

- `process_tournament_rebuy` -> `fn_ca_choose_tournament_seat_locked` ->
  `fn_ensure_late_registration_capacity` asked for `tournaments ... FOR UPDATE`.
- The other side was `fn_ca_commit_hand_submission` -> ... ->
  `fn_ca_settle_hand_stacks_absolute`, which asked for `tournaments ... FOR SHARE`.

Effects:

- `DatabaseDeadlocksElevated` fired (store row 445924).
- The at-bust real-time payout was refused twice (445928, 445931; `financial_alerts`
  768233a8 and 04e68f2d). The terminal settlement pays those places.

**Cause.**

1. The rebuy's seat root (`fn_ca_lock_tournament_rebuy_acquisition`) locks the
   tournament row `FOR NO KEY UPDATE`. That is deliberate, so a hand commit's
   foreign-key checks (`FOR KEY SHARE`) are never paused by a rebuy.
2. A seatless rebuy then reaches the capacity check, which asked for `FOR UPDATE`.
   That is a lock upgrade, and it conflicts with the hand's `FOR KEY SHARE`.
3. The hand meanwhile waits `FOR SHARE` on the rebuy's `NO KEY UPDATE`.

Thirteen production functions take the row `FOR NO KEY UPDATE` before they can reach
this check, so every one of them carried the same trap.

**Fix.** Migration `20261119235115` changes one line:
`fn_ensure_late_registration_capacity` now locks the row `FOR NO KEY UPDATE`.

- It is md5-guarded against the production pre-image `a539fd43`, with live proof
  `c142f165`.
- Capacity checks still serialise against each other.
- The function changes no key column and deletes nothing.

**Proof and gates.**

- Native PG proof: `scripts/ci/test-rebuy-capacity-lock-order.py`, run by
  `.github/workflows/rebuy-capacity-lock-order.yml`.
  - On the exact production pre-image it reproduces 40P01.
  - After the migration, the capacity call does not wait (5.8 ms against 201 ms),
    there is no deadlock, and the serialisation and ACL are preserved.
- Law: `tests/a-capacity-check-never-upgrades-the-tournament-lock.law.test.ts`.

**Detection.** The existing `DatabaseDeadlocksElevated` rule and the
`tournament.real_time_payout_refused` capture both route into
`operational_alert_events` with `target_task_id`.

**Not this family.** Seven deadlocks today on `cash_game_waitlist` inserts against
`fn_cash_clusters_tick_all_uncapped` (`cash_games` `FOR KEY SHARE`) are a separate
cycle and stay open.
