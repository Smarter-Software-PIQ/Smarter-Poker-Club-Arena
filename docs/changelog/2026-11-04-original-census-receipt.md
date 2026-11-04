# Original census timing without another scan

The existing main-thread diagnostic workflow can read the ten scalar counters
already retained by the native addon from failed operation 41873097694-1. The
reader pins the original full engine revision, instance, durable intent,
container/image/PID/start, addon cache path/source and attempt timestamps. A
missing or changed witness is UNKNOWN. It never reloads the addon, runs another
census, requests GC, changes game state or advances a release.

The same release lock and owned Inspector lifecycle protect the read. The
original native shutdown owns the close handshake; success requires confirmed
closure and unchanged process/container identity. Focused regressions exercise
a real CommonJS cache entry after file removal, closed scalar validation,
foreign/stale identity refusal, lock contention and before/after readbacks.
The receipt mode permits three discovery/readback rounds, with the existing
one-second discovery and five-second Inspector-command bounds. Its worst nested
work and recovery path is under 66 seconds including leftover timer settlement;
the host allows 75 seconds for that inner operation and the SSH carrier allows
105 seconds for connection plus before/after Docker reads. CPU mode is unchanged.

This observation can separate time before the first valid predicate from the
remaining scan. The old addon cannot separately attribute GC inside that first
interval. Source qualification is not evidence that the cache still exists in
production, nor a deployment or tournament-relaunch result.
