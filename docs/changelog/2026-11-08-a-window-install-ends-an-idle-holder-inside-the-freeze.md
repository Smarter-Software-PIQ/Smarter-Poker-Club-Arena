# A window install ends an idle holder inside the freeze (2026-11-08)

## The defect

A `-- @install-window: daily-maintenance` file gets one attempt with a 1 s
`lock_timeout` inside the confirmed 04:00 America/Chicago freeze. The quiet
moment (#9904) waits up to 12 s for a holder that is working. It cannot help
with a session left `idle in transaction` (an abandoned psql, management-API,
CLI or dashboard session): that session keeps its locks until it is closed, so
the file was refused and stayed queued for a full day, every day the session
stayed open.

## The fix

`scripts/ci/install-window-migrations.mjs`, immediately before each declared
file's single attempt, runs one statement
(`IDLE_BLOCKERS_TERMINATE_QUERY` in `scripts/ci/maintenance-window-migrations.mjs`)
that:

1. re-checks the daily window predicate with `TERMINATE_RESERVE_SECONDS`
   (start reserve + 3 s) and examines nothing if it is not open;
2. finds sessions holding or queued for a lock that conflicts with the file's
   on a relation the file declares with `-- @locks:`;
3. keeps only client backends of the postgres role family that are
   `idle in transaction` for at least `IDLE_HOLDER_MIN_IDLE_MS` (2 s), not
   superusers, not `supabase_*`, not pg_cron, not the installer or applier
   (production: `postgres` and `cli_login_postgres`; PostgREST's
   `authenticator` and the engine roles are never members);
4. terminates them with `pg_terminate_backend(pid, 1000)` and records each in
   the new `public.ca_window_install_terminations` (migration
   `20261108035024`, no foreign key) in the same statement.

The quiet wait now stops early when every holder it sees is idle on a declared
relation, so the break is not spent waiting for a session that will never end.
Nothing else moves: one attempt per file, the 1 s `lock_timeout`, the 8 s
budget, skip-alone and UNKNOWN-stops. Never in an owner window, never for an
undeclared file. If the record table is missing the statement fails and
terminates nothing.

## Proof

- Law: `tests/a-window-install-ends-an-idle-holder-only-inside-the-freeze.law.test.ts`.
- Native (real PostgreSQL, real installer and applier, case 13 of
  `scripts/ci/test-maintenance-window-migrations.sh`): an idle postgres
  session on a declared relation is terminated, recorded, and the file
  installs; an active query and an idle superuser session are untouched and
  the file is refused once; an undeclared file terminates nothing; with no
  confirmed freeze the statement terminates nothing.
