# tests/no-new-hot-row-lock-upgrades-on-tournaments.law.test.ts

Enforces via `scripts/ci/check-migration-hot-row-locks.mjs` that no new migration (>= `20261120000000`) acquires `FOR UPDATE` or `FOR SHARE` on `public.tournaments` without an explicit `-- @lifecycle-exclusive-lock: <reason>` annotation, preserving `FOR KEY SHARE` / `FOR NO KEY UPDATE` concurrency across tournament tables.
