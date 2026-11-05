# An Operator Closure Hold Survives An Engine Restart

Date: 2026-11-05
Scope: tournaments, operator closure, engine adoption

## What Happened

PR #9536 taught the engine the closure hold. When an operator's equal-share
closure (`GameServer.acknowledgeTournamentAbortBoundary`, `closureMode`
`equal_share`) meets a playing manager that answers pending with
`original_graph_not_ready`, `physical_writer_not_drained` or
`original_table_coverage_incomplete`, the engine records the handoff in
`operatorClosureHolds` (a process-local Map), retires the playing generation,
and the next adoption in resume mode calls
`TournamentManagerBase.holdForOperatorClosure(operationId)` instead of
`manager.resume()`. The held copy builds no dealer and finishes the closure
from database records.

The Map was the only record. After the daily 04:00 Chicago restart it is
empty, so the first closure request after boot resumed a PLAYING copy, which
had to fail again with one of those reasons before the hold was re-armed.
Every restart cost an extra playing generation and retire cycle per held
event, and these closures are only admitted 04:00 to 06:00 Chicago for large
events (`smarter_private.bulk_closure_admission`), which is exactly the
window the restart falls in.

## Cause

The hold had no durable twin. `smarter_private.tournament_abort_targets`
already carries every other fact about the operator's request for the event
(operation, state, requested generation, quiescence, money snapshot,
receipt), but not that the engine had handed the event to a hold.

## Fix

Migration `20261105222134_an_operator_closure_hold_survives_an_engine_restart.sql`:

- `smarter_private.tournament_abort_targets` gains three nullable columns:
  `closure_hold_operation_id uuid`, `closure_hold_at timestamptz`,
  `closure_hold_reason text`.
- `public.fn_ca_record_tournament_closure_hold(p_operation_id, p_tournament_id,
  p_reason, p_generation)` sets the hold only when the target row belongs to
  that operation and is still `stop_requested` or `quiesced` and has not been
  withdrawn into recovery; otherwise it answers `ok=false` with a reason and
  writes nothing. Service role only.
- `public.fn_ca_clear_tournament_closure_hold(p_operation_id, p_tournament_id)`
  clears a hold that names that operation. Service role only.
- `public.fn_ca_read_tournament_closure_hold(p_tournament_id)` is the
  adoption-time read, keyed by tournament alone because a freshly booted
  engine does not yet know the operation. It answers the hold only while the
  target is `stop_requested` or `quiesced`, not withdrawn, and the hold names
  the target's own operation. Read-only, service role only.
- `public.fn_ca_tournament_abort_stop_state` gains a `closure_hold` key under
  the same rules, by exact-text patch of its installed definition inside a
  `DO` block that refuses unless the anchor matches exactly once.

The table is a small private table written only by the operator closure
doors, so the migration does not need the daily maintenance window; it takes
its lock once with a 1 s `lock_timeout`.

Engine (`server/src/GameServer.ts`):

- When the handoff arms the in-memory hold it also records it durably with
  the retiring generation and the refusing reason. A refused or failed write
  is logged once; the in-memory behaviour is unchanged and nothing throws.
- On adoption in resume mode, when the Map has no entry, the engine reads the
  durable hold after the lease is granted and before any resume. If it names
  this tournament's live operation, and the existing guards still hold (not
  the F06 recovery owner, still the manager in `tournamentEngines`, lease
  authority current), it arms the Map and calls `holdForOperatorClosure`
  exactly as the in-memory path does. `start` and `stage_resume` never
  consult it.
- The durable record is cleared on the same paths that delete from the Map:
  closure withdrawn (`state === 'recovery'`) and closure settled.

## How It Was Verified

- `server/src/tournament/OperatorClosureHoldSurvivesRestart.test.ts` runs the
  real `GameServer.performTournamentManagerAdmission` into the real
  `TournamentManager` with only the database modelled: a fresh server with an
  empty Map arms the hold from the durable record and never calls `resume()`
  or builds a dealer; an adoption with no record resumes as before; a record
  whose operation is not the live target operation, or on a settled target,
  is ignored; a start never consults the record; the handoff records the
  hold with reason and generation; a refused record keeps the in-memory hold;
  withdrawal and settlement clear the record.
- `server/src/tournament/OperatorClosureHold.test.ts` (PR #9536) and
  `aFreshAdoptionAsksTheDoorBeforeHoldingTheEvent.law.test.ts` still pass.
- `npx tsc --noEmit -p server` clean.
- `scripts/ci/migration-transaction-shape.mjs`,
  `scripts/ci/check-definer-authorization.mjs`,
  `scripts/ci/check-explicit-table-access.mjs`,
  `tests/a-merged-migration-must-be-live.law.test.ts`,
  `tests/unit/aMergedMigrationIsInstallable.test.ts` pass.

## What Is Left To CI And The Applier

The migration has not been applied to any database. It reaches production
only from protected main through `apply-merged-migration.yml` (CLAUDE.md
section 2 rule 11). Its `@live-proof` line checks the three columns, the
patched `closure_hold` key and the grants on all three functions once it has.
