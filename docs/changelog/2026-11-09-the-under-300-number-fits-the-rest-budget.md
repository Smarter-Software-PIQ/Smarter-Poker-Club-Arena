# The under-300 number fits the REST budget - 2026-11-09

The daily seat-first start count shipped yesterday evening (#10110) and the
estate digest was wired to print it against Dan's under-300 target. The first
real run of that section printed this instead:

```
### Seat-first board starts (Spins and Sit and Gos)

- (seat-first starts unreadable today)

### Digest self-report

- seat-first starts: starts rpc 500
```

It reported UNKNOWN rather than a fabricated zero, which is what 10.86 rule 1
asks for. But UNKNOWN is not the number Dan asked for, so the cause had to go.

## The cause, read rather than guessed

`fn_ca_seat_first_daily_starts` was verified by running it over the Supabase
MCP, which connects as `postgres` with a 5 minute statement_timeout. The digest
calls it over PostgREST as `service_role`, whose statement_timeout is pinned to
its historical ~8 s by the PGRST002 fix (CLAUDE.md section 2).

The day filter was not sargable:

```sql
(t.started_at AT TIME ZONE 'America/Chicago')::date = day.d
```

so the expression had to be computed for every row of a 991,799-row,
1,541 MB table. Measured:

| measurement                             | value              |
| --------------------------------------- | ------------------ |
| `EXPLAIN ANALYZE`, warm                 | 2,843 ms           |
| shared buffers touched                  | 247,595            |
| the same call cold, two days (pg log)   | 13,831 ms          |
| rows in `tournaments`                   | 991,799            |
| of those, SPIN or SNG                   | 979,100            |
| `service_role` statement budget         | ~8,000 ms          |

About 7 s a day: inside the budget with no headroom, and over it whenever the
heap is cold or the box is busy. `idx_tournaments_tournament_type` cannot
narrow it either, because 98.7% of the table is SPIN or SNG, and every index
that mentions `started_at` is partial (spin-only, status-restricted, or
predicated on `spin_reveal_lag_ms`).

The evidence, in order:

```
postgres_logs  02:11:05Z  duration: 13831.491 ms  plan: ... fn_ca_seat_first_daily_starts
edge_logs      02:15:30Z  POST | 500 | /rest/v1/rpc/fn_ca_seat_first_daily_starts
```

## The fix

Two migrations and one line of the digest. No retry, no second call, no
fallback value: 10.11 and 10.12 both say a retry would hide a path that should
not have failed.

1. **`20261109022243`** replaces the day filter with ONE half-open
   timestamptz range computed once:

   ```sql
   t.started_at >= lo AND t.started_at < hi
   ```

   The boundaries come from `date + time zone`, so the IANA rules decide them
   and a DST day is 23 or 25 hours wide without the arithmetic here knowing
   which. Nothing about WHAT is counted moves: the kinds, the satellite-feeder
   test and the human-participation rule are byte-for-byte what #10110
   shipped, and the migration asserts the 2026-11-07 counts (Spin 6,670,
   regular heads-up 5,847, satellite feeder 4) before it commits, so it aborts
   rather than quietly reporting a different number. Verified by running the
   new body inline against production first: identical, including the single
   human-triggered Spin.

2. **`20261109022418`** adds `idx_tournaments_started_at`, which is what makes
   the range a range read instead of a scan. It is built through the door's
   one considered exception for an index on a table written every hand
   (`scripts/ci/migration-concurrent-preamble.mjs`): the
   `CREATE INDEX CONCURRENTLY IF NOT EXISTS` statement sits before the
   transaction, and the transaction refuses an INVALID leftover by name so a
   half-built index cannot sit there being ignored by the planner. A plain
   `CREATE INDEX` would have held SHARE on `tournaments` for the whole build,
   which CLAUDE.md section 2 rule 9 is written about. About 22 MB; not partial,
   because 979,342 of the 991,799 rows have a non-null `started_at` so a
   predicate would exclude almost nothing while costing the planner every
   other `started_at` question.

3. **`.github/scripts/estate-digest.mjs`** now carries PostgREST's own message
   beside the status. 10.86 rule 4: the first failure printed `starts rpc 500`
   and nothing else, so the next reader had to go to the edge and postgres logs
   to learn what 500 meant. The line the digest already prints now names the
   cause.

## Expected plan afterwards

An index range read of one Chicago day: about 15,000 rows today, and about 200
a day once the waiting ladder is the engine that is serving, instead of 991,799
heap rows.

## What this does not change

The under-300 comparison, the satellite-feeder line, the human/horse split and
the digest's schedule are untouched. The first digest run that reports a day
served entirely by the waiting ladder is the one on 2026-11-11, reporting
Tuesday 2026-11-10.
