# Bounded equity requests and worker memory ownership

An equity worker error previously removed the worker from capacity accounting before its asynchronous termination completed. Replacement workers could therefore overlap the memory of retiring workers. Retirement now retains capacity until termination completes, shutdown joins every owned termination, and the singleton cannot be replaced while shutdown is incomplete. Failed termination remains an explicit failure. The bounded routing grace period uses a monotonic clock, so wall-clock corrections cannot extend or prematurely exhaust it.

The request queue now has independent count and serialized-payload byte ceilings. Requests retain bounded copies of calculator fields, rather than arbitrary caller-owned graphs. Insurance can displace queued cosmetic requests, but never active computations or admitted insurance. Existing caller deadlines and fail-closed hand continuation remain intact. Queue bytes are released on dispatch, expiry, rejection and shutdown.

The existing health response and metrics expose actual main-isolate heap limits and available/constrained memory. Existing equity READY/result messages carry worker-authored isolate samples. Unknown measurements remain unknown. These observations neither traverse heaps nor trigger collection, repairs or restarts.

Regression coverage includes deferred/failed termination, singleton shutdown ownership, queue count and byte pressure, insurance priority, sparse/oversized inputs, detached request data, and a real bundled worker with independently known outcomes. `node server/scripts/qualify-equity-memory.mjs 120` runs a finite isolated mixed calculator qualification and reports samples; it is not whole-engine or production capacity certification.

This change alone does not establish a host resize requirement, remove the V8 main heap ceiling, prove long-term memory stability, or complete the nine-phase reliability programme. Protected delivery and actual engine adoption must be verified separately.
