# Database Replies Lost

Use this runbook for `DatabaseRepliesLost` (warning) and
`DatabaseWriteRetriesExhausted` (critical) in the `postgres-health` group of
`infra/monitoring/alert-rules.yml`. Both observe; neither retries, repairs or
restarts anything.

## What fired

The game server talks to the database only through Supabase PostgREST over
HTTPS. Every attempt that ends without a database answer is counted in
`poker_db_lost_replies_total{kind}`:

- `deadline`: the client's own deadline or the caller's abort fired first
  (the hand-continuation write gives each attempt 8 seconds).
- `network`: the connection failed (reset, refused, DNS, body cut off).
- `gateway`: PostgREST or its proxy answered 502, 503 or 504 instead of the
  database.

`DatabaseRepliesLost` fires when five or more are lost in one minute. The
writes that retry themselves have recovered so far, so no table has been
stopped by it yet.

`poker_db_rpc_retries_total{rpc, outcome}` counts the self-retrying writes
(today `fn_f06_retain_hand_continuation`, four attempts):
`retry`, `recovered`, `exhausted`. `DatabaseWriteRetriesExhausted` fires on
any `exhausted`: all four attempts lost their reply, and the table that made
the write stops dealing on that hand
(`Hand Continuation Write Is Unproven [transport_error sqlstate=unknown]`).

Both alerts stay firing for ten minutes after the last lost reply, so a
choppy link is one episode, and then resolve on their own.

## What to look at

1. Which kind: in Prometheus,
   `sum by (kind) (increase(poker_db_lost_replies_total[5m]))`.
   `deadline` with no `network` usually means the database is slow (locks,
   CPU); `network` or `gateway` means the path to it.
2. The database side: Supabase dashboard for the project (CPU, connections,
   PostgREST logs), and `pg_stat_activity` for long waits.
3. The engine log for the same minute (read-only):
   `docker logs --since 10m club-arena-engine 2>&1 | grep -E "retain retry|Write Is Unproven|supabase_timeout|fetch failed"`.
4. Whether tables actually stopped: `TableStoppedDealing` and
   `PokerTablesFrozen` follow within a minute or two when they do.

## History

Written after 2026-11-05, when lost replies at 12:21, 14:29 and 14:43 UTC
froze nine or ten tables each time with no alarm until the tables themselves
were noticed.
