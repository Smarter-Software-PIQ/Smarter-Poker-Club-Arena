# A wake acknowledgement never holds a wake while it waits (2026-11-22)

## What happened

The engine's acknowledgement of a tournament manager's wakes
(`fn_ack_tournament_manager_wakes`) and a bounty rebuy
(`process_tournament_rebuy`) deadlocked twice in the 24 hours to 01:20 UTC on
2026-11-23, at 07:20:43 and 18:50:25 UTC on 2026-11-22. Postgres cancelled
the acknowledgement both times, not the rebuy. The engine reports a failed
acknowledgement as `GameServer.tournament_manager_wake_ack_failed` and keeps
those wakes until a later acknowledgement succeeds.

## Cause, read from the log and the rows

The ack's side waited at the same line each time:

```
while locking tuple (...) in relation "tournament_manager_wakes"
fn_ack_tournament_manager_wakes line 27:
SELECT 1 FROM public.tournament_manager_wakes w
 WHERE w.id=ANY(v_ids) ORDER BY w.id FOR UPDATE
```

A tournament has at most one pending wake row per reason.
`fn_emit_tournament_manager_wake` writes it with
`INSERT ... ON CONFLICT (tournament_id,reason) DO UPDATE`, which locks the row
until the writer commits.

A bounty rebuy writes two of those rows in one transaction, in code order:
`bounty_settled` (the `trg_emit_manager_wake_for_settled_bounty` trigger,
inside the bounty settle) and then `rebuy`. Each row's id is whatever it got
when that pending row was created. The production rows read back show the
inversion both times:

| time (UTC) | `rebuy` row | `bounty_settled` row | rebuy locked first | ack locked first |
| ---------- | ----------- | -------------------- | ------------------ | ---------------- |
| 07:20:43   | 1385466     | 1385467              | 1385467            | 1385466          |
| 18:50:25   | 1390195     | 1390196              | 1390196            | 1390195          |

The ack locks its exact ids in id order, so it held the lower id and waited
for the higher one, while the rebuy held the higher one and wanted the lower.
Which reason has the lower id changes from one wake to the next: an `INSERT
... ON CONFLICT` takes an identity value even when it updates an existing
row. So no fixed order of reasons could line the emitters up with the ack.

## The change

`20261123025756` gives each tournament one wake key,
`'ca:tournament-manager-wakes:v1:' || tournament id`, taken before any wake
row is locked:

- `fn_emit_tournament_manager_wake` takes it **shared** just before its
  upsert, after its terminal-status refusal (which writes nothing). A writer
  holds it from its first wake write to its commit. Shared holders never wait
  for each other, so two emitters of one tournament still block each other
  only on the same reason's row, as before.
- `fn_retire_manager_wakes_after_terminal_status`, the only other writer of
  wake rows, takes it **shared** before its UPDATE.
- `fn_ack_tournament_manager_wakes` takes it **exclusively**, before it
  locks any wake, when it locks more than one. It now waits for writers in
  flight while holding no wake, and once it has the key no writer can hold
  one of its rows. An ack of a single wake keeps its old path: waiting for its
  only row holds nothing, so it cannot close a cycle.

`tournament_capacity_table_receipts.manager_wake_id` takes a key-share lock on
a wake row through its foreign key. That only happens in the transaction that
just emitted that wake, which already holds the key.

The same rows get the same generations and `consumed_at` values, and the ack
returns the same answer it would have given had it simply waited. Nothing
here moves money, seats anyone or reads `is_horse`.

**What it costs.** A multi-wake ack now waits for every wake writer of its
tournament that is in flight, not only one holding a row in its set. While it
waits, a new writer's first wake write queues behind it (Postgres grants a
lock in arrival order), until the in-flight writer commits and the ack's few
row locks finish. Before this change that new writer already waited the same
way whenever the in-flight writer held the same reason's row. A writer that
already holds the key (its second emit in one transaction) never waits on it.

## Proof

`scripts/dev/prove-a-wake-ack-never-holds-a-wake-while-it-waits.sh` runs on a
throwaway PostgreSQL 16. It loads production's own text for the three writers
(`scripts/dev/fixtures/a-wake-ack-never-holds-a-wake-while-it-waits`, each md5
checked against production) on the table's production shape. It replays 18:50:25: pending
`rebuy` = id 1 and `bounty_settled` = id 2, a rebuy transaction that emits
`bounty_settled`, works for 1.5 s and emits `rebuy`, and an ack of {1, 2}
0.5 s in. Then it runs the migration file itself and replays again.

| case                                  | first                     | second                                                                           | wakes afterwards                |
| ------------------------------------- | ------------------------- | -------------------------------------------------------------------------------- | ------------------------------- |
| replay, before                        | rebuy committed           | ack: deadlock (`while locking tuple ... in relation "tournament_manager_wakes"`) | 1 rebuy g2, 2 bounty g2 pending |
| replay, after                         | rebuy committed           | ack committed, 0 consumed (both generations moved on)                            | 1 rebuy g2, 2 bounty g2 pending |
| two emitters, two reasons, after      | committed                 | committed within 500 ms                                                          | both pending                    |
| one-wake ack beside an emitter, after | committed                 | committed within 500 ms, 1 consumed                                              | 1 consumed, 2 pending           |
| ack with nothing in flight, after     | ack committed, 2 consumed |                                                                                  | both consumed                   |
| terminal retirement beside a held ack | ack committed             | status change committed                                                          | both consumed                   |
| terminal retirement alone, after      | committed                 |                                                                                  | both consumed                   |

Law: `tests/a-wake-ack-never-holds-a-wake-while-it-waits.law.test.ts`.
