# tests/cron-watchers-materialize-and-prune-without-deadlock.law.test.ts

Scheduled cron watchers materialize per-tournament guarantee funding CTEs, bound start_time scans with GREATEST, cover PLO4/5 human cash hands by partial index, and prune diamond history in PK-ordered SKIP LOCKED batches without deadlocking.
