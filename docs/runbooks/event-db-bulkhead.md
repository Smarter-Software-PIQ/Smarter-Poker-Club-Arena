# Event Database Bulkhead

Use this runbook for `EventDbBulkheadSaturated` (warning) and
`EventDbBulkheadOpen` (warning) in the `postgres-health` group of
`infra/monitoring/alert-rules.yml`. Both observe; neither retries, repairs or
restarts anything.

## What fired

`EventDatabaseBulkhead` (`server/src/services/supabase/eventDatabaseBulkhead.ts`)
bounds concurrent database calls per tournament event and across all events so
one congested tournament cannot starve PostgREST or other tables.

- **`EventDbBulkheadSaturated`**: fires when
  `poker_event_db_bulkhead_park_timeouts_total` or
  `poker_event_db_bulkhead_refused_full_total` increases over 5 minutes for 1
  minute. That means callers waited until their deadline expired in the
  bulkhead queue or hit the per-event parked-waiter cap.
- **`EventDbBulkheadOpen`**: fires when `poker_event_db_bulkhead_open == 1`
  persists for 5 minutes. `openForShutdown()` should only be open during a
  brief engine shutdown; a running engine with `open == 1` has no bulkhead
  protection.

## What to look at

1. Inspect Prometheus gauges:
   - `poker_event_db_bulkhead_in_flight`
   - `poker_event_db_bulkhead_parked_current`
   - `poker_event_db_bulkhead_cooling_current`
   - `poker_event_db_bulkhead_throttled_events`
2. Inspect `/health` (`eventDbBulkhead.events`) on `ca-engine` to see which
   specific tournament key(s) have reduced `limit`, elevated `cooling`, or
   `parked > 0`.
3. Inspect engine logs (read-only):
   `docker logs --since 15m club-arena-engine 2>&1 | grep "EventDbBulkhead"`.
4. Correlate with `DatabaseRepliesLost`, `DatabaseDeadlocksElevated`, and
   `SettlementLaneConvoy` to distinguish database-side lock contention from a
   single runaway tournament loop.
