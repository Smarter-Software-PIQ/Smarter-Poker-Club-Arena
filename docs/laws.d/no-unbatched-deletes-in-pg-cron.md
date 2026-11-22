# tests/no-unbatched-deletes-in-pg-cron.law.test.ts

Enforces via `scripts/ci/check-cron-deletes-are-bounded.mjs` that no new migration (>= `20261120000000`) schedules a raw `DELETE FROM` statement inside `cron.schedule(...)` or `cron.alter_job(...)` unless it delegates to a bounded pruner function or carries both an explicit `LIMIT` clause and a `-- @bounded-cron-delete: <reason>` comment.
