# A held table is a stalled table, and the release gate proves each one (2026-11-06)

## What broke

- Sunday Deep Stack Satellite 25 sat nine hours with five tables parked behind its qualifier boundary and one holding a hand that never started, while `/health` reported `stalledTableCount: 0`. The stall census only looked at tables that were not paused by design.
- The restart certificate published how many tables held it shut and why, never which, so the release gate could only prove "no hand in the air anywhere".
- A release whose certificate could not open still announced its Deployment Recovery break and paused every table for five minutes before backing out (42139090188-1, 01:22Z).

## The fix

- `engine/heldTableStall.ts` + `GameServer.heldStalledTables()`: a seated table held past its bound by a boundary owner or a never-started original is added to `/health stalledTables` with `reason` and `heldBy`. Identification only, kept out of the liveness verdict. `ServerTableEngineBase.describePauseOwners()` names every authority `isPausedByDesign()` reads.
- `MaintenanceBreak`: `maintenance.unparkedTableIds` (bounded to 64) names each counted table and, for a held original, its permit and hand (`describeHeldOriginalAtPauseGate()`); `maintenance.restartPrecheck` names blockers no break can clear.
- `engine-release-transaction.sh`: the certificate passes the named cards_in_air tables to `engine-release-inflight-hands.py --tables`, which proves each one on top of the fleet-wide read; names that do not account for every table refuse. `request_recovery_window` does not ask for a window while `restartPrecheck.persistent` names anything.

## Laws

- `server/src/engine/aHeldTableThatNeverLiftsIsStalled.law.test.ts`
- `server/src/maintenance/theRestartGateNamesItsTables.law.test.ts`
- `tests/a-named-cards-in-the-air-table-is-proved-one-by-one.law.test.ts`
- `tests/operations/inflight-hands-named-tables.test.py`
