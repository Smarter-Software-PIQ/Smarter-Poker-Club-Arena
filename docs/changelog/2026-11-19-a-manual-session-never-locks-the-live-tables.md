# A manual session never locks the live tables (2026-11-19, incident 075013fd)

## What happened

2026-11-18 23:32:25-23:34:19 UTC. Two direct `postgres` sessions through
Supavisor's transaction pooler ran
`supabase/migrations/20260308_tournament_bounties_and_columns.sql` against
production. From the logs (postgres_logs, supavisor_logs, `ca_ddl_events`):

- login role `postgres`; `application_name` "Supavisor" (the client set none
  of its own); transaction mode (port 6543);
- client address 24.15.206.254, the same fixed non-cloud address that runs
  `psql` session-mode work against production all day; GitHub's runners
  connect from Azure ranges with `psql` and never in transaction mode. One
  failed password authentication from it at 23:32:17;
- backends 2810985 (session `6afe3589.2ae469`, from 23:32:25) and 2811113
  (`6afe35a1.2ae4e9`, from 23:32:49), the same file 24 s apart;
- the first send was the whole file, refused by the parser
  (`CREATE POLICY IF NOT EXISTS` does not exist); then each statement was sent
  on its own, in autocommit, and the client carried on past every error,
  including three cancels by `fn_ca_table_stall_watch_tick`;
- 30 `ALTER TABLE tournaments|tournament_players ADD COLUMN IF NOT EXISTS`
  for columns that already existed, each queued for ACCESS EXCLUSIVE for up to
  7.9 s; tournaments stalled ~100 s, 13 cash tables 16-57 s.

The version `20260308` is not in `schema_migrations` and no workflow, script
or cron in this repository sends that file (or any migration file other than
through `apply-recorded-migration.mjs`). The sender was an ad-hoc session
outside the repository, so it cannot be fixed in a file here; the database now
refuses it, whoever it is. The writer-lock sentinel never qualified it,
because each statement was its own transaction younger than 15 s.

## The fix

Migration `20261119053515_a_manual_session_never_locks_the_live_tables.sql`:

- `smarter_private.ca_live_tables`: the 31 tables whose writer-blocking lock
  stalls live play.
- Event trigger `ca_live_tables_refuse_manual_ddl` (ddl_command_start, before
  any relation lock) refuses, for any `postgres` session that is not the
  claimed applier, ALTER TABLE / index / trigger / policy / rule / DROP TABLE
  DDL naming a live table, and CREATE TABLE that REFERENCES one.
  CONCURRENTLY index builds sent alone are allowed.
- `ca_live_tables_refuse_manual_ddl_held` (ddl_command_end) refuses the same
  commands if the transaction holds a writer-blocking lock on a live table
  anyway (dynamic SQL).
- ADD COLUMN IF NOT EXISTS of a column a live table already has is refused
  before its lock for everyone, the applier included.
- The applier marker: `migration-session-identity.mjs` now opens every
  applier transaction with `smarter_private.fn_ca_migration_applier_claim`
  for the exact history row the applier writes. The claim row is bound to the
  backend (pid, backend start) and transaction (xid) and returns a random
  nonce into `ca.migration_applier_claim`; a deferred constraint trigger
  refuses the COMMIT unless that version, name and source md5 were recorded in
  the same transaction; a claim for a recorded version or name is refused
  (`migration_already_applied`). `application_name` proves nothing on its own.
- `apply-merged-migration.yml` and the daily window installer both go through
  `apply-recorded-migration.mjs`, so both claim. Before the claim function
  exists the claim block does nothing, so the guard's own install and every
  fixture without it are unchanged.

Not covered: LOCK TABLE, TRUNCATE, VACUUM FULL, CLUSTER (event triggers do not
fire for them); the writer-lock sentinel still cancels those after 15 s.

## Proof

`scripts/ci/test-manual-ddl-guard-postgres.py`, run by
`.github/workflows/manual-ddl-guard-proof.yml` on PostgreSQL 16 and 17: a
manual session is refused in about 10 ms with a reader holding ACCESS SHARE
and `lock_timeout` 30 s; the incident file replayed statement by statement is
refused at every live-table statement in 66 ms and changes nothing; the
applier's bound transaction (its real history template and binder) installs
DDL on a live table; a re-run of that version is refused; a claim without its
history cannot commit; a no-op IF NOT EXISTS is refused without ever queueing
a lock. Law: `tests/a-manual-session-never-locks-the-live-tables.law.test.ts`.
