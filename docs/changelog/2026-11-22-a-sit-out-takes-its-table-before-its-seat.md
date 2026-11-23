# A sit-out or a departure takes its table before its seat (2026-11-22)

## What happened

A tournament hand's continuation journal and the engine's sit-out of a player
at the same table deadlocked twice in the 24 hours to 01:20 UTC on 2026-11-23,
at 07:06:39 and 18:32:04 UTC on 2026-11-22. Postgres cancelled the journal
write (`fn_f06_retain_hand_continuation`, the PostgREST call taking
`p_tournament_id, p_lease_generation, p_table_id, p_hand_number, p_sequence,
p_payload, p_sha256`) both times. The other side was `fn_cash_seat_sitout`.

## Cause, read from the log and the live functions

The journal's side waited at the same line each time:

```
while locking tuple (...) in relation "table_seats"
fn_ca_f06_share_table_lane line 22:
SELECT s.id FROM public.table_seats s ... ORDER BY s.id FOR UPDATE OF s
```

`fn_ca_f06_share_table_lane` takes the table row `FOR UPDATE` and then every
seat of the table in id order. That is the order every hand lane uses: table
row, then seats.

`fn_cash_seat_sitout` takes the player's seat `FOR UPDATE` first, then
updates its `is_sitting_out`. That UPDATE fires the AFTER trigger
`zz_note_human_seat_seen` (migration `20261112022000`), which runs this for a
person's seat:

```sql
UPDATE public.tables SET last_human_seen_at = now() WHERE id = tid;
```

So the sit-out held the seat and waited for the table row, while the lane held
the table row and waited for the seat.

`fn_request_seat_departure` has the same shape. It locks the seat, then sets
`is_sitting_out` on it (plus `leave_pending` at a cash table), which fires the
same trigger, on tournament tables as well as cash ones. It is not in the
logs yet, but it would deadlock the same way. Once the sit-out takes the table
first, the departure is also the only writer of those two columns that could
still close a cycle with a sit-out of the same seat.

## The change

`20261123024034` makes both functions take the table row `FOR NO KEY UPDATE`
just before the seat. That is the lock the trigger's UPDATE takes anyway
(`last_human_seen_at` is not a key column), so the trigger never needs a
stronger lock after the seat is held. The departure keeps its tournament row
first: tournament, table, seat, the order a hand commit uses.

A sit-out or departure that meets a hand lane now waits at the table row
holding nothing. Whichever arrives first finishes first. The lock is taken for
every seat, a horse's as well as a person's, and nothing in the change reads
`is_horse`. The same rows are written with the same values: no seat, stack,
payout, finishing place or sit-out result changes.

The engine column the trigger feeds (`tables.last_human_seen_at`, the cash
human-departure dwell) is untouched. Moving it off the table row would have
needed an engine release.

## Proof

`scripts/dev/prove-a-sit-out-takes-its-table-before-its-seat.sh` runs on a
throwaway PostgreSQL 16. It loads production's own text for the four
functions in the cycle (`scripts/dev/fixtures/a-sit-out-takes-its-table-before-its-seat`,
each md5 checked against production) and replays the logged interleaving: the
writer has its seat, the lane takes the table and waits for that seat. Then it
runs the migration file itself and replays the same interleaving again.

| case                         | writer                                                     | lane      | rows written                            |
| ---------------------------- | ---------------------------------------------------------- | --------- | --------------------------------------- |
| sit-out, before              | deadlock (`while updating tuple ... in relation "tables"`) | committed | none (rolled back)                      |
| departure, before            | deadlock (`while updating tuple ... in relation "tables"`) | committed | none (rolled back)                      |
| sit-out, after               | committed                                                  | committed | person sitting out, table stamped       |
| departure, after             | committed                                                  | committed | person sitting out, request, stamped    |
| sit-out, lane first, after   | committed                                                  | committed | same                                    |
| departure, lane first, after | committed                                                  | committed | same                                    |
| horse sit-out, after         | committed                                                  | committed | horse sitting out, no stamp (as before) |

Law: `tests/a-sit-out-takes-its-table-before-its-seat.law.test.ts`.

## Not changed here

Other functions that write `table_seats` without taking the table row
themselves first: `fn_lightning_owed_leave_returns_to_pool`,
`fn_cash_seat_swap_execute_before_maintenance_gate` and
`atomic_seat_cashout_locked`. `atomic_seat_cashout_locked` is called by
`fn_cashout_seat_occupancy` (which takes the table row first), and also by
`player_leave_table`, `fn_lightning_rejoin_seated`, `fn_admin_kick_player` and
`atomic_table_cashout`. None of these appear in the two deadlocks this change
fixes, and they are left as they are. The 22:35 UTC deadlock between
`fn_cashout_seat_occupancy` and `fn_cash_capture_hand_manifest` on a cash
table is a different cycle and is not addressed here.
