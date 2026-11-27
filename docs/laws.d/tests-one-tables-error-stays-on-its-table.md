# tests/one-tables-error-stays-on-its-table.law.test.ts

One table's error stays on its table. `server/src/index.ts` used to send every
uncaughtException and unhandledRejection to `fatal()`, so one stray throw in
one table's timer or one rejected promise in one table's hand pipeline
restarted every table and voided every hand in play. Every per-table entry
point now runs through `server/src/engine/TableFaultBoundary.ts`, which kills
only that engine generation (`killForRestart`, owner rebuild, crash recovery).
The law parses every ServerTableEngine source file and refuses a raw
setTimeout, setInterval, setImmediate or queueMicrotask outside the contained
helpers (a callback that only settles its own promise is exempt) and a bare
`void call()` without its own `.catch` (use `detachTableWork`). It also pins
the DeadlineScheduler hand-off to the table's sink, the engine's sink
registration, and the process handlers routing through `routeProcessFault`,
which keeps `fatal()` for every unattributed error.
