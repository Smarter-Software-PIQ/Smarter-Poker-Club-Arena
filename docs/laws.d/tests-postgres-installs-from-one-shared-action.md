# tests/postgres-installs-from-one-shared-action.law.test.ts

Every workflow installs PostgreSQL through one shared installer, `.github/actions/install-postgres-17` (or its `install.sh`). No workflow keeps its own inline PGDG install. The installer reads only the signed Ubuntu and PGDG sources, uses the byte-pinned checkout key at the `Signed-By` path and creates no default cluster. Every apt call has bounded retries, so a network blip no longer fails about seventy jobs one at a time (2026-11-07).
