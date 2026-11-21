# 2026-11-21: The Native Fixture Follows Debian's PostgreSQL 17.12

The required `TypeScript Check` failed on every pull request whose native fixture gate ran. The image build stopped at `apt-get install` with `Version '17.11-0+deb13u1' for 'postgresql-17' was not found` (PR #11609, runs `44898313955` and `44898928944`).

## Cause

`operations/release/fixture/Dockerfile` pinned `postgresql-17`, `postgresql-client-17`, `libpq5`, `libpq-dev` and `postgresql-server-dev-17` to `17.11-0+deb13u1` and `postgresql-17-wal2json` to `2.6-2+b1`. Debian's main archive (`deb.debian.org`) keeps only the current point release of a package. When trixie took PostgreSQL 17.12 into the point release, `trixie main` and `trixie-security` stopped serving 17.11, and wal2json was rebuilt as `2.6-2+deb13u1`. An exact pin therefore breaks at each Debian point release. The dated snapshot archive is not a fallback: it was dropped on 2026-11-05 for 504s and is not reintroduced.

## Fix

Every stage moves together, so builders and runtime keep one ABI (`docs/changelog/2026-11-13-fixture-builders-hold-postgres-17-11.md`):

- runtime, `supautils-builder` (inherited by `cron-builder` and `safeupdate-builder`) and `genuine-providers-builder`: PostgreSQL packages at `17.12-0+deb13u1`; wal2json at `2.6-2+deb13u1`; pgvector stays `0.8.0-1`. All seven pins were read from the trixie and trixie-security amd64 `Packages` indexes on 2026-11-21.
- `native-smoke.mjs` (the `postgres --version` stage and its evidence record), `operations/release/ci/fixture-smoke.py` and `tests/operations/fixture-smoke-runner.test.py` expect 17.12.
- `operations/release/fixture/README.md` names the new versions and the wal2json package SHA-256.

## Durable guard

`operations/release/fixture/debian-pins.py` reads the Dockerfile's `deb` sources and every exact `package=version` apt pin, downloads each source's amd64 `Packages` index once, and exits 1 naming each pin no source serves, with the versions it does serve. It is the first step after checkout in `component-fixture-native-smoke.yml`, so the next point release fails in seconds with the missing version named, instead of after the dependency and image builds. It runs only inside that existing workflow: no cron, schedule or watcher. Against the previous Dockerfile it names all six dropped pins. `tests/operations/fixture-debian-pins.test.py` (offline) and `tests/the-fixture-builders-share-the-runtime-postgres.law.test.ts` require the step to precede the build, and the smoke, runner and Dockerfile to name one point release.

## Left unchanged on purpose

The separately source-built native `pg_dump` 17.11 client (`native-dump-diagnostic.*`, the `schema-snapshot` `native_client` `source_version '17.11'`, `scripts/dr`), historical evidence, the bbj-bank-replay probes and `.github/actions/install-postgres-17` are distinct contracts. A 17.11 `pg_dump` reads a 17.12 server of the same major. The `output_plugin_libraries` setting the fixture relies on is present in the PostgreSQL 17.12 source (`guc_tables.c`).
