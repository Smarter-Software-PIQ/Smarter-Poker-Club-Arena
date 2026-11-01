# 2026-10-31 - Client: realtime degradation, error-sink cap, dead-table recovery, 10-max seats

Phase 5 of the October 31 Platform Health programme. Client-only: no engine API changes,
so it publishes through `publish-club-arena.yml` without an engine window.

- **Realtime degradation policy** (`src/lib/realtimeDegradationPolicy.ts`, MasterBus hooks).
  A failing channel resubscribes once immediately, then backs off 1 s to 30 s with jitter,
  and the player sees one degraded notice instead of a reconnect storm.
- **Client error sink cap** (`src/utils/clientErrorSink.ts`). One looping error can no
  longer flood `client_error_events`.
- **Dead-table recovery** (`src/lib/deadTableRecovery.ts`). When a table page stops
  receiving state, it re-reads the table read-only and within a bound. It never takes,
  moves or releases a seat.
- **10-max seats** (`src/lib/tableSeatGeometry.ts`). The engine seats up to ten; the client
  now draws a tenth seat from positions the measured 3/5/6/8/9-max rings already use, so a
  hero in seat 10 renders.
- **Demo union link** renders "not found" instead of breaking the union route.
- **A synthesized pot_win is a warning**, not an error.
- **Certification residue sweep** is `workflow_dispatch` only. It has no schedule, per the
  no-new-automated-loop policy.

Verified locally: `tsc --noEmit` clean; the unit and hook tests touching these files
(71 files, 1,682 tests) pass.
