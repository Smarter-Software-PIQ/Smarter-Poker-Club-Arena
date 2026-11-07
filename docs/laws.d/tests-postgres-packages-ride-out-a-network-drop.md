# tests/postgres-packages-ride-out-a-network-drop.law.test.ts

Every CI workflow that installs PostgreSQL from apt.postgresql.org passes apt its option array with `Acquire::Retries=8` and `Acquire::Retries::Delay::Maximum=60`, so a network drop of a few minutes is ridden out inside the job. On 2026-11-07 accounting shard 5 of #9933 failed before any test ran when every postgresql-17 fetch failed in one second with "Network is unreachable".
