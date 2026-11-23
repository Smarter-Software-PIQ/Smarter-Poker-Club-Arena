# Reporting and seat writers take one order (2026-11-23)

Two migrations follow up on the cash lock fixes of 2026-11-22
(`2026-11-22-cash-locks-take-one-order.md`). They change only when a row lock
is taken or released. No amount, key or write changes, and nothing reads
`is_horse`.

## 1. A reporting write is refused with its money (20261123072817)

**What happened.** In the 24 hours to 2026-11-23 07:15 UTC the production
Postgres log held 128 swallowed Club Data reporting failures:

- 92 `legacy Club Data projection: 55P03 canceling statement due to lock timeout`
  (`fn_ca_club_data_fact_put`). 90 of them came through
  `trg_ca_club_data_fact_rake` > `atomic_distribute_rake` >
  `fn_ca_bank_pending_cash_rake` > `fn_project_hand_side_effects`, and 2 through
  `trg_finish_hand_post_commit_obligations`.
- 34 `Club Data rake rollup failed ... lock timeout` (`trg_ca_reporting_rake_insert`),
  on the same path.
- 2 deadlocks at 01:15 UTC (a legacy projection and a cash table rollup). They
  were the buy-in against cash-out pair that 20261123024433 already fixed at its
  cause. The 24 hours before held no reporting deadlocks.

They were spread across every minute of the hour, so a rebuild job was not the
cause. Every one was a rake that banked while its Club Data rows were dropped.

**Cause.** `fn_ca_bank_pending_cash_rake` banks a stored rake under a 250ms
`lock_timeout` and answers `busy` when anything is held, keeping the obligation
for its next pass. The rake reporting triggers run inside that call. When a
buy-in, a cash-out or another table's projection held the same table's daily
reporting row for more than 250ms, the trigger's own `EXCEPTION WHEN OTHERS`
handler caught the timeout. The rake banked and the report was lost. The same
handlers swallowed deadlocks the same way.

**Fix.** All thirteen `WHEN OTHERS` handlers in the seven reporting functions now
begin with `IF smarter_private.bank_refusal_is_transient(SQLSTATE) THEN RAISE; END IF;`.
That is the banker's own test for "a retry can change this": deadlock,
serialization, lock not available, resources, operator, connection. The seven
functions are `fn_ca_club_data_fact_put`, `fn_ca_club_data_hand_put`,
`fn_ca_club_data_pacific_cash_register` and the four wallet and rake reporting
triggers.

When one of those refusals happens now, the money statement that fired the
trigger is refused with it. The rake bank answers `busy` with nothing written,
and its next pass banks the same 10 chips once, with the report. A busy answer
is not counted as an attempt.

**What the handlers still guard.** A deterministic defect in Club Data, such as
a bad cast or a constraint, is still logged and contained. A reporting bug never
refuses a buy-in, a cash-out, a prize or a rake.

**Buy-in against buy-in.** Each wallet row takes its reporting rows in one fixed
order: player fact, table game row, player daily row, then the table's
`club_table_daily` row. Two buyers share only the two table rows and take them in
that order, so they can wait for each other but cannot deadlock.

A rake bank walks its contributors in (club, player) order. It runs under the
banker's 250ms, which is well inside the 1s Postgres waits before it checks for
a deadlock. So when a rake bank and a buy-in collide, the rake is the side that
answers `busy` and is banked again, and the buy-in is never refused.

## 2. Every cash seat writer takes its table first (20261123072823)

A table's row is the parent of every chair at it. The cash-out (20261123024433),
the sit-out and the departure request (20261123024034) and the dealt manifest
all lock the table and then the seat. Every function body that writes
`public.table_seats` was read from production. Four still locked a cash seat
before its table, each of them deadlocking against those paths:

| Writer                                    | Seat first, then the table through                            |
| ----------------------------------------- | ------------------------------------------------------------- |
| `fn_lightning_owed_leave_returns_to_pool` | its `leave_pending` update (`zz_note_human_seat_seen`)        |
| `fn_lightning_rejoin_seated`              | `atomic_seat_cashout_locked` (a busted anchor's exit)         |
| `player_leave_table`                      | `atomic_seat_cashout_locked` (cash tables)                    |
| `fn_cash_cluster_commit_must_move`        | the halt lift's `UPDATE public.tables`, after seats FOR SHARE |

Each one now locks its table first, `FOR NO KEY UPDATE`, which is the mode its
own later table write takes. The reversion locks every member table in id order,
the same order `fn_cash_seat_move_execute` uses. Its Lightning mode lock stays
where it was. The seat triggers that take that lock are deferred to their
writer's commit, so a writer never holds it while waiting for a table.

The migration header lists every other seat writer and why it is left alone.

## Proof

`scripts/dev/prove-reporting-and-seat-writers-take-one-order.sh` runs on a
throwaway Postgres 16. It installs production's own text for every function
either migration edits, md5-checked against production
(`scripts/dev/fixtures/one-lock-order-live-2026-11-23.json` holds the bodies no
repository file had byte for byte). The output:

```
before (the live bodies):
  rake bank vs held fact row      : banked swallowed=2 bank=10 report=0 stored=0
  rake bank vs held daily row     : banked swallowed=1 bank=10 report=0 stored=0
  owed-leave return vs cash-out   : deadlock
  system leave vs dealt manifest  : deadlock
  busted rejoin vs dealt manifest : deadlock
  reversion vs cash-out           : deadlock
after (the two migrations applied):
  rake bank vs held fact row      : busy swallowed=0 bank=0 report=0 stored=1
  rake bank vs held daily row     : busy swallowed=0 bank=0 report=0 stored=1
  owed-leave return vs cash-out   : committed
  system leave vs dealt manifest  : committed
  busted rejoin vs dealt manifest : committed
  reversion vs cash-out           : committed
  busy, then asked again          : busy banked absent bank=10 fact=10 daily=10 rakes=1
  a reporting defect              : banked bank=10 daily=0
PROOF OK
```

With `PROOF_KEEP_PROBES=1` the same run applies both files whole, probes
included.

## Laws

- `tests/a-reporting-write-is-refused-with-its-money.law.test.ts`
- `tests/every-cash-seat-writer-takes-its-table-first.law.test.ts`. This one reads
  every later migration and refuses any function that locks a seat before its
  table, unless the file names it on a `-- @seat-before-table:` line with a
  reason.

## Nets left in place

`club-rake-rollup-catchup` (hourly, `fn_club_table_daily_catchup`) and the
Pacific seed's `NOT legacy_recorded` merge still exist. They should now find no
lost rake reports. If they start finding some again, the cause has come back.
