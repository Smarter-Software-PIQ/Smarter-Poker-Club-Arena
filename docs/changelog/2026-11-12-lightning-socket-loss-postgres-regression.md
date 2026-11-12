# Retain the Lightning socket-loss regression

PR #10498 repaired unhandled errors on checked-out lane and fold PostgreSQL
clients. Its real PostgreSQL reproduction had remained uncommitted scratch.
The retained proof now runs in accounting shard 3, joined by the existing
required Server Engine check. No runtime, database or request semantics change.

`python3 -B scripts/ci/test-lightning-socket-loss-postgres.py` creates a disposable
PostgreSQL 17 with TCP disabled and uses real pg pools and real session factories.
Set `PG_BIN` and a short, task-owned external `TMPDIR` on the Mac. No production
URL or inherited PGHOST is used. Termination selects only fixture-role backends
with the probe's unique application name; only the runner's own cluster stops.

Each lane has commit, idle-loss and in-use-loss cases. Idle loss produces one
pool report per terminated socket. In-use loss returns the correct UNKNOWN code,
keeps the idle reporter silent, reaches the wrapper once, and reconciles zero
effects by its request ID. A subsequent commit in the same child process proves
survival and usable reacquisition. The nontransactional attempt count remains
exactly two including that next request, so a resend cannot be hidden by the
fixture's unique effect key. No uncaught-exception handler absorbs a crash.

The real checked-out client must also retain an error listener after pg-pool has
removed its idle listener. This deterministic assertion catches missing lifetime
coverage even when backend FATAL/query/release ordering happens to avoid a crash.
Removing only #10498's connect listener is the documented negative control:
lane reproduced an uncaught `Connection terminated unexpectedly`; fold crash
reproduction varied with event ordering, so its deterministic control asserts
missing checked-out coverage. Neither observation is generalized to all losses.

This fixture proves aborted/no-effect reconciliation only. Existing durable
request/receipt tests own committed-but-reply-lost outcomes. Production acceptance
remains separate: a qualifying release must serve #10498 with seal, full thaw
and resumed Lightning. Natural connection-error execution stays unverified when
no such event occurs on the corrected build; no production failure is induced.
