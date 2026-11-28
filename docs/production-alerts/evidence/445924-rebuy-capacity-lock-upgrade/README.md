# Evidence: alert 445924 (rebuy/hand-commit deadlock on the tournament row)

Everything below was read-only against production on 2026-11-19 between 23:45 and 23:55 UTC.

**Store rows**

- 445924 (firing) and 445953 (resolved): `DatabaseDeadlocksElevated`, 12 deadlocks in 10 minutes, startsAt 22:58:59Z.
- 445928 and 445931: `tournament.real_time_payout_refused`, sqlstate 40P01.

**Postgres log (`postgres_logs`, `event_message = 'deadlock detected'`, 20:00-23:55Z)**

16 errors in two families:

- **9 rebuy errors**, 23:02:06 to 23:28:58. Every one has the context `fn_ensure_late_registration_capacity` line 29 `FOR UPDATE`, reached from `fn_ca_choose_tournament_seat_locked` and `process_tournament_rebuy` line 599. The other process is always `fn_ca_commit_hand_submission`, waiting at `fn_ca_settle_hand_stacks_absolute` line 209 `FOR SHARE` on tuple (199253,1) held by the rebuy.
- **7 `cash_game_waitlist` errors**: a separate family, not addressed here.

**Hourly count of rebuy deadlocks**

There were 0 in every hour from 2026-11-19T00 to 22, and 9 in hour 23.

**Function state**

- `fn_ensure_late_registration_capacity` `pg_get_functiondef` md5 is `a539fd43bb2992f8d75253f2d7a4dd7c`. It matches the fixture byte for byte.
- `fn_ca_lock_tournament_rebuy_acquisition` line 63 takes `FOR NO KEY UPDATE`.
- 13 functions take the row `FOR NO KEY UPDATE` first.
- 7 callers reach the capacity check.

**Native proof**

`native-proof-pg16-local.json` is a local run on PostgreSQL 16. CI runs the same script on PostgreSQL 17.
