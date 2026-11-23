# Cash locks take one order (2026-11-22)

Two migrations, one rule: two cash paths that touch the same rows take them in
the same order. Lock order only. No amount, key or write changes.

## What happened

In the 24 hours to 2026-11-23 01:20 UTC the production Postgres logged:

- **3 deadlocks on a player's cash-out** (`fn_cashout_seat_occupancy`), each
  time with the cash-out as the side Postgres cancelled:
  - 07:30:23 vs `fn_ca_process_hand_post_commit_obligations`
  - 21:04:38 vs `atomic_table_buyin`
  - 22:35:32 vs `fn_cash_capture_hand_manifest`
- **5 deadlocks on the stay-clock evaluation** (`fn_cash_session_evaluate`),
  every one between the engine's own call and a Lightning settlement
  (`fn_engine_lightning_lane` -> `fn_lightning_settle_hand` -> trigger
  `fn_lightning_cash_clock_at_settlement` -> `fn_cash_session_evaluate`), at
  03:33, 05:24, 06:14, 07:56 and 08:23.

## Causes, by line

1. **Evaluation (5).** `fn_cash_session_evaluate` line 43 locks one
   `cash_player_session` row `FOR UPDATE` per entry, and its loop (line 20)
   walked the entries in the caller's order. The Lightning trigger sends each
   table's players `ORDER BY player_id`; the engine sends seat order. Two calls
   on one table each held one player's row and waited for the other's.
2. **Cash-out vs manifest (22:35).** The cash-out locks the seat `FOR UPDATE`
   and takes the `tables` row last (`atomic_seat_cashout_locked` line 140,
   `UPDATE tables SET current_players`). The manifest takes `tables` `FOR SHARE`
   (its line 28) and then reads each dealt chair `FOR SHARE`, the leaving one
   included.
3. **Cash-out vs buy-in (21:04).** Between the seat and line 140 the cash-out
   credits the wallet; the credit's `wallet_transactions` row makes
   `trg_ca_reporting_wallet_insert` upsert the table's `club_table_daily` row. A
   human buy-in inserts its chair, which takes `tables` through
   `zz_note_human_seat_seen`, and then journals its debit into the same daily
   row.
4. **Cash-out vs post-commit (07:30).** On a player's last chair,
   `fn_record_ended_seat_occupancy` (line 25) locked every unresolved add-on
   `FOR UPDATE`, and only then skipped the ones an open hand envelope owns. That
   hand's post-commit held such an add-on and waited for the seat at
   `resolve_pending_addon` line 29.

## The change

- `20261123024428`: the evaluation loop walks its entries in `player_id`
  (uuid) order, the Lightning trigger's order. Entries that are not a uuid are
  still skipped. Two entries for one player keep their order. The engine reads
  the result into a map by `user_id`, so the order of the returned rows changes
  nothing.
- `20261123024433`:
  - **Table before seat.** `fn_cashout_seat_occupancy` and
    `atomic_seat_cashout_locked` take a cash table's row `FOR NO KEY UPDATE`
    (the mode of their own `current_players` UPDATE) before the seat. Parent
    before child, exactly as both already do for a tournament's game row and a
    diamond table. The manifest, a table close (`trg_tables_auto_cashout_on_close`)
    and the admin closes already take the table first. The cash hand settlement
    and the add-on resolver never lock the table row.
  - **Every buyer the same.** `atomic_table_buyin_before_maintenance_announcement_gate`
    takes the table right after its chair insert, before its wallet journal. A
    human buyer already held it there (through the human-seat trigger). A horse
    buyer took it only at its last statement, after the reporting rows, and
    against the new cash-out that is the next deadlock. The proof reproduces it,
    so horses and humans now take it in one place.
  - **Owned add-ons are not waited for.** The seat-exit trigger skips add-ons an
    open hand envelope owns in the query that locks the others. Its check after
    the lock stays. The resolved and skipped sets are the same as before, since
    an envelope's post-commit resolves every id it lists before it completes.

## Why not the manifest

Locking the manifest's chairs before its table would also have closed the
22:35 cycle. But a table close holds the table while it cashes out every chair,
so that order would open a new cycle with every close. It would also have moved
the manifest's md5 pin in `original_inventory_proof_sources_match()` and
changed the union inventory generation. The cash-out was the path that broke
parent-before-child, so the cash-out is what changed.

## Proof

`scripts/dev/prove-cash-locks-take-one-order.sh` builds a throwaway
PostgreSQL 16 and installs the live bodies byte for byte. Each one is read from
this repository, and its md5 is checked against the md5 production reported on
2026-11-23. Pause hooks in stub helpers hold each side where the log shows it
waiting.

```
before (the live bodies):
  cash-out vs manifest          : deadlock
  cash-out vs human buy-in      : deadlock
  horse buy-in vs cash-out      : committed
  post-commit add-on vs cash-out: deadlock
  engine vs Lightning evaluation: deadlock
after (the two migrations applied):
  cash-out vs manifest          : committed (leaver +100)
  cash-out vs human buy-in      : committed (leaver +100, buyer -100)
  horse buy-in vs cash-out      : committed (leaver +100, buyer -100)
  post-commit add-on vs cash-out: committed (leaver +100 cash-out, +20 add-on refund, once each)
  engine vs Lightning evaluation: committed
swap (the buy-in alone back on its live body, the cash-out new):
  horse buy-in vs cash-out      : deadlock
PROOF OK
```

Law: `tests/cash-locks-take-one-order.law.test.ts`.

## Not in this change

The same 24 hours also hold 102 cash-out lock waits on `cash_games`. They are
the foreign key check of the roster trigger waiting on the cluster tick's
`FOR UPDATE`, fixed separately by `20261122232612`. There are also buy-in vs
buy-in deadlocks on the shared Club Data rows (`club_table_daily`,
`ca_club_data_game_ct`), mostly caught by the rollup's own exception handler.
Neither is changed here.
