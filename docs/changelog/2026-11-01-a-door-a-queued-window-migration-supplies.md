# 2026-11-01: a door a queued window migration supplies

Owner order (Dan, 2026-11-01): "FIX ANY AND ALL BLOCKERS NOW AND FINISH THIS UP, PUSH AND PUBLISH EVERYTHING."

## The blocker

From #9054 (merge `0d7cd8df4e`), every engine release request failed the receiver job "Prove The Exact Engine Has Every Production Door" with this message:

> fn_ca_cancel_tournament_abort_unsettled_hand() is called by server/src/tournament/TournamentManagerBase.ts and does not exist in production.

Refused attempts are recorded in `ca_engine_deploy_attempts` at 07:21, 07:35, 08:13 and 08:19 UTC.

The function is created only by `20261101005048_operator_closure_records_a_stopped_unsettled_hand_dispositio.sql`. That migration declares `-- @install-window: daily-maintenance` because it adds triggers to `hand_history` and five custody tables. Only the "Install Queued Daily-Maintenance Migrations" job of `stage-engine-release.yml` installs it, inside the 04:00 America/Chicago freeze. The door check runs about 25 minutes before that freeze. So a build that needs the migration could never pass: the build had to reach the freeze before its door existed, and the door check would not let it through until the door existed.

## The design

The requirement is carried, not waived.

1. **Receiver door check** (`scripts/ci/check-engine-doors-exist.mjs`). A missing door is *carried* only when all of these hold:
   - A migration in the target tree creates it in schema `public`. That migration declares the daily-maintenance window and is not `SUPERSEDED BY` a file in the tree. These are the same rules the window installer uses to build its queue.
   - Production's `schema_migrations` does not record that migration yet. The check uses the installer's three keys: version, name, and the 55-character name prefix.
   - The target does not carry a still-live owner-window activation floor.
   - The release is not a rollback.

   Unreadable history refuses. A door whose supplier is already recorded still refuses, because the window cannot create it again. If any missing door is unsupplied, the whole build refuses and names only those doors. A carried door is announced with a notice and goes out as the step output `window_doors=name@version,...`.

2. **Receiver deploy job** (`auto-deploy-hetzner.yml`). The job validates the list on the runner. Before `install-engine-intake.sh` runs, it binds the list to the run key as `/var/lib/club-arena/engine-release-requests/<run>.window-doors`. The record has mode 0600, a schema line, the target SHA, and one `name version` line per door. This follows `install-engine-drill.sh`:
   - a reattach finds the same bytes;
   - a different record is refused;
   - a request already on disk without a record is refused.

3. **Host transaction** (`engine-release-transaction.sh`). It reads the record strictly; an absent record means an ordinary release, unchanged. Then:
   - `request_recovery_window` returns before asking. Such a release never opens an off-cycle window.
   - After a certificate, any break that is not the daily 04:00 Chicago freeze is declined. This happens before the lock, the prepare and any mutation, using the same predicate as `maintenance_certificate`.
   - The final pre-seal database proof gets `--require-function` for each carried door.

4. **Database proof** (`engine-release-database-proof.py`). Inside its existing bounded poll, it reads the carried doors through the new read-only RPC `fn_ca_engine_release_missing_functions(text[])` (migration `20261101134516`, STABLE, invoker, service_role only).
   - The doors are read before the leader witness, so the leader stays the last read before the seal.
   - Once a door is seen it is not re-read.
   - If a door is still missing or unreadable at the proof's unchanged deadline, the proof refuses the seal. The existing recovery then restores the sealed predecessor inside the 135 s reserve. "Unreadable" and "missing" are reported as different states.

## Why the proof is not a single read before the replacement

The task proposed re-verifying before the swap. The two jobs do not wait for each other: the window installer and the release transaction both start on the same confirmed freeze. Measured from production:

| Break (UTC) | Window install committed | Predecessor ready for restart |
| --- | --- | --- |
| 2026-10-26 09:00 | 09:00:27.96 | - |
| 2026-10-27 09:00 | 09:00:18.38, 09:00:19.31 | 09:01:18.1 |
| 2026-10-28 09:00 | 09:00:24.67 | 09:00:23.77 |
| 2026-10-29 09:00 | 09:00:20.37, 09:00:22.50 | - |

Install times come from `ca_break_window_migration_overrides` and restart readiness from `engine_maintenance_break_log`. On 2026-10-28 the predecessor was ready for restart one second *before* the install committed. A single pre-replacement read would race the installer and refuse good releases. Waiting there would spend the candidate-proof budget that the 285000/260000/245000 ms ladder already allocates.

The final pre-seal proof has the order guaranteed:
- The installer starts only with at least 150 s left in the break and commits within 8 s, so its last possible commit is at least 142 s before the end.
- The proof must finish before the 135 s rollback reserve.
- Both happen before the thaw, which starts 90 s before the end.

The proof already polls (5 s) inside its existing `DB_TIMEOUT` (17-60 s, clamped to the break-proof budget). In practice it runs 60-150 s into the break, far after the 18-28 s commits above.

The cost of a refusal there is the existing rollback inside the frozen break: the predecessor comes back, and no player action happens in between. That is the same path every failed candidate proof already takes.

Every pinned ceiling is unchanged: 120 s lead, 300 s freeze, the 285000/260000/245000 ms ladders, the 40 s checkpoint including 5 s cleanup, 150 s candidate proof, 135 s rollback reserve, and the 17-60 s final proof.

## Safety argument

- **No build is sealed calling a function production lacks.** The seal requires every carried door to be read as present in `pg_proc` after the window installer's commit, before the thaw. "Could not tell" refuses (CLAUDE.md 10.86).
- **No off-cycle freeze is spent on it.** The transaction never requests a window for such a release and declines any other break before mutating anything.
- **Nothing outside the carried list relaxes.** Other missing doors, continuation histories, the retained-checkpoint contract, allowlists and rollback policy are unchanged.
- **One window migration installs as one transaction.** If its created function is present, its replaced function bodies and triggers are present too.

## Pinned by

- `tests/a-door-a-queued-window-migration-supplies.law.test.ts` (registry: `docs/laws.d/tests-a-door-a-queued-window-migration-supplies.md`)
