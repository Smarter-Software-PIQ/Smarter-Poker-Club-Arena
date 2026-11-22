# tests/the-fixture-builders-share-the-runtime-postgres.law.test.ts

The native fixture Dockerfile lists every PostgreSQL package once, in its `postgres-debs` stage, with exact version, pool path, SHA-1 and SHA-256; the runtime and every builder install those same checked files, hold them and prove the installed versions. Files come from deb.debian.org and, after Debian drops a version (13.8, 2026-11-21), from snapshot.debian.org by SHA-1, so neither a Debian security release (17.12, 2026-11-13) nor a point release can split builder and runtime ABIs or fail every native smoke.
