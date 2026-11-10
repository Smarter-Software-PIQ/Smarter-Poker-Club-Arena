# One database-only break for the closed-person read policy

The read policy `20261110003726` closes the last place a closed person's recorded tournament name is returned to ordinary callers: the `tournament_players` table itself. It needs a lock on that table, so it may only install inside a platform freeze.

On November 10 the daily window skipped it. The scheduled preparation events arrived about two hours late (11:34 and 12:50 UTC), so no daily preparation was admitted, and the 09:50 UTC owner engine dispatch does not run the queued window migrations.

Dan authorized one database-only Deployment Recovery break today. The window `2026-11-10-closed-person-name-policy-db` names only this file: players are told at 16:40 UTC, and the break may run between 17:00 and 22:00 UTC. The stage workflow is dispatched with `request_database_break=true`. The installer makes one attempt with a 1 s lock timeout, the tables thaw, and the serving engine is not replaced. The entry expires at 22:00 UTC.
