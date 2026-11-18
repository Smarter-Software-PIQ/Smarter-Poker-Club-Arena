# 2026-11-13: Fixture Builders Hold PostgreSQL 17.11

From about 10:20 UTC every pull request's `Native fixture prerequisites / native-smoke` failed with 58P01 (`internal_load_library`) in `fixture-preimage-current-application-role-extension`, which fails the required `TypeScript Check` for the whole repository.

Cause, read from the passing (09:36 UTC) and failing (13:39 UTC) image build logs: trixie-security published PostgreSQL 17.12. The runtime stage pins `postgresql-17=17.11-0+deb13u1`, but the `supautils-builder` install named only `postgresql-server-dev-17=17.11`, so its unpinned `libpq-dev` dependency took `libpq5`, `libpq-dev` and `postgresql-17` to 17.12, and the `genuine-providers-builder` (`libgdal-dev` and friends) took `postgresql-server-dev-17` to 17.12. Native providers were then built against a server the runtime does not run.

Fix: both builder installs name `postgresql-17`, `postgresql-client-17`, `libpq5`, `libpq-dev` and `postgresql-server-dev-17` at `17.11-0+deb13u1`, the exact runtime version. Pinned by `tests/the-fixture-builders-share-the-runtime-postgres.law.test.ts` (fails against the previous Dockerfile). Moving the fixture to 17.12 is a deliberate version change for the runtime and builders together, never a side effect of a build dependency.
