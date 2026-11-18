# A lost Lightning socket does not restart the engine

At 09:55:38Z on 2026-11-11 production restarted outside the break (EngineRestartedOutsideTheBreak, SLOEngineAvailability 95.65%, then HorseFleetCollapsed while the fleet rebuilt). The engine log shows the cause: `[GameServer.Uncaught_exception] Error: Connection terminated unexpectedly` from `pg/lib/client.js`, immediately followed by `[LightningLaneSession] fn_lightning_match_and_form outcome unknown`, then the supervisor drain. No earlier engine log on the host (six generations back to 2026-11-06) contains an uncaught exception; the dedicated Lightning lane pool shipped with engine 05ab41c3 the same morning.

Cause: `lightningLaneSession` and `lightningFoldSession` listen for `error` on the pool only. pg-pool removes that listener from a socket while it is checked out (pg-pool 3.14 `_acquireClient`), and pg emits a lost backend on the client itself. An EventEmitter `error` with no listener throws, so one lost in-use socket was an uncaught exception, and the engine's uncaught handler drains for a supervisor restart.

Reproduced against a real PostgreSQL 17 and the engine's own `pg` 8.23.0: check a socket out of a `pg.Pool`, `pg_terminate_backend` it, and the process records two uncaught exceptions (`terminating connection due to administrator command`, `Connection terminated unexpectedly`). With a listener attached through the pool's `connect` event it records none.

Fix: both sessions attach an `error` listener to every socket the pool connects, for the socket's whole life, registered before the first `connect()`. The call holding the socket still sees its queries rejected, resolves the outcome as unknown exactly as before, and destroys the socket on release. Regression tests in both session test files use a real EventEmitter so a missing listener throws; they fail on the previous source and pass on this one.

Delivery is an engine component change and ships through the existing engine release route.
