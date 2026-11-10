# 2026-11-10 - The collusion pair-flow scan gets an index it can range-scan

## What was wrong, read from rows and plans

`public.fn_ca_collusion_scan(p_days)` opens with one aggregate over
`public.ca_hand_transfers` filtered by `played_at > now() - p_days`. That table
holds ~73.5M rows (9.5 GB heap, 16 GB of indexes), and every index on it led
with `winner_id` or `loser_id`. So `played_at` could only ever be an index
**condition** on a full traversal of a 73.5M-entry index, never a range scan:

```
Index Scan using idx_ca_hand_transfers_winner  (cost=0.57..1140058.66)
  Index Cond: (played_at > (now() - '7 days'::interval))
  Filter: (amount > '0'::numeric)
```

Reproduced read-only at the function's own `statement_timeout = 120s`: the
aggregate did not finish. `ca-collusion-daily` (schedule `20 4 * * *`) failed
the last 3 of its 3 runs with SQLSTATE 57014 at
`fn_ca_collusion_scan line 6 at FOR over SELECT rows`, and drift incident
`c3f667d5-422b-47bb-9b1b-0898fa1c7003` (`fn_ca_cron_failure_watch`, critical)
had been open since 2026-11-09 21:37 with no successful run in 24 h.

Collusion scanning was therefore blind for over a day. Under CLAUDE.md 10.83 a
check nobody can run is not a check.

## The fix

`20261110162314_ca_hand_transfers_played_at_index_for_the_collusion_pair_flo.sql`
adds one btree leading with `played_at`.

`played_at` correlation on this table is 0.999966, because inserts are
append-only, so heap access behind the range scan is effectively sequential and
no `INCLUDE` columns are needed. `winner_id` and `loser_id` are `NOT NULL`, so
the scan's `IS NOT NULL` predicates are tautologies; the index is deliberately
not partial on them, and not partial on `amount > 0` either, so any other
time-window read of this table can use it.

## Measured after, live on production

```
HashAggregate (actual time=5824.748..6994.574 rows=241472 loops=1)
  ->  Index Scan using ca_hand_transfers_played_at_idx (actual time=0.068..3299.999 rows=5210689 loops=1)
        Index Cond: (played_at > (now() - '7 days'::interval))
Execution Time: 7041.972 ms
```

Seven seconds, against a 120 s budget it previously exceeded. The planner also
chose `HashAggregate` on its own.

Delivery: PR #10375, squash `82a844e9a9cdef796d0dced716a1eb4017a9c2ff`, merged
2026-11-10 17:07:08Z. `Apply Merged Migration` run 42861754250 completed
success; `20261110162314` is recorded in `supabase_migrations.schema_migrations`;
`ca_hand_transfers_played_at_idx` is `indisvalid = true`, `indisready = true`,
1414 MB.

## Scope, and what was deliberately left alone

This moved no money, settled nothing, and changed no function body, alert, rule
or threshold. No cron, watcher, reconciler or repair loop was added.

- **Statistics staleness, not bundled.** Autoanalyze last ran 2026-11-02, since
  its 10 % scale factor needs ~7.3M inserts on a table this size, so the
  planner's `played_at` histogram ended before the 7-day window and it
  estimated 7,357 rows for a window holding 5,210,689. That estimate no longer
  selects the access path once `played_at` leads an index, and the aggregate
  still chose `HashAggregate`, so it was recorded in the migration header for a
  follow-up judged on its own evidence rather than smuggled into an index
  change. Its only measured cost today is 233 MB of hash spill across 9 batches.
- **A check refused this migration and was not weakened.**
  `tests/unit/aMergedMigrationIsInstallable.test.ts` rejected the first draft
  for a bare `ANALYZE` in the `CREATE INDEX CONCURRENTLY` preamble
  ("only CREATE INDEX CONCURRENTLY IF NOT EXISTS ... may precede BEGIN"). The
  `ANALYZE` was removed; the rule stands.
- **The incident was left open on purpose.** `ca-collusion-daily` has not run
  since the fix, so the job's own success is unproven and claiming it would be a
  success claim without verification. The alert board gives that source
  `auto_resolve_hours = 24` ("transient: clears after 24h unseen"), so it clears
  itself once the job stops failing.

## Operational notice for the first successful run

At its existing thresholds (`hands_together >= 20`, `abs(net) >= 5000`,
direction ratio `> 0.8`) the restored scan currently matches **3,032 pairs**, of
which **419 would be warning severity** (`net_flow >= 50000` and not both cert
accounts, one push each) and 2,613 info. That is steady-state weekly volume
rather than a backlog: the window is always the trailing 7 days and the dedupe
key is per pair per ISO week, so the first run of an ISO week raises them and
later daily runs dedupe.

No threshold was changed and no alert was suppressed to reduce that volume.
Whether those thresholds are right for a horse-heavy platform is a product
question for the owner, and 10.5 forbids filtering horses out of the scan to
make the number smaller.
