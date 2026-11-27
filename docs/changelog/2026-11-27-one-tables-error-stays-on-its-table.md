# One Table's Error Stays On Its Table (2026-11-27)

Engine reliability, finding 3 of the engine code review.

## Cause

`server/src/index.ts` sent every `uncaughtException` and every
`unhandledRejection` to `fatal()`, which drains and exits the whole engine. One
stray throw inside one table's timer, or one rejected promise in one table's
hand pipeline (a `void this.pacedAllInRunout(...)`, a scheduler callback),
therefore restarted every table on the box and voided every hand in play.

## Fix

- `server/src/engine/TableFaultBoundary.ts`: the boundary. `tableCallback`
  wraps a per-table callback, `detachTableWork` observes a per-table promise
  nobody awaits, and both hand a failure to that table's sink. Attribution is
  explicit only (no async-context guessing, because a lazily started
  process-wide timer inherits whatever context started it). A sink that throws
  is not containment: its error escapes unattributed and stays fatal.
- `ServerTableEngineBase`: `containTableFault` reports the error and calls the
  existing `killForRestart('contained_fault:<label>')`. The owner rebuilds that
  one table and the rebuilt engine's crash recovery replays or refunds the
  in-flight hand from its snapshot, exactly as for every other watchdog kill.
  Chips still move only at settlement: `stop()` joins any settlement already in
  flight before the table is released, and a fenced generation has no
  controller, so no hand event can dispatch from it. A generation already
  terminal (killed or stopped) only records a late fault; it is never rebuilt
  by one. New helpers `tableTimeout`, `tableInterval`, `tableImmediate`,
  `tableMicrotask` and `detachTableWork` replace every raw timer and every
  bare `void promise` in the ServerTableEngine files (17 timers, 73 promises).
- `DeadlineScheduler`: a throwing deadline (turn clock, heartbeat, insurance,
  run it twice, break) is still reported and the scheduler still serves every
  other table, and it is now handed to its table's engine sink, which the
  engine registers while it owns the table. A tableId with no engine keeps the
  old report-only behaviour.
- `index.ts`: `installProcessFaultHandlers(process, fatal)`. `routeProcessFault`
  contains only an error a table wrapper already attributed; everything else
  calls `fatal()` exactly as before.
- `server/src/observability/gcPauseMonitor.ts`: a `node:perf_hooks`
  PerformanceObserver on `gc` entries. A pause at or past 500 ms increments
  `poker_engine_gc_pause_long_total{kind}` and sets
  `poker_engine_gc_pause_longest_ms` on the always-on registry, and writes one
  throttled `engine_lifecycle_logs` row (`gc_pause_long`) and console line per
  minute carrying how many more were held. No heap flag or deploy script changed.

## Guard

- `tests/one-tables-error-stays-on-its-table.law.test.ts` (with
  `docs/laws.d/tests-one-tables-error-stays-on-its-table.md`) parses every
  ServerTableEngine file and refuses a raw timer or a bare `void call()`.
- `server/src/engine/oneTablesErrorStaysOnItsTable.test.ts`: real engines; a
  throw in table A's timer, a rejection in A's detached work and a throwing
  deadline for A each restart only A while B and C keep running; an
  unattributed error still calls `fatal`.
- `server/src/observability/gcPauseMonitor.test.ts`: threshold, window
  throttling, kind mapping and boot-time series.

## Not changed

Action handlers (`handlers/action.ts`, the WebSocket transport) already catch
per request and never reached the process handlers; they are unchanged.
