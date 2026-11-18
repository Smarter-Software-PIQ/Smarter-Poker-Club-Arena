# tests/the-fixture-builders-share-the-runtime-postgres.law.test.ts

Every apt install in the native fixture Dockerfile that touches PostgreSQL 17 or its client headers pins postgresql-17, libpq5, libpq-dev and postgresql-server-dev-17 to the runtime's exact version, so a Debian security release (17.12, 2026-11-13) cannot split builder and runtime ABIs and fail every native smoke with 58P01.
