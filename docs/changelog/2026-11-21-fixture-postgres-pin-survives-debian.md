# 2026-11-21: The Fixture's PostgreSQL Pin Survives a Debian Point Release

From about 09:55 UTC every pull request's `Native fixture prerequisites / native-smoke` failed while building `operations/release/fixture/Dockerfile`, and the required `TypeScript Check` failed with `FIXTURE_GATE_NATIVE_SUCCESS_REQUIRED` (runs 44891884720, 44892437918, 44895568497; last pass 44889235019 at 09:29 UTC):

```
E: Version '17.11-0+deb13u1' for 'postgresql-17' was not found
E: Version '2.6-2+b1' for 'postgresql-17-wal2json' was not found
```

Cause: Debian 13.8 was published at 09:15 UTC (`dists/trixie/Release`: `Version: 13.8`, `Date: Sat, 21 Nov 2026 09:15:44 UTC`). It moved trixie `main` to postgresql-17 `17.12-0+deb13u1` and wal2json `2.6-2+deb13u1`, so 17.11 left both indexes the fixture's APT reads (trixie-security already carried only 17.12). An exact `pkg=version` APT pin can only name what Debian's index still lists, so the pin that kept runtime and builders on one ABI (2026-11-13) became the thing that broke the build.

Fix, with no version change: PostgreSQL stays 17.11-0+deb13u1, pgvector 0.8.0-1, wal2json 2.6-2+b1.

- A new `postgres-debs` stage lists every PostgreSQL package once (postgresql-17, postgresql-client-17, libpq5, libpq-dev, postgresql-server-dev-17, pgvector, wal2json) with exact version, Debian pool path, SHA-1 and SHA-256. It is the only place those versions are written.
- It fetches each file by pool path from `deb.debian.org/debian`, then `deb.debian.org/debian-security`, then `snapshot.debian.org/file/<sha1>` (Debian's permanent content-addressed archive). Every file must match its SHA-256 or the build stops. The SHA-256 of wal2json 2.6-2+b1 equals the one the README already recorded from packages.debian.org; all seven files were checked byte-identical from deb.debian.org and snapshot.
- The runtime and both builder installs install those same files from a build-time bind mount (nothing is left in the image), `apt-mark hold` them, and assert every installed version against the list.
- snapshot.debian.org is still not an APT source (2026-11-05: 504s and ~10 s per package for whole-system installs on hosted runners). Only these seven files can be read from it, by hash, and only after Debian's pool stops serving them.

Changing the fixture's PostgreSQL version is now one edit to the `postgres-debs` list for the runtime and builders together. Pinned by `tests/the-fixture-builders-share-the-runtime-postgres.law.test.ts` (fails against the previous Dockerfile).
