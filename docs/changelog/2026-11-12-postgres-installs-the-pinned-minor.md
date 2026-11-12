# CI Installs The PostgreSQL Minor The Native Tools Are Built For

On 2026-11-12 PGDG published PostgreSQL 17.12. The shared installer (`.github/actions/install-postgres-17/install.sh`) asked for a floating `postgresql-17`, so runners moved to 17.12 while `scripts/ci/build_pg17_isolationtester.py`, the funded BBJ replay and the probe manifests that hash that builder all require exactly 17.11. Every accounting shard that builds the isolation client then failed before reaching a test: `packaged server: exactly PostgreSQL 17.11 required` (#10605 run 43252372017, #10604 run 43251290554, #10599). No server pull request could pass its required checks.

The installer now reads the minor from `VERSION` in that builder and installs `postgresql-17`, `postgresql-client-17` and `postgresql-server-dev-17` at the newest signed PGDG build of that minor (17.11-1.pgdg26.04+2 is still in the signed index). When the server is requested the client is pinned with it, so the server does not pull a newer client. `PG_SERVER_MINOR` overrides the minor for a deliberate move. If the index no longer offers the pinned minor the install fails by name instead of drifting.

Nothing bound to 17.11 changes: the builder, its source digest, the probe and qualification manifests and the funded replay are untouched. Trust is unchanged: the same signed Ubuntu and PGDG sources, the checkout key, the same four retried apt calls. Moving to 17.12 remains one reviewed change to the builder and what binds it.

Regression: `tests/postgres-installs-from-one-shared-action.law.test.ts` runs the pin block against a stub index that offers a newer minor first, and covers the client-only request, a vanished minor and the explicit override.
