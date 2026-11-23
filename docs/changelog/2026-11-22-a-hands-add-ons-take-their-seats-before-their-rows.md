# A hand's add-ons take their seats before their rows (2026-11-22)

## What happened

Between 20:16 and 20:23 UTC on 2026-11-22 the end-of-hand bookkeeping RPC
`fn_project_hand_side_effects` deadlocked six times at one Lightning host
table (Postgres log, `deadlock detected` ERROR rows). The same envelope line
also deadlocked on 2026-11-18 at 06:27 UTC (against the Lightning lane) and on
2026-11-17 at 23:09 UTC (against a cash-out, `fn_cashout_seat_occupancy`, whose
seat exit resolves the player's add-ons under the seat row it is ending). No
other deadlock involving the function appears in the log from 2026-11-17 to
2026-11-23. Each time Postgres cancelled the bookkeeping pass. The worker
retried it, but the hand's top-up delivery and statistics were held up behind
the cancelled pass.

## Cause, read from the log

The bookkeeping side of every one of the eight is the same line (on 2026-11-17
and 2026-11-18 the envelope was called directly and the call sat at its older
line 304):

```
while locking tuple (80125,n) in relation "table_seats"
SELECT stack FROM table_seats WHERE table_id = v_row.table_id
  AND user_id = v_row.user_id AND left_at IS NULL FOR UPDATE
resolve_pending_addon(uuid,numeric) line 29
fn_ca_process_hand_post_commit_obligations(uuid) line 469
fn_project_hand_side_effects(uuid) line 269
```

The other side was the next Lightning hand being settled
(`fn_lightning_settle_hand`, once directly over PostgREST and five times
through `smarter_private.fn_engine_lightning_lane`). Its own lock-wait lines
(`log_lock_waits` is on) show what it held and what it waited for:

- held: the player's seat, `fn_lightning_settle_hand` line 242 (every anchor
  seat `FOR UPDATE`, in seat id order);
- waited for: `table_pending_addons` tuple (1158,35), from
  `fn_ca_commit_hand_settlement` line 649, where the commit door freezes the
  host table's unresolved add-ons `FOR UPDATE ... ORDER BY created_at, id`.

Every door that holds a seat and a pending add-on takes the seat first: the
commit door freezes add-ons after its stack core holds the hand's seats (a
Lightning settlement after it has locked every anchor), and an ended seat
resolves its add-ons under its own row (`fn_record_ended_seat_occupancy`, by
`created_at, id`). The post-commit envelope was the one place that took them
the other way round:

- line 459 of `fn_ca_process_hand_post_commit_obligations` locks the add-on row;
- line 469 calls `resolve_pending_addon`, whose line 29 locks the player's seat.

So a top-up being delivered after hand N held the add-on and waited for the
seat, while hand N+1, committing on the same chair, held the seat and waited
for the add-on. The envelope also walked its add-ons in uuid text order while
the commit door takes them by `created_at, id`, a second reverse order between
two add-ons of one table.

## The change

`20261123023325` edits the live envelope once, just before its add-on loop.
With the same 1 s bound the function already gives every lock it names (a
refusal still answers `obligation_lock_busy`, which the worker retries), it
first takes every live seat `resolve_pending_addon` will lock (the player of
each unresolved add-on, at its table) by seat id, then every add-on row the
loop locks by `created_at, id`. The loop is unchanged: it resolves in its own
order and re-enters both locks at once, and `resolve_pending_addon` still runs
with the caller's lock_timeout. Every amount applied, refunded or credited is
exactly what it was. Nothing reads `is_horse`.

Production's envelope before: md5 `39d75365156c46476bfe01854d3c86b9`. After:
`16332f6377e82b717505f846e046af32`.

## The same function against itself

Two envelopes of one table never overlap: each holds the table's
`hand-post-commit:` mutex (tried, 250 ms) before any row. Envelopes of
different tables lock disjoint add-on and seat rows, since both are scoped to
the hand's own table, and their player rows are taken under the
`player-stats:` keys `fn_project_hand_side_effects` tries in uuid order first.
No self-deadlock appears in the log, and nothing here changes those paths.

## Proof

`scripts/dev/prove-a-hands-add-ons-take-their-seats-before-their-rows.py`, on a
throwaway PostgreSQL 16, with production's envelope rebuilt byte for byte
(md5 checked) and production's `resolve_pending_addon` (md5 checked). The
other side is the next hand's commit, using the two statements production
logged: the seat lock, then the add-on freeze.

| case                                                         | before            | after                         |
| ------------------------------------------------------------ | ----------------- | ----------------------------- |
| 1. the commit holds the chair, the envelope a top-up         | deadlock detected | both commit, top-up delivered |
| 2. two top-ups whose uuid order reverses their age           | deadlock detected | both commit, both delivered   |
| 3. five serial cases (fit, capped, vacated, replay, foreign) | answers and rows  | byte-identical to before      |

## Law

`tests/a-hands-add-ons-take-their-seats-before-their-rows.law.test.ts` rebuilds
the production envelope, applies the edit, and pins: seats, then add-on rows,
then the unchanged loop; both bounded at 1 s with the resolver still on the
caller's wait; the text outside the inserted block untouched; the other doors'
order; and that no later migration takes an add-on before its seat again.
