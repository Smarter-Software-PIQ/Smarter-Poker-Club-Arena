# Retired Table Engines Are Collectable, And The Engine Heap Has A Ceiling

## What Production Showed (2026-11-02, engine-01, release eed06fe5)

- 43 container restarts since Oct 29; 15 in the last 72 hours were V8
  "Ineffective mark-compacts near heap limit". Node 22's default main heap
  limit on this host is 4144 MB.
- After the 13:10 UTC restart `poker_engine_heap_used_bytes` read 1.17 GB at
  13:25, 1.97 GB at 13:37, 2.20 GB at 13:43, 2.52 GB at 13:50, 2.79 GB at 14:00
  and 3.13 GB at 14:04: about 2 to 4 GB an hour, an OOM every 1 to 3 hours.
- In one 30-minute log window the engine created about 8,700 table engines and
  stopped about 8,700 (roughly 220 a minute, spikes to 780). 14,694 lines were
  "Diamond Tournaments Are Not Open" across only 91 distinct tables, plus 7,330
  `Tournament.table_engine_readmission_failed`: closed Diamond tournament tables
  being re-admitted and refused in a loop, and 134 dark-tournament manager
  rebuilds in the same window.
- A low-impact V8 sampling heap profile (no snapshot, 256 KB sampling interval,
  four minutes) attributed the largest share of retained allocation to engines
  built by `admitMissingManagedTableEngine -> createManagedTableEngine ->
bindTournamentDataAuthorityMethods`, i.e. retired table-engine generations
  that were still reachable.

## Root Cause

eed06fe5's `GameServer.weeklyPayoutTableListeners` is a strong
`Map<ServerTableEngine, unsubscribe>`. Every adoption (`registerTableEngine`,
`replaceTableEngine`, cash wake, weekly-payout refresh) adds the engine and only
process shutdown removes it, so every retired generation stays reachable with
its hand controller, telemetry rings and bound tournament methods. #8692 (on
main since Oct 29, not in eed06fe5) made it a `WeakMap` and released it on every
registry exit. The closed Diamond Arena turned a slow leak into a fast one by
retiring thousands of generations an hour.

Reproduced with the real `GameServer` and `ServerTableEngine` and a forced full
GC: eed06fe5 retains 24 of 24 retired generations in each of four exit paths;
main retains 0.

## What This Change Adds

- `server/src/aRetiredTableEngineIsCollectable.law.test.ts`: the property the
  process needs, independent of which registry caused it. A generation that has
  been stopped and has left the GameServer (tournament unregister, failed-start
  fence, replacement, cash unregister) must be collectable. Fails on eed06fe5,
  passes on main, and fails again if any future registry keeps engines alive.
- `server/Dockerfile`: `NODE_OPTIONS` now carries
  `--max-old-space-size=6144`. This is headroom, not the fix. Every docker exec
  probe passes its own explicit `--max-old-space-size`, which still wins
  (verified with Node 22: NODE_OPTIONS 6144 plus argv 128 gives a 224 MB limit).
  The legacy census gate reads the serving eed06fe5 heap at 12 ms per MB against
  59,000 ms, so it fits below about 4,900 MB; that gate only applies to an
  eed06fe5 predecessor, which still runs with the old default.
- `tests/engine-release-seal.law.test.ts`: the builder heap check now reads only
  the compiler `RUN` line, so the runtime ceiling is not mistaken for a builder
  heap.

## How To Confirm After Release

On the first served release containing #8692 and this change,
`poker_engine_heap_used_bytes` should level off within the first hour after
boot instead of climbing 2 to 4 GB an hour, and the container `RestartCount`
should stop increasing from heap exhaustion.
