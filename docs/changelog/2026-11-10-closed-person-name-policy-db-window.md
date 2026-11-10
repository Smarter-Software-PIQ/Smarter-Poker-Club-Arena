# One database-only break for the closed-person read policy

The read policy `20261110003726` closes the last place a closed person's recorded tournament name is returned to ordinary callers: the `tournament_players` table itself. It needs a lock on that table, so it may only install inside a platform freeze.

On November 10 the daily window skipped it. The scheduled preparation events arrived about two hours late (11:34 and 12:50 UTC), so no daily preparation was admitted, and the 09:50 UTC owner engine dispatch does not run the queued window migrations.

Dan authorized one database-only Deployment Recovery break today. The window `2026-11-10-closed-person-name-policy-db` names only this file: players are told at 16:40 UTC, and the break may run between 17:00 and 22:00 UTC. The stage workflow is dispatched with `request_database_break=true`. The installer makes one attempt with a 1 s lock timeout, the tables thaw, and the serving engine is not replaced. The entry expires at 22:00 UTC.

## First break: unproven, nothing installed

Run 42861001229 announced the break at 17:04:54 UTC. One table was still finishing a hand when the controller's deadline passed: it needs every table parked with 285 seconds of the break left. The controller therefore refused to send the migration (`Full 285-second drained/frozen reserve was not certified`). The tables thawed at 17:11:54, the serving engine was unchanged, and the receipt reads `result: unproven`, `installer: unknown`, `thawed: true`. `20261110003726` is still not recorded in `schema_migrations`.

Dan then authorized one more break before 22:00 UTC. The window `2026-11-10-closed-person-name-policy-db-retry` names the same file: players are told at 18:10, and the break may run between 18:30 and 22:00 UTC. It is dispatched once.
